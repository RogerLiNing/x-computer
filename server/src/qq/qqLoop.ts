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
  /** 渠道消息作为Chat会话处理 */
  handleChannelMessageAsChat?: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) => Promise<void>;
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
  const { db, getConfig, setConfig, runIntent, runAgent, handleChannelMessageAsChat } = deps;
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

  const fromDisplay = msg.fromName || msg.fromId;

  // 如果提供了handleChannelMessageAsChat，则使用Chat会话方式处理
  if (handleChannelMessageAsChat) {
    const targetType = msg.messageType === 'private' ? 'private' : msg.messageType === 'group' ? 'group' : 'guild';
    const targetId = msg.chatId;
    await handleChannelMessageAsChat(userId, 'QQ', msg.text, fromDisplay, { targetType, targetId });
  } else {
    // 后备：使用fireSignal触发意图处理
    const targetType = msg.messageType === 'private' ? 'private' : msg.messageType === 'group' ? 'group' : 'guild';
    const targetId = msg.chatId;
    const goal = `用户通过 QQ 发来消息，请处理并回复。

【发件人】${fromDisplay}（${msg.messageType === 'private' ? '私聊' : msg.messageType === 'group' ? `群聊 ${msg.groupId}` : `频道 ${msg.guildId}/${msg.channelId}`}）
【内容】
${msg.text}

【重要-回复工具参数】请使用 x.send_qq，参数必须是：targetType="${targetType}", targetId="${targetId}"（这是发送者的 QQ ID，是一串数字如 ${targetId}，不是 "user" 字符串！）。`;

    await fireSignal(userId, 'qq_message_received', { from: msg.fromId, chatId: msg.chatId, text: msg.text, messageId: msgId, messageType: msg.messageType, goal }, { getConfig, runIntent, runAgent });
  }

  await saveProcessedIds(setConfig, userId, [...processed, msgId]);
  serverLogger.info('qq/loop', `qq_message_received 已发出`, `userId=${userId} from=${fromDisplay}`);
}
