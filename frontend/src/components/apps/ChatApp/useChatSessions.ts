import React, { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/utils/api';
import type { ToolCallRecord } from '@/components/shared';

export interface ChatSessionItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  isPinned?: boolean;
  isArchived?: boolean;
  summary?: string | null;
  parentSessionId?: string | null;
  preview?: string | null;
}

export const WELCOME_FALLBACK = `你好，我是 X，你的电脑助手。

你不需要懂 AI，也不用记命令。像发微信一样告诉我想做什么就行：
• 查找资料并整理重点
• 写消息、报告、方案或其他内容
• 读取文件，提炼结论和待办
• 设置提醒，完成多步骤任务

不知道怎么说也没关系，直接告诉我：“我想完成一件事，但不知道从哪里开始。”涉及发送、删除、付款等重要操作时，我会先征求你的确认。`;

const LAST_SESSION_KEY = 'x-computer-last-chat-session-id';
const LAST_SESSION_CLOUD_KEY = 'last_chat_session_id';

function getLocalSessionId(): string | null {
  try {
    return localStorage.getItem(LAST_SESSION_KEY);
  } catch {
    return null;
  }
}

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
  isSessionLoading: boolean;
  sessionLoadError: string | null;
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
  toggleArchive: (sessionId: string) => void;
  setCurrentSessionId: (id: string | null) => void;
  refreshSessions: () => void;
  generateSummary: (sessionId: string, providerId: string, modelId: string, baseUrl?: string) => Promise<string>;
  autoTag: (sessionId: string, providerId: string, modelId: string, baseUrl?: string, merge?: boolean) => Promise<string[]>;
  forkSession: (sessionId: string) => Promise<string>;
}

