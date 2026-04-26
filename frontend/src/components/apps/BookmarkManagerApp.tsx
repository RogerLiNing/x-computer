import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, Edit2, Search, Folder, Bookmark, ExternalLink, X, Tag, Globe } from 'lucide-react';
import { api } from '@/utils/api';

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  description: string | null;
  folder: string;
  tags: string[];
  favicon: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  windowId: string;
}

interface FormState {
  title: string;
  url: string;
  description: string;
  folder: string;
  tags: string;
  favicon: string;
}

const DEFAULT_FORM: FormState = { title: '', url: '', description: '', folder: '/', tags: '', favicon: '' };

export function BookmarkManagerApp({ windowId }: Props) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFolder, setActiveFolder] = useState<string>('/');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const folders = useMemo(() => {
    const set = new Set(bookmarks.map(b => b.folder || '/'));
    return Array.from(set).sort();
  }, [bookmarks]);

  const loadBookmarks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.bookmarksList({ search: search || undefined, folder: activeFolder !== '/' ? activeFolder : undefined });
      setBookmarks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, activeFolder]);

  useEffect(() => { loadBookmarks(); }, [loadBookmarks]);

  const openCreate = () => {
    setForm({ ...DEFAULT_FORM, folder: activeFolder === '/' ? '/' : activeFolder });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (bm: BookmarkItem) => {
    setForm({
      title: bm.title,
      url: bm.url,
      description: bm.description ?? '',
      folder: bm.folder,
      tags: bm.tags.join(', '),
      favicon: bm.favicon ?? '',
    });
    setEditingId(bm.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.url.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        url: form.url.trim(),
        description: form.description.trim() || undefined,
        folder: form.folder.trim() || '/',
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        favicon: form.favicon.trim() || undefined,
      };
      if (editingId) {
        await api.bookmarksUpdate(editingId, payload);
      } else {
        await api.bookmarksCreate(payload);
      }
      closeForm();
      await loadBookmarks();
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('删除此书签？')) return;
    try {
      await api.bookmarksDelete(id);
      await loadBookmarks();
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败');
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text)' }}>
      {/* Sidebar */}
      <div style={{ width: '180px', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--color-border)' }}>
          <button
            onClick={openCreate}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '6px 10px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
          >
            <Plus size={13} /> 新建书签
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          <button
            onClick={() => setActiveFolder('/')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '5px 12px',
              background: activeFolder === '/' ? 'var(--color-accent-bg)' : 'transparent',
              color: activeFolder === '/' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              border: 'none', cursor: 'pointer', fontSize: '12px', textAlign: 'left',
            }}
          >
            <Globe size={12} /> 全部书签
          </button>
          {folders.filter(f => f !== '/').map(folder => (
            <button
              key={folder}
              onClick={() => setActiveFolder(folder)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '5px 12px',
                background: activeFolder === folder ? 'var(--color-accent-bg)' : 'transparent',
                color: activeFolder === folder ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                border: 'none', cursor: 'pointer', fontSize: '12px', textAlign: 'left',
              }}
            >
              <Folder size={12} /> {folder}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Search bar */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '8px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索书签标题或URL..."
              style={{ width: '100%', paddingLeft: '28px', padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Bookmark list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {loading && <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '20px' }}>加载中...</div>}
          {error && <div style={{ textAlign: 'center', color: '#ef4444', padding: '20px' }}>{error}</div>}
          {!loading && !error && bookmarks.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '40px' }}>
              <Bookmark size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <div>暂无书签</div>
              <button onClick={openCreate} style={{ marginTop: '12px', padding: '6px 14px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                添加第一个书签
              </button>
            </div>
          )}
          {bookmarks.map(bm => (
            <div key={bm.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', borderRadius: '8px', marginBottom: '4px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', transition: 'border-color 0.15s' }}>
              {bm.favicon ? (
                <img src={bm.favicon} alt="" width={16} height={16} style={{ marginTop: '2px', borderRadius: '3px', flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <Bookmark size={14} style={{ marginTop: '2px', flexShrink: 0, color: 'var(--color-text-secondary)' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <a href={bm.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={e => e.stopPropagation()}>
                    {bm.title}
                  </a>
                  <a href={bm.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}
                    onClick={e => e.stopPropagation()}>
                    <ExternalLink size={11} />
                  </a>
                </div>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                  {bm.url}
                </div>
                {bm.description && (
                  <div style={{ color: 'var(--color-text-secondary)', fontSize: '11px', marginTop: '3px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {bm.description}
                  </div>
                )}
                {bm.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {bm.tags.map(tag => (
                      <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '1px 6px', background: 'var(--color-accent-bg)', color: 'var(--color-accent)', borderRadius: '10px', fontSize: '10px' }}>
                        <Tag size={9} /> {tag}
                      </span>
                    ))}
                  </div>
                )}
                {bm.folder !== '/' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '3px', color: 'var(--color-text-secondary)', fontSize: '10px' }}>
                    <Folder size={10} /> {bm.folder}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                <button onClick={() => openEdit(bm)} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', borderRadius: '4px', display: 'flex' }}>
                  <Edit2 size={12} />
                </button>
                <button onClick={() => handleDelete(bm.id)} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', borderRadius: '4px', display: 'flex' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create/Edit modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--color-surface)', borderRadius: '12px', padding: '24px', width: '460px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>{editingId ? '编辑书签' : '新建书签'}</h3>
              <button onClick={closeForm} style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', display: 'flex' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>标题 *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', outline: 'none' }}
                  placeholder="书签标题" autoFocus />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>URL *</label>
                <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', outline: 'none' }}
                  placeholder="https://..." />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>描述</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', outline: 'none', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
                  placeholder="可选描述..." />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>文件夹</label>
                  <input value={form.folder} onChange={e => setForm(f => ({ ...f, folder: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', outline: 'none' }}
                    placeholder="/" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Favicon URL</label>
                  <input value={form.favicon} onChange={e => setForm(f => ({ ...f, favicon: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', outline: 'none' }}
                    placeholder="https://..." />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>标签（逗号分隔）</label>
                <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--color-bg)', color: 'var(--color-text)', boxSizing: 'border-box', outline: 'none' }}
                  placeholder="标签1, 标签2" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={closeForm} style={{ padding: '7px 16px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--color-text)' }}>
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim() || !form.url.trim()}
                style={{ padding: '7px 16px', background: form.title.trim() && form.url.trim() ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', border: 'none', borderRadius: '6px', cursor: form.title.trim() && form.url.trim() ? 'pointer' : 'not-allowed', fontSize: '13px' }}
              >
                {saving ? '保存中...' : (editingId ? '保存' : '创建')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
