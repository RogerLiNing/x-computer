/**
 * WhatsApp 渠道服务（R052）：参考 Openclaw，使用 Baileys（WhatsApp Web）实现双向通信。
 * - QR 码登录
 * - 发送消息
 * - 接收消息并触发 whatsapp_message_received 信号
 */

import makeWASocket, {
  useMultiFileAuthState,
  type WASocket,
  type BaileysEventMap,
  type WAMessage,
  Browsers,
} from '@whiskeysockets/baileys';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent } from 'undici';
import { Boom } from '@hapi/boom';
import path from 'path';
import os from 'os';
import fs from 'fs';
import QRCode from 'qrcode';
import { v4 as uuid } from 'uuid';
import { serverLogger } from '../observability/ServerLogger.js';
import { getSystemProxy } from '../utils/systemProxy.js';

const CREDENTIALS_BASE = path.join(os.homedir(), '.x-computer', 'credentials', 'whatsapp');

export interface WhatsAppConfig {
  enabled?: boolean;
  dmPolicy?: 'allowlist' | 'open' | 'disabled';
  allowFrom?: string[];
  groupPolicy?: 'allowlist' | 'disabled';
  groupAllowFrom?: string[];
  /** 是否接收「发给自己」的消息（与自己的对话），默认 false */
  allowSelfChat?: boolean;
  textChunkLimit?: number;
  mediaMaxMb?: number;
  sendReadReceipts?: boolean;
  /** 代理 URL，如 http://127.0.0.1:7890，国内需配置才能连接 WhatsApp */
  proxy?: string;
}

function parseWhatsAppConfig(raw: string | undefined): WhatsAppConfig | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    return o as WhatsAppConfig;
  } catch {
    return null;
  }
}

/** 将号码转为 E.164 风格用于比对（去掉 + 和 @s.whatsapp.net 等） */
function normalizePhoneForAllowlist(phone: string): string {
  return (phone || '')
    .replace(/^\+/, '')
    .replace(/@.*$/, '')
    .replace(/\D/g, '');
}

/** 检查 JID 是否在白名单内 */
function isAllowed(config: WhatsAppConfig | null, fromJid: string, isGroup: boolean): boolean {
  if (!config) return false;
  if (config.dmPolicy === 'disabled') return false;
  if (isGroup) {
    if (config.groupPolicy === 'disabled') return false;
    if (config.groupPolicy === 'allowlist' && config.groupAllowFrom?.length) {
      const fromNorm = normalizePhoneForAllowlist(fromJid);
      return config.groupAllowFrom.some((a) => normalizePhoneForAllowlist(a) === fromNorm);
    }
    return true;
  }
  if (config.dmPolicy === 'open') return true;
  if (config.dmPolicy === 'allowlist' && config.allowFrom?.length) {
    const fromNorm = normalizePhoneForAllowlist(fromJid);
    return config.allowFrom.some((a) => normalizePhoneForAllowlist(a) === fromNorm);
  }
  return false;
}

/** 从 WAMessage 提取文本 */
function extractText(msg: WAMessage): string {
  const m = msg.message;
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption;
  return '';
}

/** 判断是否为群组 JID */
function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** 需要重连的状态码（参考 OpenClaw Issue #21474、Baileys 文档） */
const RECONNECT_STATUS_CODES = new Set([
  408, // Request Timeout
  428, // Precondition Required
  515, // Stream Errored (restart required)
]);
const MAX_RECONNECT_RETRIES = 12;
const BASE_RECONNECT_DELAY_MS = 2000;

