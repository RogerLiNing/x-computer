import { create } from 'zustand';
import type {
  AppIdentifier,
  AppWindow,
  ExecutionMode,
  Notification,
  Task,
  TaskStep,
  ApprovalRequest,
  AuditEntry,
} from '@shared/index';
import { getAppTitle, getAppDefaultSize, isMobileViewport } from '@/appRegistry';
import { api } from '@/utils/api';

// ── Window helpers ─────────────────────────────────────────

let nextZIndex = 1;
let windowCounter = 0;

function makeWindowId(): string {
  return `win-${++windowCounter}-${Date.now()}`;
}

const DESKTOP_APP_ORDER: AppIdentifier[] = [
  'file-manager', 'terminal', 'browser', 'chat', 'x', 'code-editor', 'text-editor',
  'spreadsheet', 'email', 'calendar', 'settings', 'task-timeline',
];
const GRID_COLS = 6;
const DESKTOP_ICON_LAYOUT_KEY = 'x-computer-desktop-icon-layout';

function getDefaultIconPositions(): Partial<Record<string, { col: number; row: number }>> {
  const out: Partial<Record<string, { col: number; row: number }>> = {};
  DESKTOP_APP_ORDER.forEach((id, i) => {
    out[String(id)] = { col: i % GRID_COLS, row: Math.floor(i / GRID_COLS) };
  });
  return out;
}

function loadIconPositions(): Partial<Record<string, { col: number; row: number }>> {
  try {
    const raw = localStorage.getItem(DESKTOP_ICON_LAYOUT_KEY);
    if (!raw) return getDefaultIconPositions();
    const parsed = JSON.parse(raw) as Record<string, { col: number; row: number }>;
    const result: Partial<Record<string, { col: number; row: number }>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v?.col === 'number' && typeof v?.row === 'number') result[k] = v;
    }
    return Object.keys(result).length ? result : getDefaultIconPositions();
  } catch {
    return getDefaultIconPositions();
  }
}

function saveIconPositions(positions: Partial<Record<string, { col: number; row: number }>>) {
  try {
    localStorage.setItem(DESKTOP_ICON_LAYOUT_KEY, JSON.stringify(positions));
  } catch {
    // ignore
  }
}

// ── File System types ──────────────────────────────────────

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  /** 创建时间（ISO），后端可选返回 */
  created?: string;
  permissions: string;
}

// ── Context menu ───────────────────────────────────────────

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action: () => void;
  separator?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

// ── Store interface ────────────────────────────────────────

interface DesktopStore {
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

  // Windows
  windows: AppWindow[];
  activeWindowId: string | null;
  openApp: (appId: AppIdentifier, meta?: Record<string, unknown>) => string;
  closeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  minimizeWindow: (windowId: string) => void;
  maximizeWindow: (windowId: string) => void;
  restoreWindow: (windowId: string) => void;
  moveWindow: (windowId: string, x: number, y: number) => void;
  resizeWindow: (windowId: string, w: number, h: number) => void;
  setWindowTitle: (windowId: string, title: string) => void;
  setWindowMetadata: (windowId: string, metadata: Record<string, unknown>) => void;

  // Execution mode
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;

  // Tasks (enhanced)
  tasks: Task[];
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  upsertTask: (taskId: string, data: any) => void;
  syncTasks: (tasks: Task[]) => void;
  updateTaskStep: (taskId: string, stepId: string, updates: Partial<TaskStep>) => void;
  removeTask: (taskId: string) => void;

  // Approvals
  approvals: ApprovalRequest[];
  addApproval: (req: ApprovalRequest) => void;
  resolveApproval: (id: string, status: 'approved' | 'rejected') => void;

  // Audit
  auditLog: AuditEntry[];
  addAuditEntry: (entry: AuditEntry) => void;
  syncAuditLog: (entries: AuditEntry[]) => void;

  // Notifications
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationRead: (id: string) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  // Taskbar
  taskbarPinned: AppIdentifier[];

