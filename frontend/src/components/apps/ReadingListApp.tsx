import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit3, X, BookMarked, Search, ExternalLink, Star, Filter } from 'lucide-react';
import { api } from '@/utils/api';
import { useTranslation } from 'react-i18next';

interface ReadingItem {
  id: string;
  title: string;
  author: string | null;
  url: string | null;
  notes: string | null;
  priority: string | null;
  status: string | null;
  rating: number | null;
  tags: string[];
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  windowId: string;
}

type FilterStatus = 'all' | 'unread' | 'reading' | 'done';

export default function ReadingListApp({ windowId }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    author: '',
    url: '',
    notes: '',
    priority: 'medium',
    status: 'unread',
    rating: 0,
    tags: '',
    source: '',
  });

  const loadItems = useCallback(async () => {
    try {
      const data = (await api.readingListList({
        status: filterStatus === 'all' ? undefined : filterStatus,
        search: search || undefined,
      })) as ReadingItem[];
      setItems(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  const resetForm = () => {
    setFormData({ title: '', author: '', url: '', notes: '', priority: 'medium', status: 'unread', rating: 0, tags: '', source: '' });
    setShowForm(false);
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!formData.title.trim()) return;
    try {
      await api.readingListCreate({
        title: formData.title.trim(),
        author: formData.author.trim() || undefined,
        url: formData.url.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        priority: formData.priority,
        status: formData.status,
        rating: formData.rating > 0 ? formData.rating : undefined,
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
        source: formData.source.trim() || undefined,
      });
      void loadItems();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !formData.title.trim()) return;
    try {
      await api.readingListUpdate(editingId, {
        title: formData.title.trim(),
        author: formData.author.trim() || null,
        url: formData.url.trim() || null,
        notes: formData.notes.trim() || null,
        priority: formData.priority,
        status: formData.status,
        rating: formData.rating > 0 ? formData.rating : null,
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
        source: formData.source.trim() || null,
      });
      void loadItems();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.readingListDelete(id);
      void loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const startEdit = (item: ReadingItem) => {
    setFormData({
      title: item.title,
      author: item.author ?? '',
      url: item.url ?? '',
      notes: item.notes ?? '',
      priority: item.priority ?? 'medium',
      status: item.status ?? 'unread',
      rating: item.rating ?? 0,
      tags: item.tags.join(', '),
      source: item.source ?? '',
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  const statusColors: Record<string, string> = {
    unread: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    reading: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    done: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  };
  const priorityColors: Record<string, string> = {
    high: 'text-red-500',
    medium: 'text-yellow-500',
    low: 'text-green-500',
  };

  const renderStars = (rating: number) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={12} className={n <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-gray-600'} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1a1a2e] text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#16162a]">
        <div className="flex items-center gap-2">
          <BookMarked size={18} className="text-purple-500" />
          <span className="font-semibold text-sm">Reading List</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索..."
              className="text-xs border border-gray-300 dark:border-gray-600 rounded pl-7 pr-2 py-1 bg-white dark:bg-gray-800 w-32"
            />
          </div>
          <div className="flex items-center gap-1">
            {(['all', 'unread', 'reading', 'done'] as FilterStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`text-xs px-2 py-1 rounded ${filterStatus === s ? 'bg-purple-500 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
              >
                {s === 'all' ? '全部' : s === 'unread' ? '未读' : s === 'reading' ? '在读' : '已读'}
              </button>
            ))}
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-purple-500 text-white hover:bg-purple-600"
          >
            <Plus size={14} /> 新增
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-purple-50 dark:bg-purple-950/20">
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">标题 *</label>
            <input
              value={formData.title}
              onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
              placeholder="书名 / 文章标题 / 链接标题"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">作者</label>
              <input
                value={formData.author}
                onChange={e => setFormData(f => ({ ...f, author: e.target.value }))}
                placeholder="作者"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">来源</label>
              <input
                value={formData.source}
                onChange={e => setFormData(f => ({ ...f, source: e.target.value }))}
                placeholder="来源"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">链接</label>
            <input
              value={formData.url}
              onChange={e => setFormData(f => ({ ...f, url: e.target.value }))}
              placeholder="https://..."
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
            />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">优先级</label>
              <select
                value={formData.priority}
                onChange={e => setFormData(f => ({ ...f, priority: e.target.value }))}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              >
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">状态</label>
              <select
                value={formData.status}
                onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              >
                <option value="unread">未读</option>
                <option value="reading">在读</option>
                <option value="done">已读</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">评分</label>
              <div className="flex items-center h-[34px] gap-1 border border-gray-300 dark:border-gray-600 rounded px-2 bg-white dark:bg-gray-800">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" onClick={() => setFormData(f => ({ ...f, rating: n }))}>
                    <Star size={14} className={n <= formData.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-gray-600'} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">笔记</label>
            <textarea
              value={formData.notes}
              onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
              placeholder="个人笔记..."
              rows={3}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 resize-none"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">标签（逗号分隔）</label>
            <input
              value={formData.tags}
              onChange={e => setFormData(f => ({ ...f, tags: e.target.value }))}
              placeholder="技术, 商业, 小说"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={editingId ? handleUpdate : handleCreate}
              className="px-4 py-1.5 rounded bg-purple-500 text-white text-sm hover:bg-purple-600"
            >
              {editingId ? '保存修改' : '创建'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm rounded">
          {error}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">加载中...</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
            <BookMarked size={32} />
            <span>暂无阅读项</span>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map(item => (
              <div key={item.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {item.status && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${statusColors[item.status] ?? ''}`}>
                          {item.status === 'unread' ? '未读' : item.status === 'reading' ? '在读' : '已读'}
                        </span>
                      )}
                      {item.priority && (
                        <span className={`text-xs font-medium ${priorityColors[item.priority]}`}>
                          {item.priority === 'high' ? '↑ 高优先级' : item.priority === 'medium' ? '中优先级' : '↓ 低优先级'}
                        </span>
                      )}
                      {item.rating && item.rating > 0 && renderStars(item.rating)}
                      {item.tags.map(tag => (
                        <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <h3 className="font-semibold text-sm mb-0.5">{item.title}</h3>
                    {item.author && <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{item.author}{item.source ? ` · ${item.source}` : ''}</p>}
                    {item.notes && <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{item.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
                        title="打开链接"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button onClick={() => startEdit(item)} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400" title="编辑">
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500" title="删除">
                      <Trash2 size={14} />
                    </button>
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
