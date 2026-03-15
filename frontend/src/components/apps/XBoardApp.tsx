import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, GripVertical, Pencil, Trash2, Check, X, ArrowUp, ArrowRight, ArrowDown, Circle, Clock, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '@/utils/api';

interface BoardItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type ColumnId = 'todo' | 'in_progress' | 'pending' | 'done';

const COLUMNS: { id: ColumnId; label: string; color: string; icon: React.ReactNode }[] = [
  { id: 'todo', label: '待做', color: 'text-blue-500', icon: <Circle className="w-4 h-4" /> },
  { id: 'in_progress', label: '进行中', color: 'text-amber-500', icon: <Loader2 className="w-4 h-4" /> },
  { id: 'pending', label: '等待', color: 'text-purple-500', icon: <Clock className="w-4 h-4" /> },
  { id: 'done', label: '已完成', color: 'text-green-500', icon: <CheckCircle2 className="w-4 h-4" /> },
];

const PRIORITY_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  high: { label: '高', icon: <ArrowUp className="w-3 h-3" />, color: 'text-red-500' },
  medium: { label: '中', icon: <ArrowRight className="w-3 h-3" />, color: 'text-amber-500' },
  low: { label: '低', icon: <ArrowDown className="w-3 h-3" />, color: 'text-blue-400' },
};

interface Props {
  windowId: string;
}

