import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, X, Check, Flame, TrendingUp, Target, CheckCircle2 } from 'lucide-react';

interface Habit {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  category: string;
  completions: Record<string, boolean>; // date string "YYYY-MM-DD" -> true
}

interface Props {
  windowId: string;
}

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const CATEGORIES = ['健康', '学习', '运动', '工作', '生活', '其他'];

const DEFAULT_HABITS: Omit<Habit, 'id' | 'createdAt' | 'completions'>[] = [
  { name: '喝水 8 杯', color: '#3b82f6', category: '健康' },
  { name: '冥想 10 分钟', color: '#8b5cf6', category: '健康' },
  { name: '阅读 30 分钟', color: '#22c55e', category: '学习' },
  { name: '运动 30 分钟', color: '#f59e0b', category: '运动' },
];

function dateStr(d: Date = new Date()) {
  return d.toISOString().split('T')[0];
}

function getStreak(habit: Habit): number {
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const key = dateStr(d);
    if (habit.completions[key]) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else if (i > 0) {
      break;
    } else {
      d.setDate(d.getDate() - 1);
    }
  }
  return streak;
}

function getLongestStreak(habit: Habit): number {
  const dates = Object.keys(habit.completions)
    .filter(k => habit.completions[k])
    .sort();
  if (dates.length === 0) return 0;
  let longest = 1, current = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) { current++; longest = Math.max(longest, current); }
    else current = 1;
  }
  return longest;
}

