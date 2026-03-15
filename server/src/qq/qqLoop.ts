/**
 * QQ 消息处理循环：收到消息后存入 DB、发出 qq_message_received 信号。
 */

import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import { fireSignal } from '../signals/signalService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { QQMessagePayload } from './qqService.js';

const QQ_PROCESSED_IDS_KEY = 'qq_processed_ids';
const MAX_PROCESSED_IDS = 500;

export interface QQLoopDeps {
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
  const raw = getConfig(userId, QQ_PROCESSED_IDS_KEY);
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
  const result = setConfig(userId, QQ_PROCESSED_IDS_KEY, JSON.stringify(ids.slice(-MAX_PROCESSED_IDS)));
  if (result instanceof Promise) await result;
}

export async function handleQQMessage(
  deps: QQLoopDeps,
  userId: string,
  msg: QQMessagePayload,
): Promise<void> {
  const { db, getConfig, setConfig, runIntent, runAgent } = deps;
  const msgId = `qq-${msg.messageId}`;
  const processed = await loadProcessedIds(getConfig, userId);
  if (processed.has(msgId)) return;

  const id = `qq-${uuid()}`;
  await db.insertChannelMessage(userId, {
    id,
    channel: 'qq',
    channelMessageId: msg.messageId,
    fromId: msg.fromId,
    fromName: msg.fromName,
    chatId: msg.chatId,
    text: msg.text,
    timestamp: msg.timestamp,
    isGroup: msg.messageType !== 'private',
  });

  const targetType = msg.messageType === 'private' ? 'private' : msg.messageType === 'group' ? 'group' : 'guild';
  const targetId = msg.chatId;
  const fromDisplay = msg.fromName || msg.fromId;
  const goal = `用户通过 QQ 发来消息，请处理并回复。

【发件人】${fromDisplay}（${msg.messageType === 'private' ? '私聊' : msg.messageType === 'group' ? `群聊 ${msg.groupId}` : `频道 ${msg.guildId}/${msg.channelId}`}）
【内容】
${msg.text}

请理解用户意图，处理请求，并用 x.send_qq 回复（targetType=${targetType}, targetId=${targetId}）。`;

  await fireSignal(userId, 'qq_message_received', { from: msg.fromId, chatId: msg.chatId, text: msg.text, messageId: msgId, messageType: msg.messageType, goal }, { getConfig, runIntent, runAgent });

  await saveProcessedIds(setConfig, userId, [...processed, msgId]);
  serverLogger.info('qq/loop', `qq_message_received 已发出`, `userId=${userId} from=${fromDisplay}`);
}
