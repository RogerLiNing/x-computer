/**
 * Slack 渠道服务：通过 @slack/bolt（Socket Mode）连接 Slack，实现双向通信。
 * 参考 OpenClaw Slack 渠道和现有 WhatsApp 架构。
 */

import { App } from '@slack/bolt';
import { serverLogger } from '../observability/ServerLogger.js';

export interface SlackConfig {
  enabled?: boolean;
  botToken?: string;
  appToken?: string;
  dmPolicy?: 'allowlist' | 'open' | 'disabled';
  allowFrom?: string[];
  channelPolicy?: 'allowlist' | 'open' | 'disabled';
  allowChannels?: string[];
}

export function parseSlackConfig(raw: string | undefined): SlackConfig | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    return o as SlackConfig;
  } catch {
    return null;
  }
}

function isAllowed(config: SlackConfig | null, fromId: string, channelId: string, isDM: boolean): boolean {
  if (!config) return false;
  if (isDM) {
    if (config.dmPolicy === 'disabled') return false;
    if (config.dmPolicy === 'open') return true;
    if (config.dmPolicy === 'allowlist' && config.allowFrom?.length) {
      return config.allowFrom.some((a) => a === fromId);
    }
    return false;
  }
  if (config.channelPolicy === 'disabled') return false;
  if (config.channelPolicy === 'open') return true;
  if (config.channelPolicy === 'allowlist' && config.allowChannels?.length) {
    return config.allowChannels.some((c) => c === channelId);
  }
  return false;
}

export type SlackMessagePayload = {
  channelId: string;
  fromId: string;
  fromName?: string;
  text: string;
  messageTs: string;
  timestamp: number;
  isDM: boolean;
  threadTs?: string;
};

class UserSlackConnection {
  private app: App | null = null;
  private running = false;
  private botUserId: string | null = null;

  constructor(
    private userId: string,
    private getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
    private onMessage: (userId: string, msg: SlackMessagePayload) => void,
  ) {}

  async connect(botToken: string, appToken: string): Promise<{ ok: boolean; error?: string }> {
    if (this.running) return { ok: true };
    try {
      this.app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      this.app.message(async ({ message }) => {
        const msg = message as { subtype?: string; user?: string; text?: string; channel?: string; channel_type?: string; ts: string; thread_ts?: string };
        if (msg.subtype) return;
        if (!msg.user || !msg.text) return;
        if (msg.user === this.botUserId) return;

        const rawConfig = this.getConfig(this.userId, 'slack_config');
        const config = parseSlackConfig(rawConfig instanceof Promise ? await rawConfig : rawConfig);
        if (!config?.enabled) return;

        const isDM = msg.channel_type === 'im';
        const channelId = msg.channel ?? '';
        if (!channelId) return;
        if (!isAllowed(config, msg.user, channelId, isDM)) return;

        this.onMessage(this.userId, {
          channelId,
          fromId: msg.user,
          text: msg.text,
          messageTs: msg.ts,
          timestamp: Math.floor(parseFloat(msg.ts)),
          isDM,
          threadTs: msg.thread_ts,
        });
      });

      await this.app.start();
      const authResult = await this.app.client.auth.test({ token: botToken });
      this.botUserId = (authResult.user_id as string) ?? null;
      this.running = true;
      serverLogger.info('slack', `Bot 已连接: ${authResult.user} userId=${this.userId}`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLogger.warn('slack', `连接失败 userId=${this.userId}`, msg);
      return { ok: false, error: msg };
    }
  }

  async sendMessage(channelId: string, text: string, threadTs?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.app || !this.running) return { ok: false, error: '未连接，请先配置 Slack Token' };
    try {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getStatus(): 'connected' | 'disconnected' {
    return this.running ? 'connected' : 'disconnected';
  }

  disconnect(): void {
    if (this.app) {
      try { void this.app.stop(); } catch {}
      this.app = null;
    }
    this.running = false;
    this.botUserId = null;
  }
}

let globalOnMessage: ((userId: string, msg: SlackMessagePayload) => void) | null = null;

export function setSlackMessageHandler(
  handler: (userId: string, msg: SlackMessagePayload) => void,
): void {
  globalOnMessage = handler;
}

const connections = new Map<string, UserSlackConnection>();

function getOrCreateConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserSlackConnection {
  let conn = connections.get(userId);
  if (!conn) {
    conn = new UserSlackConnection(userId, getConfig, globalOnMessage ?? (() => {}));
    connections.set(userId, conn);
  }
  return conn;
}

export function disconnectSlack(userId: string): void {
  const conn = connections.get(userId);
  if (conn) {
    conn.disconnect();
    connections.delete(userId);
  }
}

export function getSlackConnection(
  userId: string,
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
): UserSlackConnection {
  return getOrCreateConnection(userId, getConfig);
}

export async function sendSlackMessage(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  channelId: string,
  message: string,
  threadTs?: string,
): Promise<{ ok: boolean; error?: string }> {
  const conn = getOrCreateConnection(userId, getConfig);
  return conn.sendMessage(channelId, message, threadTs);
}

export async function reconnectSlackForConfiguredUsers(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  getUserIdsWithConfig: () => string[] | Promise<string[]>,
): Promise<void> {
  const userIds = await Promise.resolve(getUserIdsWithConfig());
  serverLogger.info('slack', `启动时检查 Slack 自动重连，找到 ${userIds.length} 个配置用户`);
  for (const userId of userIds) {
    const raw = getConfig(userId, 'slack_config');
    const config = parseSlackConfig(raw instanceof Promise ? await raw : raw);
    if (!config?.enabled || !config?.botToken || !config?.appToken) continue;
    const conn = getOrCreateConnection(userId, getConfig);
    conn.connect(config.botToken, config.appToken).then((r) => {
      if (r.ok) serverLogger.info('slack', `启动时已恢复连接 userId=${userId}`);
      else serverLogger.warn('slack', `启动时恢复连接失败 userId=${userId}`, r.error);
    });
  }
}
