import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Bot, Plus, Clock, X } from 'lucide-react';
import { api } from '@/utils/api';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  startTime: number;
  endTime: number | null;
  allDay: boolean;
  color: string;
}

const EVENT_COLORS = [
  { value: '#6366f1', label: '靛蓝' },
  { value: '#3b82f6', label: '蓝色' },
  { value: '#10b981', label: '绿色' },
  { value: '#f59e0b', label: '黄色' },
  { value: '#ef4444', label: '红色' },
  { value: '#a855f7', label: '紫色' },
  { value: '#ec4899', label: '粉色' },
  { value: '#14b8a6', label: '青色' },
];

interface EventFormData {
  title: string;
  description: string;
  date: string;
  time: string;
  endTime: string;
  allDay: boolean;
  color: string;
}

function eventToFormData(ev?: CalendarEvent): EventFormData {
  if (!ev) {
    const now = new Date();
    return {
      title: '',
      description: '',
      date: now.toISOString().slice(0, 10),
      time: '09:00',
      endTime: '10:00',
      allDay: false,
      color: EVENT_COLORS[0].value,
    };
  }
  const start = new Date(ev.startTime);
  const end = ev.endTime ? new Date(ev.endTime) : new Date(ev.startTime + 3600000);
  return {
    title: ev.title,
    description: ev.description ?? '',
    date: start.toISOString().slice(0, 10),
    time: start.toTimeString().slice(0, 5),
    endTime: end.toTimeString().slice(0, 5),
    allDay: !!ev.allDay,
    color: ev.color || EVENT_COLORS[0].value,
  };
}

function formDataToEvent(form: EventFormData): {
  title: string; description?: string; startTime: number; endTime?: number | null; allDay?: boolean; color?: string;
} {
  const d = new Date(form.date + 'T00:00:00');
  const startTime = form.allDay
    ? d.getTime()
    : new Date(`${form.date}T${form.time}:00`).getTime();
  const endTime = form.allDay
    ? d.getTime() + 86400000 - 1
    : form.endTime ? new Date(`${form.date}T${form.endTime}:00`).getTime() : undefined;
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    startTime,
    endTime,
    allDay: form.allDay,
    color: form.color,
  };
}

function colorClass(color: string): string {
  // Extract RGB from hex
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.2)`;
}

function colorText(color: string): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},1)`;
}

interface Props {
  windowId: string;
}

