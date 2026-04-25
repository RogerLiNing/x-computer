import React, { useState, useCallback, useEffect } from 'react';
import { api } from '@/utils/api';
import type { ToolCallRecord } from '@/components/shared';

export interface ChatSessionItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  isPinned?: boolean;
}

export const WELCOME_FALLBACK = `我是 X-Computer 主脑，掌控本机所有应用与任务。

你可以：
• 直接说出目标或聊天提问（我会用你配置的大模型回复）
• 让我写某类内容：我会先问清需求，写好后你可说「写入编辑器」由我决定写入哪段
• 描述多步任务：我会创建执行流程，你可在任务时间线中审批或自动执行

需要危险或敏感操作时，我会请求你的确认。试试输入「你好」或「写一篇短文」开始。`;

const LAST_SESSION_KEY = 'x-computer-last-chat-session-id';
const LAST_SESSION_CLOUD_KEY = 'last_chat_session_id';

function syncLastSessionToCloud(sessionId: string | null) {
  try {
    if (sessionId) localStorage.setItem(LAST_SESSION_KEY, sessionId);
    else localStorage.removeItem(LAST_SESSION_KEY);
  } catch (_) {}
  api.setUserConfigKey(LAST_SESSION_CLOUD_KEY, sessionId).catch(() => {});
}

function convertMessages(msgs: Array<{ id: string; role: string; content: string; createdAt: string; toolCalls?: unknown; images?: string[]; attachedFiles?: Array<{ name: string; path: string }>; bookmarked?: boolean }>): import('./Message').Message[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    timestamp: new Date(m.createdAt).getTime(),
    toolCalls: m.toolCalls ? (m.toolCalls as ToolCallRecord[]) : undefined,
    images: m.images,
    attachedFiles: (m as { attachedFiles?: Array<{ name: string; path: string }> }).attachedFiles,
    bookmarked: m.bookmarked,
  }));
}

export interface UseChatSessionsReturn {
  sessions: ChatSessionItem[];
  currentSessionId: string | null;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  loadSessions: () => void;
  selectSession: (sessionId: string) => void;
  startNewChat: () => void;
  ensureSessionId: () => Promise<{ id: string; isNew: boolean }>;
  deleteSession: (sessionId: string) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  updateSessionTags: (sessionId: string, tags: string[]) => void;
  togglePin: (sessionId: string) => void;
  setCurrentSessionId: (id: string | null) => void;
  refreshSessions: () => void;
}

/** 会话管理：列表、当前会话、切换、新对话、ensure（发送时创建） */
export function useChatSessions(
  setMessages: (fn: (prev: import('./Message').Message[]) => import('./Message').Message[]) => void,
): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loadSessions = useCallback(() => {
    api.listChatSessions(50, 'normal_chat').then((list) => setSessions(list)).catch(() => {});
  }, []);

  // 启动时从云端拉取上次会话（云端优先，无则用本地缓存）
  useEffect(() => {
    api
      .getUserConfigKey(LAST_SESSION_CLOUD_KEY)
      .then((r) => {
        const id = r?.value;
        const sessionId = id != null && typeof id === 'string' && id ? id : null;
        if (!sessionId) {
          const local = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SESSION_KEY) : null;
          if (local) setCurrentSessionId(local);
          return;
        }
        setCurrentSessionId(sessionId);
        api
          .getChatMessages(sessionId)
          .then((msgs) => {
            setMessages(() => [
              { id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() },
              ...convertMessages(msgs),
            ]);
          })
          .catch(() => setCurrentSessionId(null));
      })
      .catch(() => {
        const local = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SESSION_KEY) : null;
        if (local) setCurrentSessionId(local);
      });
  }, [setMessages]);

  const selectSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      syncLastSessionToCloud(sessionId);
      api
        .getChatMessages(sessionId)
        .then((msgs) => {
          setMessages(() => [
            { id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() },
            ...convertMessages(msgs),
          ]);
        })
        .catch(() => {
          setCurrentSessionId(null);
          syncLastSessionToCloud(null);
        });
    },
    [setMessages],
  );

  const startNewChat = useCallback(() => {
    setCurrentSessionId(null);
    setMessages(() => [{ id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() }]);
    syncLastSessionToCloud(null);
  }, [setMessages]);

  const ensureSessionId = useCallback(async (): Promise<{ id: string; isNew: boolean }> => {
    if (currentSessionId) return { id: currentSessionId, isNew: false };
    const s = await api.createChatSession(undefined, 'normal_chat');
    setCurrentSessionId(s.id);
    setSessions((prev) => [{ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, tags: s.tags ?? [] }, ...prev]);
    syncLastSessionToCloud(s.id);
    return { id: s.id, isNew: true };
  }, [currentSessionId]);

  const deleteSession = useCallback(
    (sessionId: string) => {
      api
        .deleteChatSession(sessionId)
        .then(() => {
          if (sessionId === currentSessionId) {
            setCurrentSessionId(null);
            setMessages(() => [{ id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() }]);
            syncLastSessionToCloud(null);
          }
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        })
        .catch(() => {});
    },
    [currentSessionId, setMessages],
  );

  const updateSessionTitle = useCallback((sessionId: string, title: string) => {
    api.updateChatSessionTitle(sessionId, title).then(() => loadSessions()).catch(() => {});
  }, [loadSessions]);

  const updateSessionTags = useCallback((sessionId: string, tags: string[]) => {
    api.updateSessionTags(sessionId, tags).then(() => loadSessions()).catch(() => {});
  }, [loadSessions]);

  const togglePin = useCallback((sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    api.pinChatSession(sessionId, !session.isPinned).then(() => loadSessions()).catch(() => {});
  }, [sessions, loadSessions]);

  return {
    sessions,
    currentSessionId,
    sidebarOpen,
    setSidebarOpen,
    loadSessions,
    selectSession,
    startNewChat,
    ensureSessionId,
    deleteSession,
    updateSessionTitle,
    updateSessionTags,
    togglePin,
    setCurrentSessionId,
    refreshSessions: loadSessions,
  };
}
