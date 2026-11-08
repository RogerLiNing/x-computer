/**
 * QQ 消息处理循环：收到消息后存入 DB、发出 qq_message_received 信号。
 */

import { channelInboxId, channelProcessedKey } from '../messaging/channelIdentity.js';
import type { AppDatabase } from '../db/database.js';
import { fireSignal } from '../signals/signalService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { QQMessagePayload } from './qqService.js';
import { describeQQMessage, type QQAttachment, type SavedQQAttachment } from './qqAttachments.js';

const QQ_PROCESSED_IDS_KEY = 'qq_processed_ids';
const QQ_SELF_OPENID_KEY = 'qq_self_openid';
const QQ_RECENT_MESSAGES_KEY = 'qq_recent_messages';
const MAX_PROCESSED_IDS = 500;
const RECENT_MSG_WINDOW_MS = 5000; // 5秒内相同内容视为重复

export interface QQLoopDeps {
  db: AppDatabase;
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>;
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>;
  runIntent: (userId: string, intent: string, meta?: { signal?: string }) => void;
  runAgent: (userId: string, agentId: string, goal: string, meta?: { triggerId?: string; actionFingerprint?: string }) => Promise<void>;
  /** 渠道消息作为Chat会话处理 */
  handleChannelMessageAsChat?: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) => Promise<void>;
  /** 下载附件并存进用户的个人文件。只用于私聊（机器人主人本人发来的文件）。 */
  saveAttachments?: (userId: string, attachments: readonly QQAttachment[]) => Promise<SavedQQAttachment[]>;
}

/** 私聊附件存进主人的文件；群聊、频道里可能是别人发的，只说明收到了什么，不下载。 */
async function withAttachmentNotes(deps: QQLoopDeps, userId: string, msg: QQMessagePayload): Promise<QQMessagePayload> {
  const attachments = msg.attachments ?? [];
  if (!attachments.length) return msg;
  let saved: SavedQQAttachment[] = [];
  if (msg.messageType === 'private' && deps.saveAttachments) {
    try {
      saved = await deps.saveAttachments(userId, attachments);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      serverLogger.warn('qq/loop', '保存 QQ 附件失败', `userId=${userId} ${error}`);
      saved = attachments.map(attachment => ({ attachment, error: '文件区暂时不可用' }));
    }
    for (const item of saved) {
      if (item.path) serverLogger.info('qq/loop', '已保存 QQ 附件', `userId=${userId} path=${item.path}`);
      else serverLogger.warn('qq/loop', 'QQ 附件未保存', `userId=${userId} ${item.error ?? ''}`);
    }
  }
  return { ...msg, text: describeQQMessage(msg.text, attachments, saved) };
}

async function loadProcessedIds(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  scopeId?: string,
): Promise<Set<string>> {
  const raw = getConfig(userId, channelProcessedKey(QQ_PROCESSED_IDS_KEY, scopeId));
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
  scopeId?: string,
): Promise<void> {
  const result = setConfig(userId, channelProcessedKey(QQ_PROCESSED_IDS_KEY, scopeId), JSON.stringify(ids.slice(-MAX_PROCESSED_IDS)));
  if (result instanceof Promise) await result;
}

interface RecentMessage {
  fromId: string;
  text: string;
  ts: number;
}

async function loadRecentMessages(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  scopeId?: string,
): Promise<RecentMessage[]> {
  const raw = getConfig(userId, channelProcessedKey(QQ_RECENT_MESSAGES_KEY, scopeId));
  const value = raw instanceof Promise ? await raw : raw;
  if (!value) return [];
  try {
    const arr = JSON.parse(value) as unknown[];
    return Array.isArray(arr) ? (arr as RecentMessage[]).filter((m) => Date.now() - m.ts < RECENT_MSG_WINDOW_MS) : [];
  } catch {
    return [];
  }
}

async function saveRecentMessage(
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>,
  userId: string,
  recentMsgs: RecentMessage[],
  newMsg: RecentMessage,
  scopeId?: string,
): Promise<boolean> {
  // 检查是否在时间窗口内有相同内容
  const isDupe = recentMsgs.some(
    (m) => m.fromId === newMsg.fromId && m.text === newMsg.text && Date.now() - m.ts < RECENT_MSG_WINDOW_MS,
  );
  if (isDupe) return true;

  const updated = [...recentMsgs, newMsg].slice(-20); // 只保留最近20条
  const result = setConfig(userId, channelProcessedKey(QQ_RECENT_MESSAGES_KEY, scopeId), JSON.stringify(updated));
  if (result instanceof Promise) await result;
  return false;
}

export async function handleQQMessage(
  deps: QQLoopDeps,
  userId: string,
  incoming: QQMessagePayload,
): Promise<void> {
  let msg = incoming;
  const { db, getConfig, setConfig, runIntent, runAgent, handleChannelMessageAsChat } = deps;
  const msgId = `qq-${msg.messageId}`;

  const processed = await loadProcessedIds(getConfig, userId, msg.origin?.scopeId);
  const id = channelInboxId(userId, 'qq', msg.chatId, msgId, msg.origin?.scopeId);
  const processedId = msg.origin ? id : msgId;
  if (processed.has(processedId)) return;
  if (!handleChannelMessageAsChat) {
    await saveProcessedIds(setConfig, userId, [...processed, processedId], msg.origin?.scopeId);
    const recentMsgs = await loadRecentMessages(getConfig, userId, msg.origin?.scopeId);
    if (await saveRecentMessage(setConfig, userId, recentMsgs, { fromId: msg.fromId, text: msg.text, ts: Date.now() }, msg.origin?.scopeId)) return;
  }

  msg = await withAttachmentNotes(deps, userId, msg);

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

  // 自动记录用户的 OpenID（私聊时发送者就是用户自己）
  if (msg.messageType === 'private' && msg.fromId) {
    const currentOpenid = await Promise.resolve(getConfig(userId, channelProcessedKey(QQ_SELF_OPENID_KEY, msg.origin?.scopeId)));
    if (!currentOpenid || currentOpenid !== msg.fromId) {
      await Promise.resolve(setConfig(userId, channelProcessedKey(QQ_SELF_OPENID_KEY, msg.origin?.scopeId), msg.fromId));
      serverLogger.info('qq/loop', `已记录用户 OpenID`, `userId=${userId} openid=${msg.fromId}`);
    }
  }

  // 如果提供了handleChannelMessageAsChat，则使用Chat会话方式处理
  if (handleChannelMessageAsChat) {
    const targetType = msg.messageType === 'private' ? 'private' : msg.messageType === 'group' ? 'group' : 'guild';
    const targetId = msg.chatId;
    await handleChannelMessageAsChat(userId, 'QQ', msg.text, fromDisplay, { targetType, targetId, messageId: msgId, ...(msg.origin ? { origin: msg.origin, inboxId: id } : {}) });
    await saveProcessedIds(setConfig, userId, [...processed, processedId], msg.origin?.scopeId);
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

  serverLogger.info('qq/loop', `qq_message_received 已发出`, `userId=${userId} from=${fromDisplay}`);
}
