import { create } from 'zustand';
import type { AppIdentifier, ExecutionMode } from '@shared/index';
import { api } from '@/utils/api';

// ── Constants for desktop icon layout ───────────────────────

export const DESKTOP_APP_ORDER: AppIdentifier[] = [
  'file-manager', 'terminal', 'browser', 'chat', 'x', 'code-editor', 'text-editor',
  'spreadsheet', 'email', 'calendar', 'settings', 'task-timeline',
];
const GRID_COLS = 6;
const DESKTOP_ICON_LAYOUT_KEY = 'x-computer-desktop-icon-layout';

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

interface ConfigStore {
  // Execution mode
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;

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
  /** 会话列表（供 SearchLauncher 使用） */
  searchSessions: Array<{ id: string; title: string | null; summary?: string | null; tags: string[] }>;
  setSearchSessions: (sessions: Array<{ id: string; title: string | null; summary?: string | null; tags: string[] }>) => void;
}

// ── Store ──────────────────────────────────────────────────

export const useConfigStore = create<ConfigStore>((set, _get) => ({
  // -- Execution Mode --
  executionMode: 'approval',
  setExecutionMode: (mode) => set({ executionMode: mode }),

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
