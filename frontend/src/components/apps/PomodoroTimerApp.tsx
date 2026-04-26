import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Coffee, Timer, CheckCircle2, TrendingUp } from 'lucide-react';

interface PomodoroSession {
  type: 'work' | 'short_break' | 'long_break';
  durationMinutes: number;
  completedAt: number;
}

interface TimerSettings {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
}

const DEFAULT_SETTINGS: TimerSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartWork: false,
};

const STORAGE_KEY = 'x-computer-pomodoro-settings';
const HISTORY_KEY = 'x-computer-pomodoro-history';

function loadSettings(): TimerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadHistory(): PomodoroSession[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PomodoroSession[];
    // Keep only last 100 sessions
    return arr.slice(-100);
  } catch {
    return [];
  }
}

function saveHistory(history: PomodoroSession[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100)));
  } catch { /* ignore */ }
}

type Phase = 'work' | 'short_break' | 'long_break';

const PHASE_LABELS: Record<Phase, string> = {
  work: '专注工作',
  short_break: '短休息',
  long_break: '长休息',
};

const PHASE_COLORS: Record<Phase, string> = {
  work: '#ef4444',
  short_break: '#10b981',
  long_break: '#3b82f6',
};

const PHASE_BG: Record<Phase, string> = {
  work: 'rgba(239,68,68,0.1)',
  short_break: 'rgba(16,185,129,0.1)',
  long_break: 'rgba(59,130,246,0.1)',
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

interface Props {
  windowId: string;
}

export function PomodoroTimerApp({ windowId }: Props) {
  const [settings, setSettings] = useState<TimerSettings>(loadSettings);
  const [phase, setPhase] = useState<Phase>('work');
  const [timeLeft, setTimeLeft] = useState(settings.workMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);
  const [history, setHistory] = useState<PomodoroSession[]>(loadHistory);
  const [editingSetting, setEditingSetting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSeconds = phase === 'work'
    ? settings.workMinutes * 60
    : phase === 'short_break'
    ? settings.shortBreakMinutes * 60
    : settings.longBreakMinutes * 60;

  const progress = totalSeconds > 0 ? ((totalSeconds - timeLeft) / totalSeconds) * 100 : 0;

  const clearTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handlePhaseComplete = useCallback(() => {
    clearTimer();
    setIsRunning(false);

    const session: PomodoroSession = {
      type: phase,
      durationMinutes: phase === 'work'
        ? settings.workMinutes
        : phase === 'short_break'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes,
      completedAt: Date.now(),
    };
    const newHistory = [...history, session];
    setHistory(newHistory);
    saveHistory(newHistory);

    let nextPhase: Phase;
    if (phase === 'work') {
      const newCount = completedPomodoros + 1;
      setCompletedPomodoros(newCount);
      if (newCount % settings.longBreakInterval === 0) {
        nextPhase = 'long_break';
      } else {
        nextPhase = 'short_break';
      }
    } else {
      nextPhase = 'work';
    }

    setPhase(nextPhase);
    const nextSeconds = nextPhase === 'work'
      ? settings.workMinutes * 60
      : nextPhase === 'short_break'
      ? settings.shortBreakMinutes * 60
      : settings.longBreakMinutes * 60;
    setTimeLeft(nextSeconds);

    // Auto-start
    const shouldAutoStart =
      (nextPhase !== 'work' && settings.autoStartBreaks) ||
      (nextPhase === 'work' && settings.autoStartWork);
    if (shouldAutoStart) {
      setTimeout(() => setIsRunning(true), 100);
    }
  }, [phase, completedPomodoros, history, settings]);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) {
            handlePhaseComplete();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [isRunning, handlePhaseComplete]);

  const resetPhase = () => {
    clearTimer();
    setIsRunning(false);
    setTimeLeft(totalSeconds);
  };

  const skipToNext = () => {
    handlePhaseComplete();
  };

  const toggleRunning = () => {
    setIsRunning(r => !r);
  };

  const handleSettingChange = (key: keyof TimerSettings, value: number | boolean) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
    // If not running, update timeLeft for current phase
    if (!isRunning) {
      if (key === 'workMinutes' && phase === 'work') setTimeLeft((value as number) * 60);
      if (key === 'shortBreakMinutes' && phase === 'short_break') setTimeLeft((value as number) * 60);
      if (key === 'longBreakMinutes' && phase === 'long_break') setTimeLeft((value as number) * 60);
    }
  };

  const accentColor = PHASE_COLORS[phase];
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const todaySessions = history.filter(s => {
    const d = new Date(s.completedAt);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });
  const todayPomodoros = todaySessions.filter(s => s.type === 'work').length;
  const todayMinutes = todaySessions.reduce((sum, s) => sum + s.durationMinutes, 0);

  return (
    <div className="h-full flex flex-col text-sm bg-desktop-surface overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02] shrink-0">
        <Timer size={15} className="text-red-400" />
        <span className="text-xs font-medium text-desktop-text">番茄钟</span>
        <div className="flex-1" />
        <span className="text-[10px] text-desktop-muted/60">{completedPomodoros} 🍅 完成</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 min-h-0">
        {/* Phase tabs */}
        <div className="flex gap-1 bg-white/5 rounded-xl p-1">
          {(['work', 'short_break', 'long_break'] as Phase[]).map(p => (
            <button
              key={p}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                phase === p ? 'font-semibold' : 'text-desktop-muted hover:text-desktop-text'
              }`}
              style={phase === p ? { backgroundColor: PHASE_BG[p], color: PHASE_COLORS[p] } : {}}
              onClick={() => {
                if (!isRunning) {
                  setPhase(p);
                  setTimeLeft(p === 'work' ? settings.workMinutes * 60
                    : p === 'short_break' ? settings.shortBreakMinutes * 60
                    : settings.longBreakMinutes * 60);
                }
              }}
            >
              {PHASE_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Timer circle */}
        <div className="relative flex items-center justify-center">
          <svg width={220} height={220} className="-rotate-90">
            {/* Background circle */}
            <circle
              cx={110} cy={110} r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={8}
            />
            {/* Progress circle */}
            <circle
              cx={110} cy={110} r={radius}
              fill="none"
              stroke={accentColor}
              strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000"
            />
          </svg>

          {/* Timer text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-mono font-bold text-desktop-text tracking-wider">
              {formatTime(timeLeft)}
            </span>
            <span className="text-xs text-desktop-muted mt-1">
              {PHASE_LABELS[phase]}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            className="w-12 h-12 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
            onClick={resetPhase}
            title="重置"
          >
            <RotateCcw size={18} className="text-desktop-muted" />
          </button>

          <button
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg"
            style={{ backgroundColor: accentColor + '33', border: `2px solid ${accentColor}` }}
            onClick={toggleRunning}
            title={isRunning ? '暂停' : '开始'}
          >
            {isRunning
              ? <Pause size={24} style={{ color: accentColor }} />
              : <Play size={24} fill={accentColor} style={{ color: accentColor }} />
            }
          </button>

          <button
            className="w-12 h-12 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
            onClick={skipToNext}
            title="跳过到下一个"
          >
            <CheckCircle2 size={18} className="text-desktop-muted" />
          </button>
        </div>

        {/* Today's stats */}
        <div className="flex gap-4 w-full max-w-xs">
          <div className="flex-1 bg-white/[0.02] rounded-xl p-3 text-center border border-white/5">
            <div className="text-xl font-bold text-red-400">{todayPomodoros}</div>
            <div className="text-[10px] text-desktop-muted mt-0.5">今日番茄</div>
          </div>
          <div className="flex-1 bg-white/[0.02] rounded-xl p-3 text-center border border-white/5">
            <div className="text-xl font-bold text-blue-400">{todayMinutes}</div>
            <div className="text-[10px] text-desktop-muted mt-0.5">专注分钟</div>
          </div>
          <div className="flex-1 bg-white/[0.02] rounded-xl p-3 text-center border border-white/5">
            <div className="text-xl font-bold text-green-400">{Math.round(todayMinutes / 60 * 10) / 10}</div>
            <div className="text-[10px] text-desktop-muted mt-0.5">专注小时</div>
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="border-t border-white/5 px-4 py-3 bg-white/[0.01] shrink-0">
        <button
          className="text-[11px] text-desktop-muted hover:text-desktop-text transition-colors"
          onClick={() => setEditingSetting(s => !s)}
        >
          {editingSetting ? '收起设置' : '⚙️ 自定义番茄钟时长'}
        </button>

        {editingSetting && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[
              { key: 'workMinutes' as const, label: '工作 (分钟)', min: 1, max: 60 },
              { key: 'shortBreakMinutes' as const, label: '短休息 (分钟)', min: 1, max: 30 },
              { key: 'longBreakMinutes' as const, label: '长休息 (分钟)', min: 1, max: 60 },
              { key: 'longBreakInterval' as const, label: '长休息间隔 (个)', min: 2, max: 10 },
            ].map(({ key, label, min, max }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-desktop-muted w-24 shrink-0">{label}</span>
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={settings[key]}
                  onChange={e => handleSettingChange(key, parseInt(e.target.value) || min)}
                  className="flex-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-desktop-text outline-none focus:border-desktop-accent/50 w-16"
                />
              </div>
            ))}
            {[
              { key: 'autoStartBreaks' as const, label: '休息自动开始' },
              { key: 'autoStartWork' as const, label: '工作自动开始' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-xs text-desktop-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings[key]}
                  onChange={e => handleSettingChange(key, e.target.checked)}
                  className="accent-desktop-accent"
                />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
