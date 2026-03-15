import { useState, useRef, useEffect } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { Lock, Fingerprint, ArrowRight } from 'lucide-react';

export function LockScreen() {
  const { isLocked, unlockScreen } = useDesktopStore();
  const [password, setPassword] = useState('');
  const [shake, setShake] = useState(false);
  const [time, setTime] = useState(new Date());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isLocked) {
      setPassword('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isLocked]);

  if (!isLocked) return null;

  const handleUnlock = () => {
    // For MVP, any password works (or empty)
    if (password.length >= 0) {
      unlockScreen();
      setPassword('');
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 600);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center"
      style={{
        background:
          'radial-gradient(ellipse at 50% 30%, rgba(15, 52, 96, 0.8) 0%, transparent 50%), ' +
          'radial-gradient(ellipse at 70% 70%, rgba(233, 69, 96, 0.1) 0%, transparent 40%), ' +
          'linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 50%, #0a0a1a 100%)',
      }}
    >
      <div className="flex flex-col items-center gap-8">
        {/* Time */}
        <div className="text-center">
          <div className="text-7xl font-light text-desktop-text/90 tabular-nums tracking-wider">
            {time.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-sm text-desktop-muted mt-2">
            {time.toLocaleDateString('zh-CN', {
              timeZone: 'Asia/Shanghai',
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        </div>

        {/* Avatar */}
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-desktop-highlight to-purple-500 flex items-center justify-center shadow-2xl">
          <Fingerprint size={36} className="text-white/80" />
        </div>

        {/* Username */}
        <div className="text-desktop-text font-medium">X-Computer 用户</div>

        {/* Password input */}
        <div className={`flex items-center gap-2 ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}>
          <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 focus-within:border-desktop-highlight/40 transition-colors">
            <Lock size={14} className="text-desktop-muted mr-3" />
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              placeholder="输入密码解锁（直接回车）"
              className="bg-transparent outline-none text-sm text-desktop-text w-52 placeholder:text-desktop-muted/40"
              autoFocus
            />
          </div>
          <button
            className="w-10 h-10 rounded-xl bg-desktop-highlight/20 hover:bg-desktop-highlight/40 flex items-center justify-center transition-colors"
            onClick={handleUnlock}
          >
            <ArrowRight size={18} className="text-desktop-highlight" />
          </button>
        </div>

        <div className="text-[11px] text-desktop-muted/40 mt-4">
          X-Computer AI 自主电脑系统 v0.1.0
        </div>
      </div>
    </div>
  );
}
