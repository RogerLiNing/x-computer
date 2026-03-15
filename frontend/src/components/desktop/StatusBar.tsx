import { useState, useEffect } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { Wifi, WifiOff, Battery, Lock, Search } from 'lucide-react';

export function StatusBar() {
  const { connected, toggleSearch, lockScreen } = useDesktopStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-7 bg-black/30 backdrop-blur-md flex items-center px-3 sm:px-4 gap-2 sm:gap-3 z-50 relative text-[10px] sm:text-[11px]">
      {/* Left: brand */}
      <div className="font-semibold text-desktop-text/70 flex items-center gap-1.5 truncate min-w-0">
        <span className="text-desktop-highlight font-bold shrink-0">X</span>
        <span className="hidden sm:inline">Computer</span>
      </div>

      <div className="flex-1" />

      {/* Right: status indicators */}
      <button
        className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-white/10 transition-colors text-desktop-muted"
        onClick={toggleSearch}
        title="搜索 (⌘K)"
      >
        <Search size={11} />
      </button>

      <div className="flex items-center gap-1 text-desktop-muted">
        {connected ? (
          <Wifi size={12} className="text-green-400/70" />
        ) : (
          <WifiOff size={12} className="text-red-400/70" />
        )}
      </div>

      <Battery size={14} className="text-desktop-muted/60" />

      <button
        className="hover:bg-white/10 rounded px-1 py-0.5 transition-colors text-desktop-muted"
        onClick={lockScreen}
        title="锁定 (⌘L)"
      >
        <Lock size={11} />
      </button>

      <span className="text-desktop-muted/70 tabular-nums">
        {time.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' })}{' '}
        {time.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}
