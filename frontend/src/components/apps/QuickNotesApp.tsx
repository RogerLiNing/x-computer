import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Pin, PinOff, Edit2, Check, X, StickyNote } from 'lucide-react';
import { api } from '@/utils/api';

interface Note {
  id: string;
  title: string;
  content: string;
  color: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

const NOTE_COLORS = [
  { value: '#fef3c7', label: '黄色' },
  { value: '#d1fae5', label: '绿色' },
  { value: '#dbeafe', label: '蓝色' },
  { value: '#fce7f3', label: '粉色' },
  { value: '#ede9fe', label: '紫色' },
  { value: '#fed7aa', label: '橙色' },
  { value: '#f1f5f9', label: '灰色' },
];

interface Props {
  windowId: string;
}

export function QuickNotesApp({ windowId }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editColor, setEditColor] = useState(NOTE_COLORS[0].value);
  const [isCreating, setIsCreating] = useState(false);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.notesList();
      setNotes(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const startCreate = () => {
    setIsCreating(true);
    setEditTitle('');
    setEditContent('');
    setEditColor(NOTE_COLORS[0].value);
    setEditingId(null);
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditColor(note.color);
    setIsCreating(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsCreating(false);
  };

  const saveNote = async () => {
    try {
      if (editingId) {
        const updated = await api.notesUpdate(editingId, {
          title: editTitle,
          content: editContent,
          color: editColor,
        });
        setNotes(prev => prev.map(n => n.id === editingId ? { ...n, ...updated } : n));
      } else {
        const created = await api.notesCreate({
          title: editTitle,
          content: editContent,
          color: editColor,
        });
        setNotes(prev => [created, ...prev]);
      }
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await api.notesDelete(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const togglePin = async (note: Note) => {
    try {
      const updated = await api.notesUpdate(note.id, { pinned: !note.pinned });
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, ...updated } : n));
    } catch (e) {
      setError(e instanceof Error ? e.message : '置顶失败');
    }
  };

  return (
    <div className="h-full flex flex-col text-sm bg-desktop-surface">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02] shrink-0">
        <StickyNote size={15} className="text-yellow-400" />
        <span className="text-xs font-medium text-desktop-text">快速笔记</span>
        <span className="text-[10px] text-desktop-muted/50">{notes.length} 条</span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-yellow-500/20 text-yellow-400 text-xs hover:bg-yellow-500/30 transition-colors font-medium"
          onClick={startCreate}
        >
          <Plus size={12} />
          新建
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-1.5 bg-red-500/10 text-red-400 text-xs border-b border-red-500/20 shrink-0">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>忽略</button>
        </div>
      )}

      {/* Note editor (inline) */}
      {(isCreating || editingId) && (
        <div className="p-3 border-b border-white/5 bg-white/[0.01] shrink-0">
          <div
            className="rounded-xl p-3 border border-white/10"
            style={{ backgroundColor: editColor + '33' }}
          >
            <input
              className="w-full bg-transparent text-sm font-medium text-desktop-text outline-none mb-2 placeholder:text-desktop-muted/40"
              placeholder="标题（可选）"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              autoFocus
            />
            <textarea
              className="w-full bg-transparent text-xs text-desktop-text/80 outline-none resize-none leading-5 placeholder:text-desktop-muted/40 min-h-[60px]"
              placeholder="写下你的笔记..."
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              rows={3}
            />
            {/* Color picker */}
            <div className="flex gap-1 mt-2 flex-wrap">
              {NOTE_COLORS.map(c => (
                <button
                  key={c.value}
                  className={`w-5 h-5 rounded-full transition-transform ${editColor === c.value ? 'ring-2 ring-white/50 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c.value }}
                  onClick={() => setEditColor(c.value)}
                  title={c.label}
                />
              ))}
            </div>
            <div className="flex gap-2 mt-2 justify-end">
              <button
                className="px-3 py-1 text-xs text-desktop-muted hover:bg-white/10 rounded-lg transition-colors"
                onClick={cancelEdit}
              >
                取消
              </button>
              <button
                className="px-3 py-1 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg transition-colors"
                onClick={saveNote}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-auto p-3">
        {loading && notes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-desktop-muted text-xs">
            加载中…
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-desktop-muted/50 text-xs gap-2">
            <StickyNote size={32} className="opacity-30" />
            <p>暂无笔记</p>
            <button className="text-yellow-400 underline" onClick={startCreate}>创建第一条笔记</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {notes.map(note => (
              <div
                key={note.id}
                className="rounded-xl p-3 border border-white/5 hover:border-white/10 transition-colors group cursor-pointer"
                style={{ backgroundColor: note.color + '33' }}
                onClick={() => startEdit(note)}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {note.title && (
                      <div className="text-xs font-semibold text-desktop-text truncate mb-1">
                        {note.title}
                      </div>
                    )}
                    <div className="text-[11px] text-desktop-text/70 whitespace-pre-wrap leading-relaxed break-words line-clamp-4">
                      {note.content || <span className="italic text-desktop-muted/40">空笔记</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1 rounded hover:bg-white/10 transition-colors"
                      onClick={e => { e.stopPropagation(); togglePin(note); }}
                      title={note.pinned ? '取消置顶' : '置顶'}
                    >
                      {note.pinned
                        ? <PinOff size={12} className="text-yellow-400" />
                        : <Pin size={12} className="text-desktop-muted" />
                      }
                    </button>
                    <button
                      className="p-1 rounded hover:bg-red-500/20 transition-colors"
                      onClick={e => { e.stopPropagation(); deleteNote(note.id); }}
                      title="删除"
                    >
                      <Trash2 size={12} className="text-red-400/70 hover:text-red-400" />
                    </button>
                  </div>
                </div>
                <div className="text-[10px] text-desktop-muted/40 mt-2">
                  {new Date(note.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