/** 单用户 WhatsApp 连接管理 */
class UserWhatsAppConnection {
  private sock: WASocket | null = null;
  private authPath: string;
  private qrCallback: ((qr: string) => void) | null = null;
  private connectedCallback: (() => void) | null = null;
  private disconnectCallback: ((reason?: string, detail?: string) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  /** 重试次数，成功连接后重置；用于指数退避 */
  private reconnectRetryCount = 0;
  /** 实际连接状态：仅当 Baileys 发出 connection===open 时为 true，disconnect/close 后立即为 false */
  private connectionOpen = false;

  constructor(
    private userId: string,
    private getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
    private onMessage: (userId: string, msg: { fromJid: string; text: string; messageId?: string; timestamp?: number; isGroup: boolean }) => void,
  ) {
    this.authPath = path.join(CREDENTIALS_BASE, userId);
    fs.mkdirSync(this.authPath, { recursive: true });
  }

  setQrCallback(cb: (qr: string) => void): void {
    this.qrCallback = cb;
  }

  setConnectedCallback(cb: () => void): void {
    this.connectedCallback = cb;
  }

  setDisconnectCallback(cb: (reason?: string, detail?: string) => void): void {
    this.disconnectCallback = cb;
  }

  async connect(proxyOverride?: string, isReconnect = false): Promise<{ ok: boolean; qr?: string; error?: string }> {
    try {
      // 515/408/428 触发的重连：不清理 creds，否则会误删刚扫码尚未完全持久化的认证（导致反复要重新扫码）
      if (!isReconnect) {
        const credsPath = path.join(this.authPath, 'creds.json');
        if (fs.existsSync(credsPath)) {
          try {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            if (!creds.registered || !creds.me?.id) {
              serverLogger.info('whatsapp', '检测到未完成的认证，清理后重新开始');
              fs.rmSync(this.authPath, { recursive: true, force: true });
              fs.mkdirSync(this.authPath, { recursive: true });
            }
          } catch (e) {
            serverLogger.warn('whatsapp', '认证文件损坏，清理后重新开始');
            fs.rmSync(this.authPath, { recursive: true, force: true });
            fs.mkdirSync(this.authPath, { recursive: true });
          }
        }
      }
      
      const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
      const rawConfig = this.getConfig(this.userId, 'whatsapp_config');
      const config = parseWhatsAppConfig(rawConfig instanceof Promise ? await rawConfig : rawConfig);
      let proxyUrl = (proxyOverride ?? config?.proxy ?? process.env.HTTP_PROXY ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.https_proxy)?.trim();
      if (!proxyUrl) {
        const sys = getSystemProxy();
        if (sys) {
          proxyUrl = sys;
          serverLogger.info('whatsapp', `使用系统代理: ${sys}`);
        }
      }
      let wsAgent: import('https').Agent | undefined;
      let fetchAgent: ProxyAgent | undefined;
      if (proxyUrl) {
        const lower = proxyUrl.toLowerCase();
        
        // undici ProxyAgent 只支持 HTTP/HTTPS，不支持 SOCKS5
        if (lower.startsWith('socks')) {
          serverLogger.warn('whatsapp', `SOCKS5 代理暂不支持（undici 限制），请使用 HTTP 代理。当前 URL: ${proxyUrl}`);
          throw new Error('SOCKS5 代理暂不支持，请使用 HTTP 代理（如 http://127.0.0.1:10809）');
        }
        
        try {
          // 按照 OpenClaw 的方式：不传递额外配置参数
          wsAgent = new HttpsProxyAgent(proxyUrl);
          fetchAgent = new ProxyAgent(proxyUrl);
          serverLogger.info('whatsapp', `WhatsApp 代理已启用: ${proxyUrl}`);
        } catch (err) {
          serverLogger.warn('whatsapp', `代理配置失败，将不使用代理连接: ${err instanceof Error ? err.message : String(err)}`);
          wsAgent = undefined;
          fetchAgent = undefined;
        }
      }
      // 使用固定版本，避免版本不匹配问题
      const WHATSAPP_VERSION: [number, number, number] = [2, 3000, 1027934701];
      
      // @ts-ignore - Baileys 类型定义不完整
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: state.keys,
        },
        version: WHATSAPP_VERSION,
        browser: Browsers.macOS('Desktop'),
        // syncFullHistory 必须为 true 才能触发 DARWIN 平台识别（Baileys 内部逻辑）
        syncFullHistory: true,
        markOnlineOnConnect: false,
        ...(wsAgent && { agent: wsAgent }),
        ...(fetchAgent && { fetchAgent }),
        connectTimeoutMs: 60000,
        logger: {
          level: 'warn',
          trace: () => {},
          debug: () => {},
          info: (msg: any) => {
            const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
            serverLogger.info('baileys', formatted);
          },
          warn: (msg: any) => {
            const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
            serverLogger.warn('baileys', formatted);
          },
          error: (msg: any) => {
            const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
            serverLogger.error('baileys', formatted);
          },
          fatal: (msg: any) => {
            const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
            serverLogger.error('baileys', formatted);
          },
          child: () =>
            ({
              level: 'warn',
              trace: () => {},
              debug: () => {},
              info: (msg: any) => {
                const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
                serverLogger.info('baileys-child', formatted);
              },
              warn: (msg: any) => {
                const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
                serverLogger.warn('baileys-child', formatted);
              },
              error: (msg: any) => {
                const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
                serverLogger.error('baileys-child', formatted);
              },
              fatal: (msg: any) => {
                const formatted = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
                serverLogger.error('baileys-child', formatted);
              },
              child: () => ({} as any),
            }) as any,
        } as any,
      });

      this.sock = sock;

