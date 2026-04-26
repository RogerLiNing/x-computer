import { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Trash2, Edit3, Check, X, Clock, AlertCircle, UserCheck, RotateCcw } from 'lucide-react';
import { api } from '@/utils/api';
import { useTranslation } from 'react-i18next';

interface Delegation {
  id: string;
  title: string;
  description: string | null;
  delegatedTo: string;
  dueAt: string | null;
  lastCheckedAt: string | null;
  status: 'waiting' | 'completed' | 'cancelled';
  followUpCount: number;
  notes: string | null;
  source: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Props {
  windowId: string;
}

type FilterStatus = 'all' | 'waiting' | 'completed' | 'cancelled';

export default function DelegationTrackerApp({ windowId }: Props) {
  const { t } = useTranslation();
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    delegatedTo: '',
    description: '',
    dueAt: '',
    source: '',
    tags: '',
  });

  const loadDelegations = useCallback(async () => {
    try {
      const data = (await api.delegationsList({
        search: search || undefined,
        status: filterStatus === 'all' ? undefined : filterStatus,
      })) as Delegation[];
      setDelegations(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus]);

  useEffect(() => { void loadDelegations(); }, [loadDelegations]);

  const resetForm = () => {
    setFormData({ title: '', delegatedTo: '', description: '', dueAt: '', source: '', tags: '' });
    setShowForm(false);
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.delegatedTo.trim()) return;
    try {
      await api.delegationsCreate({
        title: formData.title.trim(),
        delegatedTo: formData.delegatedTo.trim(),
        description: formData.description.trim() || undefined,
        dueAt: formData.dueAt || undefined,
        source: formData.source.trim() || undefined,
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
      });
      void loadDelegations();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!formData.title.trim() || !formData.delegatedTo.trim()) return;
    try {
      await api.delegationsUpdate(id, {
        title: formData.title.trim(),
        delegatedTo: formData.delegatedTo.trim(),
        description: formData.description.trim() || undefined,
        dueAt: formData.dueAt || undefined,
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
      });
      void loadDelegations();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条委托？')) return;
    try {
      await api.delegationsDelete(id);
      void loadDelegations();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleStatusChange = async (id: string, status: 'waiting' | 'completed' | 'cancelled') => {
    try {
      await api.delegationsUpdate(id, { status });
      void loadDelegations();
    } catch (e) {
      setError(e instanceof Error ? e.message : '状态更新失败');
    }
  };

  const startEdit = (d: Delegation) => {
    setFormData({
      title: d.title,
      delegatedTo: d.delegatedTo,
      description: d.description ?? '',
      dueAt: d.dueAt ? d.dueAt.slice(0, 16) : '',
      source: d.source ?? '',
      tags: d.tags.join(', '),
    });
    setEditingId(d.id);
    setShowForm(true);
  };

  const isOverdue = (d: Delegation) =>
    d.status === 'waiting' && d.dueAt && new Date(d.dueAt) < new Date();

  const statusLabel = (s: string) => {
    if (s === 'waiting') return '等待中';
    if (s === 'completed') return '已完成';
    if (s === 'cancelled') return '已取消';
    return s;
  };

  const statusColor = (s: string) => {
    if (s === 'waiting') return 'bg-yellow-100 text-yellow-800';
    if (s === 'completed') return 'bg-green-100 text-green-800';
    if (s === 'cancelled') return 'bg-gray-100 text-gray-500';
    return 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 text-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <UserCheck size={18} className="text-blue-500 shrink-0" />
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">委托追踪</h1>
        <div className="flex-1" />
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-colors"
        >
          <Plus size={14} />
          新委托
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索委托..."
          className="flex-1 bg-transparent outline-none text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400"
        />
        <div className="flex gap-1">
          {(['all', 'waiting', 'completed', 'cancelled'] as FilterStatus[]).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${filterStatus === s ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              {s === 'all' ? '全部' : statusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 text-xs">
          <AlertCircle size={14} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-96 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                {editingId ? '编辑委托' : '新建委托'}
              </h2>
              <button onClick={resetForm}><X size={16} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">标题 *</label>
                <input value={formData.title} onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="委托事项标题" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">委托给 *</label>
                <input value={formData.delegatedTo} onChange={e => setFormData(f => ({ ...f, delegatedTo: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="委托人姓名或团队" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">描述</label>
                <textarea value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder="委托详情和预期结果" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">截止日期</label>
                <input type="datetime-local" value={formData.dueAt} onChange={e => setFormData(f => ({ ...f, dueAt: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">来源</label>
                <input value={formData.source} onChange={e => setFormData(f => ({ ...f, source: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="如：会议、邮件、对话" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">标签（逗号分隔）</label>
                <input value={formData.tags} onChange={e => setFormData(f => ({ ...f, tags: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="标签1, 标签2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">取消</button>
              <button
                onClick={() => editingId ? handleUpdate(editingId) : handleCreate()}
                disabled={!formData.title.trim() || !formData.delegatedTo.trim()}
                className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Check size={14} />
                {editingId ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            加载中...
          </div>
        ) : delegations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
            <UserCheck size={32} />
            <span>暂无委托</span>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {delegations.map(d => (
              <div key={d.id} className={`px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${isOverdue(d) ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{d.title}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${statusColor(d.status)}`}>
                        {statusLabel(d.status)}
                      </span>
                      {isOverdue(d) && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 shrink-0">
                          <AlertCircle size={10} /> 逾期
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-0.5">
                        <UserCheck size={11} /> {d.delegatedTo}
                      </span>
                      {d.dueAt && (
                        <span className="flex items-center gap-0.5">
                          <Clock size={11} /> {new Date(d.dueAt).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                      {d.followUpCount > 0 && (
                        <span className="flex items-center gap-0.5">
                          <RotateCcw size={11} /> 跟进{d.followUpCount}次
                        </span>
                      )}
                    </div>
                    {d.description && (
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{d.description}</p>
                    )}
                    {d.tags.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {d.tags.map(tag => (
                          <span key={tag} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {d.status === 'waiting' && (
                      <>
                        <button onClick={() => handleStatusChange(d.id, 'completed')}
                          className="p-1 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 rounded" title="标记完成">
                          <Check size={14} />
                        </button>
                        <button onClick={() => startEdit(d)}
                          className="p-1 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded" title="编辑">
                          <Edit3 size={14} />
                        </button>
                      </>
                    )}
                    <button onClick={() => handleDelete(d.id)}
                      className="p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded" title="删除">
                      <Trash2 size={14} />
                    </button>
                    {d.status !== 'cancelled' && d.status !== 'completed' && (
                      <button onClick={() => handleStatusChange(d.id, 'cancelled')}
                        className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title="取消">
                        <X size={14} />
                      </button>
                    )}
                    {d.status !== 'waiting' && (
                      <button onClick={() => handleStatusChange(d.id, 'waiting')}
                        className="p-1 text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/30 rounded" title="重新激活">
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
