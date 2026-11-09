/**
 * QQ 渠道服务：通过 qq-official-bot SDK（WebSocket 模式）连接 QQ 官方 Bot API，
 * 支持私聊（C2C）、群聊（@机器人）和频道消息的双向通信。
 *
 * 配置项：appid + secret（从 QQ 开放平台获取），无需 QR 码。
 */

import { Bot, ReceiverMode, type PrivateMessageEvent, type GroupMessageEvent, type GuildMessageEvent } from 'qq-official-bot';
import { serverLogger } from '../observability/ServerLogger.js';
import { captureChannelOrigin, type ChannelOrigin } from '../messaging/channelIdentity.js';
import { randomUUID } from 'node:crypto';
import { createSendIdentity, SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { extractQQAttachments, type QQAttachment } from './qqAttachments.js';

export interface QQConfig {
  enabled?: boolean;
  appId?: string;
  secret?: string;
  /** 是否开启沙箱模式（测试环境） */
  sandbox?: boolean;
  dmPolicy?: 'allowlist' | 'open' | 'disabled';
  allowFrom?: string[];
  groupPolicy?: 'allowlist' | 'open' | 'disabled';
  allowGroups?: string[];
}

export function parseQQConfig(raw: string | undefined): QQConfig | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    return o as QQConfig;
  } catch {
    return null;
  }
}

function isAllowed(config: QQConfig | null, fromId: string, groupId: string | undefined, isPrivate: boolean): boolean {
  if (!config) return false;
  if (isPrivate) {
    if (config.dmPolicy === 'disabled') return false;
    if (config.dmPolicy === 'open') return true;
    if (config.dmPolicy === 'allowlist' && config.allowFrom?.length) {
      return config.allowFrom.some((a) => a === fromId);
    }
    return false;
  }
  if (config.groupPolicy === 'disabled') return false;
  if (config.groupPolicy === 'open') return true;
  if (config.groupPolicy === 'allowlist' && config.allowGroups?.length && groupId) {
    return config.allowGroups.some((g) => g === groupId);
  }
  return false;
}

export type QQMessagePayload = {
  origin?: ChannelOrigin;
  messageType: 'private' | 'group' | 'guild';
  chatId: string;
  fromId: string;
  fromName: string;
  text: string;
  messageId: string;
  timestamp: number;
  groupId?: string;
  guildId?: string;
  channelId?: string;
  /** 文件、图片等附件；text 里对应的是 `<file,…>` 这样的标记。 */
  attachments?: QQAttachment[];
};

/** 单次连接（含 SDK 内部获取网关的重试）最长等待时间。QQ 网关慢时单次请求就要 10 秒以上。 */
export const QQ_CONNECT_TIMEOUT_MS = 45_000;
/** 前几次重连用指数退避，之后固定每 5 分钟试一次，永不放弃。 */
const RECONNECT_BASE_DELAY_MS = 3_000;
const RECONNECT_FAST_CAP_MS = 60_000;
const RECONNECT_SLOW_DELAY_MS = 5 * 60_000;
const FAST_RECONNECT_ATTEMPTS = 10;

/** 密钥或 AppID 错误时重试没有意义，等用户改配置。 */
function isAuthFailure(message: string): boolean {
  return /invalid appid or secret|100016/i.test(message);
}

class UserQQConnection {
  private bot: Bot<ReceiverMode.WEBSOCKET> | null = null;
  private sendSessionId = randomUUID();
  private running = false;
  private botInfo: { id?: string; username?: string } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private savedConfig: { appId: string; secret: string; sandbox?: boolean } | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30秒心跳（缩短，更频繁检测）
  private heartbeatFailCount = 0;
  private readonly MAX_HEARTBEAT_FAILURES = 3; // 心跳连续失败超过此次数则重连
  private isReconnecting = false; // 防止并发重连

  constructor(
    private userId: string,
    private getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
    private onMessage: (userId: string, msg: QQMessagePayload) => void,
  ) {}

