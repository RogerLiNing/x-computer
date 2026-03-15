/**
 * Slack 消息处理循环：收到消息后存入 DB、发出 slack_message_received 信号。
 */

import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import { fireSignal } from '../signals/signalService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { SlackMessagePayload } from './slackService.js';

const SLACK_PROCESSED_IDS_KEY = 'slack_processed_ids';
const MAX_PROCESSED_IDS = 500;

export interface SlackLoopDeps {
  db: AppDatabase;
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>;
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>;
  runIntent: (userId: string, intent: string, meta?: { signal?: string }) => void;
  runAgent: (userId: string, agentId: string, goal: string, meta?: { triggerId?: string; actionFingerprint?: string }) => Promise<void>;
}

async function loadProcessedIds(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
): Promise<Set<string>> {
  const raw = getConfig(userId, SLACK_PROCESSED_IDS_KEY);
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
  const result = setConfig(userId, SLACK_PROCESSED_IDS_KEY, JSON.stringify(ids.slice(-MAX_PROCESSED_IDS)));
  if (result instanceof Promise) await result;
}

export async function handleSlackMessage(
  deps: SlackLoopDeps,
  userId: string,
  msg: SlackMessagePayload,
): Promise<void> {
  const { db, getConfig, setConfig, runIntent, runAgent } = deps;
  const msgId = `sk-${msg.channelId}-${msg.messageTs}`;
  const processed = await loadProcessedIds(getConfig, userId);
  if (processed.has(msgId)) return;

  const id = `sk-${uuid()}`;
  await db.insertChannelMessage(userId, {
    id,
    channel: 'slack',
    channelMessageId: msg.messageTs,
    fromId: msg.fromId,
    fromName: msg.fromName ?? msg.fromId,
    chatId: msg.channelId,
    text: msg.text,
    timestamp: msg.timestamp,
    isGroup: !msg.isDM,
  });

  const fromDisplay = msg.fromName ?? msg.fromId;
  const goal = `用户通过 Slack 发来消息，请处理并回复。

【发件人】${fromDisplay}（Channel: ${msg.channelId}）
【内容】
${msg.text}

请理解用户意图，处理请求，并用 x.send_slack 回复到 channelId=${msg.channelId}${msg.threadTs ? `，threadTs=${msg.threadTs}` : ''}。`;

  await fireSignal(userId, 'slack_message_received', { from: msg.fromId, channelId: msg.channelId, text: msg.text, messageId: msgId, goal }, { getConfig, runIntent, runAgent });

  await saveProcessedIds(setConfig, userId, [...processed, msgId]);
  serverLogger.info('slack/loop', `slack_message_received 已发出`, `userId=${userId} from=${fromDisplay}`);
}
