/**
 * QQ 渠道服务：通过 qq-official-bot SDK（WebSocket 模式）连接 QQ 官方 Bot API，
 * 支持私聊（C2C）、群聊（@机器人）和频道消息的双向通信。
 *
 * 配置项：appid + secret（从 QQ 开放平台获取），无需 QR 码。
 */

import { Bot, ReceiverMode, type PrivateMessageEvent, type GroupMessageEvent, type GuildMessageEvent } from 'qq-official-bot';
import { serverLogger } from '../observability/ServerLogger.js';

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
};

class UserQQConnection {
  private bot: Bot<ReceiverMode.WEBSOCKET> | null = null;
  private running = false;
  private botInfo: { id?: string; username?: string } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 3000; // 初始重连延迟 3 秒（缩短）
  private savedConfig: { appId: string; secret: string; sandbox?: boolean } | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30秒心跳（缩短，更频繁检测）
  private readonly MAX_SEND_RETRIES = 3; // 发送消息最大重试次数
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
      this.reconnectDelay = 3000;
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
    if (!this.savedConfig) return;
    if (this.isReconnecting) return; // 防止并发重连
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      serverLogger.error('qq', `重连次数已达上限（${this.maxReconnectAttempts}），请检查网络或 Token`, `userId=${this.userId}`);
      this.isReconnecting = false;
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 60000); // 指数退避，最大 60 秒
    this.reconnectAttempts++;
    this.isReconnecting = true;
    serverLogger.info('qq', `计划 ${Math.round(delay / 1000)} 秒后重连（第 ${this.reconnectAttempts} 次）`, `userId=${this.userId}`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const result = await this.connect(this.savedConfig!.appId, this.savedConfig!.secret, this.savedConfig!.sandbox);
      if (!result.ok) {
        this.isReconnecting = false;
        this.scheduleReconnect();
      } else {
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 3000;
      }
    }, delay);
  }

  async connect(appId: string, secret: string, sandbox?: boolean): Promise<{ ok: boolean; error?: string }> {
    if (this.running && this.bot) return { ok: true };
    
    // 保存配置用于重连
    this.savedConfig = { appId, secret, sandbox };
    
    // 定义连接超时（防止 DNS 解析等网络问题导致卡死）
    const CONNECT_TIMEOUT = 10000; // 10秒
    const timeoutId = setTimeout(() => {
      serverLogger.warn('qq', `连接超时（${CONNECT_TIMEOUT}ms），中止连接 userId=${this.userId}`);
      if (this.bot) {
        try { void this.bot.stop(); } catch {}
        this.bot = null;
      }
    }, CONNECT_TIMEOUT);
    
    try {
      this.bot = new Bot({
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

      this.setupReconnect();

      this.bot.on('message.private.friend', async (event: PrivateMessageEvent) => {
        await this.handleIncoming('private', event.user_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, undefined, undefined, undefined);
      });

      this.bot.on('message.private.direct', async (event: PrivateMessageEvent) => {
        await this.handleIncoming('guild', event.user_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, undefined, event.guild_id, event.channel_id);
      });

      this.bot.on('message.group', async (event: GroupMessageEvent) => {
        await this.handleIncoming('group', event.group_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, event.group_id, undefined, undefined);
      });

      this.bot.on('message.guild', async (event: GuildMessageEvent) => {
        await this.handleIncoming('guild', event.channel_id ?? event.guild_id, event.sender.user_name, event.raw_message, event.message_id, event.user_id, undefined, event.guild_id, event.channel_id);
      });

      await this.bot.start();
      clearTimeout(timeoutId); // 清除超时定时器
      
      try {
        const info = await this.bot.getSelfInfo();
        this.botInfo = { id: info.id, username: info.username };
        serverLogger.info('qq', `Bot 已连接: ${info.username} (${info.id}) userId=${this.userId}`);
      } catch {
        serverLogger.info('qq', `Bot 已连接 userId=${this.userId}`);
      }
      this.running = true;
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 3000;
      this.startHeartbeat();
      return { ok: true };
    } catch (err) {
      clearTimeout(timeoutId); // 确保清除超时定时器
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('qq', `连接失败 userId=${this.userId}`, msg);
      // 如果连接失败，清理资源
      if (this.bot) {
        try { void this.bot.stop(); } catch {}
        this.bot = null;
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
  ) {
    const rawConfig = this.getConfig(this.userId, 'qq_config');
    const config = parseQQConfig(rawConfig instanceof Promise ? await rawConfig : rawConfig);
    if (!config?.enabled) return;
    const isPrivate = type === 'private';
    if (!isAllowed(config, fromId, groupId, isPrivate)) return;
    if (!text.trim()) return;

    this.onMessage(this.userId, {
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
    });
  }

  async sendMessage(target: { type: 'private' | 'group' | 'guild'; id: string }, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot || !this.running) return { ok: false, error: '未连接，请先配置并连接 QQ Bot' };

    let lastError: string = '';
    for (let attempt = 0; attempt < this.MAX_SEND_RETRIES; attempt++) {
      try {
        if (target.type === 'private') {
          await this.bot.sendPrivateMessage(target.id, text);
        } else if (target.type === 'group') {
          await this.bot.sendGroupMessage(target.id, text);
        } else {
          await this.bot.sendGuildMessage(target.id, text);
        }
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        serverLogger.warn('qq', `发送消息失败（第 ${attempt + 1}/${this.MAX_SEND_RETRIES} 次）userId=${this.userId}`, lastError);

        // 如果不是最后一次尝试，等待后重试（指数退避）
        if (attempt < this.MAX_SEND_RETRIES - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    return { ok: false, error: lastError };
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
): Promise<{ ok: boolean; error?: string }> {
  const conn = getOrCreateConnection(userId, getConfig);
  return conn.sendMessage(target, message);
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
    // 添加超时和错误处理，避免启动时卡死
    const CONNECT_TIMEOUT = 15000; // 15秒超时
    const timeoutPromise = new Promise<{ ok: false; error: string }>((_, reject) => {
      setTimeout(() => reject(new Error('连接超时')), CONNECT_TIMEOUT);
    });
    try {
      const result = await Promise.race([
        conn.connect(config.appId, config.secret, config.sandbox),
        timeoutPromise,
      ]);
      if (result.ok) {
        serverLogger.info('qq', `启动时已恢复连接 userId=${userId}`);
      } else {
        serverLogger.warn('qq', `启动时恢复连接失败 userId=${userId}`, result.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('qq', `启动时连接失败（${userId}）`, msg);
    }
  }
}
