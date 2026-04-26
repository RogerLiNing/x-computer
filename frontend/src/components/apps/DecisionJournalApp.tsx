import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Trash2, Edit3, Check, X, ChevronDown, Tag, Clock, BookOpen, Archive, RotateCcw } from 'lucide-react';
import { api } from '@/utils/api';
import { useTranslation } from 'react-i18next';

interface Decision {
  id: string;
  title: string;
  context: string | null;
  decisionText: string;
  rationale: string | null;
  alternatives: string[];
  outcome: string | null;
  outcomePositive: boolean | null;
  tags: string[];
  status: 'open' | 'resolved' | 'reversed';
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  windowId: string;
}

type FilterStatus = 'all' | 'open' | 'resolved' | 'reversed';

export default function DecisionJournalApp({ windowId }: Props) {
  const { t } = useTranslation();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    decisionText: '',
    context: '',
    rationale: '',
    alternatives: '',
    tags: '',
    followUpAt: '',
  });

  const loadDecisions = useCallback(async () => {
    try {
      const data = await api.decisionsList({ search: search || undefined, status: filterStatus === 'all' ? undefined : filterStatus });
      setDecisions(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus]);

  useEffect(() => { void loadDecisions(); }, [loadDecisions]);

  const resetForm = () => {
    setFormData({ title: '', decisionText: '', context: '', rationale: '', alternatives: '', tags: '', followUpAt: '' });
    setShowForm(false);
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.decisionText.trim()) return;
    try {
      await api.decisionsCreate({
        title: formData.title.trim(),
        decisionText: formData.decisionText.trim(),
        context: formData.context.trim() || undefined,
        rationale: formData.rationale.trim() || undefined,
        alternatives: formData.alternatives.split('\n').map(s => s.trim()).filter(Boolean),
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
        followUpAt: formData.followUpAt || undefined,
      });
      void loadDecisions();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleUpdate = async (id: string, fields: Partial<Decision>) => {
    try {
      await api.decisionsUpdate(id, {
        title: fields.title,
        decisionText: fields.decisionText,
        context: fields.context,
        rationale: fields.rationale,
        alternatives: fields.alternatives,
        outcome: fields.outcome,
        outcomePositive: fields.outcomePositive,
        tags: fields.tags,
        status: fields.status,
        followUpAt: fields.followUpAt,
      });
      void loadDecisions();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.decisionsDelete(id);
      void loadDecisions();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleResolve = async (decision: Decision, positive: boolean, outcome: string) => {
    await handleUpdate(decision.id, {
      status: 'resolved',
      outcomePositive: positive,
      outcome: outcome || undefined,
    });
  };

  const handleReverse = async (decision: Decision) => {
    await handleUpdate(decision.id, { status: 'reversed' });
  };

  const openEdit = (d: Decision) => {
    setEditingId(d.id);
    setFormData({
      title: d.title,
      decisionText: d.decisionText,
      context: d.context ?? '',
      rationale: d.rationale ?? '',
      alternatives: d.alternatives.join('\n'),
      tags: d.tags.join(', '),
      followUpAt: d.followUpAt ? d.followUpAt.slice(0, 16) : '',
    });
    setShowForm(true);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !formData.title.trim() || !formData.decisionText.trim()) return;
    try {
      await api.decisionsUpdate(editingId, {
        title: formData.title.trim(),
        decisionText: formData.decisionText.trim(),
        context: formData.context.trim() || null,
        rationale: formData.rationale.trim() || null,
        alternatives: formData.alternatives.split('\n').map(s => s.trim()).filter(Boolean),
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
        followUpAt: formData.followUpAt || null,
      });
      void loadDecisions();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const statusColor = (status: string) => {
    if (status === 'resolved') return 'text-green-400';
    if (status === 'reversed') return 'text-red-400';
    return 'text-yellow-400';
  };

  const statusLabel = (status: string) => {
    if (status === 'resolved') return '已定论';
    if (status === 'reversed') return '已反转';
    return '进行中';
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-desktop-text select-none" style={{ fontFamily: 'monospace' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <BookOpen className="w-4 h-4 text-desktop-accent shrink-0" />
        <span className="text-sm font-medium flex-1">Decision Journal</span>
        <button
          onClick={() => { setShowForm(!showForm); setEditingId(null); setFormData({ title: '', decisionText: '', context: '', rationale: '', alternatives: '', tags: '', followUpAt: '' }); }}
          className="flex items-center gap-1 px-2 py-1 rounded bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs transition-colors"
        >
          <Plus className="w-3 h-3" />
          {showForm && !editingId ? '取消' : '新建'}
        </button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="border-b border-white/10 p-3 space-y-2 shrink-0 bg-white/5">
          <input
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none placeholder:text-white/20"
            placeholder="决策标题 *"
            value={formData.title}
            onChange={(e) => setFormData(f => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none resize-y h-16 placeholder:text-white/20"
            placeholder="决定内容 *（我们决定...）"
            value={formData.decisionText}
            onChange={(e) => setFormData(f => ({ ...f, decisionText: e.target.value }))}
          />
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none resize-y h-12 placeholder:text-white/20"
            placeholder="背景（为什么需要这个决策？）"
            value={formData.context}
            onChange={(e) => setFormData(f => ({ ...f, context: e.target.value }))}
          />
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none resize-y h-12 placeholder:text-white/20"
            placeholder="决策理由"
            value={formData.rationale}
            onChange={(e) => setFormData(f => ({ ...f, rationale: e.target.value }))}
          />
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none resize-y h-12 placeholder:text-white/20"
            placeholder="备选方案（每行一个）"
            value={formData.alternatives}
            onChange={(e) => setFormData(f => ({ ...f, alternatives: e.target.value }))}
          />
          <div className="flex gap-2">
            <input
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none placeholder:text-white/20"
              placeholder="标签（逗号分隔）"
              value={formData.tags}
              onChange={(e) => setFormData(f => ({ ...f, tags: e.target.value }))}
            />
            <input
              type="datetime-local"
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none"
              value={formData.followUpAt}
              onChange={(e) => setFormData(f => ({ ...f, followUpAt: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            {editingId ? (
              <>
                <button onClick={handleSaveEdit} className="px-3 py-1 rounded bg-green-600/30 hover:bg-green-600/50 text-xs text-green-300 flex items-center gap-1">
                  <Check className="w-3 h-3" /> 保存
                </button>
                <button onClick={resetForm} className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-desktop-muted flex items-center gap-1">
                  <X className="w-3 h-3" /> 取消
                </button>
              </>
            ) : (
              <button onClick={handleCreate} className="px-3 py-1 rounded bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs text-desktop-text flex items-center gap-1">
                <Plus className="w-3 h-3" /> 记录决策
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <Search className="w-3 h-3 text-desktop-muted shrink-0" />
        <input
          className="flex-1 bg-transparent text-xs text-desktop-text outline-none placeholder:text-white/20"
          placeholder="搜索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1">
          {(['all', 'open', 'resolved', 'reversed'] as FilterStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${filterStatus === s ? 'bg-desktop-accent/40 text-desktop-text' : 'text-desktop-muted hover:text-desktop-text'}`}
            >
              {s === 'all' ? '全部' : s === 'open' ? '进行中' : s === 'resolved' ? '已定论' : '已反转'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-desktop-muted">加载中…</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        ) : decisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <BookOpen className="w-8 h-8 text-white/10" />
            <p className="text-xs text-desktop-muted">暂无决策记录</p>
            <p className="text-[10px] text-white/20">点击上方"新建"记录你的第一个决策</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {decisions.map((d) => (
              <DecisionCard
                key={d.id}
                decision={d}
                onEdit={openEdit}
                onDelete={handleDelete}
                onResolve={handleResolve}
                onReverse={handleReverse}
                statusColor={statusColor}
                statusLabel={statusLabel}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionCard({
  decision: d,
  onEdit,
  onDelete,
  onResolve,
  onReverse,
  statusColor,
  statusLabel,
}: {
  decision: Decision;
  onEdit: (d: Decision) => void;
  onDelete: (id: string) => void;
  onResolve: (d: Decision, positive: boolean, outcome: string) => void;
  onReverse: (d: Decision) => void;
  statusColor: (s: string) => string;
  statusLabel: (s: string) => string;
}) {
  const { t } = useTranslation();
  const [showOutcome, setShowOutcome] = useState(false);
  const [outcomeText, setOutcomeText] = useState('');

  return (
    <div className="p-3 hover:bg-white/3 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-desktop-text truncate">{d.title}</span>
            <span className={`text-[10px] ${statusColor(d.status)}`}>● {statusLabel(d.status)}</span>
            {d.tags.map(tag => (
              <span key={tag} className="text-[9px] px-1 rounded bg-white/10 text-desktop-muted">{tag}</span>
            ))}
          </div>
          <p className="text-[11px] text-desktop-muted mt-0.5 leading-relaxed">{d.decisionText}</p>
          {d.context && (
            <p className="text-[10px] text-white/40 mt-0.5 italic">背景: {d.context}</p>
          )}
          {d.rationale && (
            <p className="text-[10px] text-desktop-accent mt-0.5">理由: {d.rationale}</p>
          )}
          {d.alternatives.length > 0 && (
            <p className="text-[10px] text-white/40 mt-0.5">备选: {d.alternatives.join(' / ')}</p>
          )}
          {d.outcome && (
            <p className={`text-[10px] mt-0.5 ${d.outcomePositive ? 'text-green-400' : 'text-red-400'}`}>
              结果: {d.outcome}
            </p>
          )}
          {d.followUpAt && d.status === 'open' && (
            <p className="text-[10px] text-yellow-400/60 mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              回顾: {new Date(d.followUpAt).toLocaleDateString()}
            </p>
          )}
          <p className="text-[9px] text-white/20 mt-1">
            {new Date(d.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {d.status === 'open' && (
            <>
              {showOutcome ? (
                <div className="flex flex-col gap-1">
                  <input
                    className="w-36 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-[10px] text-desktop-text outline-none"
                    placeholder="结果描述..."
                    value={outcomeText}
                    onChange={e => setOutcomeText(e.target.value)}
                    autoFocus
                  />
                  <button
                    onClick={() => { onResolve(d, true, outcomeText); setShowOutcome(false); setOutcomeText(''); }}
                    className="px-2 py-0.5 rounded bg-green-600/30 hover:bg-green-600/50 text-[10px] text-green-300 flex items-center gap-0.5"
                  >
                    <Check className="w-3 h-3" /> 成功
                  </button>
                  <button
                    onClick={() => { onResolve(d, false, outcomeText); setShowOutcome(false); setOutcomeText(''); }}
                    className="px-2 py-0.5 rounded bg-red-600/30 hover:bg-red-600/50 text-[10px] text-red-300 flex items-center gap-0.5"
                  >
                    <X className="w-3 h-3" /> 失败
                  </button>
                  <button onClick={() => setShowOutcome(false)} className="text-[10px] text-white/30">取消</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowOutcome(true)}
                  className="p-1 rounded hover:bg-green-600/20 text-green-400/60 hover:text-green-400 transition-colors"
                  title="记录结果"
                >
                  <Check className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={() => onReverse(d)}
                className="p-1 rounded hover:bg-red-600/20 text-red-400/60 hover:text-red-400 transition-colors"
                title="标记为反转"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            onClick={() => onEdit(d)}
            className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
            title="编辑"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          <button
            onClick={() => onDelete(d.id)}
            className="p-1 rounded hover:bg-red-600/20 text-red-400/30 hover:text-red-400 transition-colors"
            title="删除"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
