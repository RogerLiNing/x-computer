import { useRef, useCallback, useState } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { X, Minus, Square, Maximize2 } from 'lucide-react';
import { AppContent } from '../apps/AppContent';
import type { AppWindow } from '@shared/index';

interface Props {
  window: AppWindow;
}

export function AppWindowFrame({ window: win }: Props) {
  const { closeWindow, focusWindow, minimizeWindow, maximizeWindow, restoreWindow, moveWindow, resizeWindow } =
    useDesktopStore();

  const frameRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, winX: 0, winY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  // ── Drag ─────────────────────────────────────────────
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (win.isMaximized) return;
      e.preventDefault();
      focusWindow(win.id);
      dragStart.current = { x: e.clientX, y: e.clientY, winX: win.x, winY: win.y };
      setDragging(true);

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragStart.current.x;
        const dy = ev.clientY - dragStart.current.y;
        moveWindow(win.id, dragStart.current.winX + dx, Math.max(0, dragStart.current.winY + dy));
      };
      const onUp = () => {
        setDragging(false);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [win, focusWindow, moveWindow],
  );

  // ── Resize ───────────────────────────────────────────
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (win.isMaximized) return;
      e.preventDefault();
      e.stopPropagation();
      resizeStart.current = { x: e.clientX, y: e.clientY, w: win.width, h: win.height };
      setResizing(true);

      const onMove = (ev: MouseEvent) => {
        const dw = ev.clientX - resizeStart.current.x;
        const dh = ev.clientY - resizeStart.current.y;
        resizeWindow(
          win.id,
          Math.max(320, resizeStart.current.w + dw),
          Math.max(200, resizeStart.current.h + dh),
        );
      };
      const onUp = () => {
        setResizing(false);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [win, resizeWindow],
  );

  const isMobileWindow = typeof window !== 'undefined' && window.innerWidth < 640;

  const style: React.CSSProperties = win.isMaximized
    ? {
        left: 0,
        top: 0,
        width: '100%',
        height: isMobileWindow
          ? '100%'
          : 'calc(100% - var(--taskbar-height, 52px))',
        zIndex: win.zIndex,
        paddingTop: isMobileWindow ? 'env(safe-area-inset-top)' : undefined,
      }
    : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex };

  return (
    <div
      ref={frameRef}
      className={`absolute flex flex-col overflow-hidden animate-fade-in sm:rounded-xl ${isMobileWindow && win.isMaximized ? 'safe-area-pb' : ''} ${
        win.isFocused ? 'shadow-window-focused ring-1 ring-desktop-highlight/20' : 'shadow-window'
      } ${win.isMaximized ? 'rounded-none' : ''}`}
      style={style}
      onMouseDown={() => focusWindow(win.id)}
    >
      {/* Title bar：移动端增高触控区域 */}
      <div
        className={`flex items-center h-9 min-h-[44px] sm:min-h-0 px-3 gap-2 shrink-0 cursor-default select-none touch-none ${
          win.isFocused ? 'bg-desktop-window-header' : 'bg-desktop-window-header/70'
        }`}
        onMouseDown={onDragStart}
        onDoubleClick={() => (win.isMaximized ? restoreWindow(win.id) : maximizeWindow(win.id))}
      >
        <span className="text-xs font-medium text-desktop-text/90 flex-1 truncate">{win.title}</span>

        <div className="flex items-center gap-1">
          <button
            className="min-w-[44px] min-h-[44px] w-10 h-10 sm:w-6 sm:h-6 sm:min-w-0 sm:min-h-0 rounded flex items-center justify-center hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
            onClick={(e) => { e.stopPropagation(); minimizeWindow(win.id); }}
          >
            <Minus size={13} className="text-desktop-muted" />
          </button>
          <button
            className="min-w-[44px] min-h-[44px] w-10 h-10 sm:w-6 sm:h-6 sm:min-w-0 sm:min-h-0 rounded flex items-center justify-center hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
            onClick={(e) => {
              e.stopPropagation();
              win.isMaximized ? restoreWindow(win.id) : maximizeWindow(win.id);
            }}
          >
            {win.isMaximized ? (
              <Square size={11} className="text-desktop-muted" />
            ) : (
              <Maximize2 size={12} className="text-desktop-muted" />
            )}
          </button>
          <button
            className="min-w-[44px] min-h-[44px] w-10 h-10 sm:w-6 sm:h-6 sm:min-w-0 sm:min-h-0 rounded flex items-center justify-center hover:bg-desktop-highlight/80 active:bg-desktop-highlight transition-colors touch-manipulation"
            onClick={(e) => { e.stopPropagation(); closeWindow(win.id); }}
          >
            <X size={14} className="text-desktop-muted hover:text-white" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 bg-desktop-window overflow-hidden">
        <AppContent appId={win.appId} windowId={win.id} metadata={win.metadata} />
      </div>

      {/* Resize handle：小屏不显示 */}
      {!win.isMaximized && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hidden sm:block"
          onMouseDown={onResizeStart}
        />
      )}
    </div>
  );
}
