import { useEffect, useRef } from 'react';
import { useDesktopStore } from '@/store/desktopStore';

export function ContextMenu() {
  const { contextMenu, hideContextMenu } = useDesktopStore();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu.visible) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideContextMenu();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu.visible, hideContextMenu]);

  if (!contextMenu.visible) return null;

  // Ensure menu stays within viewport
  const menuWidth = 200;
  const menuHeight = contextMenu.items.length * 34;
  const x = Math.min(contextMenu.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(contextMenu.y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-[99999] animate-fade-in"
      style={{ left: x, top: y }}
    >
      <div className="bg-desktop-surface/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 min-w-[200px] overflow-hidden">
        {contextMenu.items.map((item, i) =>
          item.separator ? (
            <div key={i} className="h-px bg-white/5 my-1" />
          ) : (
            <button
              key={i}
              className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-xs transition-colors ${
                item.disabled
                  ? 'text-desktop-muted/40 cursor-not-allowed'
                  : 'text-desktop-text/80 hover:bg-white/8 hover:text-desktop-text'
              }`}
              onClick={() => {
                if (!item.disabled) {
                  item.action();
                  hideContextMenu();
                }
              }}
              disabled={item.disabled}
            >
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[10px] text-desktop-muted/50 tabular-nums">{item.shortcut}</span>
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
