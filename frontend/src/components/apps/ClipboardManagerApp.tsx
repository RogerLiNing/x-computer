import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Pin, Trash2, Copy, X, Clipboard, Type, Image, FileText } from 'lucide-react';

interface ClipboardItem {
  id: string;
  type: 'text' | 'image' | 'file';
  content: string; // text content or base64 image data
  preview: string; // truncated text or thumbnail
  pinned: boolean;
  timestamp: number;
}

const MAX_ITEMS = 200;
const POLL_INTERVAL = 1000;

interface Props {
  windowId: string;
}

export function ClipboardManagerApp({ windowId }: Props) {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const lastContentRef = useRef<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadItems = useCallback(() => {
    try {
      const raw = localStorage.getItem('clipboard-history');
      if (raw) setItems(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const saveItems = useCallback((newItems: ClipboardItem[]) => {
    try {
      localStorage.setItem('clipboard-history', JSON.stringify(newItems));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadItems();
    lastContentRef.current = items[0]?.content ?? '';
  }, []);

  useEffect(() => {
    const readClipboard = async () => {
      try {
        if (!navigator.clipboard?.readText) return;
        const text = await navigator.clipboard.readText();
        if (text && text !== lastContentRef.current && text.trim().length > 0) {
          lastContentRef.current = text;
          const newItem: ClipboardItem = {
            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'text',
            content: text,
            preview: text.slice(0, 120).replace(/\n/g, ' '),
            pinned: false,
            timestamp: Date.now(),
          };
          setItems(prev => {
            // Avoid duplicates
            if (prev.some(i => i.content === text)) return prev;
            const updated = [newItem, ...prev].slice(0, MAX_ITEMS);
            saveItems(updated);
            return updated;
          });
        }
      } catch { /* clipboard access denied or unsupported */ }
    };

    pollRef.current = setInterval(readClipboard, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [saveItems]);

  const copyToClipboard = async (item: ClipboardItem) => {
    try {
      await navigator.clipboard.writeText(item.content);
      lastContentRef.current = item.content;
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      alert('复制失败：浏览器未授予剪贴板权限');
    }
  };

  const togglePin = (id: string) => {
    setItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, pinned: !i.pinned } : i)
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return b.timestamp - a.timestamp;
        });
      saveItems(updated);
      return updated;
    });
  };

  const deleteItem = (id: string) => {
    setItems(prev => {
      const updated = prev.filter(i => i.id !== id);
      saveItems(updated);
      return updated;
    });
  };

  const clearHistory = () => {
    if (!confirm('清除所有未固定的历史记录？')) return;
    setItems(prev => {
      const updated = prev.filter(i => i.pinned);
      saveItems(updated);
      return updated;
    });
  };

  const clearAll = () => {
    if (!confirm('清除所有历史记录（包括已固定）？')) return;
    setItems([]);
    saveItems([]);
  };

  const filtered = items.filter(item => {
    if (!search) return true;
    return item.content.toLowerCase().includes(search.toLowerCase());
  });

  const pinnedCount = items.filter(i => i.pinned).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text)' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索剪贴板历史..."
            style={{ width: '100%', paddingLeft: '28px', padding: '5px 8px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button onClick={clearHistory} title="清除未固定" style={{ padding: '5px 10px', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
          清除历史
        </button>
        <button onClick={clearAll} title="清空全部" style={{ padding: '5px 10px', background: 'transparent', border: '1px solid #ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: '#ef4444', flexShrink: 0 }}>
          清空全部
        </button>
      </div>

      {/* Status bar */}
      <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--color-text-secondary)', flexShrink: 0, background: 'var(--color-surface)' }}>
        <span><Clipboard size={11} style={{ verticalAlign: 'middle', marginRight: '3px' }} />{items.length} 条记录</span>
        <span><Pin size={11} style={{ verticalAlign: 'middle', marginRight: '3px' }} />{pinnedCount} 条已固定</span>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>自动监控中</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '40px' }}>
            <Clipboard size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <div>暂无剪贴板记录</div>
            <div style={{ fontSize: '11px', marginTop: '6px', opacity: 0.7 }}>复制内容后将自动记录</div>
          </div>
        )}
        {filtered.map(item => (
          <div key={item.id} style={{ display: 'flex', gap: '8px', padding: '9px 12px', borderRadius: '8px', marginBottom: '4px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', position: 'relative', transition: 'border-color 0.15s' }}>
            <div style={{ color: 'var(--color-text-secondary)', flexShrink: 0, marginTop: '1px' }}>
              {item.type === 'text' ? <Type size={13} /> : <FileText size={13} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }} onClick={() => copyToClipboard(item)}>
              <div style={{ fontSize: '12px', color: 'var(--color-text)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', cursor: 'pointer', lineHeight: 1.5 }}>
                {item.content}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '4px', display: 'flex', gap: '8px' }}>
                <span>{new Date(item.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span style={{ cursor: 'pointer', color: 'var(--color-accent)' }} onClick={e => { e.stopPropagation(); copyToClipboard(item); }}>
                  {copiedId === item.id ? '已复制!' : '点击复制'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
              <button
                onClick={() => togglePin(item.id)}
                title={item.pinned ? '取消固定' : '固定'}
                style={{ padding: '4px', background: item.pinned ? 'var(--color-accent-bg)' : 'transparent', border: 'none', cursor: 'pointer', color: item.pinned ? 'var(--color-accent)' : 'var(--color-text-secondary)', borderRadius: '4px', display: 'flex' }}
              >
                <Pin size={12} />
              </button>
              <button onClick={() => deleteItem(item.id)} title="删除" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', borderRadius: '4px', display: 'flex' }}>
                <Trash2 size={12} />
              </button>
              <button onClick={() => copyToClipboard(item)} title="复制" style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', color: copiedId === item.id ? '#22c55e' : 'var(--color-text-secondary)', borderRadius: '4px', display: 'flex' }}>
                <Copy size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
