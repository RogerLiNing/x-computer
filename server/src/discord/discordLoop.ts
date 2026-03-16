/**
 * Discord 消息处理循环：收到消息后存入 DB、发出 discord_message_received 信号。
 */

import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import { fireSignal } from '../signals/signalService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { DiscordMessagePayload } from './discordService.js';

const DISCORD_PROCESSED_IDS_KEY = 'discord_processed_ids';
const MAX_PROCESSED_IDS = 500;

export interface DiscordLoopDeps {
  db: AppDatabase;
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>;
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>;
  runIntent: (userId: string, intent: string, meta?: { signal?: string }) => void;
  runAgent: (userId: string, agentId: string, goal: string, meta?: { triggerId?: string; actionFingerprint?: string }) => Promise<void>;
  /** 渠道消息作为Chat会话处理 */
  handleChannelMessageAsChat?: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) => Promise<void>;
}

async function loadProcessedIds(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
): Promise<Set<string>> {
  const raw = getConfig(userId, DISCORD_PROCESSED_IDS_KEY);
  const value = raw instanceof Promise ? await raw : raw;
  if (!value) return new Set();
  try {
    const arr = JSON.parse(value) as unknown[];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(-MAX_PROCESSED_IDS) : []);
  } catch {
    return new Set();
  }
}

async function saveProcessedIds(
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>,
  userId: string,
  ids: string[],
): Promise<void> {
  const result = setConfig(userId, DISCORD_PROCESSED_IDS_KEY, JSON.stringify(ids.slice(-MAX_PROCESSED_IDS)));
  if (result instanceof Promise) await result;
}

export async function handleDiscordMessage(
  deps: DiscordLoopDeps,
  userId: string,
  msg: DiscordMessagePayload,
): Promise<void> {
  const { db, getConfig, setConfig, runIntent, runAgent, handleChannelMessageAsChat } = deps;
  const msgId = `dc-${msg.messageId}`;
  const processed = await loadProcessedIds(getConfig, userId);
  if (processed.has(msgId)) return;

  const id = `dc-${uuid()}`;
  await db.insertChannelMessage(userId, {
    id,
    channel: 'discord',
    channelMessageId: msg.messageId,
    fromId: msg.fromId,
    fromName: msg.fromUsername,
    chatId: msg.channelId,
    text: msg.text,
    timestamp: msg.timestamp,
    isGroup: !msg.isDM,
  });

  const fromDisplay = msg.fromUsername;

  // 如果提供了handleChannelMessageAsChat，则使用Chat会话方式处理
  if (handleChannelMessageAsChat) {
    await handleChannelMessageAsChat(userId, 'Discord', msg.text, fromDisplay, { channelId: msg.channelId });
  } else {
    // 后备：使用fireSignal触发意图处理
    const goal = `用户通过 Discord 发来消息，请处理并回复。

【发件人】${fromDisplay}（Channel ID: ${msg.channelId}）
【内容】
${msg.text}

请理解用户意图，处理请求，并用 x.send_discord 回复到 channelId=${msg.channelId}。`;

    await fireSignal(userId, 'discord_message_received', { from: msg.fromId, channelId: msg.channelId, text: msg.text, messageId: msgId, goal }, { getConfig, runIntent, runAgent });
  }

  await saveProcessedIds(setConfig, userId, [...processed, msgId]);
  serverLogger.info('discord/loop', `discord_message_received 已发出`, `userId=${userId} from=${fromDisplay}`);
}
