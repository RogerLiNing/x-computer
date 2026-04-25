import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../../utils/api.js';
import type { LucideIcon } from 'lucide-react';
import { Bell, X, CheckCheck, Trash2, Info, CheckCircle, AlertTriangle, XCircle, Zap, Webhook, Settings } from 'lucide-react';

interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: number;
  expiresAt: number | null;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  task: Zap,
  webhook: Webhook,
  system: Settings,
};

const TYPE_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
  task: 'text-purple-400',
  webhook: 'text-orange-400',
  system: 'text-gray-400',
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

interface NotificationCenterProps {
  onNotificationClick?: (n: Notification) => void;
}

export function NotificationCenter({ onNotificationClick }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Poll for unread count every 30 seconds
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await api.getUnreadNotificationCount();
        setUnreadCount(res.data.count);
      } catch { /* ignore */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Load notifications when panel opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getNotifications({ limit: 30, includeRead: true })
      .then((res) => setNotifications(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleMarkRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch { /* ignore */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    const n = notifications.find((x) => x.id === id);
    try {
      await api.deleteNotification(id);
      setNotifications((prev) => prev.filter((x) => x.id !== id));
      if (n && !n.read) setUnreadCount((c) => Math.max(0, c - 1));
    } catch { /* ignore */ }
  };

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read) handleMarkRead(n.id);
    if (n.link) window.open(n.link, '_blank', 'noopener');
    onNotificationClick?.(n);
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        title="通知中心"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/10 transition-colors"
      >
        <Bell size={18} className="text-desktop-muted" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 text-[10px] font-bold leading-4 text-white bg-red-500 rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 max-h-[480px] bg-desktop-panel border border-white/10 rounded-xl shadow-2xl flex flex-col z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm font-semibold text-desktop-text">通知中心</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  title="全部已读"
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-desktop-muted hover:text-desktop-accent rounded transition-colors"
                >
                  <CheckCheck size={13} />
                  全部已读
                </button>
              )}
              <button
                type="button"
                title="关闭"
                onClick={() => setOpen(false)}
                className="p-1 text-desktop-muted hover:text-desktop-text rounded transition-colors"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-desktop-muted text-sm">
                加载中...
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Bell size={28} className="text-desktop-muted/40" />
                <span className="text-sm text-desktop-muted/60">暂无通知</span>
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Info;
                const color = TYPE_COLORS[n.type] ?? 'text-blue-400';
                return (
                  <div
                    key={n.id}
                    className={`group relative px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${
                      !n.read ? 'bg-desktop-accent/5' : ''
                    }`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    {!n.read && (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-desktop-accent" />
                    )}
                    <div className="flex items-start gap-2.5">
                      <Icon size={15} className={`mt-0.5 shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${!n.read ? 'font-medium text-desktop-text' : 'text-desktop-muted'}`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-desktop-muted/70 mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        <p className="text-[11px] text-desktop-muted/50 mt-1">{formatRelativeTime(n.createdAt)}</p>
                      </div>
                    </div>
                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                      {!n.read && (
                        <button
                          type="button"
                          title="标记已读"
                          onClick={(e) => { e.stopPropagation(); handleMarkRead(n.id); }}
                          className="p-1 text-desktop-muted hover:text-desktop-accent rounded transition-colors"
                        >
                          <CheckCheck size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        title="删除"
                        onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                        className="p-1 text-desktop-muted hover:text-red-400 rounded transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