  private setupReconnect(): void {
    if (!this.bot) return;

    // 监听 WebSocket 断开事件
    this.bot.on('close', (hadError: boolean) => {
      if (this.reconnectTimer || this.isReconnecting) return; // 防止重复触发
      serverLogger.warn('qq', `WebSocket 连接断开${hadError ? '（有错误）' : ''} userId=${this.userId}`);
      this.running = false;
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    // 监听错误事件
    this.bot.on('error', (err: Error) => {
      serverLogger.warn('qq', `WebSocket 错误 userId=${this.userId}`, err.message);
      // 如果连接不在运行状态，触发重连
      if (!this.running && !this.reconnectTimer && !this.isReconnecting && this.savedConfig) {
        this.scheduleReconnect();
      }
    });

    // 监听 ready 事件（重连成功时）
    this.bot.on('ready', () => {
      serverLogger.info('qq', `Bot ready 事件触发，连接已建立 userId=${this.userId}`);
      // 重置重连状态
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      // 重新启动心跳
      this.startHeartbeat();
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatFailCount = 0;
    this.heartbeatTimer = setInterval(async () => {
      if (!this.bot || !this.running) return;
      try {
        // 发送心跳包保持连接活跃
        await this.bot.getSelfInfo();
        serverLogger.debug('qq', `心跳保活成功 userId=${this.userId}`);
        this.heartbeatFailCount = 0;
      } catch (err) {
        this.heartbeatFailCount++;
        serverLogger.warn('qq', `心跳保活失败(${this.heartbeatFailCount}/${this.MAX_HEARTBEAT_FAILURES}) userId=${this.userId}`, err instanceof Error ? err.message : String(err));
        if (this.heartbeatFailCount >= this.MAX_HEARTBEAT_FAILURES) {
          serverLogger.error('qq', `QQ 心跳连续失败 ${this.heartbeatFailCount} 次，主动触发重连 userId=${this.userId}`);
          this.stopHeartbeat();
          this.running = false;
          // 主动触发重连而不是停止
          this.scheduleReconnect();
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.savedConfig || this.isReconnecting || this.reconnectTimer) return;
    const delay = this.reconnectAttempts < FAST_RECONNECT_ATTEMPTS
      ? Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(1.5, this.reconnectAttempts), RECONNECT_FAST_CAP_MS)
      : RECONNECT_SLOW_DELAY_MS;
    this.reconnectAttempts++;
    this.isReconnecting = true;
    if (this.reconnectAttempts === FAST_RECONNECT_ATTEMPTS + 1) {
      serverLogger.error('qq', `已连续重连 ${FAST_RECONNECT_ATTEMPTS} 次未成功，之后每 5 分钟重试一次，请检查网络或机器人配置`, `userId=${this.userId}`);
    }
    serverLogger.info('qq', `计划 ${Math.round(delay / 1000)} 秒后重连（第 ${this.reconnectAttempts} 次）`, `userId=${this.userId}`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const config = this.savedConfig;
      if (!config) { this.isReconnecting = false; return; }
      const result = await this.connect(config.appId, config.secret, config.sandbox);
      this.isReconnecting = false;
      if (result.ok) {
        this.reconnectAttempts = 0;
      } else if (!isAuthFailure(result.error ?? '')) {
        this.scheduleReconnect();
      }
    }, delay);
  }

  async connect(appId: string, secret: string, sandbox?: boolean): Promise<{ ok: boolean; error?: string }> {
    if (this.running && this.bot) return { ok: true };
    
    // 保存配置用于重连
    this.savedConfig = { appId, secret, sandbox };
    
 
    // 连接卡住时按超时放弃，保证调用方一定能拿到结果（否则重连状态会一直卡在“正在重连”）
    let connectingBot: Bot | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`连接超时（${QQ_CONNECT_TIMEOUT_MS / 1000} 秒）`)), QQ_CONNECT_TIMEOUT_MS);
    });

    try {
      const bot = this.bot = new Bot({
        appid: appId,
        secret,
        sandbox: sandbox ?? false,
        intents: [
          'C2C_MESSAGE_CREATE',
          'GROUP_AT_MESSAGE_CREATE',
          'DIRECT_MESSAGE',
          'PUBLIC_GUILD_MESSAGES',
        ],
        mode: ReceiverMode.WEBSOCKET,
        logLevel: 'warn',
        maxRetry: 5, // SDK 内部重连次数
      });

      connectingBot = bot;
      this.running = false; this.botInfo = null; this.sendSessionId = randomUUID();
      this.setupReconnect();

      this.bot.on('message.private.friend', async (event: PrivateMessageEvent) => {
        await this.handleIncoming('private', event.user_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, undefined, undefined, undefined, bot, extractQQAttachments(event.message));
      });

      this.bot.on('message.private.direct', async (event: PrivateMessageEvent) => {
        await this.handleIncoming('guild', event.user_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, undefined, event.guild_id, event.channel_id, bot, extractQQAttachments(event.message));
      });

      this.bot.on('message.group', async (event: GroupMessageEvent) => {
        await this.handleIncoming('group', event.group_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, event.group_id, undefined, undefined, bot, extractQQAttachments(event.message));
      });

      this.bot.on('message.guild', async (event: GuildMessageEvent) => {
        await this.handleIncoming('guild', event.channel_id ?? event.guild_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, undefined, event.guild_id, event.channel_id, bot, extractQQAttachments(event.message));
      });

      await Promise.race([bot.start(), timeout]);
      clearTimeout(timeoutId);
      if (this.bot !== bot) return { ok: false, error: '连接已变化' };
      
      try {
        const info = await bot.getSelfInfo();
        if (this.bot !== bot) return { ok: false, error: '连接已变化' };
        this.botInfo = { id: info.id, username: info.username };
        serverLogger.info('qq', `Bot 已连接: ${info.username} (${info.id}) userId=${this.userId}`);
      } catch {
        serverLogger.info('qq', `Bot 已连接 userId=${this.userId}`);
      }
      if (this.bot !== bot) return { ok: false, error: '连接已变化' };
      this.running = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      return { ok: true };
    } catch (err) {
      clearTimeout(timeoutId); // 确保清除超时定时器
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('qq', `连接失败 userId=${this.userId}`, msg);
      // Only clean up the client belonging to this login attempt.
      if (connectingBot) {
        try { void connectingBot.stop(); } catch {}
        if (this.bot === connectingBot) { this.bot = null; this.running = false; this.botInfo = null; }
      }
      if (isAuthFailure(msg)) {
        serverLogger.error('qq', `QQ 机器人 AppID 或密钥无效，不再自动重连，请在设置里更新 userId=${this.userId}`);
      } else {
        this.scheduleReconnect();
      }
      return { ok: false, error: msg };
    }
  }

