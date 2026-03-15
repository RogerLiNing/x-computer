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

  constructor(
    private userId: string,
    private getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
    private onMessage: (userId: string, msg: QQMessagePayload) => void,
  ) {}

  async connect(appId: string, secret: string, sandbox?: boolean): Promise<{ ok: boolean; error?: string }> {
    if (this.running) return { ok: true };
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
      });

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
      try {
        const info = await this.bot.getSelfInfo();
        this.botInfo = { id: info.id, username: info.username };
        serverLogger.info('qq', `Bot 已连接: ${info.username} (${info.id}) userId=${this.userId}`);
      } catch {
        serverLogger.info('qq', `Bot 已连接 userId=${this.userId}`);
      }
      this.running = true;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('qq', `连接失败 userId=${this.userId}`, msg);
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
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getStatus(): 'connected' | 'disconnected' {
    return this.running ? 'connected' : 'disconnected';
  }

  getBotInfo(): { id?: string; username?: string } | null {
    return this.botInfo;
  }

  disconnect(): void {
    if (this.bot) {
      try { void this.bot.stop(); } catch {}
      this.bot = null;
    }
    this.running = false;
    this.botInfo = null;
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
    conn.connect(config.appId, config.secret, config.sandbox).then((r) => {
      if (r.ok) serverLogger.info('qq', `启动时已恢复连接 userId=${userId}`);
      else serverLogger.warn('qq', `启动时恢复连接失败 userId=${userId}`, r.error);
    });
  }
}