      sock.ev.on('connection.update', (update: Partial<BaileysEventMap['connection.update']>) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          QRCode.toDataURL(qr, { width: 256, margin: 1 }).then((dataUrl: string) => {
            this.qrCallback?.(dataUrl);
          }).catch(() => {});
        }
        if (connection === 'open') {
          this.connectionOpen = true;
          this.reconnectRetryCount = 0;
          this.connectedCallback?.();
        }
        if (connection === 'close') {
          this.connectionOpen = false;
          const err = lastDisconnect?.error as Boom | undefined;
          const statusCode = err?.output?.statusCode;
          let msg = err?.message ?? err?.output?.statusCode ?? 'unknown';
          
          serverLogger.warn('whatsapp', `连接关闭 (code: ${statusCode}, msg: ${msg})`);
          
          // 408/428/515：需创建新 socket 重连（参考 OpenClaw Issue #21474、Baileys 文档）
          // 使用 setImmediate 避免阻塞事件循环；指数退避 + 最大重试限制
          if (statusCode != null && RECONNECT_STATUS_CODES.has(statusCode)) {
            this.sock = null;
            this.disconnectCallback?.('disconnected', '连接中断，正在重连...');
            if (!this.reconnecting && !this.reconnectTimer) {
              this.reconnecting = true;
              const retry = this.reconnectRetryCount;
              const delay = Math.min(
                BASE_RECONNECT_DELAY_MS * Math.pow(2, retry) + Math.random() * 1000,
                60000,
              );
              serverLogger.info('whatsapp', `连接需重启 (code ${statusCode})，${retry + 1}/${MAX_RECONNECT_RETRIES} 次重试，${(delay / 1000).toFixed(1)}s 后重连...`);
              this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.reconnecting = false;
                if (this.reconnectRetryCount >= MAX_RECONNECT_RETRIES) {
                  serverLogger.warn('whatsapp', `已达最大重试次数 ${MAX_RECONNECT_RETRIES}，请手动重新登录`);
                  this.reconnectRetryCount = 0;
                  this.disconnectCallback?.('disconnected', '重连次数过多，请重新扫码登录');
                  return;
                }
                this.reconnectRetryCount++;
                // 使用 setImmediate 让出事件循环，避免阻塞其他 channel（OpenClaw #21474）
                setImmediate(() => {
                  this.connect(undefined, true).then((r) => {
                    if (r.ok) {
                      this.reconnectRetryCount = 0;
                      serverLogger.info('whatsapp', '重连成功');
                    } else {
                      serverLogger.warn('whatsapp', `重连失败: ${r.error}`);
                    }
                  });
                });
              }, delay);
            }
            return;
          }
          
          // 401 device_removed：设备被移除，需要清除认证
          if (statusCode === 401 && typeof msg === 'string' && msg.includes('device_removed')) {
            serverLogger.warn('whatsapp', '检测到设备被移除，清除认证后需重新登录');
            
            // 清除认证文件
            try {
              fs.rmSync(this.authPath, { recursive: true, force: true });
              fs.mkdirSync(this.authPath, { recursive: true });
              serverLogger.info('whatsapp', '认证文件已清除');
            } catch (e) {
              serverLogger.error('whatsapp', `清除认证文件失败: ${e}`);
            }
            
            // 通知前端重新登录
            this.disconnectCallback?.('logged_out', '设备已被移除，请重新扫码登录');
            return;
          }
          
          // 改进代理相关错误提示
          if (typeof msg === 'string' && (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND'))) {
            const msgStr = String(msg);
            const proxyHint = proxyUrl 
              ? `当前代理：${proxyUrl}。请检查：1) 代理软件是否运行；2) 端口是否正确（V2Box/Clash 等请在应用设置中查看本地监听端口）；3) 若使用 SOCKS5，建议改用 HTTP 代理（更稳定）。`
              : '未配置代理。国内访问 WhatsApp 需要代理，请在设置中配置 HTTP 代理（如 http://127.0.0.1:端口）或点击「检测系统代理」。';
            msg = `WebSocket Error (${msgStr})。${proxyHint}`;
          }
          
          // 428 已在 RECONNECT_STATUS_CODES 中处理；此处仅处理 401 等
          if (statusCode === 401) {
            this.disconnectCallback?.('logged_out');
          } else {
            this.disconnectCallback?.('disconnected', String(msg));
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const rawConfig = this.getConfig(this.userId, 'whatsapp_config');
        const config = parseWhatsAppConfig(rawConfig instanceof Promise ? await rawConfig : rawConfig);
        if (!config?.enabled) return;

        for (const msg of messages) {
          const isFromMe = !!msg.key.fromMe;
          if (isFromMe && !config.allowSelfChat) continue;
          const fromJid = msg.key.remoteJid ?? '';
          if (!fromJid) continue;
          const isGroup = isGroupJid(fromJid);
          if (!isFromMe && !isAllowed(config, fromJid, isGroup)) continue;

          const text = extractText(msg);
          if (!text.trim()) continue;

          this.onMessage(this.userId, {
            fromJid,
            text,
            messageId: msg.key.id ?? undefined,
            timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : undefined,
            isGroup,
          });
        }
      });

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('whatsapp', `连接失败 userId=${this.userId}`, msg);
      return { ok: false, error: msg };
    }
  }

  async sendMessage(toJid: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.sock) return { ok: false, error: '未连接，请先扫码登录' };
    try {
      const jid = toJid.includes('@') ? toJid : `${toJid.replace(/\D/g, '')}@s.whatsapp.net`;
      await this.sock.sendMessage(jid, { text });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'qr_pending' {
    if (!this.sock || !this.connectionOpen) return 'disconnected';
    return 'connected';
  }

  disconnect(): void {
    this.connectionOpen = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
    if (this.sock) {
      try {
        (this.sock as any).end?.();
      } catch {}
      this.sock = null;
    }
  }

  async getQr(): Promise<string | null> {
    const { state } = await useMultiFileAuthState(this.authPath);
    if (state.creds.registered) return null;
    const result = await this.connect();
    return result.qr ?? null;
  }
}

