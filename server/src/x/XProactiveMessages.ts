/**
 * 主脑 X 主动找用户：按用户存储的主动消息，供「X 主脑」入口展示；
 * 主脑通过工具 x.notify_user 推送，后端写入此处并 WebSocket 推送给对应用户。
 */

import { broadcastToUser } from '../wsBroadcast.js';

export type ProactiveMessageType = 'info' | 'need_api_key' | 'question' | 'skill_ready';

export interface ProactiveMessage {
  id: string;
  userId: string;
  content: string;
  type: ProactiveMessageType;
  createdAt: number;
  read?: boolean;
}

const byUser = new Map<string, ProactiveMessage[]>();
const MAX_PER_USER = 100;

function nextId(): string {
  return `x-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 获取某用户的主动消息列表（按时间倒序） */
export function getMessages(userId: string | undefined): ProactiveMessage[] {
  if (!userId) return [];
  const list = byUser.get(userId);
  return list ? [...list].reverse() : [];
}

/** 主脑向用户推送一条主动消息（后台执行，用户可在 X 主脑入口看到）；并实时推送到已连接客户端 */
export function addMessage(
  userId: string | undefined,
  content: string,
  type: ProactiveMessageType = 'info',
): ProactiveMessage | null {
  if (!userId || !content.trim()) return null;
  const list = byUser.get(userId) ?? [];
  const msg: ProactiveMessage = {
    id: nextId(),
    userId,
    content: content.trim(),
    type,
    createdAt: Date.now(),
  };
  list.push(msg);
  if (list.length > MAX_PER_USER) list.shift();
  byUser.set(userId, list);
  broadcastToUser(userId, { type: 'x_proactive_message', data: msg });
  return msg;
}

/** 标记某条为已读（可选，前端可调用） */
export function markRead(userId: string | undefined, messageId: string): void {
  if (!userId) return;
  const list = byUser.get(userId);
  const m = list?.find((x) => x.id === messageId);
  if (m) m.read = true;
}

/** 将 fromUserId 的主动消息合并到 toUserId（登录/注册后关联匿名数据时调用） */
export function mergeMessagesInto(fromUserId: string, toUserId: string): void {
  if (fromUserId === toUserId) return;
  const fromList = byUser.get(fromUserId);
  if (!fromList?.length) return;
  const toList = byUser.get(toUserId) ?? [];
  const merged = [...toList];
  for (const msg of fromList) {
    merged.push({ ...msg, userId: toUserId });
  }
  if (merged.length > MAX_PER_USER) merged.splice(0, merged.length - MAX_PER_USER);
  byUser.set(toUserId, merged);
  byUser.delete(fromUserId);
}
