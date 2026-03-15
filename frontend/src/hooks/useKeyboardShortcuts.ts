import { useEffect } from 'react';
import { useDesktopStore } from '@/store/desktopStore';

/**
 * Global keyboard shortcuts for the desktop environment.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const s = useDesktopStore.getState();
      const cmd = e.metaKey || e.ctrlKey;

      // Cmd+K: Search launcher (handled in SearchLauncher)
      // Already handled there.

      // Cmd+L: Lock screen
      if (cmd && e.key === 'l' && !e.shiftKey) {
        e.preventDefault();
        s.lockScreen();
        return;
      }

      // Cmd+W: Close active window
      if (cmd && e.key === 'w') {
        e.preventDefault();
        if (s.activeWindowId) s.closeWindow(s.activeWindowId);
        return;
      }

      // Cmd+M: Minimize active window
      if (cmd && e.key === 'm') {
        e.preventDefault();
        if (s.activeWindowId) s.minimizeWindow(s.activeWindowId);
        return;
      }

      // Cmd+Shift+F: Maximize/Restore active window
      if (cmd && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        if (s.activeWindowId) {
          const win = s.windows.find((w) => w.id === s.activeWindowId);
          if (win) {
            win.isMaximized ? s.restoreWindow(win.id) : s.maximizeWindow(win.id);
          }
        }
        return;
      }

      // Cmd+1-9: Focus nth window
      if (cmd && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const visible = s.windows.filter((w) => !w.isMinimized);
        if (visible[idx]) {
          s.focusWindow(visible[idx].id);
        }
        return;
      }

      // Cmd+T: Open terminal
      if (cmd && e.key === 't' && !e.shiftKey) {
        e.preventDefault();
        s.openApp('terminal');
        return;
      }

      // Cmd+N: Open chat
      if (cmd && e.key === 'n') {
        e.preventDefault();
        s.openApp('chat');
        return;
      }

      // Escape: Close context menu / search
      if (e.key === 'Escape') {
        if (s.contextMenu.visible) {
          s.hideContextMenu();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
