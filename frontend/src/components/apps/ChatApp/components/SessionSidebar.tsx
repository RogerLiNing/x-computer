import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';

interface ChatSessionItem {
  id: string;
  title: string | null;
}

interface SessionSidebarProps {
  sessions: ChatSessionItem[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onStartNewChat: () => void;
  onUpdateSessionTitle: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onStartNewChat,
  onUpdateSessionTitle,
  onDeleteSession,
}: SessionSidebarProps) {
  return (
    <div className="w-full sm:w-56 shrink-0 border-r border-white/5 bg-white/[0.02] flex flex-col absolute sm:relative inset-x-0 top-12 sm:top-0 bottom-0 sm:bottom-auto z-20 sm:z-auto">
      <button
        className="flex items-center gap-2 px-3 py-2.5 m-2 rounded-lg bg-desktop-highlight/20 hover:bg-desktop-highlight/30 text-desktop-text text-xs transition-colors"
        onClick={onStartNewChat}
      >
        <MessageSquarePlus size={14} />
        新对话
      </button>
      <div className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-0.5 rounded-lg ${
              currentSessionId === s.id ? 'bg-desktop-accent/30' : 'hover:bg-white/5'
            }`}
          >
            <button
              type="button"
              className={`flex-1 min-w-0 text-left px-3 py-2 rounded-lg text-xs transition-colors truncate ${
                currentSessionId === s.id ? 'text-desktop-text' : 'text-desktop-muted hover:text-desktop-text'
              }`}
              onClick={() => onSelectSession(s.id)}
            >
              {s.title?.trim() || '新对话'}
            </button>
            <button
              type="button"
              className="shrink-0 p-1.5 rounded text-desktop-muted hover:bg-white/10 hover:text-desktop-text opacity-0 group-hover:opacity-100 transition-opacity"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation();
                const newTitle = window.prompt('会话标题', s.title?.trim() || '新对话');
                if (newTitle !== null && newTitle.trim()) onUpdateSessionTitle(s.id, newTitle.trim());
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              className="shrink-0 p-1.5 rounded text-desktop-muted hover:bg-white/10 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              title="删除会话"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('确定删除该会话？')) onDeleteSession(s.id);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
