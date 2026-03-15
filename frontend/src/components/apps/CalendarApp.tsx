import { useState } from 'react';
import { ChevronLeft, ChevronRight, Bot, Plus, Clock } from 'lucide-react';

const EVENTS = [
  { date: 10, title: '产品策略会', time: '10:00', color: 'bg-blue-500/30 text-blue-300' },
  { date: 10, title: '代码评审', time: '14:00', color: 'bg-green-500/30 text-green-300' },
  { date: 12, title: '周报提交', time: '17:00', color: 'bg-yellow-500/30 text-yellow-300' },
  { date: 14, title: '1:1 会议', time: '11:00', color: 'bg-purple-500/30 text-purple-300' },
  { date: 15, title: '版本发布', time: '09:00', color: 'bg-red-500/30 text-red-300' },
];

interface Props {
  windowId: string;
}

export function CalendarApp({ windowId }: Props) {
  const [currentDate] = useState(new Date(2026, 1, 10)); // Feb 2026
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = currentDate.getDate();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  // Pad last week
  while (weeks[weeks.length - 1].length < 7) {
    weeks[weeks.length - 1].push(null);
  }

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
        <button className="p-1 rounded hover:bg-white/10 transition-colors">
          <ChevronLeft size={16} className="text-desktop-muted" />
        </button>
        <h2 className="text-sm font-medium text-desktop-text flex-1 text-center">
          {year}年 {month + 1}月
        </h2>
        <button className="p-1 rounded hover:bg-white/10 transition-colors">
          <ChevronRight size={16} className="text-desktop-muted" />
        </button>
        <button className="flex items-center gap-1 px-2 py-1 rounded bg-desktop-highlight/20 text-desktop-highlight text-xs hover:bg-desktop-highlight/30 transition-colors">
          <Plus size={12} />
          新建
        </button>
        <button className="p-1.5 rounded hover:bg-blue-500/20 transition-colors" title="AI 安排日程">
          <Bot size={14} className="text-blue-400" />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto p-3">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
            <div key={d} className="text-center text-[11px] text-desktop-muted py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              const dayEvents = day ? EVENTS.filter((e) => e.date === day) : [];
              const isToday = day === today;
              return (
                <div
                  key={di}
                  className={`min-h-[72px] rounded-lg p-1.5 transition-colors ${
                    day ? 'hover:bg-white/5 cursor-pointer' : ''
                  } ${isToday ? 'bg-desktop-highlight/10 ring-1 ring-desktop-highlight/30' : ''}`}
                >
                  {day && (
                    <>
                      <div className={`text-xs mb-1 ${isToday ? 'text-desktop-highlight font-semibold' : 'text-desktop-text/70'}`}>
                        {day}
                      </div>
                      {dayEvents.map((ev, i) => (
                        <div key={i} className={`text-[10px] rounded px-1.5 py-0.5 mb-0.5 truncate ${ev.color}`}>
                          {ev.time} {ev.title}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Today's schedule */}
      <div className="border-t border-white/5 px-4 py-2 bg-white/[0.01]">
        <div className="text-[11px] text-desktop-muted flex items-center gap-1 mb-1.5">
          <Clock size={11} />
          今日日程
        </div>
        <div className="flex gap-2">
          {EVENTS.filter((e) => e.date === today).map((ev, i) => (
            <div key={i} className={`text-[11px] rounded-md px-2 py-1 ${ev.color}`}>
              {ev.time} {ev.title}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
