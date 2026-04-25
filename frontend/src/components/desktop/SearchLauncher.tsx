import { useState, useRef, useEffect, useMemo } from 'react';
import { useDesktopStore } from '@/store/desktopStore';
import { useConfigStore } from '@/store/configStore';
import { useAdminStore } from '@/store/adminStore';
import { useMiniAppsStore } from '@/store/miniAppsStore';
import { getAllApps } from '@/appRegistry';
import {
  Search, FolderOpen, Terminal, Globe, MessageSquare, Brain, Code,
  FileText, Mail, Calendar, Settings, Clock, Table, Zap,
  Command, ArrowRight, Layout, FileSpreadsheet, Image, Bot, Play, Kanban, CreditCard, Shield, Hash,
} from 'lucide-react';
import type { AppIdentifier } from '@shared/index';

const ICON_BY_NAME: Record<string, React.ElementType> = {
  FolderOpen, Terminal, Globe, MessageSquare, Brain, Code,
  FileText, Mail, Calendar, Settings, Clock, Table, Layout,
  FileSpreadsheet, Image, Bot, Play, Kanban, CreditCard, Shield,
};

interface SearchItem {
  id: string;
  appId?: AppIdentifier;
  label: string;
  sublabel: string;
  icon: React.ElementType;
  action: () => void;
  category: string;
}

export function SearchLauncher() {
  const { openApp } = useDesktopStore();
  const { searchOpen, setSearchOpen } = useConfigStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const setQueryRef = useRef(setQuery);
  setQueryRef.current = setQuery;

  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        useConfigStore.getState().toggleSearch();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const miniApps = useMiniAppsStore((s) => s.list);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  const searchSessions = useConfigStore((s) => s.searchSessions);

  // Session navigation: close search and switch to chat, then select session
  const navigateToSession = (sessionId: string) => {
    useDesktopStore.getState().openApp('chat');
    // Dispatch a custom event that ChatApp listens for
    window.dispatchEvent(new CustomEvent('x:select-session', { detail: { sessionId } }));
    useConfigStore.getState().setSearchOpen(false);
  };

  const allItems: SearchItem[] = useMemo(() => {
    const appItems: SearchItem[] = getAllApps().map((app) => ({
      id: app.id,
      appId: app.id as AppIdentifier,
      label: app.name,
      sublabel: app.availability === 'demo' ? `${app.description ?? ''} · 演示` : (app.description ?? ''),
      icon: ICON_BY_NAME[app.icon as string] ?? FileText,
      action: () => openApp(app.id),
      category: '应用',
    }));

    // Sessions
    const sessionItems: SearchItem[] = searchSessions.map((s) => ({
      id: `session-${s.id}`,
      label: s.title ?? '无标题会话',
      sublabel: s.summary ? `摘要: ${s.summary}` : s.tags.length > 0 ? `#${s.tags.join(' #')}` : '',
      icon: MessageSquare,
      action: () => navigateToSession(s.id),
      category: '会话',
    }));

    // Tags
    const tagSet = new Set<string>();
    searchSessions.forEach((s) => s.tags.forEach((t) => tagSet.add(t)));
    const tagItems: SearchItem[] = Array.from(tagSet).map((tag) => ({
      id: `tag-${tag}`,
      label: `#${tag}`,
      sublabel: `${searchSessions.filter((s) => s.tags.includes(tag)).length} 个会话`,
      icon: Hash,
      action: () => setQueryRef.current(`#${tag}`),
      category: '标签',
    }));

    return [...appItems, ...sessionItems, ...tagItems];
  }, [openApp, miniApps, isAdmin, searchSessions]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.sublabel.toLowerCase().includes(q) ||
        (item.appId && item.appId.includes(q)),
    );
  }, [query, allItems]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        setSearchOpen(false);
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  if (!searchOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[99998] flex items-start justify-center pt-[8vh] sm:pt-[15vh] px-3 sm:px-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSearchOpen(false);
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Search panel：小屏全宽留边 */}
      <div className="relative w-full max-w-[520px] bg-desktop-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Search size={18} className="text-desktop-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索应用、操作、文件..."
            className="flex-1 bg-transparent outline-none text-sm text-desktop-text placeholder:text-desktop-muted/50"
            autoFocus
          />
          <div className="flex items-center gap-1 text-[10px] text-desktop-muted/40">
            <Command size={10} />
            <span>K</span>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-auto py-2">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-desktop-muted">
              没有找到匹配的结果
            </div>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selectedIndex ? 'bg-desktop-highlight/10' : 'hover:bg-white/5'
                  }`}
                  onClick={() => {
                    item.action();
                    setSearchOpen(false);
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    i === selectedIndex ? 'bg-desktop-highlight/20' : 'bg-white/5'
                  }`}>
                    <Icon size={16} className={i === selectedIndex ? 'text-desktop-highlight' : 'text-desktop-muted'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-desktop-text/90 truncate">{item.label}</div>
                    <div className="text-[10px] text-desktop-muted/60 truncate">{item.sublabel}</div>
                  </div>
                  <span className="text-[10px] text-desktop-muted/30 bg-white/5 rounded px-1.5 py-0.5">
                    {item.category}
                  </span>
                  {i === selectedIndex && (
                    <ArrowRight size={12} className="text-desktop-highlight/50" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
