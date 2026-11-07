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
  /** Optional grouping for visual sections in the palette (e.g. built-in commands vs. skills) */
  group?: 'command' | 'skill';
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
  /** Track whether the latest selectedIndex change came from keyboard navigation,
   *  so we only scroll the highlighted item into view when the user is using the
   *  keyboard. Mouse hover should not move the list, otherwise the layout shifts
   *  between mousedown and mouseup and the browser never fires a click event. */
  const keyboardNavRef = useRef(false);

  // Keep latest callbacks in refs so the keyboard effect doesn't re-bind on every render.
  const onSelectRef = useRef(onSelect);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onCloseRef.current = onClose;
  }, [onSelect, onClose]);

  const filtered = query
    ? commands.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.description.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  // Build display rows: insert section headers between groups while keeping
  // a flat list of selectable items for keyboard navigation.
  type Row =
    | { kind: 'header'; key: string; label: string }
    | { kind: 'item'; key: string; index: number };
  const rows: Row[] = [];
  {
    let lastGroup: string | undefined;
    filtered.forEach((cmd, index) => {
      const group = cmd.group ?? 'command';
      if (group !== lastGroup) {
        const label = group === 'skill' ? '技能' : '命令';
        rows.push({ kind: 'header', key: `h:${group}:${index}`, label });
        lastGroup = group;
      }
      rows.push({ kind: 'item', key: `i:${cmd.id}`, index });
    });
  }

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!keyboardNavRef.current) return;
    keyboardNavRef.current = false;
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${selectedIndex}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        keyboardNavRef.current = true;
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        keyboardNavRef.current = true;
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
      className="fixed z-50 bg-[#161616] border border-white/20 rounded-xl shadow-2xl py-1 min-w-[280px] max-w-[360px] max-h-64 max-w-[calc(100vw-16px)] overflow-auto"
      style={{ top: position.top, left: position.left }}
    >
      {rows.map((row) => {
        if (row.kind === 'header') {
          return (
            <div
              key={row.key}
              className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-gray-500 select-none"
            >
              {row.label}
            </div>
          );
        }
        const i = row.index;
        const cmd = filtered[i];
        if (!cmd) return null;
        return (
        <button
          key={row.key}
          type="button"
          data-command-index={i}
          className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors ${
            i === selectedIndex ? 'bg-white/10' : 'hover:bg-white/5'
          }`}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="shrink-0 mt-0.5 text-amber-400/80">{cmd.icon}</span>
          <span className="flex-1 min-w-0">
            <div className="text-xs text-gray-200 font-medium leading-tight">{cmd.name}</div>
            <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{cmd.description}</div>
          </span>
        </button>
        );
      })}
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
      group: 'command',
    },
    {
      id: 'reminder',
      name: '/remind',
      description: '设置定时提醒',
      icon: <Bell size={13} />,
      action: overrides.onReminder,
      group: 'command',
    },
    {
      id: 'voice',
      name: '/voice',
      description: '开始语音输入',
      icon: <Mic size={13} />,
      action: overrides.onVoice,
      group: 'command',
    },
    {
      id: 'calculator',
      name: '/calc',
      description: '打开计算器',
      icon: <Calculator size={13} />,
      action: overrides.onCalculator,
      group: 'command',
    },
    {
      id: 'newchat',
      name: '/new',
      description: '开始新对话',
      icon: <Plus size={13} />,
      action: overrides.onNewChat,
      group: 'command',
    },
    {
      id: 'export',
      name: '/export',
      description: '导出会话',
      icon: <Download size={13} />,
      action: overrides.onExport,
      group: 'command',
    },
    {
      id: 'bookmarks',
      name: '/starred',
      description: '查看收藏消息',
      icon: <Star size={13} />,
      action: overrides.onBookmarks,
      group: 'command',
    },
    {
      id: 'archived',
      name: '/archived',
      description: '查看归档会话',
      icon: <Archive size={13} />,
      action: overrides.onArchive,
      group: 'command',
    },
    {
      id: 'template',
      name: '/template',
      description: '插入提示词模板',
      icon: <FileText size={13} />,
      action: overrides.onPromptTemplate,
      group: 'command',
    },
  ];
}
