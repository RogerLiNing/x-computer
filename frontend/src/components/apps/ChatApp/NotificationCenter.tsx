import {openNotificationLink,externalNotificationUrl} from '@/utils/openNotificationLink';
import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../../utils/api.js';
import type { LucideIcon } from 'lucide-react';
import { Bell, X, CheckCheck, Trash2, Info, CheckCircle, AlertTriangle, XCircle, Zap, Webhook, Settings, Moon } from 'lucide-react';
import { isDndActive, setDndEnabled, subscribeDndState,getDndGeneration,isDndUpdating,beginDndUpdate,endDndUpdate,applyDndPreferences } from '../../../store/dndStore';

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
  const [loadError,setLoadError]=useState('');
  const [dndActive, setDndActive] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const hasLoaded=useRef(false);
  const [dndBusy,setDndBusy]=useState(isDndUpdating());

  // Sync DND state from store
  useEffect(() => {
    const sync = () => {setDndActive(isDndActive());setDndBusy(isDndUpdating());};
    setDndActive(isDndActive());
    const unsub = subscribeDndState(sync);
    return unsub;
  }, []);

  // Load DND preferences and notification count
  useEffect(() => {
    let live=true;
    const request=getDndGeneration();
    const fetchPrefs = async () => {
      try {
        const res = await api.getDndPreferences();
        if(!live||!applyDndPreferences(res,request))return;
        window.dispatchEvent(new Event('x:notifications-refresh'));
      } catch { /* ignore */ }
    };
    fetchPrefs();
    return()=>{live=false;};
  }, []);

  // Poll for unread count every 30 seconds (skip when DND is active)
  useEffect(() => {
    let live=true,version=0;
    const fetchCount = async () => {
      const request=++version,muted=isDndActive();setDndActive(muted);
      if (muted) { setUnreadCount(0); return; }
      try {
        const res = await api.getUnreadNotificationCount();
        if(live&&request===version)setUnreadCount(res.count);
      } catch { /* ignore */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    window.addEventListener('x:notifications-refresh',fetchCount);
    return () => {live=false;clearInterval(interval);window.removeEventListener('x:notifications-refresh',fetchCount);};
  }, []);

  const handleToggleDnd = async () => {
    const request=beginDndUpdate();if(request===null)return;
    const next = !dndActive;
    setDndActive(next);
    setDndEnabled(next);
    window.dispatchEvent(new Event('x:notifications-refresh'));
    try {
      await api.setDndPreferences({ enabled: next });
    } catch {setLoadError('免打扰设置暂未保存，请稍后重试。');}finally{endDndUpdate(request);}
  };

  // Load notifications when panel opens
  useEffect(() => {
    if (!open) return;
    let live=true,version=0;
    const load=()=>{const request=++version;if(!hasLoaded.current)setLoading(true);void api.getNotifications({limit:30,includeRead:true})
      .then(res=>{if(live&&request===version){hasLoaded.current=true;setNotifications(res);setLoadError('');}})
      .catch(()=>{if(live&&request===version)setLoadError('暂时取不到最新通知，请再试一次。');})
      .finally(()=>{if(live&&request===version)setLoading(false);});};
    load();const timer=setInterval(load,30000);window.addEventListener('x:notifications-refresh',load);
    return()=>{live=false;clearInterval(timer);window.removeEventListener('x:notifications-refresh',load);};
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
      window.dispatchEvent(new Event('x:notifications-refresh'));
    } catch { /* ignore */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      window.dispatchEvent(new Event('x:notifications-refresh'));
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    const n = notifications.find((x) => x.id === id);
    try {
      await api.deleteNotification(id);
      setNotifications((prev) => prev.filter((x) => x.id !== id));
      if (n && !n.read) setUnreadCount((c) => Math.max(0, c - 1));
      window.dispatchEvent(new Event('x:notifications-refresh'));
    } catch { /* ignore */ }
  };

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read) handleMarkRead(n.id);
    if(openNotificationLink(n.link)){setOpen(false);return;}
    if (n.link) {const url=externalNotificationUrl(n.link);if(!url){setLoadError('这条通知的链接无法打开，请在应用中查看。');return;}window.open(url,'_blank','noopener,noreferrer');}
    onNotificationClick?.(n);
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        title={dndActive ? '免打扰模式已开启' : '通知中心'}
        onClick={() => setOpen((v) => !v)}
        className={`relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${dndActive ? 'text-yellow-400 hover:bg-yellow-400/10' : 'hover:bg-white/10'}`}
      >
        {dndActive ? <Moon size={18} /> : <Bell size={18} className="text-gray-400" />}
        {!dndActive && unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 text-[10px] font-bold leading-4 text-white bg-red-500 rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div role="region" aria-label="通知列表" className="absolute right-0 top-10 w-80 max-w-[calc(100vw-1rem)] max-h-[65dvh] bg-[#161616] border border-white/10 rounded-xl shadow-2xl flex flex-col z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-200">通知中心</span>
              {dndActive && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center gap-0.5">
                  <Moon size={10} /> 免打扰
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title={dndActive ? '关闭免打扰' : '开启免打扰'}
                onClick={handleToggleDnd}
                disabled={dndBusy}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${dndActive ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' : 'text-gray-400 hover:text-yellow-400 hover:bg-white/5'}`}
              >
                <Moon size={13} />
                {dndActive ? '取消免打扰' : '免打扰'}
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  title="全部已读"
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-amber-400 rounded transition-colors"
                >
                  <CheckCheck size={13} />
                  全部已读
                </button>
              )}
              <button
                type="button"
                title="关闭"
                onClick={() => setOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-200 rounded transition-colors"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loadError&&<div role="alert" className="p-3 text-sm text-amber-300"><p>{loadError}</p><button type="button" onClick={()=>window.dispatchEvent(new Event('x:notifications-refresh'))} className="mt-2 rounded border border-white/20 px-3 py-2">再试一次</button></div>}
            {loading ? (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
                加载中...
              </div>
            ) : notifications.length === 0 && !loadError ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Bell size={28} className="text-gray-400/40" />
                <span className="text-sm text-gray-400/60">暂无通知</span>
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Info;
                const color = TYPE_COLORS[n.type] ?? 'text-blue-400';
                return (
                  <div
                    key={n.id}
                    className={`group relative px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${
                      !n.read ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    {!n.read && (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-500/15" />
                    )}
                    <div className="flex items-start gap-2.5">
                      <Icon size={15} className={`mt-0.5 shrink-0 ${color}`} />
                      <button type="button" onClick={()=>void handleNotificationClick(n)} className="min-w-0 flex-1 pr-20 text-left">
                        <span className={`block text-sm truncate ${!n.read ? 'font-medium text-gray-200' : 'text-gray-400'}`}>
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="block text-xs text-gray-400/70 mt-0.5 line-clamp-2">{n.body}</span>
                        )}
                        <span className="block text-[11px] text-gray-400/50 mt-1">{formatRelativeTime(n.createdAt)}</span>
                      </button>
                    </div>
                    <div className="absolute right-2 top-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-0.5 transition-opacity">
                      {!n.read && (
                        <button
                          type="button"
                          title="标记已读"
                          onClick={(e) => { e.stopPropagation(); handleMarkRead(n.id); }}
                          className="min-h-10 min-w-10 p-2 text-gray-400 hover:text-amber-400 rounded transition-colors"
                        >
                          <CheckCheck size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        title="删除"
                        onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                        className="min-h-10 min-w-10 p-2 text-gray-400 hover:text-red-400 rounded transition-colors"
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
