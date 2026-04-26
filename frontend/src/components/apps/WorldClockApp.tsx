import { useState, useEffect } from 'react';
import { Plus, X, Globe, Sunrise, Moon } from 'lucide-react';

const PRESET_CITIES = [
  { id: 'beijing', name: '北京', zone: 'Asia/Shanghai', flag: '🇨🇳' },
  { id: 'shanghai', name: '上海', zone: 'Asia/Shanghai', flag: '🇨🇳' },
  { id: 'tokyo', name: '东京', zone: 'Asia/Tokyo', flag: '🇯🇵' },
  { id: 'singapore', name: '新加坡', zone: 'Asia/Singapore', flag: '🇸🇬' },
  { id: 'mumbai', name: '孟买', zone: 'Asia/Kolkata', flag: '🇮🇳' },
  { id: 'dubai', name: '迪拜', zone: 'Asia/Dubai', flag: '🇦🇪' },
  { id: 'moscow', name: '莫斯科', zone: 'Europe/Moscow', flag: '🇷🇺' },
  { id: 'paris', name: '巴黎', zone: 'Europe/Paris', flag: '🇫🇷' },
  { id: 'london', name: '伦敦', zone: 'Europe/London', flag: '🇬🇧' },
  { id: 'newyork', name: '纽约', zone: 'America/New_York', flag: '🇺🇸' },
  { id: 'chicago', name: '芝加哥', zone: 'America/Chicago', flag: '🇺🇸' },
  { id: 'denver', name: '丹佛', zone: 'America/Denver', flag: '🇺🇸' },
  { id: 'losangeles', name: '洛杉矶', zone: 'America/Los_Angeles', flag: '🇺🇸' },
  { id: 'vancouver', name: '温哥华', zone: 'America/Vancouver', flag: '🇨🇦' },
  { id: 'sydney', name: '悉尼', zone: 'Australia/Sydney', flag: '🇦🇺' },
  { id: 'auckland', name: '奥克兰', zone: 'Pacific/Auckland', flag: '🇳🇿' },
  { id: 'honolulu', name: '檀香山', zone: 'Pacific/Honolulu', flag: '🇺🇸' },
];

const STORAGE_KEY = 'x-computer-world-clock';

function loadSelectedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ['beijing', 'newyork', 'london', 'tokyo'];
    return JSON.parse(raw) as string[];
  } catch {
    return ['beijing', 'newyork', 'london', 'tokyo'];
  }
}

function saveSelectedIds(ids: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
}

function getTimeInZone(zone: string, now: Date) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const second = parseInt(parts.find(p => p.type === 'second')?.value ?? '0', 10);
    return {
      time: `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}`,
      hour,
      minute,
      second,
      date: dateFormatter.format(now),
      isDay: hour >= 6 && hour < 18,
    };
  } catch {
    return { time: '--:--:--', hour: 0, minute: 0, second: 0, date: '', isDay: true };
  }
}

function getUtcOffset(zone: string): string {
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: zone }));
    const diffMs = tzDate.getTime() - utcDate.getTime();
    const diffH = Math.floor(Math.abs(diffMs) / 3600000);
    const diffM = Math.floor((Math.abs(diffMs) % 3600000) / 60000);
    const sign = diffMs >= 0 ? '+' : '-';
    return `UTC${sign}${diffH}${diffM > 0 ? `:${String(diffM).padStart(2,'0')}` : ''}`;
  } catch {
    return 'UTC+0';
  }
}

interface CityClock {
  cityId: string;
  city: (typeof PRESET_CITIES)[number];
  offset: string;
  time: string;
  hour: number;
  minute: number;
  second: number;
  date: string;
  isDay: boolean;
}

interface Props {
  windowId: string;
}