  // Desktop icon grid layout (user can drag to rearrange)
  desktopIconPositions: Partial<Record<string, { col: number; row: number }>>;
  setDesktopIconPosition: (appId: AppIdentifier, col: number, row: number) => void;
  /** 从云端覆盖图标布局（启动时拉取后调用，不写回云端） */
  setDesktopIconPositionsFromCloud: (positions: Partial<Record<string, { col: number; row: number }>>) => void;

  // Context menu
  contextMenu: ContextMenuState;
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideContextMenu: () => void;

  // Lock screen
  isLocked: boolean;
  lockScreen: () => void;
  unlockScreen: () => void;

  // Search launcher
  searchOpen: boolean;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;

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

// ── Store ──────────────────────────────────────────────────

export const useDesktopStore = create<DesktopStore>((set, get) => ({
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

  // -- Windows --
  windows: [],
  activeWindowId: null,

  openApp: (appId, meta) => {
    const size = getAppDefaultSize(appId);
    const existing = get().windows.filter((w) => !w.isMinimized);
    const offset = (existing.length % 8) * 28;
    const mobile = isMobileViewport();
    const taskbarH = mobile ? 48 : 52;
    const screenW = window.innerWidth;
    const screenH = window.innerHeight - taskbarH;
    const x = mobile ? 0 : Math.max(40, Math.min(screenW - size.w - 40, (screenW - size.w) / 2 + offset - 100));
    const y = mobile ? 0 : Math.max(20, Math.min(screenH - size.h - 20, (screenH - size.h) / 2 + offset - 80));

    const win: AppWindow = {
      id: makeWindowId(),
      appId,
      title: getAppTitle(appId),
      x,
      y,
      width: size.w,
      height: size.h,
      isMinimized: false,
      isMaximized: mobile,
      isFocused: true,
      zIndex: ++nextZIndex,
      metadata: meta,
    };
    set((s) => ({
      windows: [...s.windows.map((w) => ({ ...w, isFocused: false })), win],
      activeWindowId: win.id,
    }));
    return win.id;
  },

  closeWindow: (windowId) => {
    set((s) => {
      const remaining = s.windows.filter((w) => w.id !== windowId);
      const visible = remaining.filter((w) => !w.isMinimized);
      const newActive = visible.length > 0
        ? visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id
        : null;
      return {
        windows: remaining.map((w) => ({ ...w, isFocused: w.id === newActive })),
        activeWindowId: newActive,
      };
    });
  },

  focusWindow: (windowId) => {
    set((s) => ({
      windows: s.windows.map((w) => ({
        ...w,
        isFocused: w.id === windowId,
        isMinimized: w.id === windowId ? false : w.isMinimized,
        zIndex: w.id === windowId ? ++nextZIndex : w.zIndex,
      })),
      activeWindowId: windowId,
    }));
  },

  minimizeWindow: (windowId) => {
    set((s) => {
      const updated = s.windows.map((w) =>
        w.id === windowId ? { ...w, isMinimized: true, isFocused: false } : w,
      );
      const visible = updated.filter((w) => !w.isMinimized);
      const newActive = visible.length > 0
        ? visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id
        : null;
      return {
        windows: updated.map((w) => ({ ...w, isFocused: w.id === newActive })),
        activeWindowId: newActive,
      };
    });
  },

  maximizeWindow: (windowId) => {
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === windowId ? { ...w, isMaximized: true } : w,
      ),
    }));
  },

  restoreWindow: (windowId) => {
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === windowId ? { ...w, isMaximized: false } : w,
      ),
    }));
  },

  moveWindow: (windowId, x, y) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === windowId ? { ...w, x, y } : w)),
    }));
  },

  resizeWindow: (windowId, width, height) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === windowId ? { ...w, width, height } : w)),
    }));
  },

  setWindowTitle: (windowId, title) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === windowId ? { ...w, title } : w)),
    }));
  },

  setWindowMetadata: (windowId, metadata) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === windowId ? { ...w, metadata } : w)),
    }));
  },

  // -- Execution Mode --
  executionMode: 'approval',
  setExecutionMode: (mode) => set({ executionMode: mode }),

  // -- Tasks (enhanced) --
  tasks: [],
  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),

  updateTask: (taskId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t)),
    })),

  upsertTask: (taskId, data) =>
    set((s) => {
      const idx = s.tasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) {
        const tasks = [...s.tasks];
        tasks[idx] = { ...tasks[idx], ...data, updatedAt: Date.now() };
        return { tasks };
      }
      // 新任务：完整对象直接插入；仅 status/result 时也插入最小项，便于对话里「查看任务」能收到完成状态
      const inserted = data.domain && data.title ? data : { id: taskId, ...data, updatedAt: Date.now() };
      return { tasks: [inserted, ...s.tasks] };
    }),

  syncTasks: (tasks) => set({ tasks: Array.isArray(tasks) ? tasks : [] }),

  updateTaskStep: (taskId, stepId, updates) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const steps = t.steps ?? [];
        return {
          ...t,
          updatedAt: Date.now(),
          steps: steps.map((step) =>
            step.id === stepId ? { ...step, ...updates } : step,
          ),
        };
      }),
    })),

  removeTask: (taskId) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) })),

  // -- Approvals --
  approvals: [],
  addApproval: (req) =>
    set((s) => {
      if (s.approvals.some((a) => a.id === req.id)) return {};
      return { approvals: [req, ...s.approvals] };
    }),
  resolveApproval: (id, status) =>
    set((s) => ({
      approvals: s.approvals.map((a) =>
        a.id === id ? { ...a, status, resolvedAt: Date.now() } : a,
      ),
    })),

  // -- Audit --
  auditLog: [],
  addAuditEntry: (entry) =>
    set((s) => ({ auditLog: [...s.auditLog, entry] })),
  syncAuditLog: (entries) => set({ auditLog: Array.isArray(entries) ? entries : [] }),

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

  // -- Taskbar --
  taskbarPinned: [
    'file-manager',
    'terminal',
    'browser',
    'chat',
    'code-editor',
    'text-editor',
    'email',
    'settings',
    'task-timeline',
  ],

  // -- Desktop icon grid --
  desktopIconPositions: typeof window !== 'undefined' ? loadIconPositions() : getDefaultIconPositions(),
  setDesktopIconPosition: (appId, col, row) => {
    const key = String(appId);
    set((s) => {
      const positions = { ...s.desktopIconPositions };
      const prev = positions[key];
      const occupant = Object.entries(positions).find(
        ([id, p]) => id !== key && p != null && p.col === col && p.row === row,
      );
      positions[key] = { col, row };
      if (occupant?.[1]) positions[occupant[0]] = prev ?? { col: 0, row: 0 };
      saveIconPositions(positions);
      api.setUserConfigKey('desktop_layout', positions).catch(() => {});
      return { desktopIconPositions: positions };
    });
  },

  setDesktopIconPositionsFromCloud: (positions) => {
    const sanitized: Partial<Record<string, { col: number; row: number }>> = {};
    for (const [k, v] of Object.entries(positions ?? {})) {
      if (v && typeof v === 'object' && typeof (v as { col?: number }).col === 'number' && typeof (v as { row?: number }).row === 'number') {
        sanitized[k] = { col: (v as { col: number }).col, row: (v as { row: number }).row };
      }
    }
    if (Object.keys(sanitized).length > 0) {
      set({ desktopIconPositions: sanitized });
      saveIconPositions(sanitized);
    }
  },

  // -- Context menu --
  contextMenu: { visible: false, x: 0, y: 0, items: [] },
  showContextMenu: (x, y, items) =>
    set({ contextMenu: { visible: true, x, y, items } }),
  hideContextMenu: () =>
    set((s) => (s.contextMenu.visible ? { contextMenu: { ...s.contextMenu, visible: false } } : {})),

  // -- Lock screen --
  isLocked: false,
  lockScreen: () => set({ isLocked: true }),
  unlockScreen: () => set({ isLocked: false }),

  // -- Search --
  searchOpen: false,
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setSearchOpen: (open) => set({ searchOpen: open }),

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
