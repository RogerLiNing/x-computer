/**
 * 主脑 X 主动找用户：按用户存储的主动消息，供「X 主脑」入口展示；
 * 主脑通过工具 x.notify_user 推送，后端写入此处并 WebSocket 推送给对应用户。
 */

import { broadcastToUser } from '../wsBroadcast.js';
import type { AppDatabase } from '../db/database.js';

export const LIVING_NOTICE_PREFIX='living-notice-';

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

/** Autonomous receipts share the existing durable notification and read state. */
export async function getMessagesWithHistory(db:AppDatabase|undefined,userId:string|undefined):Promise<ProactiveMessage[]>{
  const memory=getMessages(userId);if(!db||!userId||userId==='anonymous')return memory;
  const rows=await db.query<{id:string;body:string;created_at:number;read:number}>('SELECT id,body,created_at,`read` FROM notifications WHERE user_id=? AND id LIKE ? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC,id DESC LIMIT 100',[userId,`${LIVING_NOTICE_PREFIX}%`,Date.now()]);
  const durable=rows.map(row=>({id:row.id,userId,content:row.body,type:'info' as const,createdAt:Number(row.created_at),read:!!row.read}));
  return [...new Map([...memory,...durable].map(message=>[message.id,message])).values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,MAX_PER_USER);
}
export async function markReadWithHistory(db:AppDatabase|undefined,userId:string|undefined,id:string){
  if(db&&userId&&id.startsWith(LIVING_NOTICE_PREFIX))await db.markNotificationRead(id,userId);
  markRead(userId,id);
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
