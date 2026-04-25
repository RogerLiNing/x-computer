import { useEffect } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { useConfigStore } from '@/store/configStore';

const SHORTCUTS_STORAGE_KEY = 'x-computer-shortcuts';

const DEFAULT_SHORTCUTS: Record<string, () => string> = {
  searchLauncher: () => '⌘K',
  lockScreen: () => '⌘L',
  closeWindow: () => '⌘W',
  minimizeWindow: () => '⌘M',
  maximizeWindow: () => '⌘⇧F',
  focusWindow1: () => '⌘1',
  focusWindow2: () => '⌘2',
  focusWindow3: () => '⌘3',
  focusWindow4: () => '⌘4',
  focusWindow5: () => '⌘5',
  focusWindow6: () => '⌘6',
  focusWindow7: () => '⌘7',
  focusWindow8: () => '⌘8',
  focusWindow9: () => '⌘9',
  openTerminal: () => '⌘T',
  openChat: () => '⌘N',
  newChat: () => '⌘⇧N',
  toggleSidebar: () => '⌘B',
};

function loadCustomShortcuts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch { /* ignore */ }
  return {};
}

function parseShortcut(shortcut: string): { cmd: boolean; alt: boolean; shift: boolean; key: string } | null {
  if (!shortcut) return null;
  const parts = shortcut.split(/([\^⌘⌥⇧])/);
  let cmd = false, alt = false, shift = false, key = '';
  for (const p of parts) {
    if (p === '⌘' || p === '^' || p === 'Command' || p === 'Control') cmd = true;
    else if (p === '⌥' || p === 'Alt') alt = true;
    else if (p === '⇧' || p === 'Shift') shift = true;
    else if (p) key = p;
  }
  return key ? { cmd, alt, shift, key } : null;
}

function matchesShortcut(e: KeyboardEvent, parsed: { cmd: boolean; alt: boolean; shift: boolean; key: string }): boolean {
  const cmd = e.metaKey || e.ctrlKey;
  if (parsed.cmd !== cmd) return false;
  if (parsed.alt !== e.altKey) return false;
  if (parsed.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === parsed.key.toLowerCase() || e.code.toLowerCase().endsWith(parsed.key.toLowerCase());
}

/**
 * Global keyboard shortcuts for the desktop environment.
 * Reads custom shortcuts from localStorage (saved by ShortcutsSettings).
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const shortcuts = loadCustomShortcuts();

    const handleKeyDown = (e: KeyboardEvent) => {
      const s = useDesktopStore.getState();
      const config = useConfigStore.getState();

      // Search launcher — let SearchLauncher handle it
      const sl = shortcuts['searchLauncher'] || DEFAULT_SHORTCUTS.searchLauncher();
      const slParsed = parseShortcut(sl);
      if (slParsed && matchesShortcut(e, slParsed)) return;

      // Lock screen
      const ls = shortcuts['lockScreen'] || DEFAULT_SHORTCUTS.lockScreen();
      if (matchesShortcut(e, parseShortcut(ls)!)) {
        e.preventDefault();
        config.lockScreen();
        return;
      }

      // Close active window
      const cw = shortcuts['closeWindow'] || DEFAULT_SHORTCUTS.closeWindow();
      if (matchesShortcut(e, parseShortcut(cw)!)) {
        e.preventDefault();
        if (s.activeWindowId) s.closeWindow(s.activeWindowId);
        return;
      }

      // Minimize active window
      const mw = shortcuts['minimizeWindow'] || DEFAULT_SHORTCUTS.minimizeWindow();
      if (matchesShortcut(e, parseShortcut(mw)!)) {
        e.preventDefault();
        if (s.activeWindowId) s.minimizeWindow(s.activeWindowId);
        return;
      }

      // Maximize / Restore active window
      const xw = shortcuts['maximizeWindow'] || DEFAULT_SHORTCUTS.maximizeWindow();
      if (matchesShortcut(e, parseShortcut(xw)!)) {
        e.preventDefault();
        if (s.activeWindowId) {
          const win = s.windows.find((w) => w.id === s.activeWindowId);
          if (win) {
            win.isMaximized ? s.restoreWindow(win.id) : s.maximizeWindow(win.id);
          }
        }
        return;
      }

      // Focus nth window
      for (let i = 1; i <= 9; i++) {
        const action = `focusWindow${i}`;
        const sc = shortcuts[action] || DEFAULT_SHORTCUTS[action]();
        const parsed = parseShortcut(sc);
        if (parsed && matchesShortcut(e, parsed)) {
          e.preventDefault();
          const idx = i - 1;
          const visible = s.windows.filter((w) => !w.isMinimized);
          if (visible[idx]) s.focusWindow(visible[idx].id);
          return;
        }
      }

      // Open terminal
      const ot = shortcuts['openTerminal'] || DEFAULT_SHORTCUTS.openTerminal();
      if (matchesShortcut(e, parseShortcut(ot)!)) {
        e.preventDefault();
        s.openApp('terminal');
        return;
      }

      // Open chat
      const oc = shortcuts['openChat'] || DEFAULT_SHORTCUTS.openChat();
      if (matchesShortcut(e, parseShortcut(oc)!)) {
        e.preventDefault();
        s.openApp('chat');
        return;
      }

      // New chat
      const nc = shortcuts['newChat'] || DEFAULT_SHORTCUTS.newChat();
      if (matchesShortcut(e, parseShortcut(nc)!)) {
        e.preventDefault();
        s.openApp('chat');
        return;
      }

      // Toggle sidebar
      const ts = shortcuts['toggleSidebar'] || DEFAULT_SHORTCUTS.toggleSidebar();
      if (matchesShortcut(e, parseShortcut(ts)!)) {
        // Sidebar toggle is handled per-app; dispatch a custom event
        window.dispatchEvent(new CustomEvent('x:toggle-sidebar'));
        return;
      }

      // Escape: Close context menu
      if (e.key === 'Escape') {
        if (config.contextMenu.visible) {
          config.hideContextMenu();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