  private async handleIncoming(
    type: 'private' | 'group' | 'guild',
    chatId: string,
    fromName: string,
    text: string,
    messageId: string,
    fromId: string,
    groupId?: string,
    guildId?: string,
    channelId?: string,
    sourceBot?: Bot,
    attachments: QQAttachment[] = [],
  ) {
    if (sourceBot && this.bot !== sourceBot) return;
    const accountId = this.getSendIdentity()?.accountId, sessionId = this.sendSessionId;
    const rawConfig = await this.getConfig(this.userId, 'qq_config');
    const config = parseQQConfig(rawConfig);
    if ((sourceBot && this.bot !== sourceBot) || !config?.enabled) return;
    const isPrivate = type === 'private';
    if (!isAllowed(config, fromId, groupId, isPrivate)) return;
    if (!text.trim()) return;

    this.onMessage(this.userId, {
            origin: captureChannelOrigin(accountId, sessionId, rawConfig),
      messageType: type,
      chatId,
      fromId,
      fromName,
      text,
      messageId,
      timestamp: Math.floor(Date.now() / 1000),
      groupId,
      guildId,
      channelId,
      ...(attachments.length ? { attachments } : {}),
    });
  }

  getSendIdentity() { return this.bot && this.running ? createSendIdentity(this.botInfo?.id, this.botInfo?.username, this.sendSessionId) : null; }

