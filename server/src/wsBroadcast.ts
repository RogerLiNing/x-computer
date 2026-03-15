/**
 * WebSocket 广播：供路由等模块向所有已连接客户端推送消息。
 * 由 index.ts 在启动时注入实际广播函数。
 */

export type BroadcastFn = (msg: { type: string; data?: unknown }) => void;

/** 按用户推送（主脑 X 主动找用户时用） */
export type BroadcastToUserFn = (userId: string, msg: { type: string; data?: unknown }) => void;

/** 向已订阅某小程序的用户连接推送（小程序/小游戏实时消息） */
export type BroadcastToAppChannelFn = (
  userId: string,
  appId: string,
  message: unknown,
) => void;

let broadcastFn: BroadcastFn | null = null;
let broadcastToUserFn: BroadcastToUserFn | null = null;
let broadcastToAppChannelFn: BroadcastToAppChannelFn | null = null;

export function setBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

export function setBroadcastToUser(fn: BroadcastToUserFn): void {
  broadcastToUserFn = fn;
}

export function setBroadcastToAppChannel(fn: BroadcastToAppChannelFn): void {
  broadcastToAppChannelFn = fn;
}

export function broadcast(msg: { type: string; data?: unknown }): void {
  if (broadcastFn) broadcastFn(msg);
}

export function broadcastToUser(userId: string, msg: { type: string; data?: unknown }): void {
  if (userId && broadcastToUserFn) broadcastToUserFn(userId, msg);
}

export function broadcastToAppChannel(userId: string, appId: string, message: unknown): void {
  if (userId && appId && broadcastToAppChannelFn) broadcastToAppChannelFn(userId, appId, message);
}
