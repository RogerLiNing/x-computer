import { create } from 'zustand';

export interface AiDocumentState {
  content: string;
  suggestedPath: string;
  isStreaming: boolean;
}

interface AiDocumentStore {
  /** 按窗口 ID 存储 AI 文档状态（流式写入、建议路径） */
  byWindowId: Record<string, AiDocumentState>;
  setContent: (windowId: string, content: string) => void;
  appendContent: (windowId: string, chunk: string) => void;
  setStreaming: (windowId: string, isStreaming: boolean) => void;
  setSuggestedPath: (windowId: string, path: string) => void;
  init: (windowId: string, suggestedPath: string) => void;
  get: (windowId: string) => AiDocumentState | undefined;
  remove: (windowId: string) => void;
  /** 当前用于 AI 文档的窗口 ID（用于后续对话「修改内容」时定位） */
  activeAiDocumentWindowId: string | null;
  setActiveAiDocumentWindowId: (id: string | null) => void;
}

export const useAiDocumentStore = create<AiDocumentStore>((set, get) => ({
  byWindowId: {},
  activeAiDocumentWindowId: null,

  setContent: (windowId, content) =>
    set((s) => ({
      byWindowId: {
        ...s.byWindowId,
        [windowId]: { ...(s.byWindowId[windowId] ?? { content: '', suggestedPath: '', isStreaming: false }), content },
      },
    })),

  appendContent: (windowId, chunk) =>
    set((s) => {
      const cur = s.byWindowId[windowId];
      if (!cur) return s;
      return {
        byWindowId: {
          ...s.byWindowId,
          [windowId]: { ...cur, content: cur.content + chunk },
        },
      };
    }),

  setStreaming: (windowId, isStreaming) =>
    set((s) => {
      const cur = s.byWindowId[windowId];
      if (!cur) return s;
      return {
        byWindowId: {
          ...s.byWindowId,
          [windowId]: { ...cur, isStreaming },
        },
      };
    }),

  setSuggestedPath: (windowId, path) =>
    set((s) => {
      const cur = s.byWindowId[windowId];
      if (!cur) return s;
      return {
        byWindowId: {
          ...s.byWindowId,
          [windowId]: { ...cur, suggestedPath: path },
        },
      };
    }),

  init: (windowId, suggestedPath) =>
    set((s) => ({
      byWindowId: {
        ...s.byWindowId,
        [windowId]: { content: '', suggestedPath, isStreaming: true },
      },
      activeAiDocumentWindowId: windowId,
    })),

  get: (windowId) => get().byWindowId[windowId],

  remove: (windowId) =>
    set((s) => {
      const next = { ...s.byWindowId };
      delete next[windowId];
      return {
        byWindowId: next,
        activeAiDocumentWindowId: s.activeAiDocumentWindowId === windowId ? null : s.activeAiDocumentWindowId,
      };
    }),

  setActiveAiDocumentWindowId: (id) => set({ activeAiDocumentWindowId: id }),
}));
