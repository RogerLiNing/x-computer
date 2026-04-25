import React, { useState, useEffect, useRef } from 'react';
import { Search, Star, Archive, Download, Plus, Calculator, Bell, Mic, FileText, MessageSquare, Zap } from 'lucide-react';

export interface Command {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** If provided, inserts this text into the input */
  insertText?: string;
  /** If provided, executes this action */
  action?: () => void;
}

interface CommandPaletteProps {
  query: string;
  visible: boolean;
  position: { top: number; left: number };
  commands: Command[];
  onSelect: (command: Command) => void;
  onClose: () => void;
}

export function CommandPalette({ query, visible, position, commands, onSelect, onClose }: CommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? commands.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.description.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) onSelect(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visible, filtered, selectedIndex, onSelect, onClose]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="fixed z-50 bg-desktop-surface border border-white/20 rounded-xl shadow-2xl py-1 min-w-[280px] max-w-[360px] max-h-64 overflow-auto"
      style={{ top: position.top, left: position.left }}
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          type="button"
          className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors ${
            i === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'
          }`}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="shrink-0 mt-0.5 text-desktop-accent/80">{cmd.icon}</span>
          <span className="flex-1 min-w-0">
            <div className="text-xs text-desktop-text font-medium leading-tight">{cmd.name}</div>
            <div className="text-[10px] text-desktop-muted mt-0.5 leading-tight">{cmd.description}</div>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Default commands available in the chat input */
export function getDefaultCommands(overrides: {
  onSearch?: () => void;
  onReminder?: () => void;
  onVoice?: () => void;
  onExport?: () => void;
  onNewChat?: () => void;
  onCalculator?: () => void;
  onBookmarks?: () => void;
  onArchive?: () => void;
  onPromptTemplate?: () => void;
}): Command[] {
  return [
    {
      id: 'search',
      name: '/search',
      description: '搜索所有会话消息',
      icon: <Search size={13} />,
      action: overrides.onSearch,
    },
    {
      id: 'reminder',
      name: '/remind',
      description: '设置定时提醒',
      icon: <Bell size={13} />,
      action: overrides.onReminder,
    },
    {
      id: 'voice',
      name: '/voice',
      description: '开始语音输入',
      icon: <Mic size={13} />,
      action: overrides.onVoice,
    },
    {
      id: 'calculator',
      name: '/calc',
      description: '打开计算器',
      icon: <Calculator size={13} />,
      action: overrides.onCalculator,
    },
    {
      id: 'newchat',
      name: '/new',
      description: '开始新对话',
      icon: <Plus size={13} />,
      action: overrides.onNewChat,
    },
    {
      id: 'export',
      name: '/export',
      description: '导出会话',
      icon: <Download size={13} />,
      action: overrides.onExport,
    },
    {
      id: 'bookmarks',
      name: '/starred',
      description: '查看收藏消息',
      icon: <Star size={13} />,
      action: overrides.onBookmarks,
    },
    {
      id: 'archived',
      name: '/archived',
      description: '查看归档会话',
      icon: <Archive size={13} />,
      action: overrides.onArchive,
    },
    {
      id: 'template',
      name: '/template',
      description: '插入提示词模板',
      icon: <FileText size={13} />,
      action: overrides.onPromptTemplate,
    },
  ];
}
