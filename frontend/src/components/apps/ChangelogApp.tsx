import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit3, X, History, Tag, Calendar, ChevronDown, Globe } from 'lucide-react';
import { api } from '@/utils/api';
import { useTranslation } from 'react-i18next';

interface ChangelogEntry {
  id: string;
  version: string;
  title: string;
  titleEn: string | null;
  content: string;
  contentEn: string | null;
  tags: string[];
  releasedAt: string | null;
  createdAt: string;
}

interface Props {
  windowId: string;
}

export default function ChangelogApp({ windowId }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<number | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [formData, setFormData] = useState({
    version: '',
    title: '',
    titleEn: '',
    content: '',
    contentEn: '',
    tags: '',
    releasedAt: '',
  });

  const loadEntries = useCallback(async () => {
    try {
      const data = (await api.changelogList({ year: filterYear })) as ChangelogEntry[];
      setEntries(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filterYear]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  const resetForm = () => {
    setFormData({ version: '', title: '', titleEn: '', content: '', contentEn: '', tags: '', releasedAt: '' });
    setShowForm(false);
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!formData.version.trim() || !formData.title.trim() || !formData.content.trim()) return;
    try {
      await api.changelogCreate({
        version: formData.version.trim(),
        title: formData.title.trim(),
        titleEn: formData.titleEn.trim() || undefined,
        content: formData.content.trim(),
        contentEn: formData.contentEn.trim() || undefined,
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
        releasedAt: formData.releasedAt || undefined,
      });
      void loadEntries();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!formData.version.trim() || !formData.title.trim() || !formData.content.trim()) return;
    try {
      await api.changelogUpdate(editingId, {
        version: formData.version.trim(),
        title: formData.title.trim(),
        titleEn: formData.titleEn.trim() || null,
        content: formData.content.trim(),
        contentEn: formData.contentEn.trim() || null,
        tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
        releasedAt: formData.releasedAt || null,
      });
      void loadEntries();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.changelogDelete(id);
      void loadEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const startEdit = (entry: ChangelogEntry) => {
    setFormData({
      version: entry.version,
      title: entry.title,
      titleEn: entry.titleEn ?? '',
      content: entry.content,
      contentEn: entry.contentEn ?? '',
      tags: entry.tags.join(', '),
      releasedAt: entry.releasedAt ?? '',
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  const tagColors: Record<string, string> = {
    feat: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    fix: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    refactor: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    docs: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    perf: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    test: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1a1a2e] text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#16162a]">
        <div className="flex items-center gap-2">
          <History size={18} className="text-blue-500" />
          <span className="font-semibold text-sm">Changelog</span>
          <button
            onClick={() => setLang(l => l === 'zh' ? 'en' : 'zh')}
            className="ml-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            <Globe size={12} />
            {lang === 'zh' ? 'EN' : 'CN'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterYear ?? ''}
            onChange={e => setFilterYear(e.target.value ? parseInt(e.target.value) : undefined)}
            className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
          >
            <option value="">全部年份</option>
            {[...new Set(entries.map(e => e.releasedAt ? new Date(e.releasedAt).getFullYear() : null).filter((y): y is number => y !== null))].sort((a, b) => b - a).map(y => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600"
          >
            <Plus size={14} /> 新增
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-blue-50 dark:bg-blue-950/20">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">版本号 *</label>
              <input
                value={formData.version}
                onChange={e => setFormData(f => ({ ...f, version: e.target.value }))}
                placeholder="如 1.2.0"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">发布日期</label>
              <input
                type="date"
                value={formData.releasedAt}
                onChange={e => setFormData(f => ({ ...f, releasedAt: e.target.value }))}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">标题（中文）*</label>
              <input
                value={formData.title}
                onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                placeholder="版本标题"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Title（English）</label>
              <input
                value={formData.titleEn}
                onChange={e => setFormData(f => ({ ...f, titleEn: e.target.value }))}
                placeholder="Version title"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">更新内容（中文）*</label>
            <textarea
              value={formData.content}
              onChange={e => setFormData(f => ({ ...f, content: e.target.value }))}
              placeholder="详细描述本次更新内容..."
              rows={4}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 resize-none"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Content（English）</label>
            <textarea
              value={formData.contentEn}
              onChange={e => setFormData(f => ({ ...f, contentEn: e.target.value }))}
              placeholder="Describe the changes in English..."
              rows={4}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800 resize-none"
            />
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">标签（逗号分隔，如 feat,fix）</label>
            <input
              value={formData.tags}
              onChange={e => setFormData(f => ({ ...f, tags: e.target.value }))}
              placeholder="feat, fix, refactor"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-800"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={editingId ? handleUpdate : handleCreate}
              className="px-4 py-1.5 rounded bg-blue-500 text-white text-sm hover:bg-blue-600"
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
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
            <History size={32} />
            <span>暂无更新日志</span>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {entries.map(entry => (
              <div key={entry.id} className="px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        v{entry.version}
                      </span>
                      {entry.tags.map(tag => (
                        <span key={tag} className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${tagColors[tag] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                          {tag}
                        </span>
                      ))}
                      {entry.releasedAt && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <Calendar size={12} />
                          {entry.releasedAt}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-sm mb-1">{lang === 'zh' ? entry.title : (entry.titleEn ?? entry.title)}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
                      {lang === 'zh' ? entry.content : (entry.contentEn ?? entry.content)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400"
                      title="展开"
                    >
                      <ChevronDown size={14} className={`transition-transform ${expandedId === entry.id ? 'rotate-180' : ''}`} />
                    </button>
                    <button onClick={() => startEdit(entry)} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400" title="编辑">
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => handleDelete(entry.id)} className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500" title="删除">
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
