import { useState, useEffect } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { getAppTitle, getApp } from '@/appRegistry';
import { getUserId } from '@/utils/userId';
import {
  FolderOpen, Terminal, Globe, MessageSquare, Brain, Code,
  FileText, Mail, Settings, Clock, Bot, Zap, Shield,
  Bell, Table, Calendar, Search, Layout, FileSpreadsheet, Image,
  Play, Kanban, CreditCard,
} from 'lucide-react';
import type { AppIdentifier } from '@shared/index';

const ICON_BY_NAME: Record<string, React.ElementType> = {
  FolderOpen, Terminal, Globe, MessageSquare, Brain, Code,
  FileText, Mail, Settings, Clock, Table, Calendar, Layout,
  FileSpreadsheet, Image, Bot, Play, Kanban, CreditCard, Shield,
};

const API_BASE = '/api';

export function Taskbar() {
  const {
    taskbarPinned, windows, activeWindowId,
    openApp, focusWindow, minimizeWindow,
    notifications, tasks, connected,
    toggleSearch,
  } = useDesktopStore();

  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const notificationsList = Array.isArray(notifications) ? notifications : [];
  const tasksList = Array.isArray(tasks) ? tasks : [];
  const unreadCount = notificationsList.filter((n) => !n.read).length;
  const runningTasks = tasksList.filter((t) => t.status === 'running').length;
  const pendingApprovals = tasksList.filter((t) => t.status === 'awaiting_approval').length;

  return (
    <div className="h-12 sm:h-[52px] bg-desktop-taskbar/95 backdrop-blur-xl border-t border-white/5 flex items-center px-2 sm:px-3 gap-0.5 sm:gap-1 z-50 relative select-none safe-area-pb">
      {/* Start / AI button */}
      <button
        className="min-w-[44px] min-h-[44px] w-10 h-10 rounded-xl bg-gradient-to-br from-desktop-highlight to-desktop-highlight/60 flex items-center justify-center hover:brightness-110 active:brightness-95 transition-all shadow-lg mr-0.5 sm:mr-1 touch-manipulation"
        title="AI 助手"
        onClick={() => openApp('chat')}
      >
        <Bot size={20} className="text-white" />
      </button>

      {/* Search button */}
      <button
        className="min-w-[44px] min-h-[44px] w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/8 active:bg-white/12 transition-colors mr-0.5 sm:mr-1 touch-manipulation"
        title="搜索 (⌘K)"
        onClick={toggleSearch}
      >
        <Search size={17} className="text-desktop-muted" />
      </button>

      <div className="w-px h-6 sm:h-7 bg-white/10 mx-0.5 sm:mx-1 shrink-0" />

      {/* Pinned & open apps：小屏横向滚动 */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto overflow-y-hidden py-1 scrollbar-thin">
        {taskbarPinned.map((appId) => {
          const app = getApp(appId);
          const Icon = app ? (ICON_BY_NAME[app.icon] ?? FileText) : FileText;
          const title = getAppTitle(appId);
          const openWindows = (Array.isArray(windows) ? windows : []).filter((w) => w.appId === appId);
          const hasOpen = openWindows.length > 0;
          const isActive = openWindows.some((w) => w.id === activeWindowId);
          const isMiniApp = app?.source === 'miniapp';
          const miniAppIconUrl = isMiniApp
            ? `${API_BASE}/apps/sandbox/${encodeURIComponent(getUserId())}/apps/${appId}/icon.png`
            : '';

          return (
            <button
              key={String(appId)}
              className={`min-w-[44px] min-h-[44px] w-10 h-10 shrink-0 rounded-lg flex items-center justify-center transition-all relative group overflow-hidden touch-manipulation ${
                isActive
                  ? 'bg-white/15 shadow-inner'
                  : hasOpen
                    ? 'bg-white/8 hover:bg-white/12'
                    : 'hover:bg-white/8'
              }`}
              title={title}
              onClick={() => {
                if (isActive && openWindows.length === 1) {
                  minimizeWindow(openWindows[0].id);
                } else if (hasOpen) {
                  focusWindow(openWindows[0].id);
                } else {
                  openApp(appId);
                }
              }}
            >
              {isMiniApp && miniAppIconUrl ? (
                <>
                  <img
                    src={miniAppIconUrl}
                    alt=""
                    className="w-5 h-5 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ display: 'none' }}
                    aria-hidden
                  >
                    <Icon size={18} className={isActive ? 'text-white' : 'text-desktop-muted'} />
                  </div>
                </>
              ) : (
                <Icon size={18} className={isActive ? 'text-white' : 'text-desktop-muted'} />
              )}
              {hasOpen && (
                <div
                  className={`absolute bottom-0.5 rounded-full transition-all ${
                    isActive ? 'w-4 h-1 bg-desktop-highlight' : 'w-1 h-1 bg-desktop-muted/60'
                  }`}
                />
              )}
              <div className="absolute bottom-full mb-2 px-2 py-1 bg-desktop-surface/95 backdrop-blur-sm border border-white/10 rounded-lg text-[10px] text-desktop-text opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                {title}
              </div>
            </button>
          );
        })}
      </div>

      {/* System tray */}
      <div className="flex items-center gap-1.5">
        {/* Running tasks indicator */}
        {(runningTasks > 0 || pendingApprovals > 0) && (
          <button
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
            onClick={() => openApp('task-timeline')}
            title="查看任务"
          >
            {runningTasks > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-blue-400">
                <Zap size={10} className="animate-pulse" />
                {runningTasks}
              </span>
            )}
            {pendingApprovals > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                <Shield size={10} />
                {pendingApprovals}
              </span>
            )}
          </button>
        )}

        {/* Connection status */}
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`}
          title={connected ? '已连接到服务器' : '未连接'}
        />

        {/* Notifications */}
        <button
          className="relative w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/8 transition-colors"
          onClick={() => openApp('task-timeline')}
        >
          <Bell size={15} className="text-desktop-muted" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-desktop-highlight text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Clock：小屏只显示时间 */}
        <div className="text-[10px] sm:text-[11px] text-desktop-muted/70 tabular-nums pl-1 sm:px-2 text-right shrink-0">
          <div>{clock.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}</div>
          <div className="hidden sm:block text-[9px] text-desktop-muted/40">
            {clock.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' })}
          </div>
        </div>
      </div>
    </div>
  );
}
