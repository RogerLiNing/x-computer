/**
 * X 主脑形象：浮动在桌面上，常驻可见；点击打开 X 主脑。
 * 使用 public/x-figure.png，无图时回退为 Brain 图标。
 */

import { useState } from 'react';
import { Brain } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';

export function XFigureFloating() {
  const openApp = useDesktopStore((s) => s.openApp);
  const xProactiveMessages = useDesktopStore((s) => s.xProactiveMessages);
  const [figureLoaded, setFigureLoaded] = useState(false);
  const messages = Array.isArray(xProactiveMessages) ? xProactiveMessages : [];
  const unreadCount = messages.filter((m) => !m.read).length;

  return (
    <div className="absolute bottom-20 right-6 z-20 pointer-events-auto">
      <button
        type="button"
        onClick={() => openApp('x')}
        className="relative w-16 h-16 rounded-full overflow-hidden bg-desktop-surface border-2 border-desktop-accent/50 shadow-lg hover:scale-110 hover:border-desktop-accent transition-all focus:outline-none focus:ring-2 focus:ring-desktop-accent"
        title="X 主脑 — 点击打开"
        aria-label="打开 X 主脑"
      >
        <img
          src="/x-figure.png"
          alt="X"
          className={figureLoaded ? 'w-full h-full object-cover' : 'absolute w-0 h-0 opacity-0'}
          onLoad={() => setFigureLoaded(true)}
          onError={() => setFigureLoaded(false)}
        />
        {!figureLoaded && (
          <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-desktop-accent to-desktop-highlight/80">
            <Brain className="w-8 h-8 text-white" />
          </span>
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-medium">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
