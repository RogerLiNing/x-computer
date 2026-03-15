import { useState, useEffect, useCallback } from 'react';
import { Mail, Star, Trash2, Send, Reply, Forward, Bot, Inbox, Archive, Search, Edit, RefreshCw } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import { api } from '@/utils/api';

interface Email {
  id: string;
  from: string;
  subject: string;
  preview: string;
  body: string;
  time: string;
  read: boolean;
  starred: boolean;
}

/** 格式化日期为简短时间 */
function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const today = now.toLocaleDateString();
  const dDate = d.toLocaleDateString();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (dDate === today) return time;
  const yesterday = new Date(now.getTime() - 86400000).toLocaleDateString();
  if (dDate === yesterday) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

interface Props {
  windowId: string;
}

export function EmailApp({ windowId }: Props) {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const addNotification = useDesktopStore((s) => s.addNotification);

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getEmailInbox(30);
      if (!res.ok && res.error) {
        setError(res.error);
        setEmails([]);
        return;
      }
      const list = (res.emails ?? []).map((e) => ({
        id: String(e.uid),
        from: e.from || '未知',
        subject: e.subject || '(无主题)',
        preview: (e.text ?? '').slice(0, 80) || e.subject || '',
        body: e.text ?? '',
        time: formatTime(e.date),
        read: !e.unseen,
        starred: false,
      }));
      setEmails(list);
      setSelectedId((prev) => (prev && list.some((x) => x.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : '拉取失败');
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const selected = emails.find((e) => e.id === selectedId);

  const toggleStar = (id: string) => {
    setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, starred: !e.starred } : e)));
  };

  return (
    <div className="h-full flex text-sm">
      {/* Sidebar */}
      <div className="w-14 border-r border-white/5 bg-white/[0.01] flex flex-col items-center py-3 gap-2">
        <button
          className="w-9 h-9 rounded-lg bg-desktop-highlight/20 flex items-center justify-center hover:bg-desktop-highlight/30 transition-colors"
          title="写邮件"
          onClick={() => setComposing(true)}
        >
          <Edit size={16} className="text-desktop-highlight" />
        </button>
        <button
          className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
          title="收件箱"
        >
          <Inbox size={16} className="text-desktop-text/70" />
        </button>
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-50"
          title="刷新收件箱"
          onClick={loadEmails}
          disabled={loading}
        >
          <RefreshCw size={14} className={`text-desktop-muted ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors" title="已发送">
          <Send size={14} className="text-desktop-muted" />
        </button>
        <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors" title="归档">
          <Archive size={14} className="text-desktop-muted" />
        </button>
        <div className="flex-1" />
        <button
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-blue-500/20 transition-colors"
          title="AI 整理邮件"
          onClick={() => addNotification({ type: 'info', title: 'AI 邮件助手', message: 'AI 正在整理和分类你的邮件...' })}
        >
          <Bot size={16} className="text-blue-400" />
        </button>
      </div>

      {/* Email list */}
      <div className="w-64 border-r border-white/5 overflow-auto flex flex-col">
        <div className="p-2 shrink-0">
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-desktop-muted" />
            <input
              placeholder="搜索邮件..."
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-desktop-text outline-none focus:border-desktop-highlight/30 placeholder:text-desktop-muted/50"
            />
          </div>
          {error && (
            <div className="text-[11px] text-amber-400/90 mb-2 px-1">
              {error}
            </div>
          )}
        </div>
        {loading && emails.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-desktop-muted text-xs">
            <RefreshCw size={16} className="animate-spin mr-2" />
            加载中…
          </div>
        ) : (
        <div className="flex-1 overflow-auto">
        {emails.map((email) => (
          <div
            key={email.id}
            className={`px-3 py-2.5 cursor-pointer border-b border-white/5 transition-colors ${
              selectedId === email.id ? 'bg-desktop-accent/30' : 'hover:bg-white/[0.03]'
            }`}
            onClick={() => {
              setSelectedId(email.id);
              setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, read: true } : e)));
            }}
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs truncate flex-1 ${!email.read ? 'font-semibold text-desktop-text' : 'text-desktop-text/70'}`}>
                {email.from}
              </span>
              <button onClick={(e) => { e.stopPropagation(); toggleStar(email.id); }} className="shrink-0">
                <Star size={12} className={email.starred ? 'text-yellow-400 fill-yellow-400' : 'text-desktop-muted/30'} />
              </button>
              <span className="text-[10px] text-desktop-muted shrink-0">{email.time}</span>
            </div>
            <div className={`text-xs truncate mt-0.5 ${!email.read ? 'text-desktop-text/90' : 'text-desktop-muted'}`}>
              {email.subject}
            </div>
            <div className="text-[11px] text-desktop-muted/60 truncate mt-0.5">{email.preview}</div>
          </div>
        ))}
        </div>
        )}
      </div>

      {/* Email content */}
      <div className="flex-1 overflow-auto">
        {selected ? (
          <div className="p-4">
            <h2 className="text-base font-medium text-desktop-text mb-3">{selected.subject}</h2>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-desktop-accent flex items-center justify-center text-xs font-medium text-desktop-text">
                {selected.from[0]}
              </div>
              <div>
                <div className="text-xs text-desktop-text">{selected.from}</div>
                <div className="text-[11px] text-desktop-muted">{selected.time}</div>
              </div>
              <div className="flex-1" />
              <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><Reply size={14} className="text-desktop-muted" /></button>
              <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><Forward size={14} className="text-desktop-muted" /></button>
              <button className="p-1.5 rounded hover:bg-white/10 transition-colors"><Trash2 size={14} className="text-desktop-muted" /></button>
            </div>
            <div className="text-xs text-desktop-text/80 whitespace-pre-wrap leading-relaxed bg-white/[0.02] rounded-lg p-4 border border-white/5 min-h-[120px] overflow-auto">
              {selected.body ? selected.body : <span className="text-desktop-muted">（无正文）</span>}
            </div>
            <div className="mt-3">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs transition-colors"
                onClick={() => addNotification({ type: 'info', title: 'AI 邮件助手', message: 'AI 正在草拟回复...' })}
              >
                <Bot size={12} />
                AI 草拟回复
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-desktop-muted text-xs">
            <div className="text-center">
              <Mail size={36} className="mx-auto mb-3 text-desktop-accent" />
              <p>选择一封邮件查看内容</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
