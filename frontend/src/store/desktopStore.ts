import { create } from 'zustand';
import type { AppIdentifier, AppWindow } from '@shared/index';
import { getAppTitle, getAppDefaultSize, isMobileViewport } from '@/appRegistry';

// ── Window helpers ─────────────────────────────────────────

let nextZIndex = 1;
let windowCounter = 0;

function makeWindowId(): string {
  return `win-${++windowCounter}-${Date.now()}`;
}

// ── Store interface ────────────────────────────────────────

interface DesktopStore {
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
}

// ── Store ──────────────────────────────────────────────────

export const useDesktopStore = create<DesktopStore>((set, get) => ({
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
}));
