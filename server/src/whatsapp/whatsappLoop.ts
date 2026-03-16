/**
 * WhatsApp 消息处理循环：收到消息后存入 DB、发出 whatsapp_message_received 信号。
 * 参考 emailCheckLoop，但 WhatsApp 为实时推送，由 whatsappService 的回调触发。
 */

import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import { fireSignal } from '../signals/signalService.js';
import { serverLogger } from '../observability/ServerLogger.js';

const WHATSAPP_CONFIG_KEY = 'whatsapp_config';
const WHATSAPP_PROCESSED_IDS_KEY = 'whatsapp_processed_ids';
const MAX_PROCESSED_IDS = 500;

export interface WhatsAppLoopDeps {
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
  const raw = getConfig(userId, WHATSAPP_PROCESSED_IDS_KEY);
  const value = raw instanceof Promise ? await raw : raw;
  if (!value) return new Set();
  try {
    const arr = JSON.parse(value) as unknown[];
    const ids = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    return new Set(ids.slice(-MAX_PROCESSED_IDS));
  } catch {
    return new Set();
  }
}

async function saveProcessedIds(
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>,
  userId: string,
  ids: string[],
): Promise<void> {
  const trimmed = ids.slice(-MAX_PROCESSED_IDS);
  const result = setConfig(userId, WHATSAPP_PROCESSED_IDS_KEY, JSON.stringify(trimmed));
  if (result instanceof Promise) await result;
}

/**
 * 处理单条 WhatsApp 消息：存入 DB、发出信号。
 */
export async function handleWhatsAppMessage(
  deps: WhatsAppLoopDeps,
  userId: string,
  msg: { fromJid: string; text: string; messageId?: string; timestamp?: number; isGroup: boolean },
): Promise<void> {
  const { db, getConfig, setConfig, runIntent, runAgent, handleChannelMessageAsChat } = deps;
  const msgId = msg.messageId ?? `${msg.fromJid}-${msg.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2)}`;
  const processed = await loadProcessedIds(getConfig, userId);
  if (processed.has(msgId)) return;

  const id = `wa-${uuid()}`;
  await db.insertWhatsAppMessage(userId, {
    id,
    messageId: msg.messageId,
    fromJid: msg.fromJid,
    text: msg.text,
    timestamp: msg.timestamp,
    isGroup: msg.isGroup,
  });

  const fromDisplay = msg.fromJid.replace(/@.*$/, '');

  // 如果提供了handleChannelMessageAsChat，则使用Chat会话方式处理
  if (handleChannelMessageAsChat) {
    await handleChannelMessageAsChat(userId, 'WhatsApp', msg.text, fromDisplay, { to: msg.fromJid });
  } else {
    // 后备：使用fireSignal触发意图处理
    const goal = `用户通过 WhatsApp 发来消息，请处理并回复。

【发件人】${fromDisplay}
【内容】
${msg.text}

请理解用户意图，处理请求，并用 x.send_whatsapp 回复到 ${fromDisplay}。`;

    await fireSignal(
      userId,
      'whatsapp_message_received',
      { from: msg.fromJid, text: msg.text, messageId: msgId, goal },
      {
        getConfig,
        runIntent,
        runAgent,
      },
    );
  }

  await saveProcessedIds(setConfig, userId, [...processed, msgId]);
  serverLogger.info('whatsapp/loop', `whatsapp_message_received 已发出`, `userId=${userId} from=${fromDisplay}`);
}