/** 全局消息处理器（由 api 层在启动时注入） */
let globalOnMessage: ((userId: string, msg: { fromJid: string; text: string; messageId?: string; timestamp?: number; isGroup: boolean }) => void) | null = null;

export function setWhatsAppMessageHandler(
  handler: (userId: string, msg: { fromJid: string; text: string; messageId?: string; timestamp?: number; isGroup: boolean }) => void,
): void {
  globalOnMessage = handler;
}

/** 全局连接管理器：每个 userId 一个连接 */
const connections = new Map<string, UserWhatsAppConnection>();

function getOrCreateConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserWhatsAppConnection {
  let conn = connections.get(userId);
  if (!conn) {
    const onMessage = globalOnMessage ?? (() => {});
    conn = new UserWhatsAppConnection(userId, getConfig, onMessage);
    connections.set(userId, conn);
  }
  return conn;
}

export function disconnectWhatsApp(userId: string): void {
  const conn = connections.get(userId);
  if (conn) {
    conn.disconnect();
    connections.delete(userId);
  }
}

export function getWhatsAppConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserWhatsAppConnection {
  return getOrCreateConnection(userId, getConfig);
}

export async function sendWhatsAppMessage(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  to: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const conn = getOrCreateConnection(userId, getConfig);
  return conn.sendMessage(to, message);
}

/**
 * 启动时自动重连：为已配置且启用了 WhatsApp、且本地有凭证的用户恢复连接。
 * 服务重启后调用，确保无需重新扫码即可继续监听消息。
 */
export async function reconnectWhatsAppForConfiguredUsers(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  getUserIdsWithWhatsAppConfig: () => string[] | Promise<string[]>,
): Promise<void> {
  const userIds = await Promise.resolve(getUserIdsWithWhatsAppConfig());
  serverLogger.info('whatsapp', `启动时检查 WhatsApp 自动重连，找到 ${userIds.length} 个配置了 whatsapp_config 的用户`);
  for (const userId of userIds) {
    const raw = getConfig(userId, 'whatsapp_config');
    const config = parseWhatsAppConfig(raw instanceof Promise ? await raw : raw);
    if (!config?.enabled) {
      serverLogger.info('whatsapp', `跳过 userId=${userId}：WhatsApp 未启用`);
      continue;
    }
    const credsPath = path.join(CREDENTIALS_BASE, userId, 'creds.json');
    if (!fs.existsSync(credsPath)) {
      serverLogger.info('whatsapp', `跳过 userId=${userId}：无本地凭证`);
      continue;
    }
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      if (!creds?.registered || !creds?.me?.id) continue;
    } catch {
      continue;
    }
    const conn = getOrCreateConnection(userId, getConfig);
    conn.connect(undefined, true).then((r) => {
      if (r.ok) serverLogger.info('whatsapp', `启动时已恢复连接 userId=${userId}`);
      else serverLogger.warn('whatsapp', `启动时恢复连接失败 userId=${userId}`, r.error);
    });
  }
}

export { parseWhatsAppConfig, normalizePhoneForAllowlist, isAllowed, CREDENTIALS_BASE };
