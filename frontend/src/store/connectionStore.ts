import { create } from 'zustand';
import type { Notification } from '@shared/index';
import { api } from '@/utils/api';

interface ConnectionStore {
  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;
  /** 供 useWebSocket 注入发送函数；小程序用 subscribeAppChannel 后通过此发送 subscribe_app */
  sendWs: ((msg: object) => void) | null;
  setSendWs: (fn: ((msg: object) => void) | null) => void;
  /** 订阅小程序通道：收到 app_channel 时调用 callback；返回取消订阅函数 */
  subscribeAppChannel: (appId: string, callback: (message: unknown) => void) => () => void;
  /** 内部用：WS 收到 app_channel 时由 useWebSocket 调用 */
  notifyAppChannel: (appId: string, message: unknown) => void;

  // Notifications
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationRead: (id: string) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  // X 主脑主动消息（主脑通过 x.notify_user 推送，在 X 主脑入口展示）
  xProactiveMessages: Array<{ id: string; content: string; type: string; createdAt: number; read?: boolean }>;
  addXProactiveMessage: (msg: { id: string; content: string; type: string; createdAt: number; read?: boolean }) => void;
  setXProactiveMessages: (list: Array<{ id: string; content: string; type: string; createdAt: number; read?: boolean }>) => void;
  /** 用户点击已读或 X 标记后调用，本地置为已读并请求后端 */
  markXProactiveRead: (id: string) => void;

  // 工具定义（用于界面显示描述名称，如「生成图片」「编辑图片」）
  tools: Array<{ name: string; displayName?: string }>;
  fetchTools: () => Promise<void>;
}

// ── 小程序 WebSocket 通道（app_channel）监听器，模块级避免放 store 里 ──
const appChannelListeners = new Map<string, Set<(message: unknown) => void>>();

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  // -- Connection --
  connected: false,
  setConnected: (connected) => set({ connected }),
  sendWs: null,
  setSendWs: (fn) => set({ sendWs: fn }),
  subscribeAppChannel: (appId, callback) => {
    if (!appChannelListeners.has(appId)) appChannelListeners.set(appId, new Set());
    appChannelListeners.get(appId)!.add(callback);
    return () => {
      appChannelListeners.get(appId)?.delete(callback);
    };
  },
  notifyAppChannel: (appId, message) => {
    appChannelListeners.get(appId)?.forEach((cb) => cb(message));
  },

  // -- Notifications --
  notifications: [],
  addNotification: (n) => {
    const notification: Notification = {
      ...n,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      read: false,
    };
    set((s) => ({ notifications: [notification, ...s.notifications].slice(0, 50) }));
  },
  markNotificationRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
  dismissNotification: (id) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    })),
  clearNotifications: () => set({ notifications: [] }),

  // -- X Proactive Messages --
  xProactiveMessages: [],
  addXProactiveMessage: (msg) =>
    set((s) => ({
      xProactiveMessages: [msg, ...s.xProactiveMessages].slice(0, 100),
    })),
  setXProactiveMessages: (list) => set({ xProactiveMessages: list }),
  markXProactiveRead: (id) => {
    set((s) => ({
      xProactiveMessages: s.xProactiveMessages.map((m) => (m.id === id ? { ...m, read: true } : m)),
    }));
    api.markXProactiveMessageRead(id).catch(() => {});
  },

  // -- Tools --
  tools: [],
  fetchTools: async () => {
    if (get().tools.length > 0) return;
    try {
      const list = await api.getTools();
      set({ tools: list.map((t: { name: string; displayName?: string }) => ({ name: t.name, displayName: t.displayName })) });
    } catch {
      // ignore
    }
  },
}));
