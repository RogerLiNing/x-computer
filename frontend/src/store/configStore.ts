import { create } from 'zustand';
import type { AppIdentifier, AppFolder } from '@shared/index';
import { api } from '@/utils/api';

// ── Constants for desktop icon layout ───────────────────────

export const DESKTOP_APP_ORDER: AppIdentifier[] = [
  'file-manager', 'terminal', 'browser', 'chat', 'x', 'text-editor', 'settings',
  'plugin-manager', 'digital-human', 'system-monitor', 'code-editor',
  'spreadsheet', 'email', 'calendar', 'canvas', 'diff',
  'quick-notes', 'pomodoro', 'world-clock', 'bookmarks', 'clipboard-manager', 'habit-tracker', 'password-generator', 'unit-converter', 'calculator', 'color-picker', 'dice-roller',
];
const GRID_COLS = 6;
const DESKTOP_ICON_LAYOUT_KEY = 'x-computer-desktop-icon-layout';
const APP_FOLDERS_KEY = 'x-computer-app-folders';
const APP_FOLDER_ASSIGNMENTS_KEY = 'x-computer-app-folder-assignments';

// ── Helper functions ───────────────────────────────────────

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

// ── App Folders ──────────────────────────────────────────────

function loadAppFolders(): AppFolder[] {
  try {
    const raw = localStorage.getItem(APP_FOLDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AppFolder[];
  } catch {
    return [];
  }
}

function saveAppFolders(folders: AppFolder[]) {
  try {
    localStorage.setItem(APP_FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    // ignore
  }
}

function loadAppFolderAssignments(): Record<string, string> {
  try {
    const raw = localStorage.getItem(APP_FOLDER_ASSIGNMENTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveAppFolderAssignments(assignments: Record<string, string>) {
  try {
    localStorage.setItem(APP_FOLDER_ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    // ignore
  }
}

function generateId(): string {
  return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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

/** 消息渲染模式 */
export type RenderMode = 'markdown' | 'html' | 'react';

interface ConfigStore {
  // Message render mode
  renderMode: RenderMode;
  setRenderMode: (mode: RenderMode) => void;

  // Taskbar
  taskbarPinned: AppIdentifier[];

  // Desktop icon grid layout (user can drag to rearrange)
  desktopIconPositions: Partial<Record<string, { col: number; row: number }>>;
  setDesktopIconPosition: (appId: AppIdentifier, col: number, row: number) => void;
  /** 从云端覆盖图标布局（启动时拉取后调用，不写回云端） */
  setDesktopIconPositionsFromCloud: (positions: Partial<Record<string, { col: number; row: number }>>) => void;

  // App Folders
  appFolders: AppFolder[];
  appFolderAssignments: Record<string, string>;
  addFolder: (name: string, icon: string, col: number, row: number) => AppFolder;
  removeFolder: (folderId: string) => void;
  renameFolder: (folderId: string, name: string) => void;
  setFolderIcon: (folderId: string, icon: string) => void;
  addAppToFolder: (folderId: string, appId: AppIdentifier) => void;
  removeAppFromFolder: (folderId: string, appId: AppIdentifier) => void;
  toggleFolderExpanded: (folderId: string) => void;
  setFolderPosition: (folderId: string, col: number, row: number) => void;

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
  /** 会话列表（供 SearchLauncher 使用） */
  searchSessions: Array<{ id: string; title: string | null; summary?: string | null; tags: string[] }>;
  setSearchSessions: (sessions: Array<{ id: string; title: string | null; summary?: string | null; tags: string[] }>) => void;
}

// ── Store ──────────────────────────────────────────────────

export const useConfigStore = create<ConfigStore>((set, _get) => ({
  // -- Render Mode --
  renderMode: (() => {
    try {
      const stored = localStorage.getItem('x-computer-render-mode');
      if (stored === 'html' || stored === 'react') return stored;
    } catch { /* ignore */ }
    return 'markdown';
  })(),
  setRenderMode: (mode) => {
    set({ renderMode: mode });
    try { localStorage.setItem('x-computer-render-mode', mode); } catch { /* ignore */ }
    api.setUserConfigKey('render_mode', mode).catch(() => {});
  },

  // -- Taskbar --
  taskbarPinned: [
    'file-manager',
    'terminal',
    'browser',
    'chat',
    'text-editor',
    'settings',
    'plugin-manager',
  ],

  // -- Desktop icon grid --
  desktopIconPositions:
    typeof window !== 'undefined' ? loadIconPositions() : getDefaultIconPositions(),
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
      if (
        v &&
        typeof v === 'object' &&
        typeof (v as { col?: number }).col === 'number' &&
        typeof (v as { row?: number }).row === 'number'
      ) {
        sanitized[k] = { col: (v as { col: number }).col, row: (v as { row: number }).row };
      }
    }
    if (Object.keys(sanitized).length > 0) {
      set({ desktopIconPositions: sanitized });
      saveIconPositions(sanitized);
    }
  },

  // -- App Folders --
  appFolders: typeof window !== 'undefined' ? loadAppFolders() : [],
  appFolderAssignments: typeof window !== 'undefined' ? loadAppFolderAssignments() : {},

  addFolder: (name, icon, col, row) => {
    const folder: AppFolder = {
      id: generateId(),
      name,
      icon,
      appIds: [],
      col,
      row,
      expanded: false,
    };
    set((s) => {
      const folders = [...s.appFolders, folder];
      saveAppFolders(folders);
      return { appFolders: folders };
    });
    return folder;
  },

  removeFolder: (folderId) => {
    set((s) => {
      const folder = s.appFolders.find((f) => f.id === folderId);
      const folders = s.appFolders.filter((f) => f.id !== folderId);
      const assignments = { ...s.appFolderAssignments };
      folder?.appIds.forEach((appId) => {
        delete assignments[appId];
      });
      saveAppFolders(folders);
      saveAppFolderAssignments(assignments);
      return { appFolders: folders, appFolderAssignments: assignments };
    });
  },

  renameFolder: (folderId, name) => {
    set((s) => {
      const folders = s.appFolders.map((f) =>
        f.id === folderId ? { ...f, name } : f,
      );
      saveAppFolders(folders);
      return { appFolders: folders };
    });
  },

  setFolderIcon: (folderId, icon) => {
    set((s) => {
      const folders = s.appFolders.map((f) =>
        f.id === folderId ? { ...f, icon } : f,
      );
      saveAppFolders(folders);
      return { appFolders: folders };
    });
  },

  addAppToFolder: (folderId, appId) => {
    set((s) => {
      const key = String(appId);
      const folders = s.appFolders.map((f) =>
        f.id === folderId && !f.appIds.includes(key)
          ? { ...f, appIds: [...f.appIds, key] }
          : f,
      );
      const assignments = { ...s.appFolderAssignments, [key]: folderId };
      saveAppFolders(folders);
      saveAppFolderAssignments(assignments);
      return { appFolders: folders, appFolderAssignments: assignments };
    });
  },

  removeAppFromFolder: (folderId, appId) => {
    set((s) => {
      const key = String(appId);
      const folders = s.appFolders.map((f) =>
        f.id === folderId
          ? { ...f, appIds: f.appIds.filter((id) => id !== appId) }
          : f,
      );
      const assignments = { ...s.appFolderAssignments };
      delete assignments[key];
      saveAppFolders(folders);
      saveAppFolderAssignments(assignments);
      return { appFolders: folders, appFolderAssignments: assignments };
    });
  },

  toggleFolderExpanded: (folderId) => {
    set((s) => {
      const folders = s.appFolders.map((f) =>
        f.id === folderId ? { ...f, expanded: !f.expanded } : { ...f, expanded: false },
      );
      saveAppFolders(folders);
      return { appFolders: folders };
    });
  },

  setFolderPosition: (folderId, col, row) => {
    set((s) => {
      const folders = s.appFolders.map((f) =>
        f.id === folderId ? { ...f, col, row } : f,
      );
      saveAppFolders(folders);
      return { appFolders: folders };
    });
  },

  // -- Context menu --
  contextMenu: { visible: false, x: 0, y: 0, items: [] },
  showContextMenu: (x, y, items) => set({ contextMenu: { visible: true, x, y, items } }),
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
  searchSessions: [],
  setSearchSessions: (sessions) => set({ searchSessions: sessions }),
}));