export function CalendarApp({ windowId }: Props) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create/edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<EventFormData>(eventToFormData());
  const [saving, setSaving] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.calendarListEvents({ year: viewYear, month: viewMonth });
      setEvents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [viewYear, viewMonth]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const openCreate = (day?: number) => {
    setEditingEvent(null);
    const date = day
      ? new Date(viewYear, viewMonth, day).toISOString().slice(0, 10)
      : new Date(viewYear, viewMonth, 1).toISOString().slice(0, 10);
    const base: EventFormData = { ...eventToFormData(), date, time: '09:00', endTime: '10:00' };
    setForm(base);
    setDialogOpen(true);
  };

  const openEdit = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setForm(eventToFormData(ev));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const data = formDataToEvent(form);
      if (editingEvent) {
        const updated = await api.calendarUpdateEvent(editingEvent.id, data);
        setEvents(prev => prev.map(e => e.id === editingEvent.id ? { ...e, ...updated } : e));
      } else {
        const created = await api.calendarCreateEvent(data);
        setEvents(prev => [...prev, created]);
      }
      setDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingEvent) return;
    setSaving(true);
    try {
      await api.calendarDeleteEvent(editingEvent.id);
      setEvents(prev => prev.filter(e => e.id !== editingEvent.id));
      setDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const year = viewYear;
  const month = viewMonth;
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  while (weeks[weeks.length - 1].length < 7) {
    weeks[weeks.length - 1].push(null);
  }

  const getEventsForDay = (day: number) =>
    events.filter(ev => {
      const d = new Date(ev.startTime);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });

  const todayEvents = getEventsForDay(todayDate);

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02] shrink-0">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-white/10 transition-colors">
          <ChevronLeft size={16} className="text-desktop-muted" />
        </button>
        <h2 className="text-sm font-medium text-desktop-text flex-1 text-center">
          {year}年 {month + 1}月
        </h2>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-white/10 transition-colors">
          <ChevronRight size={16} className="text-desktop-muted" />
        </button>
        <button
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-desktop-highlight/20 text-desktop-highlight text-xs hover:bg-desktop-highlight/30 transition-colors font-medium"
          onClick={() => openCreate()}
        >
          <Plus size={12} />
          新建
        </button>
        {loading && (
          <div className="w-4 h-4 border-2 border-desktop-accent border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-1.5 bg-red-500/10 text-red-400 text-xs shrink-0 border-b border-red-500/20">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>忽略</button>
        </div>
      )}

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
            <div key={d} className="text-center text-[11px] text-desktop-muted py-1">
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              const dayEvents = day ? getEventsForDay(day) : [];
              const isToday = isCurrentMonth && day === todayDate;
              return (
                <div
                  key={di}
                  className={`min-h-[72px] rounded-lg p-1.5 transition-colors ${
                    day ? 'hover:bg-white/5 cursor-pointer' : ''
                  } ${isToday ? 'bg-desktop-highlight/10 ring-1 ring-desktop-highlight/30' : ''}`}
                  onClick={() => day && openCreate(day)}
                >
                  {day && (
                    <>
                      <div className={`text-xs mb-1 ${isToday ? 'text-desktop-highlight font-semibold' : 'text-desktop-text/70'}`}>
                        {day}
                      </div>
                      {dayEvents.slice(0, 3).map((ev, i) => (
                        <div
                          key={ev.id}
                          className="text-[10px] rounded px-1.5 py-0.5 mb-0.5 truncate cursor-pointer hover:opacity-80 transition-opacity"
                          style={{ backgroundColor: colorClass(ev.color), color: colorText(ev.color) }}
                          onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                          title={ev.title}
                        >
                          {ev.allDay ? '' : new Date(ev.startTime).toTimeString().slice(0, 5) + ' '}{ev.title}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] text-desktop-muted/60 px-1.5">+{dayEvents.length - 3} 更多</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Today's schedule */}
      <div className="border-t border-white/5 px-4 py-2 bg-white/[0.01] shrink-0">
        <div className="text-[11px] text-desktop-muted flex items-center gap-1 mb-1.5">
          <Clock size={11} />
          今日日程 {isCurrentMonth && `· ${todayDate}日`}
        </div>
        {todayEvents.length === 0 ? (
          <div className="text-[11px] text-desktop-muted/50">今日暂无日程</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {todayEvents.map((ev) => (
              <div
                key={ev.id}
                className="text-[11px] rounded-md px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: colorClass(ev.color), color: colorText(ev.color) }}
                onClick={() => openEdit(ev)}
              >
                {ev.allDay ? '全天' : new Date(ev.startTime).toTimeString().slice(0, 5)} {ev.title}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-desktop-surface border border-white/10 rounded-xl shadow-2xl w-[420px] max-h-[90vh] flex flex-col">
            {/* Dialog Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
              <h3 className="text-sm font-semibold text-desktop-text">
                {editingEvent ? '编辑日程' : '新建日程'}
              </h3>
              <button onClick={() => setDialogOpen(false)} className="p-1 rounded hover:bg-white/10 transition-colors">
                <X size={16} className="text-desktop-muted" />
              </button>
            </div>

            {/* Dialog Body */}
            <div className="flex-1 overflow-auto px-5 py-4 space-y-3">
              {/* Title */}
              <div>
                <label className="block text-[11px] text-desktop-muted mb-1">标题 *</label>
                <input
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-desktop-text outline-none focus:border-desktop-accent/50 transition-colors"
                  placeholder="输入日程标题"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  autoFocus
                />
              </div>

              {/* Date + Time row */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-desktop-muted mb-1">日期</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-desktop-text outline-none focus:border-desktop-accent/50 transition-colors"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  />
                </div>
                {!form.allDay && (
                  <div>
                    <label className="block text-[11px] text-desktop-muted mb-1">开始时间</label>
                    <input
                      type="time"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-desktop-text outline-none focus:border-desktop-accent/50 transition-colors"
                      value={form.time}
                      onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                    />
                  </div>
                )}
              </div>

              {!form.allDay && (
                <div>
                  <label className="block text-[11px] text-desktop-muted mb-1">结束时间</label>
                  <input
                    type="time"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-desktop-text outline-none focus:border-desktop-accent/50 transition-colors"
                    value={form.endTime}
                    onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                  />
                </div>
              )}

              {/* All day */}
              <label className="flex items-center gap-2 text-xs text-desktop-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))}
                  className="accent-desktop-accent"
                />
                全天事件
              </label>

              {/* Color */}
              <div>
                <label className="block text-[11px] text-desktop-muted mb-1.5">颜色</label>
                <div className="flex gap-1.5 flex-wrap">
                  {EVENT_COLORS.map(c => (
                    <button
                      key={c.value}
                      className={`w-7 h-7 rounded-full transition-transform ${form.color === c.value ? 'ring-2 ring-white/50 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c.value }}
                      onClick={() => setForm(f => ({ ...f, color: c.value }))}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[11px] text-desktop-muted mb-1">描述</label>
                <textarea
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-desktop-text outline-none focus:border-desktop-accent/50 transition-colors resize-none leading-5"
                  placeholder="添加备注..."
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>

            {/* Dialog Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-white/5 shrink-0">
              <div>
                {editingEvent && (
                  <button
                    className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    onClick={handleDelete}
                    disabled={saving}
                  >
                    删除
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1.5 text-xs text-desktop-muted hover:bg-white/10 rounded-lg transition-colors"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  className="px-4 py-1.5 text-xs bg-desktop-highlight/20 hover:bg-desktop-highlight/30 text-desktop-highlight rounded-lg transition-colors font-medium disabled:opacity-50"
                  onClick={handleSave}
                  disabled={saving || !form.title.trim()}
                >
                  {saving ? '保存中…' : editingEvent ? '保存' : '创建'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