/** 会话管理：列表、当前会话、切换、新对话、ensure（发送时创建） */
export function useChatSessions(
  setMessages: (fn: (prev: import('./Message').Message[]) => import('./Message').Message[]) => void,
  isBusy = false,
): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [currentSessionId, setCurrentSessionIdState] = useState<string | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const sessionRequestRef = useRef(0);
  const deletingSessionIdsRef = useRef(new Set<string>());
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const setCurrentSessionId = useCallback((id: string | null) => {
    sessionRequestRef.current += 1;
    setCurrentSessionIdState(id);
    setIsSessionLoading(false);
    setSessionLoadError(null);
  }, []);

  const loadSessions = useCallback(() => {
    api.listChatSessions(50, 'normal_chat').then((list) => setSessions(list)).catch(() => {});
  }, []);

  const selectSession = useCallback(
    (sessionId: string) => {
      if (busyRef.current) {
        setSessionLoadError('请先停止当前回复，再切换对话。');
        return;
      }
      if (deletingSessionIdsRef.current.has(sessionId)) {
        setSessionLoadError('该对话正在删除，请稍候。');
        return;
      }
      setCurrentSessionId(sessionId);
      const requestId = sessionRequestRef.current;
      setIsSessionLoading(true);
      syncLastSessionToCloud(sessionId);
      api
        .getChatMessages(sessionId)
        .then((msgs) => {
          if (requestId !== sessionRequestRef.current) return;
          setMessages(() => [
            { id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() },
            ...convertMessages(msgs),
          ]);
          setIsSessionLoading(false);
        })
        .catch(() => {
          if (requestId !== sessionRequestRef.current) return;
          setCurrentSessionId(null);
          setMessages(() => [{ id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() }]);
          syncLastSessionToCloud(null);
          setSessionLoadError('对话记录加载失败，请在会话列表中重新选择；原记录仍然保留。');
        });
    },
    [setCurrentSessionId, setMessages],
  );

  // 云端与本地缓存共用加载入口，用户切换后旧请求不得覆盖当前对话。
  useEffect(() => {
    const requestId = sessionRequestRef.current;
    let cancelled = false;
    const restore = (sessionId: string | null) => {
      if (cancelled || requestId !== sessionRequestRef.current) return;
      if (sessionId) selectSession(sessionId);
      else setIsSessionLoading(false);
    };
    api
      .getUserConfigKey(LAST_SESSION_CLOUD_KEY)
      .then((r) => restore(typeof r?.value === 'string' && r.value ? r.value : getLocalSessionId()))
      .catch(() => restore(getLocalSessionId()));
    return () => {
      cancelled = true;
      sessionRequestRef.current += 1;
    };
  }, [selectSession]);

  const startNewChat = useCallback(() => {
    if (busyRef.current) {
      setSessionLoadError('请先停止当前回复，再新建对话。');
      return;
    }
    setCurrentSessionId(null);
    setMessages(() => [{ id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() }]);
    syncLastSessionToCloud(null);
  }, [setCurrentSessionId, setMessages]);

  const ensureSessionId = useCallback(async (): Promise<{ id: string; isNew: boolean }> => {
    if (currentSessionId) return { id: currentSessionId, isNew: false };
    const requestId = ++sessionRequestRef.current;
    const s = await api.createChatSession(undefined, 'normal_chat');
    if (requestId !== sessionRequestRef.current) throw new DOMException('当前会话已切换', 'AbortError');
    setCurrentSessionId(s.id);
    syncLastSessionToCloud(s.id);
    setSessions((prev) => [{ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, tags: s.tags ?? [] }, ...prev]);
    return { id: s.id, isNew: true };
  }, [currentSessionId, setCurrentSessionId]);

  const deleteSession = useCallback(
    (sessionId: string) => {
      if (deletingSessionIdsRef.current.has(sessionId)) return;
      if (sessionId === currentSessionId && busyRef.current) {
        setSessionLoadError('请先停止当前回复，再删除当前对话。');
        return;
      }
      const deletingCurrent = sessionId === currentSessionId;
      if (deletingCurrent && isSessionLoading) return;
      if (deletingCurrent) {
        setIsSessionLoading(true);
        setSessionLoadError(null);
      }
      const requestId = sessionRequestRef.current;
      deletingSessionIdsRef.current.add(sessionId);
      api
        .deleteChatSession(sessionId)
        .then(() => {
          if (sessionId === currentSessionId && requestId === sessionRequestRef.current) startNewChat();
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        })
        .catch(() => {
          if (deletingCurrent && requestId === sessionRequestRef.current) {
            setIsSessionLoading(false);
            setSessionLoadError('删除对话失败，原记录仍然保留，请重试。');
          }
        })
        .finally(() => deletingSessionIdsRef.current.delete(sessionId));
    },
    [currentSessionId, isSessionLoading, startNewChat],
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

  const toggleArchive = useCallback((sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const doArchive = !session.isArchived;
    const action = doArchive ? api.archiveSession(sessionId) : api.unarchiveSession(sessionId);
    action.then(() => loadSessions()).catch(() => {});
  }, [sessions, loadSessions]);

  const generateSummary = useCallback(async (sessionId: string, providerId: string, modelId: string, baseUrl?: string): Promise<string> => {
    const res = await api.generateSessionSummary(sessionId, providerId, modelId, baseUrl);
    // Optimistically update the session in state
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, summary: res.summary ?? null } : s)),
    );
    return res.summary ?? '';
  }, []);

  const autoTag = useCallback(async (sessionId: string, providerId: string, modelId: string, baseUrl?: string, merge = true): Promise<string[]> => {
    const res = await api.autoTagSession(sessionId, providerId, modelId, baseUrl, undefined, merge);
    // Optimistically update session tags in state
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, tags: res.tags } : s)),
    );
    return res.tags;
  }, []);

  const forkSession = useCallback(async (sessionId: string): Promise<string> => {
    const res = await api.forkChatSession(sessionId);
    const newSession = {
      id: res.id,
      title: res.title,
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
      tags: res.tags,
      summary: res.summary ?? null,
      parentSessionId: res.parentSessionId ?? null,
    };
    setSessions((prev) => [newSession, ...prev]);
    return res.id;
  }, []);

  return {
    sessions,
    currentSessionId,
    isSessionLoading,
    sessionLoadError,
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
    toggleArchive,
    setCurrentSessionId,
    refreshSessions: loadSessions,
    generateSummary,
    autoTag,
    forkSession,
  };
}