  async sendMessage(target: { type: 'private' | 'group' | 'guild'; id: string }, text: string, expectedBinding?: string): Promise<{ ok: boolean; error?: string }> {
    const bot = this.bot;
    if (expectedBinding && this.getSendIdentity()?.binding !== expectedBinding) throw new SendExecutionDeniedError('QQ 账号或连接已变化，尚未发送，请重新交办');
    if (!bot || !this.running) return { ok: false, error: '未连接，请先配置并连接 QQ Bot' };

    try {
      if (target.type === 'private') {
        await bot.sendPrivateMessage(target.id, text);
      } else if (target.type === 'group') {
        await bot.sendGroupMessage(target.id, text);
      } else {
        await bot.sendGuildMessage(target.id, text);
      }
      return { ok: true };
    } catch {
      // A failed receipt can follow successful delivery, so never replay the message.
      serverLogger.warn('qq', '消息发送回执未确认', `userId=${this.userId}`);
      return { ok: false, error: '消息发送结果未确认，请核实后再决定是否重新发送' };
    }
  }

  getStatus(): 'connected' | 'disconnected' {
    return this.running ? 'connected' : 'disconnected';
  }

  getBotInfo(): { id?: string; username?: string } | null {
    return this.botInfo;
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.bot) {
      try { void this.bot.stop(); } catch {}
      this.bot = null;
    }
    this.running = false;
    this.botInfo = null;
    this.savedConfig = null;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
  }
}

let globalOnMessage: ((userId: string, msg: QQMessagePayload) => void) | null = null;

export function setQQMessageHandler(
  handler: (userId: string, msg: QQMessagePayload) => void,
): void {
  globalOnMessage = handler;
}

const connections = new Map<string, UserQQConnection>();

function getOrCreateConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserQQConnection {
  let conn = connections.get(userId);
  if (!conn) {
    conn = new UserQQConnection(userId, getConfig, globalOnMessage ?? (() => {}));
    connections.set(userId, conn);
  }
  return conn;
}

export function disconnectQQ(userId: string): void {
  const conn = connections.get(userId);
  if (conn) {
    conn.disconnect();
    connections.delete(userId);
  }
}

export async function reconnectQQ(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): Promise<{ ok: boolean; error?: string }> {
  const raw = getConfig(userId, 'qq_config');
  const config = parseQQConfig(raw instanceof Promise ? await raw : raw);
  if (!config?.enabled || !config?.appId || !config?.secret) {
    return { ok: false, error: 'QQ 未配置或未启用' };
  }
  // 断开现有连接并重新创建
  disconnectQQ(userId);
  const conn = getOrCreateConnection(userId, getConfig);
  return conn.connect(config.appId, config.secret, config.sandbox);
}

export function getQQConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserQQConnection {
  return getOrCreateConnection(userId, getConfig);
}

export async function sendQQMessage(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  target: { type: 'private' | 'group' | 'guild'; id: string },
  message: string,
  expectedBinding?: string,
): Promise<{ ok: boolean; error?: string }> {
  const conn = getOrCreateConnection(userId, getConfig);
  return conn.sendMessage(target, message, expectedBinding);
}

export async function reconnectQQForConfiguredUsers(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  getUserIdsWithConfig: () => string[] | Promise<string[]>,
): Promise<void> {
  const userIds = await Promise.resolve(getUserIdsWithConfig());
  serverLogger.info('qq', `启动时检查 QQ 自动重连，找到 ${userIds.length} 个配置用户`);
  for (const userId of userIds) {
    const raw = getConfig(userId, 'qq_config');
    const config = parseQQConfig(raw instanceof Promise ? await raw : raw);
    if (!config?.enabled || !config?.appId || !config?.secret) continue;
    const conn = getOrCreateConnection(userId, getConfig);
    // connect 自带超时；失败时会自己安排重连，这里只记录结果
    const result = await conn.connect(config.appId, config.secret, config.sandbox);
    if (result.ok) {
      serverLogger.info('qq', `启动时已恢复连接 userId=${userId}`);
    } else {
      serverLogger.warn('qq', `启动时暂未连上，稍后自动重试 userId=${userId}`, result.error);
    }
  }
}
