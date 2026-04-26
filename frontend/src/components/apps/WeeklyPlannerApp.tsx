import { useState, useEffect, useCallback } from 'react';
import { Plus, ChevronLeft, ChevronRight, Trash2, Archive, RotateCcw, Star, Check, X } from 'lucide-react';
import { api } from '@/utils/api';
import { useTranslation } from 'react-i18next';

interface WeeklyPlan {
  id: string;
  title: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  goals: string[];
  reflection: string | null;
  rating: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  entries?: WeeklyEntry[];
}

interface WeeklyEntry {
  id: string;
  planId: string;
  date: string;
  completed: boolean;
  notes: string | null;
}

interface Props { windowId: string; }

export default function WeeklyPlannerApp({ windowId }: Props) {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [activePlan, setActivePlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<number>(new Date().getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editingReview, setEditingReview] = useState(false);
  const [formData, setFormData] = useState({ title: '', weekStart: '', weekEnd: '', goals: '', tags: '' });
  const [reviewData, setReviewData] = useState({ reflection: '', rating: 0 });

  const loadPlans = useCallback(async () => {
    try {
      const data = await api.weeklyPlansList({ year: filterYear }) as WeeklyPlan[];
      setPlans(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filterYear]);

  useEffect(() => { void loadPlans(); }, [loadPlans]);

  const loadPlanDetail = useCallback(async (id: string) => {
    try {
      const data = await api.weeklyPlansGet(id) as WeeklyPlan;
      setActivePlan(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    }
  }, []);

  const resetForm = () => {
    setFormData({ title: '', weekStart: '', weekEnd: '', goals: '', tags: '' });
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.weekStart || !formData.weekEnd) return;
    try {
      await api.weeklyPlansCreate({
        title: formData.title.trim(),
        weekStart: formData.weekStart,
        weekEnd: formData.weekEnd,
        goals: formData.goals.split('\n').map(s => s.trim()).filter(Boolean),
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
      });
      void loadPlans();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此周计划？')) return;
    try {
      await api.weeklyPlansDelete(id);
      if (activePlan?.id === id) setActivePlan(null);
      void loadPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await api.weeklyPlansUpdate(id, { status: 'archived' });
      if (activePlan?.id === id) setActivePlan(null);
      void loadPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : '归档失败');
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await api.weeklyPlansUpdate(id, { status: 'active' });
      void loadPlans();
    } catch (e) {
      setError(e instanceof Error ? e.message : '激活失败');
    }
  };

  const handleSaveReview = async () => {
    if (!activePlan) return;
    try {
      await api.weeklyPlansUpdate(activePlan.id, {
        reflection: reviewData.reflection,
        rating: reviewData.rating || undefined,
      });
      void loadPlanDetail(activePlan.id);
      setEditingReview(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const handleToggleDay = async (date: string, completed: boolean) => {
    if (!activePlan) return;
    try {
      await api.weeklyPlansUpdateEntry(activePlan.id, { date, completed });
      void loadPlanDetail(activePlan.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const handleDayNote = async (date: string, notes: string) => {
    if (!activePlan) return;
    try {
      await api.weeklyPlansUpdateEntry(activePlan.id, { date, notes });
      void loadPlanDetail(activePlan.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const weekDays = activePlan ? getDaysInRange(activePlan.weekStart, activePlan.weekEnd) : [];

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 text-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <span className="text-lg">📅</span>
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Weekly Planner</h1>
        <div className="flex-1" />
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-colors">
          <Plus size={14} /> 新建周计划
        </button>
      </div>

      {/* Year filter */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <button onClick={() => setFilterYear(y => y - 1)}><ChevronLeft size={14} className="text-gray-400" /></button>
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-12 text-center">{filterYear}</span>
        <button onClick={() => setFilterYear(y => y + 1)}><ChevronRight size={14} className="text-gray-400" /></button>
        <div className="flex-1" />
        <div className="flex gap-1">
          {['active', 'archived'].map(s => (
            <button key={s}
              onClick={() => { setActivePlan(null); void loadPlans(); }}
              className={`px-2 py-0.5 rounded text-xs ${activePlan ? 'text-gray-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'}`}>
              {s === 'active' ? '进行中' : '已归档'}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 text-xs">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[420px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">新建周计划</h2>
              <button onClick={resetForm}><X size={16} className="text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">标题 *</label>
                <input value={formData.title} onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="如：第12周 · 专注产品开发" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">开始日期 *</label>
                  <input type="date" value={formData.weekStart} onChange={e => setFormData(f => ({ ...f, weekStart: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">结束日期 *</label>
                  <input type="date" value={formData.weekEnd} onChange={e => setFormData(f => ({ ...f, weekEnd: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">本周目标（每行一条）</label>
                <textarea value={formData.goals} onChange={e => setFormData(f => ({ ...f, goals: e.target.value }))}
                  rows={4} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="完成用户调研报告\n代码审查3个PR\n..." />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">标签（逗号分隔）</label>
                <input value={formData.tags} onChange={e => setFormData(f => ({ ...f, tags: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="工作, 重点" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">取消</button>
              <button onClick={handleCreate}
                disabled={!formData.title.trim() || !formData.weekStart || !formData.weekEnd}
                className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed">
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content: plan list or detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: plan list */}
        <div className={`w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto shrink-0 ${activePlan ? 'hidden md:block' : ''}`}>
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-xs">加载中...</div>
          ) : plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-xs gap-1">
              <span>📅</span><span>暂无周计划</span>
            </div>
          ) : (
            plans.map(plan => (
              <div key={plan.id}
                className={`px-3 py-2.5 border-b border-gray-50 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${activePlan?.id === plan.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                onClick={() => { setActivePlan(plan); void loadPlanDetail(plan.id); }}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 text-xs truncate">{plan.title}</div>
                    <div className="text-gray-400 text-xs mt-0.5">
                      {plan.weekStart.slice(5)} ~ {plan.weekEnd.slice(5)}
                    </div>
                    {plan.status === 'archived' && (
                      <span className="inline-block mt-1 px-1 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-400 text-xs rounded">已归档</span>
                    )}
                  </div>
                  <button onClick={e => { e.stopPropagation(); void handleDelete(plan.id); }}
                    className="p-0.5 text-gray-300 hover:text-red-400 shrink-0">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: plan detail */}
        {activePlan ? (
          <div className="flex-1 overflow-y-auto">
            {/* Detail header */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <button onClick={() => setActivePlan(null)} className="md:hidden text-gray-400">
                  <ChevronLeft size={16} />
                </button>
                <div className="flex-1">
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100">{activePlan.title}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {activePlan.weekStart} ~ {activePlan.weekEnd}
                  </p>
                </div>
                <div className="flex gap-1">
                  {activePlan.status === 'active' ? (
                    <button onClick={() => void handleArchive(activePlan.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                      <Archive size={12} /> 归档
                    </button>
                  ) : (
                    <button onClick={() => void handleReactivate(activePlan.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                      <RotateCcw size={12} /> 激活
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Goals */}
            {activePlan.goals.length > 0 && (
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">本周目标</h3>
                <ul className="space-y-1">
                  {activePlan.goals.map((g, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <span className="text-blue-400 mt-0.5">·</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Daily tracker */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">每日追踪</h3>
              <div className="space-y-2">
                {weekDays.map(day => {
                  const entry = activePlan.entries?.find(e => e.date === day.iso);
                  const isToday = day.iso === new Date().toISOString().slice(0, 10);
                  return (
                    <div key={day.iso} className={`flex items-start gap-3 p-2 rounded text-xs ${isToday ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                      <div className="shrink-0 w-16 text-right">
                        <div className={`font-medium ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}>{day.label}</div>
                        <div className="text-gray-400">{day.dateStr}</div>
                      </div>
                      <button
                        onClick={() => handleToggleDay(day.iso, !entry?.completed)}
                        className={`shrink-0 mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors ${entry?.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600 hover:border-green-400'}`}>
                        {entry?.completed && <Check size={12} />}
                      </button>
                      <div className="flex-1">
                        {entry?.notes ? (
                          <span className="text-gray-500 line-clamp-2">{entry.notes}</span>
                        ) : (
                          <span
                            className="text-gray-300 dark:text-gray-600 cursor-pointer hover:text-gray-500"
                            onClick={() => {
                              const note = prompt('添加备注：');
                              if (note !== null) void handleDayNote(day.iso, note);
                            }}>
                            添加备注...
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Weekly Review */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">周回顾</h3>
                {!editingReview && (
                  <button onClick={() => { setReviewData({ reflection: activePlan.reflection ?? '', rating: activePlan.rating ?? 0 }); setEditingReview(true); }}
                    className="text-xs text-blue-500 hover:text-blue-600">
                    {activePlan.reflection ? '编辑' : '写回顾'}
                  </button>
                )}
              </div>

              {editingReview ? (
                <div className="space-y-3">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => setReviewData(r => ({ ...r, rating: n }))}
                        className={`p-1 rounded transition-colors ${reviewData.rating >= n ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'}`}>
                        <Star size={18} fill={reviewData.rating >= n ? 'currentColor' : 'none'} />
                      </button>
                    ))}
                  </div>
                  <textarea value={reviewData.reflection}
                    onChange={e => setReviewData(r => ({ ...r, reflection: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="这周做得怎么样？有哪些收获？下周一要改进什么？" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingReview(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">取消</button>
                    <button onClick={handleSaveReview} className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">保存</button>
                  </div>
                </div>
              ) : (
                activePlan.reflection ? (
                  <div>
                    <div className="flex gap-0.5 mb-2">
                      {[1, 2, 3, 4, 5].map(n => (
                        <Star key={n} size={14}
                          className={n <= (activePlan.rating ?? 0) ? 'text-yellow-400' : 'text-gray-300'}
                          fill={n <= (activePlan.rating ?? 0) ? 'currentColor' : 'none'} />
                      ))}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{activePlan.reflection}</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">点击上方「写回顾」记录这周的收获与反思</p>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
            <span className="text-3xl">📅</span>
            <span>选择左侧周计划查看详情</span>
          </div>
        )}
      </div>
    </div>
  );
}

function getDaysInRange(start: string, end: string): Array<{ iso: string; label: string; dateStr: string }> {
  const days: Array<{ iso: string; label: string; dateStr: string }> = [];
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const cur = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (cur <= endDate) {
    const iso = cur.toISOString().slice(0, 10);
    days.push({ iso, label: labels[cur.getDay()], dateStr: `${cur.getMonth() + 1}/${cur.getDate()}` });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