export function WorldClockApp({ windowId }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(loadSelectedIds);
  const [now, setNow] = useState(new Date());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const clocks: CityClock[] = selectedIds.map(id => {
    const city = PRESET_CITIES.find(c => c.id === id)!;
    const t = getTimeInZone(city.zone, now);
    return { cityId: id, city, offset: getUtcOffset(city.zone), ...t };
  });

  const removeClock = (id: string) => {
    const updated = selectedIds.filter(i => i !== id);
    setSelectedIds(updated);
    saveSelectedIds(updated);
  };

  const addClock = (id: string) => {
    if (selectedIds.includes(id)) return;
    const updated = [...selectedIds, id];
    setSelectedIds(updated);
    saveSelectedIds(updated);
    setPickerOpen(false);
  };

  const availableCities = PRESET_CITIES.filter(c => !selectedIds.includes(c.id));

  return (
    <div className="h-full flex flex-col text-sm bg-desktop-surface overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02] shrink-0">
        <Globe size={15} className="text-blue-400" />
        <span className="text-xs font-medium text-desktop-text">世界时钟</span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-blue-500/20 text-blue-400 text-xs hover:bg-blue-500/30 transition-colors font-medium"
          onClick={() => setPickerOpen(true)}
        >
          <Plus size={12} />
          添加
        </button>
      </div>

      {/* Clocks grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {clocks.map(clock => (
            <div
              key={clock.cityId}
              className="bg-white/[0.02] rounded-xl border border-white/5 p-4 hover:border-white/10 transition-colors group relative"
            >
              {/* Remove button */}
              <button
                className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                onClick={() => removeClock(clock.cityId)}
                title="移除"
              >
                <X size={12} className="text-desktop-muted" />
              </button>

              {/* Flag + City */}
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-lg">{clock.city.flag}</span>
                <div>
                  <div className="text-xs font-semibold text-desktop-text">{clock.city.name}</div>
                  <div className="text-[10px] text-desktop-muted">{clock.offset}</div>
                </div>
                <div className="ml-auto">
                  {clock.isDay
                    ? <Sunrise size={14} className="text-yellow-400" />
                    : <Moon size={14} className="text-indigo-400" />
                  }
                </div>
              </div>

              {/* Time */}
              <div className="text-2xl font-mono font-bold text-desktop-text tracking-wider">
                {clock.time.slice(0, 5)}
                <span className="text-sm font-normal text-desktop-muted ml-1">{clock.time.slice(6)}</span>
              </div>

              {/* Date */}
              <div className="text-[10px] text-desktop-muted mt-1">{clock.date}</div>

              {/* Analog clock */}
              <div className="mt-3 flex justify-center">
                <AnalogClock hour={clock.hour} minute={clock.minute} second={clock.second} isDay={clock.isDay} />
              </div>
            </div>
          ))}
        </div>

        {clocks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-desktop-muted/50 text-xs gap-2">
            <Globe size={32} className="opacity-30" />
            <p>暂无城市</p>
            <button className="text-blue-400 underline" onClick={() => setPickerOpen(true)}>添加城市</button>
          </div>
        )}
      </div>

      {/* City picker modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-desktop-surface border border-white/10 rounded-xl shadow-2xl w-[380px] max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
              <h3 className="text-sm font-semibold text-desktop-text">选择城市</h3>
              <button onClick={() => setPickerOpen(false)} className="p-1 rounded hover:bg-white/10 transition-colors">
                <X size={16} className="text-desktop-muted" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <div className="grid grid-cols-2 gap-1">
                {availableCities.map(city => (
                  <button
                    key={city.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors text-left"
                    onClick={() => addClock(city.id)}
                  >
                    <span className="text-base">{city.flag}</span>
                    <div className="min-w-0">
                      <div className="text-xs text-desktop-text truncate">{city.name}</div>
                      <div className="text-[10px] text-desktop-muted">{getUtcOffset(city.zone)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalogClock({ hour, minute, second, isDay }: {
  hour: number; minute: number; second: number; isDay: boolean;
}) {
  const size = 60;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const strokeColor = isDay ? '#60a5fa' : '#818cf8';

  const hourAngle = ((hour % 12) + minute / 60) * 30 - 90;
  const minuteAngle = minute * 6 - 90;
  const secondAngle = second * 6 - 90;

  const hand = (angle: number, len: number) => {
    const rad = (angle * Math.PI) / 180;
    return `${cx + len * Math.cos(rad)},${cy + len * Math.sin(rad)}`;
  };

  return (
    <svg width={size} height={size} className="opacity-80">
      {/* Face */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />
      {/* Hour markers */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i * 30 - 90) * Math.PI / 180;
        const x1 = cx + (r - 4) * Math.cos(a);
        const y1 = cy + (r - 4) * Math.sin(a);
        const x2 = cx + (r - 1) * Math.cos(a);
        const y2 = cy + (r - 1) * Math.sin(a);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.3)" strokeWidth={i % 3 === 0 ? 2 : 1} />;
      })}
      {/* Hour hand */}
      <line
        x1={cx} y1={cy} x2={hand(hourAngle, r * 0.5)[0]} y2={hand(hourAngle, r * 0.5)[1]}
        stroke={strokeColor} strokeWidth={2} strokeLinecap="round"
      />
      {/* Minute hand */}
      <line
        x1={cx} y1={cy} x2={hand(minuteAngle, r * 0.7)[0]} y2={hand(minuteAngle, r * 0.7)[1]}
        stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round"
      />
      {/* Second hand */}
      <line
        x1={cx} y1={cy} x2={hand(secondAngle, r * 0.75)[0]} y2={hand(secondAngle, r * 0.75)[1]}
        stroke="#ef4444" strokeWidth={1} strokeLinecap="round" opacity={0.8}
      />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={2} fill={strokeColor} />
    </svg>
  );
}