export function XBoardApp({ windowId }: Props) {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<ColumnId | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<string>('medium');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', priority: 'medium' });
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await api.getBoardItems();
      setItems(res.items ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const timer = setInterval(fetchItems, 15000);
    return () => clearInterval(timer);
  }, [fetchItems]);

  useEffect(() => {
    if (addingTo && inputRef.current) inputRef.current.focus();
  }, [addingTo]);

  const handleAdd = async () => {
    if (!newTitle.trim() || !addingTo) return;
    try {
      await api.createBoardItem({ title: newTitle.trim(), status: addingTo, priority: newPriority });
      setNewTitle('');
      setNewPriority('medium');
      setAddingTo(null);
      fetchItems();
    } catch (e: any) {
      setError(e.message ?? '创建失败');
    }
  };

  const handleStatusChange = async (id: string, newStatus: ColumnId) => {
    try {
      await api.updateBoardItem(id, { status: newStatus });
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: newStatus } : i)));
    } catch (e: any) {
      setError(e.message ?? '更新失败');
    }
  };

  const handleEdit = async (id: string) => {
    try {
      await api.updateBoardItem(id, {
        title: editForm.title.trim() || undefined,
        description: editForm.description.trim() || undefined,
        priority: editForm.priority,
      });
      setEditingItem(null);
      fetchItems();
    } catch (e: any) {
      setError(e.message ?? '更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteBoardItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e: any) {
      setError(e.message ?? '删除失败');
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragItem(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, colId: ColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, colId: ColumnId) => {
    e.preventDefault();
    setDragOverColumn(null);
    if (dragItem) {
      const item = items.find((i) => i.id === dragItem);
      if (item && item.status !== colId) {
        handleStatusChange(dragItem, colId);
      }
    }
    setDragItem(null);
  };

  const getColumnItems = (colId: ColumnId) => items.filter((i) => i.status === colId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-desktop-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-desktop-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-desktop-border/40">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-desktop-text">X 任务看板</h1>
          <span className="text-xs text-desktop-muted">
            共 {items.length} 项
          </span>
        </div>
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-3 h-full min-w-0">
          {COLUMNS.map((col) => {
            const colItems = getColumnItems(col.id);
            const isDragOver = dragOverColumn === col.id;
            return (
              <div
                key={col.id}
                className={`flex flex-col min-w-[200px] flex-1 rounded-xl transition-colors ${
                  isDragOver ? 'bg-desktop-accent/10 ring-1 ring-desktop-accent/30' : 'bg-desktop-bg-secondary/60'
                }`}
                onDragOver={(e) => handleDragOver(e, col.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.id)}
              >
                {/* Column Header */}
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-desktop-border/20">
                  <span className={col.color}>{col.icon}</span>
                  <span className="text-sm font-medium text-desktop-text">{col.label}</span>
                  <span className="ml-auto text-xs text-desktop-muted bg-desktop-bg/60 px-1.5 py-0.5 rounded-full">
                    {colItems.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {colItems.map((item) => {
                    const isEditing = editingItem === item.id;
                    const pri = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.medium;
                    return (
                      <div
                        key={item.id}
                        draggable={!isEditing}
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        className={`group rounded-lg border border-desktop-border/30 bg-desktop-bg p-2.5 cursor-grab active:cursor-grabbing transition-all hover:border-desktop-border/60 hover:shadow-sm ${
                          dragItem === item.id ? 'opacity-40' : ''
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              className="w-full px-2 py-1 text-sm rounded border border-desktop-border/50 bg-desktop-bg-secondary text-desktop-text outline-none focus:border-desktop-accent"
                              value={editForm.title}
                              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                              onKeyDown={(e) => e.key === 'Enter' && handleEdit(item.id)}
                            />
                            <textarea
                              className="w-full px-2 py-1 text-xs rounded border border-desktop-border/50 bg-desktop-bg-secondary text-desktop-text outline-none focus:border-desktop-accent resize-none"
                              rows={2}
                              placeholder="描述（可选）"
                              value={editForm.description}
                              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            />
                            <div className="flex items-center gap-1">
                              <select
                                className="text-xs px-1.5 py-0.5 rounded border border-desktop-border/50 bg-desktop-bg-secondary text-desktop-text"
                                value={editForm.priority}
                                onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                              >
                                <option value="high">高优先级</option>
                                <option value="medium">中优先级</option>
                                <option value="low">低优先级</option>
                              </select>
                              <div className="flex-1" />
                              <button
                                className="p-1 rounded text-green-500 hover:bg-green-500/10"
                                onClick={() => handleEdit(item.id)}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                className="p-1 rounded text-desktop-muted hover:bg-desktop-bg-secondary"
                                onClick={() => setEditingItem(null)}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start gap-1.5">
                              <GripVertical className="w-3.5 h-3.5 mt-0.5 text-desktop-muted/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-desktop-text leading-snug break-words">
                                  {item.title}
                                </p>
                                {item.description && (
                                  <p className="mt-1 text-xs text-desktop-muted leading-relaxed line-clamp-2">
                                    {item.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <span className={`inline-flex items-center gap-0.5 text-[10px] ${pri.color}`}>
                                {pri.icon}
                                {pri.label}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  className="p-1 rounded text-desktop-muted hover:text-desktop-accent hover:bg-desktop-accent/10"
                                  title="编辑"
                                  onClick={() => {
                                    setEditingItem(item.id);
                                    setEditForm({ title: item.title, description: item.description ?? '', priority: item.priority });
                                  }}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <button
                                  className="p-1 rounded text-desktop-muted hover:text-red-400 hover:bg-red-400/10"
                                  title="删除"
                                  onClick={() => handleDelete(item.id)}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Add card form */}
                  {addingTo === col.id ? (
                    <div className="rounded-lg border border-desktop-accent/40 bg-desktop-bg p-2.5 space-y-2">
                      <input
                        ref={inputRef}
                        className="w-full px-2 py-1 text-sm rounded border border-desktop-border/50 bg-desktop-bg-secondary text-desktop-text outline-none focus:border-desktop-accent"
                        placeholder="输入任务标题…"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAdd();
                          if (e.key === 'Escape') { setAddingTo(null); setNewTitle(''); }
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <select
                          className="text-xs px-1.5 py-0.5 rounded border border-desktop-border/50 bg-desktop-bg-secondary text-desktop-text"
                          value={newPriority}
                          onChange={(e) => setNewPriority(e.target.value)}
                        >
                          <option value="high">高</option>
                          <option value="medium">中</option>
                          <option value="low">低</option>
                        </select>
                        <div className="flex-1" />
                        <button
                          className="px-2.5 py-1 text-xs rounded bg-desktop-accent text-white hover:bg-desktop-accent/90"
                          onClick={handleAdd}
                        >
                          添加
                        </button>
                        <button
                          className="px-2 py-1 text-xs rounded text-desktop-muted hover:bg-desktop-bg-secondary"
                          onClick={() => { setAddingTo(null); setNewTitle(''); }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1.5 w-full px-2.5 py-2 text-xs text-desktop-muted hover:text-desktop-text hover:bg-desktop-bg rounded-lg transition-colors"
                      onClick={() => { setAddingTo(col.id); setNewTitle(''); setNewPriority('medium'); }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加任务
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
