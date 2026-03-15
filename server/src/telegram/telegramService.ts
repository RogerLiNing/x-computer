/**
 * Telegram 渠道服务：通过 grammY 连接 Telegram Bot API，实现双向通信。
 * 参考 OpenClaw Telegram 渠道和现有 WhatsApp 架构。
 */

import { Bot, type Context } from 'grammy';
import { serverLogger } from '../observability/ServerLogger.js';

export interface TelegramConfig {
  enabled?: boolean;
  botToken?: string;
  dmPolicy?: 'allowlist' | 'open' | 'disabled';
  allowFrom?: string[];
  groupPolicy?: 'allowlist' | 'open' | 'disabled';
  groupAllowFrom?: string[];
}

export function parseTelegramConfig(raw: string | undefined): TelegramConfig | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    return o as TelegramConfig;
  } catch {
    return null;
  }
}

function isAllowed(config: TelegramConfig | null, fromId: string, isGroup: boolean): boolean {
  if (!config) return false;
  if (isGroup) {
    if (config.groupPolicy === 'disabled') return false;
    if (config.groupPolicy === 'open') return true;
    if (config.groupPolicy === 'allowlist' && config.groupAllowFrom?.length) {
      return config.groupAllowFrom.some((a) => a === fromId);
    }
    return false;
  }
  if (config.dmPolicy === 'disabled') return false;
  if (config.dmPolicy === 'open') return true;
  if (config.dmPolicy === 'allowlist' && config.allowFrom?.length) {
    return config.allowFrom.some((a) => a === fromId);
  }
  return false;
}

export type TelegramMessagePayload = {
  chatId: string;
  fromId: string;
  fromUsername?: string;
  text: string;
  messageId: number;
  timestamp: number;
  isGroup: boolean;
};

class UserTelegramConnection {
  private bot: Bot | null = null;
  private running = false;
  private botInfo: { username?: string; id?: number } | null = null;

  constructor(
    private userId: string,
    private getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
    private onMessage: (userId: string, msg: TelegramMessagePayload) => void,
  ) {}

  async connect(token: string): Promise<{ ok: boolean; error?: string }> {
    if (this.running) return { ok: true };
    try {
      this.bot = new Bot(token);

      this.bot.on('message:text', async (ctx: Context) => {
        const rawConfig = this.getConfig(this.userId, 'telegram_config');
        const config = parseTelegramConfig(rawConfig instanceof Promise ? await rawConfig : rawConfig);
        if (!config?.enabled) return;

        const msg = ctx.message!;
        const fromId = String(msg.from?.id ?? '');
        const chatId = String(msg.chat.id);
        const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
        if (!isAllowed(config, fromId, isGroup)) return;

        const text = msg.text ?? '';
        if (!text.trim()) return;

        this.onMessage(this.userId, {
          chatId,
          fromId,
          fromUsername: msg.from?.username,
          text,
          messageId: msg.message_id,
          timestamp: msg.date,
          isGroup,
        });
      });

      const me = await this.bot.api.getMe();
      this.botInfo = { username: me.username, id: me.id };
      serverLogger.info('telegram', `Bot 已连接: @${me.username} (${me.id}) userId=${this.userId}`);

      this.bot.start({
        onStart: () => {
          this.running = true;
        },
      });
      this.running = true;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('telegram', `连接失败 userId=${this.userId}`, msg);
      return { ok: false, error: msg };
    }
  }

  async sendMessage(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.bot) return { ok: false, error: '未连接，请先配置 Bot Token' };
    try {
      await this.bot.api.sendMessage(chatId, text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getStatus(): 'connected' | 'disconnected' {
    return this.running ? 'connected' : 'disconnected';
  }

  getBotInfo(): { username?: string; id?: number } | null {
    return this.botInfo;
  }

  disconnect(): void {
    if (this.bot) {
      try { this.bot.stop(); } catch {}
      this.bot = null;
    }
    this.running = false;
    this.botInfo = null;
  }
}

let globalOnMessage: ((userId: string, msg: TelegramMessagePayload) => void) | null = null;

export function setTelegramMessageHandler(
  handler: (userId: string, msg: TelegramMessagePayload) => void,
): void {
  globalOnMessage = handler;
}

const connections = new Map<string, UserTelegramConnection>();

function getOrCreateConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserTelegramConnection {
  let conn = connections.get(userId);
  if (!conn) {
    conn = new UserTelegramConnection(userId, getConfig, globalOnMessage ?? (() => {}));
    connections.set(userId, conn);
  }
  return conn;
}

export function disconnectTelegram(userId: string): void {
  const conn = connections.get(userId);
  if (conn) {
    conn.disconnect();
    connections.delete(userId);
  }
}

export function getTelegramConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserTelegramConnection {
  return getOrCreateConnection(userId, getConfig);
}

export async function sendTelegramMessage(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  chatId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const conn = getOrCreateConnection(userId, getConfig);
  return conn.sendMessage(chatId, message);
}

export async function reconnectTelegramForConfiguredUsers(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  getUserIdsWithConfig: () => string[] | Promise<string[]>,
): Promise<void> {
  const userIds = await Promise.resolve(getUserIdsWithConfig());
  serverLogger.info('telegram', `启动时检查 Telegram 自动重连，找到 ${userIds.length} 个配置用户`);
  for (const userId of userIds) {
    const raw = getConfig(userId, 'telegram_config');
    const config = parseTelegramConfig(raw instanceof Promise ? await raw : raw);
    if (!config?.enabled || !config?.botToken) {
      serverLogger.info('telegram', `跳过 userId=${userId}：未启用或无 token`);
      continue;
    }
    const conn = getOrCreateConnection(userId, getConfig);
    conn.connect(config.botToken).then((r) => {
      if (r.ok) serverLogger.info('telegram', `启动时已恢复连接 userId=${userId}`);
      else serverLogger.warn('telegram', `启动时恢复连接失败 userId=${userId}`, r.error);
    });
  }
}

export { isAllowed as isTelegramAllowed };
