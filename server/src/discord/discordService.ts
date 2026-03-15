/**
 * Discord 渠道服务：通过 discord.js 连接 Discord Bot，实现双向通信。
 * 参考 OpenClaw Discord 渠道和现有 WhatsApp 架构。
 */

import { Client, GatewayIntentBits, type Message } from 'discord.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface DiscordConfig {
  enabled?: boolean;
  botToken?: string;
  dmPolicy?: 'allowlist' | 'open' | 'disabled';
  allowFrom?: string[];
  guildPolicy?: 'allowlist' | 'open' | 'disabled';
  allowGuilds?: string[];
}

export function parseDiscordConfig(raw: string | undefined): DiscordConfig | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    return o as DiscordConfig;
  } catch {
    return null;
  }
}

function isAllowed(config: DiscordConfig | null, fromId: string, guildId: string | null, isDM: boolean): boolean {
  if (!config) return false;
  if (isDM) {
    if (config.dmPolicy === 'disabled') return false;
    if (config.dmPolicy === 'open') return true;
    if (config.dmPolicy === 'allowlist' && config.allowFrom?.length) {
      return config.allowFrom.some((a) => a === fromId);
    }
    return false;
  }
  if (config.guildPolicy === 'disabled') return false;
  if (config.guildPolicy === 'open') return true;
  if (config.guildPolicy === 'allowlist' && config.allowGuilds?.length && guildId) {
    return config.allowGuilds.some((g) => g === guildId);
  }
  return false;
}

export type DiscordMessagePayload = {
  channelId: string;
  guildId: string | null;
  fromId: string;
  fromUsername: string;
  text: string;
  messageId: string;
  timestamp: number;
  isDM: boolean;
};

class UserDiscordConnection {
  private client: Client | null = null;
  private connected = false;
  private botInfo: { username?: string; id?: string } | null = null;

  constructor(
    private userId: string,
    private getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
    private onMessage: (userId: string, msg: DiscordMessagePayload) => void,
  ) {}

  async connect(token: string): Promise<{ ok: boolean; error?: string }> {
    if (this.connected) return { ok: true };
    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      this.client.on('messageCreate', async (msg: Message) => {
        if (msg.author.bot) return;
        const rawConfig = this.getConfig(this.userId, 'discord_config');
        const config = parseDiscordConfig(rawConfig instanceof Promise ? await rawConfig : rawConfig);
        if (!config?.enabled) return;

        const isDM = !msg.guild;
        if (!isAllowed(config, msg.author.id, msg.guildId, isDM)) return;

        const text = msg.content ?? '';
        if (!text.trim()) return;

        this.onMessage(this.userId, {
          channelId: msg.channelId,
          guildId: msg.guildId,
          fromId: msg.author.id,
          fromUsername: msg.author.tag ?? msg.author.username,
          text,
          messageId: msg.id,
          timestamp: Math.floor(msg.createdTimestamp / 1000),
          isDM,
        });
      });

      await this.client.login(token);
      const me = this.client.user;
      this.botInfo = { username: me?.username, id: me?.id };
      this.connected = true;
      serverLogger.info('discord', `Bot 已连接: ${me?.tag} userId=${this.userId}`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('discord', `连接失败 userId=${this.userId}`, msg);
      return { ok: false, error: msg };
    }
  }

  async sendMessage(channelId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.client || !this.connected) return { ok: false, error: '未连接，请先配置 Bot Token' };
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('send' in channel)) return { ok: false, error: '无法发送到该频道' };
      await (channel as any).send(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getStatus(): 'connected' | 'disconnected' {
    return this.connected ? 'connected' : 'disconnected';
  }

  getBotInfo(): { username?: string; id?: string } | null {
    return this.botInfo;
  }

  disconnect(): void {
    if (this.client) {
      try { this.client.destroy(); } catch {}
      this.client = null;
    }
    this.connected = false;
    this.botInfo = null;
  }
}

let globalOnMessage: ((userId: string, msg: DiscordMessagePayload) => void) | null = null;

export function setDiscordMessageHandler(
  handler: (userId: string, msg: DiscordMessagePayload) => void,
): void {
  globalOnMessage = handler;
}

const connections = new Map<string, UserDiscordConnection>();

function getOrCreateConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserDiscordConnection {
  let conn = connections.get(userId);
  if (!conn) {
    conn = new UserDiscordConnection(userId, getConfig, globalOnMessage ?? (() => {}));
    connections.set(userId, conn);
  }
  return conn;
}

export function disconnectDiscord(userId: string): void {
  const conn = connections.get(userId);
  if (conn) {
    conn.disconnect();
    connections.delete(userId);
  }
}

export function getDiscordConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserDiscordConnection {
  return getOrCreateConnection(userId, getConfig);
}

export async function sendDiscordMessage(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  channelId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const conn = getOrCreateConnection(userId, getConfig);
  return conn.sendMessage(channelId, message);
}

export async function reconnectDiscordForConfiguredUsers(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  getUserIdsWithConfig: () => string[] | Promise<string[]>,
): Promise<void> {
  const userIds = await Promise.resolve(getUserIdsWithConfig());
  serverLogger.info('discord', `启动时检查 Discord 自动重连，找到 ${userIds.length} 个配置用户`);
  for (const userId of userIds) {
    const raw = getConfig(userId, 'discord_config');
    const config = parseDiscordConfig(raw instanceof Promise ? await raw : raw);
    if (!config?.enabled || !config?.botToken) continue;
    const conn = getOrCreateConnection(userId, getConfig);
    conn.connect(config.botToken).then((r) => {
      if (r.ok) serverLogger.info('discord', `启动时已恢复连接 userId=${userId}`);
      else serverLogger.warn('discord', `启动时恢复连接失败 userId=${userId}`, r.error);
    });
  }
}