function getWeekDays(habit: Habit): boolean[] {
  const days: boolean[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    days.push(!!habit.completions[dateStr(d)]);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getTotalCompletions(habit: Habit): number {
  return Object.values(habit.completions).filter(Boolean).length;
}

export function HabitTrackerApp({ windowId }: Props) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState(COLORS[0]);
  const [formCategory, setFormCategory] = useState(CATEGORIES[0]);

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem('habit-tracker');
      if (raw) {
        setHabits(JSON.parse(raw));
      } else {
        const initial: Habit[] = DEFAULT_HABITS.map((h, i) => ({
          ...h,
          id: `habit-${Date.now()}-${i}`,
          createdAt: Date.now(),
          completions: {},
        }));
        setHabits(initial);
        localStorage.setItem('habit-tracker', JSON.stringify(initial));
      }
    } catch { setHabits([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback((newHabits: Habit[]) => {
    setHabits(newHabits);
    localStorage.setItem('habit-tracker', JSON.stringify(newHabits));
  }, []);

  const today = dateStr();
  const todayCount = habits.filter(h => h.completions[today]).length;

  const toggleHabit = (id: string) => {
    save(habits.map(h => {
      if (h.id !== id) return h;
      return {
        ...h,
        completions: { ...h.completions, [today]: !h.completions[today] },
      };
    }));
  };

  const openCreate = () => {
    setFormName(''); setFormColor(COLORS[0]); setFormCategory(CATEGORIES[0]);
    setEditingId(null); setShowForm(true);
  };

  const openEdit = (h: Habit) => {
    setFormName(h.name); setFormColor(h.color); setFormCategory(h.category);
    setEditingId(h.id); setShowForm(true);
  };

  const handleSave = () => {
    if (!formName.trim()) return;
    if (editingId) {
      save(habits.map(h => h.id === editingId ? { ...h, name: formName.trim(), color: formColor, category: formCategory } : h));
    } else {
      save([...habits, { id: `habit-${Date.now()}`, name: formName.trim(), color: formColor, category: formCategory, createdAt: Date.now(), completions: {} }]);
    }
    setShowForm(false);
  };

  const deleteHabit = (id: string) => {
    if (!confirm('删除此习惯？')) return;
    save(habits.filter(h => h.id !== id));
  };

  const overallStreak = (() => {
    if (habits.length === 0) return 0;
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const key = dateStr(d);
      const done = habits.filter(h => h.completions[key]).length;
      if (done === habits.length) { streak++; d.setDate(d.getDate() - 1); }
      else if (i > 0) break;
      else d.setDate(d.getDate() - 1);
    }
    return streak;
  })();

  const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text)' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>今日进度</div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
            {todayCount}/{habits.length} 个习惯完成
          </div>
          <div style={{ height: '4px', background: 'var(--color-border)', borderRadius: '2px', marginTop: '6px', width: '100%', maxWidth: '200px' }}>
            <div style={{ height: '100%', width: `${habits.length ? (todayCount / habits.length * 100) : 0}%`, background: 'var(--color-accent)', borderRadius: '2px', transition: 'width 0.3s' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ textAlign: 'center', padding: '6px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
            <Flame size={14} style={{ color: overallStreak > 0 ? '#f97316' : 'var(--color-text-secondary)', margin: '0 auto' }} />
            <div style={{ fontSize: '11px', fontWeight: 600, marginTop: '2px' }}>{overallStreak}</div>
            <div style={{ fontSize: '9px', color: 'var(--color-text-secondary)' }}>连续</div>
          </div>
          <button onClick={openCreate} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
            <Plus size={13} /> 添加习惯
          </button>
        </div>
      </div>

      {/* Habit list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {habits.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '40px' }}>
            <Target size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <div>暂无习惯</div>
            <button onClick={openCreate} style={{ marginTop: '12px', padding: '6px 14px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              添加第一个习惯
            </button>
          </div>
        )}
        {habits.map(habit => {
          const streak = getStreak(habit);
          const longest = getLongestStreak(habit);
          const total = getTotalCompletions(habit);
          const done = !!habit.completions[today];
          const week = getWeekDays(habit);

          return (
            <div key={habit.id} style={{ padding: '12px', borderRadius: '10px', marginBottom: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <button
                onClick={() => toggleHabit(habit.id)}
                style={{ width: '26px', height: '26px', borderRadius: '50%', border: `2px solid ${done ? habit.color : 'var(--color-border)'}`, background: done ? habit.color : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px', transition: 'all 0.2s' }}
              >
                {done && <Check size={13} color="#fff" />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 500, fontSize: '13px', color: done ? habit.color : 'var(--color-text)', textDecoration: done ? 'none' : 'none', opacity: done ? 1 : 0.8 }}>{habit.name}</span>
                  <span style={{ fontSize: '10px', padding: '1px 6px', background: habit.color + '20', color: habit.color, borderRadius: '10px' }}>{habit.category}</span>
                </div>
                {/* Week view */}
                <div style={{ display: 'flex', gap: '3px', marginTop: '6px' }}>
                  {week.map((done, i) => (
                    <div key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: done ? habit.color : 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {done && <CheckCircle2 size={10} color="#fff" />}
                    </div>
                  ))}
                  <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginLeft: '4px', alignSelf: 'center' }}>近7天</span>
                </div>
                {/* Stats */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><Flame size={10} style={{ color: streak > 0 ? '#f97316' : undefined }} /> 连续 {streak} 天</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><TrendingUp size={10} /> 最佳 {longest} 天</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><CheckCircle2 size={10} /> 共 {total} 次</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                <button onClick={() => openEdit(habit)} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', borderRadius: '4px', display: 'flex' }}>
                  <Edit2 size={12} />
                </button>
                <button onClick={() => deleteHabit(habit.id)} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', borderRadius: '4px', display: 'flex' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: '12px', padding: '24px', width: '380px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{editingId ? '编辑习惯' : '添加习惯'}</h3>
              <button onClick={() => setShowForm(false)} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>习惯名称 *</label>
                <input value={formName} onChange={e => setFormName(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', outline: 'none' }}
                  placeholder="例如：每天阅读 30 分钟" autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>颜色</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setFormColor(c)}
                      style={{ width: '28px', height: '28px', borderRadius: '50%', background: c, border: formColor === c ? '3px solid var(--color-text)' : '3px solid transparent', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>分类</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {CATEGORIES.map(c => (
                    <button key={c} onClick={() => setFormCategory(c)}
                      style={{ padding: '4px 10px', borderRadius: '16px', background: formCategory === c ? formColor : 'var(--color-bg)', color: formCategory === c ? '#fff' : 'var(--color-text)', border: `1px solid ${formCategory === c ? formColor : 'var(--color-border)'}`, cursor: 'pointer', fontSize: '12px' }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--color-text)' }}>
                取消
              </button>
              <button onClick={handleSave} disabled={!formName.trim()}
                style={{ padding: '7px 16px', background: formName.trim() ? formColor : 'var(--color-border)', color: '#fff', border: 'none', borderRadius: '6px', cursor: formName.trim() ? 'pointer' : 'not-allowed', fontSize: '13px' }}>
                {editingId ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
