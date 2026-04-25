import { useState, useRef, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    _voiceRecognition?: { stop: () => void };
  }
}
import { useTranslation } from 'react-i18next';
import { Send, Bot, User, Sparkles, Loader2, Clock, CheckCircle2, XCircle, ArrowRight, ChevronDown, ChevronRight, ChevronUp, Wrench, Copy, RotateCcw, Trash2, MessageSquarePlus, PanelLeftClose, PanelLeft, Pencil, X, Download, ImagePlus, Square, Paperclip, FileText, Code, Search, Speaker, VolumeX, Calculator, Pin, Mic, MicOff, Bell, BarChart2, ThumbsUp, ThumbsDown, Edit2, Star } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useConfigStore } from '@/store/configStore';
import { useTaskStore } from '@/store/taskStore';
import { useLLMConfigStore } from '@/store/llmConfigStore';
import { useAiDocumentStore } from '@/store/aiDocumentStore';
import { getSystemLogStore } from '@/store/systemLogStore';
import { api, ApiError } from '@/utils/api';
import { TASK_TEMPLATES, type TaskTemplateCategory } from '@/config/taskTemplates';
import { buildComputerContext, formatComputerContextForPrompt, formatTaskSummaryForPrompt } from '@/utils/computerContext';
import type { TaskDomain } from '@shared/index';
import { useDomainDetection } from './ChatApp/useDomainDetection';
import { useImageHandling } from './ChatApp/useImageHandling';
import { useChatSessions, WELCOME_FALLBACK } from './ChatApp/useChatSessions';
import { useFormatChatError } from './ChatApp/useFormatChatError';
import { getMessagesForChat } from './ChatApp/chatHelpers';
import type { Message } from './ChatApp/Message';
import { TASK_KEYWORDS, DEFAULT_MAX_CHAT_ROUNDS, type AgentOption } from './ChatApp/chatConstants';
import { ToolCallBlock, MarkdownContent, MarkdownWithThink, type ToolCallRecord } from '@/components/shared';

interface Props {
  windowId: string;
  /** 嵌入手机模式布局时使用，隐藏完整 header 仅保留会话切换 */
  embeddedInMobile?: boolean;
}

export function ChatApp({ windowId, embeddedInMobile = false }: Props) {
  const { t } = useTranslation();
  const formatChatError = useFormatChatError();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'system',
      content: WELCOME_FALLBACK,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatSyncFailed, setChatSyncFailed] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  /** 对话框中上传的参考图（data URL），最多 3 张，发送时会上传到沙箱并作为 referenceImagePaths 传给后端 */
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  /** 对话框中附加的文档文件（发送时会上传到沙箱并作为 attachedFilePaths 传给后端） */
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; file: File }[]>([]);
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const [exportDropdownSessionId, setExportDropdownSessionId] = useState<string | null>(null);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageSearchResults, setMessageSearchResults] = useState<string[]>([]);
  const [messageSearchIndex, setMessageSearchIndex] = useState(0);
  /** 当前正在朗读的消息ID，null 表示未在朗读 */
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [snippets, setSnippets] = useState<Array<{ id: string; title: string; code: string; language: string; description?: string }>>([]);
  const [snippetFilter, setSnippetFilter] = useState('');
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcExpr, setCalcExpr] = useState('');
  /** 提醒浮层 */
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderMsg, setReminderMsg] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  /** 会话统计浮层 */
  const [statsOpen, setStatsOpen] = useState(false);
  /** 当前正在编辑的消息 ID（仅限 user 角色），null 表示未在编辑 */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  /** 编辑中的消息内容 */
  const [editingContent, setEditingContent] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  /** 当前正在录音的语音识别 ID，null 表示未在录音 */
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [showStarred, setShowStarred] = useState(false);
  /** 跨会话收藏消息列表 */
  const [allBookmarks, setAllBookmarks] = useState<Array<{ id: string; sessionId: string; role: string; content: string; createdAt: string }>>([]);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<Array<{ id: string; sessionId: string; sessionTitle: string | null; role: string; content: string; snippet: string; createdAt: string }>>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessionSearch, setSessionSearch] = useState('');
  /** 按需加载模式下本会话已加载的工具名，跨消息持久化 */
  const loadedToolNamesRef = useRef<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 已追加过「任务完成」跟帖的 taskId，避免重复 */
  const completedTaskFollowUpsRef = useRef<Set<string>>(new Set());
  const { detectDomain } = useDomainDetection();
  const { imageUrlToBlob, blobToBase64, saveImageToSandbox, getImageExtension } = useImageHandling();

  /** 停止当前正在进行的 AI 生成 */
  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const {
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
    refreshSessions,
  } = useChatSessions(setMessages);

  const filteredSessions = sessionSearch.trim()
    ? sessions.filter((s) => {
        const q = sessionSearch.toLowerCase();
        if (q.startsWith('#')) {
          return s.tags.map((t) => t.toLowerCase()).includes(q.slice(1));
        }
        return (s.title ?? '').toLowerCase().includes(q);
      })
    : sessions;
  const starredMessages = messages.filter((m) => m.bookmarked && m.content && m.id !== 'welcome');
  const tasks = useTaskStore((s) => s.tasks);

  /** 加载跨会话收藏消息 */
  const loadBookmarks = useCallback(() => {
    api.getBookmarkedMessages(100).then((b) => setAllBookmarks(b)).catch(() => {});
  }, []);

  /** 打开收藏面板时加载跨会话收藏 */
  useEffect(() => {
    if (showStarred) loadBookmarks();
  }, [showStarred, loadBookmarks]);

  /** 全局消息搜索（防抖 400ms） */
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!globalSearchQuery.trim()) { setGlobalSearchResults([]); return; }
    searchTimerRef.current = setTimeout(() => {
      api.searchMessages(globalSearchQuery.trim(), 30)
        .then((r) => setGlobalSearchResults(r))
        .catch(() => setGlobalSearchResults([]));
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [globalSearchQuery]);

  const { openApp, setWindowTitle } = useDesktopStore();
  const addNotification = useConnectionStore((s) => s.addNotification);
  const aiDoc = useAiDocumentStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Stop TTS on component unmount
  useEffect(() => {
    return () => { stopSpeaking(); };
  }, []);

  useEffect(() => {
    loadedToolNamesRef.current = [];
  }, [currentSessionId]);

  useEffect(() => {
    api.getWelcomeMessage().then((r) => {
      if (r?.content?.trim())
        setMessages((prev) => prev.map((m) => (m.id === 'welcome' ? { ...m, content: r.content!.trim() } : m)));
    }).catch(() => {});
  }, []);

  // Load code snippets from user config
  useEffect(() => {
    api.getUserConfig().then((cfg) => {
      const raw = cfg['snippets'];
      if (Array.isArray(raw)) setSnippets(raw as typeof snippets);
    }).catch(() => {});
  }, []);

  // Message search: filter messages by search query
  useEffect(() => {
    if (!messageSearch.trim() || !currentSessionId) {
      setMessageSearchResults([]);
      return;
    }
    const q = messageSearch.toLowerCase();
    const ids = messages
      .filter((m) => m.content && m.content.toLowerCase().includes(q) && m.id !== 'welcome')
      .map((m) => m.id);
    setMessageSearchResults(ids);
    setMessageSearchIndex(0);
  }, [messageSearch, messages, currentSessionId]);

  // Navigate search results
  const navigateSearch = (dir: 1 | -1) => {
    if (messageSearchResults.length === 0) return;
    const next = (messageSearchIndex + dir + messageSearchResults.length) % messageSearchResults.length;
    setMessageSearchIndex(next);
    const el = document.getElementById(`msg-${messageSearchResults[next]}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Text-to-speech for AI messages
  const speakText = (msgId: string, text: string) => {
    if (speakingMsgId) {
      window.speechSynthesis.cancel();
      if (speakingMsgId === msgId) {
        setSpeakingMsgId(null);
        return;
      }
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = /[一-鿿]/.test(text) ? 'zh-CN' : 'en-US';
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.onend = () => setSpeakingMsgId(null);
    utter.onerror = () => setSpeakingMsgId(null);
    window.speechSynthesis.speak(utter);
    setSpeakingMsgId(msgId);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setSpeakingMsgId(null);
  };

  /** 启动/停止语音输入（Web Speech API） */
  const toggleVoiceInput = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { addNotification({ type: 'error', title: '不支持语音', message: '当前浏览器不支持语音识别' }); return; }

    if (recordingId) {
      // 停止录音
      window._voiceRecognition?.stop();
      setRecordingId(null);
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';

    const id = `vr-${Date.now()}`;
    setRecordingId(id);

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript.trim()) {
        setInput((prev) => {
          const joined = prev ? `${prev} ${transcript}` : transcript;
          return joined;
        });
      }
    };

    recognition.onend = () => {
      if (recordingId === id) setRecordingId(null);
    };
    recognition.onerror = (event: any) => {
      if (recordingId === id) setRecordingId(null);
      if (event.error !== 'aborted') {
        addNotification({ type: 'error', title: '语音识别失败', message: event.error });
      }
    };

    (window as any)._voiceRecognition = recognition;
    recognition.start();
  };

  // Calculator: safe math evaluation
  const evalCalc = (expr: string): string => {
    try {
      // Replace common math functions with Math equivalents
      const sanitized = expr
        .replace(/\^/g, '**')
        .replace(/sqrt\(/gi, 'Math.sqrt(')
        .replace(/sin\(/gi, 'Math.sin(')
        .replace(/cos\(/gi, 'Math.cos(')
        .replace(/tan\(/gi, 'Math.tan(')
        .replace(/log\(/gi, 'Math.log10(')
        .replace(/ln\(/gi, 'Math.log(')
        .replace(/pi/gi, 'Math.PI')
        .replace(/e(?![x])/g, 'Math.E')
        .replace(/%/g, '/100*');
      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${sanitized})`)();
      if (typeof result !== 'number' || !isFinite(result)) return '';
      return Number.isInteger(result) ? String(result) : result.toFixed(6).replace(/\.?0+$/, '');
    } catch {
      return '';
    }
  };

  const handleCalcInput = (val: string) => {
    setCalcExpr(val);
  };

  const handleCalcKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const result = evalCalc(calcExpr);
      if (result !== '') {
        setInput((prev) => prev + (prev ? '\n' : '') + `${calcExpr} = ${result}`);
        setCalcExpr('');
        setCalcOpen(false);
      }
    }
  };

  const insertCalcResult = () => {
    const result = evalCalc(calcExpr);
    if (result !== '') {
      setInput((prev) => prev + (prev ? '\n' : '') + `${calcExpr} = ${result}`);
      setCalcExpr('');
      setCalcOpen(false);
    }
  };

  const submitReminder = async () => {
    if (!reminderMsg.trim()) return;
    if (!reminderDate || !reminderTime) {
      addNotification({ type: 'error', title: '请填写日期和时间', message: '' }); return;
    }
    const at = new Date(`${reminderDate}T${reminderTime}`).getTime();
    if (isNaN(at) || at <= Date.now()) {
      addNotification({ type: 'error', title: '时间必须是将来的时间', message: '' }); return;
    }
    try {
      await api.createReminder(reminderMsg.trim(), at, currentSessionId ?? undefined);
      addNotification({ type: 'info', title: '提醒已设置', message: `${reminderDate} ${reminderTime}` });
      setReminderMsg('');
      setReminderDate('');
      setReminderTime('');
      setReminderOpen(false);
    } catch {
      addNotification({ type: 'error', title: '设置提醒失败', message: '' });
    }
  };

  // 会话列表：挂载时加载；上次会话由 useChatSessions 内从云端/本地恢复
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 智能体列表：用于「选择智能体对话」
  useEffect(() => {
    api.listAgents().then((r) => setAgents(r?.agents?.map((a) => ({ id: a.id, name: a.name })) ?? [])).catch(() => setAgents([]));
  }, []);

  // 任务完成后自动追加 AI 助手「任务完成了，根据结果xxxx」跟帖
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.taskId) continue;
      const task = tasks.find((t) => t.id === msg.taskId);
      if (!task || (task.status !== 'completed' && task.status !== 'failed')) continue;
      if (completedTaskFollowUpsRef.current.has(msg.taskId)) continue;
      completedTaskFollowUpsRef.current.add(msg.taskId);
      const idx = messages.indexOf(msg);
      const userMsg = idx > 0 ? messages[idx - 1] : undefined;
      const userContent = userMsg?.role === 'user' ? userMsg.content : undefined;
      api
        .taskCompletionReply({
          taskId: msg.taskId,
          sessionId: currentSessionId ?? undefined,
          userMessage: userContent,
          task: {
            title: task.title,
            description: task.description,
            status: task.status,
            result: task.result,
            steps: task.steps?.map((s) => ({ action: s.action, output: s.output, error: s.error })),
          },
        })
        .then((r) => {
          const reply: Message = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: r.content ?? (task.status === 'completed' ? '任务完成了。' : '任务执行失败。'),
            timestamp: Date.now(),
          };
          setMessages((prev) => {
            const i = prev.findIndex((m) => m.id === msg.id);
            if (i < 0) return prev;
            const next = [...prev];
            next.splice(i + 1, 0, reply);
            return next;
          });
          if (currentSessionId) {
            api
              .addChatMessage(currentSessionId, 'assistant', reply.content)
              .then(() => refreshSessions())
              .catch(() => {});
          }
        })
        .catch(() => {
          if (msg.taskId) completedTaskFollowUpsRef.current.delete(msg.taskId);
          addNotification({ type: 'error', title: '任务完成摘要', message: '生成 AI 回复失败，可继续对话' });
        });
      break; // 一次只处理一个，避免竞态
    }
  }, [messages, tasks, currentSessionId, refreshSessions]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const insertSnippet = (code: string) => {
    setInput((prev) => prev + (prev ? '\n' : '') + code);
    setSnippetPickerOpen(false);
    setSnippetFilter('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  /** 将附带的文档文件上传到沙箱 文档/对话上传/，返回沙箱路径列表（失败则跳过该个） */
  const uploadAttachedFilesToSandbox = useCallback(async (files: { name: string; file: File }[]): Promise<string[]> => {
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const { name, file } = files[i]!;
      try {
        const base = `文档/对话上传`;
        // 仅替换文件系统非法字符，保留中文等 Unicode
        const safeName = (name.replace(/[/\\:*?"<>|\x00]/g, '_').trim() || 'file');
        const targetPath = `${base}/${Date.now()}-${i + 1}-${safeName}`;
        const result = await api.uploadFile(file, targetPath);
        if (result?.path) paths.push(result.path);
      } catch {
        /* 单个失败跳过 */
      }
    }
    return paths;
  }, []);

  /** 将附带的图片上传到沙箱 图片/对话上传/，返回沙箱路径列表（失败则跳过该张） */
  const uploadAttachedImagesToSandbox = useCallback(async (dataUrls: string[]): Promise<string[]> => {
    const ts = Date.now();
    const paths: string[] = [];
    for (let i = 0; i < dataUrls.length; i++) {
      const dataUrl = dataUrls[i]!;
      try {
        const blob = await imageUrlToBlob(dataUrl);
        const ext = getImageExtension(dataUrl, blob);
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : await blobToBase64(blob);
        const path = `图片/对话上传/${ts}-${i + 1}${ext}`;
        await api.writeFileBinary(path, base64);
        paths.push(path);
      } catch {
        /* 单张失败跳过 */
      }
    }
    return paths;
  }, []);

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input.trim()).trim();
    const hasText = text.length > 0;
    const hasImages = !overrideText && attachedImages.length > 0;
    const hasFiles = !overrideText && attachedFiles.length > 0;
    if ((!hasText && !hasImages && !hasFiles) || isLoading) return;

    const parts: string[] = [];
    if (hasImages) parts.push('图片');
    if (hasFiles) parts.push('文件');
    const attachHint = parts.length ? `（附带了${parts.join('和')}，请根据内容处理）` : '';
    const displayContent = text || attachHint;

    /** 先上传附件，拿到路径后再展示消息（确保对话中能看到附件） */
    let referenceImagePaths: string[] = [];
    let attachedFilePaths: string[] = [];
    if (hasImages) {
      try {
        referenceImagePaths = await uploadAttachedImagesToSandbox(attachedImages);
      } catch {
        /* 上传失败继续发消息，仅无参考图 */
      }
    }
    if (hasFiles) {
      try {
        attachedFilePaths = await uploadAttachedFilesToSandbox(attachedFiles);
      } catch {
        /* 上传失败继续发消息，仅无附加文件路径 */
      }
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: Date.now(),
      images: referenceImagePaths.length > 0 ? referenceImagePaths : undefined,
      attachedFiles:
        attachedFiles.length > 0
          ? attachedFiles.map((f, i) => ({ name: f.name, path: attachedFilePaths[i] ?? '' }))
          : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!overrideText) {
      setInput('');
      setAttachedImages([]);
      setAttachedFiles([]);
    }
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    // D.2: 先拿到会话 id，后续所有分支统一持久化到云端
    const llmConfig = useLLMConfigStore.getState().llmConfig;
    const chatSel = llmConfig?.defaultByModality?.chat;
    const chatProviderId = chatSel?.providerId ?? llmConfig?.providers?.[0]?.id;
    const chatProvider = llmConfig?.providers?.find((p: { id: string }) => p.id === chatProviderId);
    const chatModelId = chatSel?.modelId ?? '__custom__';
    const chatBaseUrl = chatProvider?.baseUrl ?? '';
    let sid: string = '';
    try {
      const res = await ensureSessionId();
      sid = res.id;
      if (res.isNew) {
        api.generateSessionTitle(sid, chatProviderId ?? '', chatModelId, chatBaseUrl).catch(() => {});
      }
    } catch {
      setChatSyncFailed(true);
    }

    const userAttachmentsForPersist = {
      images: referenceImagePaths,
      files: attachedFiles.map((f, i) => ({ name: f.name, path: attachedFilePaths[i] ?? '' })),
    };
    /** 将本轮用户+助手消息写入当前会话（云端持久化） */
    const persistRound = (assistantContent: string, images?: string[]) => {
      if (!sid) return;
      api
        .addChatMessage(
          sid,
          'user',
          displayContent,
          undefined,
          userAttachmentsForPersist.images.length ? userAttachmentsForPersist.images : undefined,
          userAttachmentsForPersist.files.length ? userAttachmentsForPersist.files : undefined,
        )
        .then(() => api.addChatMessage(sid, 'assistant', assistantContent, undefined, images))
        .then(() => {
          setChatSyncFailed(false);
          refreshSessions();
        })
        .catch(() => setChatSyncFailed(true));
    };

    const activeAiWindowId = useAiDocumentStore.getState().activeAiDocumentWindowId;
    const activeAiContent = activeAiWindowId ? useAiDocumentStore.getState().get(activeAiWindowId)?.content : undefined;
    const hasOpenAiDocument = !!(activeAiWindowId && (activeAiContent != null && activeAiContent.length > 0));

    const desktopState = useDesktopStore.getState();
    const configState = useConfigStore.getState();
    const connectionState = useConnectionStore.getState();
    const computerContextStr = formatComputerContextForPrompt(
      buildComputerContext({
        windows: desktopState.windows,
        activeWindowId: desktopState.activeWindowId,
        executionMode: configState.executionMode,
        tasks: useTaskStore.getState().tasks,
        taskbarPinned: configState.taskbarPinned,
        notifications: connectionState.notifications,
      }),
    );
    const taskSummaryStr = formatTaskSummaryForPrompt(useTaskStore.getState().tasks);

    const vectorSel = llmConfig?.defaultByModality?.vector;
    const vectorConfig =
      vectorSel?.providerId && vectorSel?.modelId
        ? {
            providerId: vectorSel.providerId,
            modelId: vectorSel.modelId,
            baseUrl: llmConfig?.providers?.find((p: { id: string }) => p.id === vectorSel.providerId)?.baseUrl ?? '',
            apiKey: '', // API Key 由服务器端统一管理，前端不存储
          }
        : undefined;

    if (/^记住：?/.test(text)) {
      const content = text.replace(/^记住：?/, '').trim();
      if (content) {
        try {
          await api.memoryCapture({ content, vectorConfig });
          const reply = `已记住：${content}`;
          setMessages((prev) => [
            ...prev,
            { id: `msg-${Date.now()}`, role: 'assistant', content: reply, timestamp: Date.now() },
          ]);
          persistRound(reply);
        } catch {
          const reply = '记忆写入失败，请稍后再试。';
          setMessages((prev) => [
            ...prev,
            { id: `msg-${Date.now()}`, role: 'assistant', content: reply, timestamp: Date.now() },
          ]);
          persistRound(reply);
        }
        setIsLoading(false);
        return;
      }
    }

    let memoryStr = '';
    try {
      const recallRes = await api.memoryRecall({ query: text, days: 2, vectorConfig });
      memoryStr = recallRes?.content ?? '';
    } catch {
      /* 召回失败则继续无记忆对话 */
    }

    try {
      const sel = llmConfig?.defaultByModality?.chat;
      const providerId = sel?.providerId ?? llmConfig?.providers?.[0]?.id;
      const provider = llmConfig?.providers?.find((p: { id: string }) => p.id === providerId);
      if (!providerId || !provider) {
        const reply = '请先在「系统设置 → 大模型配置」中配置聊天模型。';
        setMessages((prev) => [
          ...prev,
          { id: `msg-${Date.now()}`, role: 'assistant', content: reply, timestamp: Date.now() },
        ]);
        persistRound(reply);
        setIsLoading(false);
        return;
      }

      const { intent, suggestedPath } = await api.classifyWritingIntent({
        userMessage: text,
        hasOpenAiDocument,
        providerId,
        modelId: sel?.modelId ?? '__custom__',
      });

      // 图片生成：仅当用户未附带参考图时走直接文生图；附带了图片则必须走 Agent 流程，以便主脑使用 llm.edit_image 等工具基于参考图修改
      if (intent === 'generate_image' && referenceImagePaths.length === 0) {
        const imageSel = llmConfig?.defaultByModality?.image;
        const imgProviderId = imageSel?.providerId ?? llmConfig?.providers?.[0]?.id;
        const imgProvider = llmConfig?.providers?.find((p: { id: string }) => p.id === imgProviderId);
        if (!imageSel || !imgProviderId || !imgProvider) {
          const reply = '请先在「系统设置 → 大模型配置」中为「图片」模态选择并保存一个模型（如 OpenRouter 的 bytedance-seed/seedream-4.5）。';
          setMessages((prev) => [
            ...prev,
            { id: `msg-${Date.now()}`, role: 'assistant', content: reply, timestamp: Date.now() },
          ]);
          persistRound(reply);
          setIsLoading(false);
          return;
        }
        try {
          const result = await api.generateImage({
            prompt: text,
            providerId: imgProviderId,
            modelId: imageSel.modelId ?? '__custom__',
          });
          const assistantContent = result.content?.trim() || (result.images?.length ? '已根据你的描述生成以下图片。' : '未生成到图片。');
          const images = result.images ?? [];
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: assistantContent,
              timestamp: Date.now(),
              images,
            },
          ]);
          persistRound(assistantContent, images.length ? images : undefined);
        } catch (err: any) {
          const errContent = `图片生成失败：${err?.message ?? String(err)}`;
          setMessages((prev) => [
            ...prev,
            { id: `msg-${Date.now()}`, role: 'assistant', content: errContent, timestamp: Date.now() },
          ]);
          persistRound(errContent);
        }
        setIsLoading(false);
        return;
      }

      // 0) 写入编辑器：主脑 write_to_editor 场景 + function call
      if (intent === 'save_to_editor') {
        const log = getSystemLogStore();
        log.addLog({ level: 'info', category: 'application', source: 'save_to_editor', message: `意图识别为 save_to_editor，开始调用 chatWithTools`, detail: `providerId=${providerId}, modelId=${sel?.modelId ?? '__custom__'}` });

        const chatMessages = getMessagesForChat(messages, userMsg, DEFAULT_MAX_CHAT_ROUNDS);
        const writeToEditorTool = {
          name: 'write_to_editor',
          description: '将指定正文写入编辑器。content 为要出现在文档中的完整正文；suggestedPath 为建议的保存路径（含文件名与格式），用于编辑器标题与默认保存位置。',
          parameters: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '要写入编辑器的完整正文' },
              suggestedPath: { type: 'string', description: '建议路径，如 文档/文章标题.md、文档/会议纪要.txt；不填则显示未命名.txt' },
            },
            required: ['content'],
          },
        };
        try {
          const result = await api.chatWithTools({
            messages: chatMessages,
            tools: [writeToEditorTool],
            providerId,
            modelId: sel?.modelId ?? '__custom__',
            scene: 'write_to_editor',
            computerContext: computerContextStr,
            taskSummary: taskSummaryStr,
            memory: memoryStr,
          });

          // 记录完整返回结果
          const tcCount = result?.toolCalls?.length ?? 0;
          const tcNames = (result?.toolCalls ?? []).map((tc: { name: string }) => tc.name).join(', ') || '(无)';
          log.addLog({
            level: tcCount > 0 ? 'info' : 'warning',
            category: 'application',
            source: 'save_to_editor',
            message: `chatWithTools 返回 toolCalls=${tcCount} [${tcNames}]`,
            detail: `content: ${(result?.content ?? '').slice(0, 300)}\ntoolCalls: ${JSON.stringify(result?.toolCalls ?? [], null, 2)}`,
          });

          const writeCall = result?.toolCalls?.find((tc: { name: string }) => tc.name === 'write_to_editor');
          const contentToWrite = writeCall?.arguments?.content != null ? String(writeCall.arguments.content).trim() : '';
          const rawPath = writeCall?.arguments?.suggestedPath != null ? String(writeCall.arguments.suggestedPath).trim() : '';
          const suggestedPath = rawPath
            ? (rawPath.startsWith('文档/') ? rawPath : `文档/${rawPath}`)
            : '文档/未命名.txt';
          const toolCallRecords: ToolCallRecord[] = (result?.toolCallHistory ?? []).map((h) => ({
            id: h.id,
            toolName: h.name,
            status: (h.error ? 'failed' : 'completed') as 'running' | 'completed' | 'failed',
            input: h.input,
            output: h.output,
            error: h.error,
            duration: h.duration,
          }));
          if (contentToWrite) {
            const fileName = suggestedPath.split('/').pop() || '未命名.txt';
            log.addLog({ level: 'info', category: 'application', source: 'save_to_editor', message: `成功获取写入内容，长度=${contentToWrite.length}，正在打开编辑器`, detail: `suggestedPath=${suggestedPath}` });
            const editorWindowId = openApp('text-editor', { aiDocument: true, suggestedPath });
            aiDoc.init(editorWindowId, suggestedPath);
            aiDoc.setContent(editorWindowId, contentToWrite);
            aiDoc.setStreaming(editorWindowId, false);
            setWindowTitle(editorWindowId, `文本编辑器 — ${fileName} ●`);
            const replyContent = result?.content?.trim() || '已写入编辑器，请确认后点击保存并可为文件命名。';
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: replyContent,
                timestamp: Date.now(),
                toolCalls: toolCallRecords.length ? toolCallRecords : undefined,
              },
            ]);
            persistRound(replyContent);
          } else {
            log.addLog({
              level: 'warning',
              category: 'application',
              source: 'save_to_editor',
              message: '模型未调用 write_to_editor 工具，写入内容为空',
              detail: `模型回复: ${(result?.content ?? '').slice(0, 500)}`,
            });
            const replyContent = (result?.content ?? '').trim() || '请说明要把哪段内容写入编辑器。';
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: replyContent,
                timestamp: Date.now(),
                toolCalls: toolCallRecords.length ? toolCallRecords : undefined,
              },
            ]);
            persistRound(replyContent);
          }
          const replyForMemory = (result?.content ?? '').trim() || '已写入编辑器。';
          if (replyForMemory) {
            api.memoryConsiderCapture({
              userMessage: text,
              assistantReply: replyForMemory,
              providerId,
              modelId: sel?.modelId ?? '__custom__',
              vectorConfig,
            }).catch(() => {});
          }
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          log.addLog({
            level: 'error',
            category: 'application',
            source: 'save_to_editor',
            message: `调用失败: ${msg}`,
            detail: err?.stack,
            url: '/api/chat/with-tools',
            method: 'POST',
          });
          const replyContent = `写入编辑器时出错：${msg}`;
          setMessages((prev) => [
            ...prev,
            { id: `msg-${Date.now()}`, role: 'assistant', content: replyContent, timestamp: Date.now() },
          ]);
          persistRound(replyContent);
        }
        setIsLoading(false);
        return;
      }

      // 1) 生成内容并写入编辑器：由主 AI 驱动「编辑器 Agent」，实时流式输出到编辑器
      if (intent === 'generate_and_save_to_editor' && suggestedPath) {
        const editorWindowId = openApp('text-editor', { aiDocument: true, suggestedPath });
        const fileName = suggestedPath.split('/').pop() || suggestedPath;
        setWindowTitle(editorWindowId, `文本编辑器 — ${fileName} (编辑器助手生成中)`);
        aiDoc.init(editorWindowId, suggestedPath);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: '正在让编辑器助手根据你的要求撰写内容，并实时输出到编辑器中…',
            timestamp: Date.now(),
          },
        ]);
        try {
          await api.editorAgentStream({
            windowId: editorWindowId,
            instruction: text,
            providerId,
            modelId: sel?.modelId ?? '__custom__',
          });
          const replyContent = `编辑器助手已开始写入「${fileName}」，请在编辑器中查看实时输出，确认后点击保存。`;
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: replyContent,
              timestamp: Date.now(),
            },
          ]);
          persistRound(replyContent);
        } catch (err: any) {
          aiDoc.setStreaming(editorWindowId, false);
          setWindowTitle(editorWindowId, `文本编辑器 — ${fileName} ●`);
          const replyContent = `启动编辑器助手失败：${err.message}`;
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: replyContent,
              timestamp: Date.now(),
            },
          ]);
          persistRound(replyContent);
        }
        setIsLoading(false);
        return;
      }

      // 2) 后续对话：修改当前 AI 文档内容（主脑 edit_current_document 场景）
      if (intent === 'edit_current_document' && activeAiWindowId && activeAiContent != null) {
          const editMessages = [
            { role: 'user' as const, content: `【当前文档内容】\n${activeAiContent}\n\n【用户要求】\n${text}` },
          ];
          aiDoc.setContent(activeAiWindowId, '');
          aiDoc.setStreaming(activeAiWindowId, true);
          let fullContent = '';
          await api.chatStream(
            {
              messages: editMessages,
              providerId,
              modelId: sel?.modelId ?? '__custom__',
              scene: 'edit_current_document',
              computerContext: computerContextStr,
              taskSummary: taskSummaryStr,
              memory: memoryStr,
            },
            (chunk) => {
              fullContent += chunk;
              aiDoc.appendContent(activeAiWindowId, chunk);
            },
            signal,
          );
          aiDoc.setStreaming(activeAiWindowId, false);
          const replyContent = '已按你的要求更新编辑器中的内容，请确认后保存。';
          setMessages((prev) => [
            ...prev,
            { id: `msg-${Date.now()}`, role: 'assistant', content: replyContent, timestamp: Date.now() },
          ]);
          persistRound(replyContent);
          if (fullContent.trim()) {
            api.memoryConsiderCapture({
              userMessage: text,
              assistantReply: fullContent.trim(),
              providerId,
              modelId: sel?.modelId ?? '__custom__',
              vectorConfig,
            }).catch(() => {});
          }
          setIsLoading(false);
          return;
      }

      if (intent === 'create_task') {
        // Submit as a real task to backend（带上 LLM 配置，供任务内 llm.generate 等工具使用）
        const domain = detectDomain(text);
        const llmState = useLLMConfigStore.getState();
        const cfg = llmState.llmConfig;
        const sel = cfg?.defaultByModality?.chat;
        const providerId = sel?.providerId ?? cfg?.providers?.[0]?.id;
        const provider = cfg?.providers?.find((p: { id: string }) => p.id === providerId);
        const taskLlmConfig =
          providerId && provider
            ? {
                providerId,
                modelId: sel?.modelId ?? '__custom__',
                baseUrl: provider?.baseUrl ?? undefined,
                apiKey: '', // API Key 由服务器端统一管理
              }
            : undefined;
        const chatContext = messages
          .slice(-20)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));
        const task = await api.createTask({
          domain,
          title: text.slice(0, 50),
          description: text,
          mode: 'auto',
          llmConfig: taskLlmConfig,
          chatContext: chatContext.length > 0 ? chatContext : undefined,
        }) as any;

        // 写入桌面 store，后续 task_complete 通过 WebSocket 更新同一任务，对话里「查看任务详情」状态会从旋转变为已完成
        useTaskStore.getState().upsertTask(task.id, task);

        const domainLabel = { chat: '聊天', coding: '编程', agent: '智能体', office: '办公' }[domain];

        const reply: Message = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: `任务已创建 ✓\n\n**${text}**\n\n• 域: ${domainLabel}\n• 步骤数: ${task.steps?.length || 0}\n• 状态: ${task.status === 'awaiting_approval' ? '⏳ 等待审批' : '⚡ 执行中'}\n\n${
            task.status === 'awaiting_approval'
              ? '请在任务时间线中确认后继续执行。'
              : 'AI 正在执行，你可以在任务时间线中查看进度。'
          }`,
          timestamp: Date.now(),
          taskId: task.id,
          taskStatus: task.status,
        };
        setMessages((prev) => [...prev, reply]);
        persistRound(reply.content);
      } else {
        // 普通对话：走设置中的大模型（P2）
        const llmConfig = useLLMConfigStore.getState().llmConfig;
        const sel = llmConfig.defaultByModality?.chat;
        const providerId = sel?.providerId ?? llmConfig.providers[0]?.id;
        const modelId = sel?.modelId ?? '__custom__';
        const provider = llmConfig.providers.find((p) => p.id === providerId);

        if (!providerId || !provider) {
          const replyContent = '请先在「系统设置 → 大模型配置」中添加提供商并选择聊天默认模型。';
          setMessages((prev) => [
            ...prev,
            { id: `msg-${Date.now()}`, role: 'assistant', content: replyContent, timestamp: Date.now() },
          ]);
          persistRound(replyContent);
        } else {
          // 普通对话走 Agent 流式：展示工具调用进度，支持 Cursor 风格可展开操作
          const replyId = `msg-${Date.now()}`;
          const replyTimestamp = Date.now();
          setMessages((prev) => [
            ...prev,
            {
              id: replyId,
              role: 'assistant',
              content: '',
              timestamp: replyTimestamp,
              toolCalls: [],
            },
          ]);
          try {
            const chatMessages = getMessagesForChat(messages, userMsg, DEFAULT_MAX_CHAT_ROUNDS);
            const fullReply = await api.chatAgentStream(
              {
                messages: chatMessages,
                providerId,
                modelId,
                scene: 'normal_chat',
                computerContext: computerContextStr,
                taskSummary: taskSummaryStr,
                memory: memoryStr,
                agentId: selectedAgentId ?? undefined,
                referenceImagePaths: referenceImagePaths.length > 0 ? referenceImagePaths : undefined,
                attachedFilePaths: attachedFilePaths.length > 0 ? attachedFilePaths : undefined,
                loadedToolNames: loadedToolNamesRef.current.length > 0 ? loadedToolNamesRef.current : undefined,
              },
              (ev) => {
                setMessages((prev) => {
                  const idx = prev.findIndex((m) => m.id === replyId);
                  if (idx < 0) return prev;
                  const tcList = [...(prev[idx].toolCalls ?? [])];
                  if (ev.type === 'tool_start' && ev.id && ev.toolName) {
                    const existing = tcList.findIndex((t) => t.id === ev.id);
                    if (existing >= 0) {
                      tcList[existing] = { ...tcList[existing], status: 'running' };
                    } else {
                      tcList.push({
                        id: ev.id,
                        toolName: ev.toolName,
                        status: 'running',
                        input: ev.input as Record<string, unknown>,
                      });
                    }
                  } else if (ev.type === 'tool_complete' && ev.id) {
                    const i = tcList.findIndex((t) => t.id === ev.id);
                    if (i >= 0) {
                      tcList[i] = {
                        ...tcList[i],
                        status: ev.error ? 'failed' : 'completed',
                        output: ev.output,
                        error: ev.error,
                        duration: ev.duration,
                      };
                    }
                  }
                  const next = [...prev];
                  next[idx] = { ...next[idx], toolCalls: tcList };
                  return next;
                });
              },
              {
                signal,
                onContentChunk: (chunk) => {
                  setMessages((prev) => {
                    const idx = prev.findIndex((m) => m.id === replyId);
                    if (idx < 0) return prev;
                    const next = [...prev];
                    next[idx] = { ...next[idx], content: (next[idx].content || '') + chunk };
                    return next;
                  });
                },
              },
            );
            const content = typeof fullReply === 'string' ? fullReply : fullReply?.content ?? '';
            if (fullReply && typeof fullReply === 'object' && Array.isArray(fullReply.loadedToolNames)) {
              loadedToolNamesRef.current = fullReply.loadedToolNames;
            }
            const trimmed = (content ?? '').trim();
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === replyId);
              if (idx < 0) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], content: trimmed || '（无回复内容）' };
              return next;
            });
            if (trimmed) {
              api.memoryConsiderCapture({
                userMessage: text,
                assistantReply: trimmed,
                providerId,
                modelId,
                vectorConfig,
              }).catch(() => {});
              api
                .suggestFollowUps({
                  userMessage: text,
                  assistantReply: trimmed,
                  providerId,
                  modelId,
                })
                .then((r) => {
                  if (r?.suggestions?.length) {
                    setMessages((prev) => {
                      const idx = prev.findIndex((m) => m.id === replyId);
                      if (idx < 0) return prev;
                      const next = [...prev];
                      next[idx] = { ...next[idx], suggestedFollowUps: r.suggestions };
                      return next;
                    });
                  }
                })
                .catch(() => {});
            }
            persistRound(trimmed || '（无回复内容）');
          } catch (err: any) {
            if (err?.name === 'AbortError') {
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === replyId);
                if (idx < 0) return prev;
                const next = [...prev];
                next[idx] = { ...next[idx], content: '（已停止）' };
                return next;
              });
              persistRound('（已停止）');
            } else {
              const { content: errContent, quotaError } = formatChatError(err);
              const fallback = quotaError ? errContent : `对话请求失败：${errContent}\n\n请检查设置中的 Base URL、模型与 API Key 是否正确。`;
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === replyId);
                if (idx < 0) return prev;
                const next = [...prev];
                next[idx] = { ...next[idx], content: fallback, quotaError };
                return next;
              });
              persistRound(fallback);
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setMessages((prev) => [
          ...prev,
          { id: `msg-${Date.now()}`, role: 'assistant', content: '（已停止）', timestamp: Date.now() },
        ]);
        persistRound('（已停止）');
      } else {
        const { content: errContent, quotaError } = formatChatError(err);
        const fallback = quotaError ? errContent : `操作失败: ${errContent}\n\n请检查后端服务是否正常运行。`;
        setMessages((prev) => [
          ...prev,
          { id: `msg-${Date.now()}`, role: 'assistant', content: fallback, timestamp: Date.now(), quotaError },
        ]);
        persistRound(fallback);
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, input, attachedImages, attachedFiles, isLoading, addNotification, ensureSessionId, refreshSessions, selectedAgentId, uploadAttachedImagesToSandbox, uploadAttachedFilesToSandbox, formatChatError]);

  /** 复制消息正文到剪贴板 */
  const copyMessage = useCallback((msg: Message) => {
    const text = typeof msg.content === 'string' ? msg.content : String(msg.content ?? '');
    if (!text) {
      addNotification({ type: 'error', title: '复制失败', message: '消息内容为空' });
      return;
    }

    // 优先使用 navigator.clipboard，不可用时使用 fallback
    const doCopy = () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(
          () => addNotification({ type: 'info', title: '已复制', message: '消息已复制到剪贴板' }),
          () => fallbackCopy(text),
        );
      } else {
        fallbackCopy(text);
      }
    };

    const fallbackCopy = (copyText: string) => {
      const textarea = document.createElement('textarea');
      textarea.value = copyText;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const ok = document.execCommand('copy');
        if (ok) {
          addNotification({ type: 'info', title: '已复制', message: '消息已复制到剪贴板' });
        } else {
          addNotification({ type: 'error', title: '复制失败', message: '无法写入剪贴板' });
        }
      } catch {
        addNotification({ type: 'error', title: '复制失败', message: '无法写入剪贴板' });
      } finally {
        document.body.removeChild(textarea);
      }
    };

    doCopy();
  }, [addNotification]);

  /** 删除一条消息（不删欢迎语）；若有当前会话则同步删除云端 */
  const deleteMessage = useCallback(
    (msgId: string) => {
      if (msgId === 'welcome') return;
      if (currentSessionId) {
        api.deleteChatMessage(currentSessionId, msgId).catch(() => {});
      }
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    },
    [currentSessionId],
  );

  /** 编辑消息并重新生成：更新内容 → 删除后续消息 → 触发重新发送 */
  const handleEditSubmit = useCallback(async () => {
    if (!editingMessageId || !editingContent.trim() || isLoading) return;
    const trimmed = editingContent.trim();
    const idx = messages.findIndex((m) => m.id === editingMessageId);
    if (idx < 0) return;
    // 更新消息内容
    setMessages((prev) => prev.map((m) => (m.id === editingMessageId ? { ...m, content: trimmed } : m)));
    if (currentSessionId) await api.updateChatMessage(editingMessageId, trimmed).catch(() => {});
    // 删除后续所有消息（包括后续的 AI 回复和用户消息）
    const subsequent = messages.slice(idx + 1);
    const removal = subsequent.map((m) => {
      if (currentSessionId && m.id !== 'welcome') api.deleteChatMessage(currentSessionId, m.id).catch(() => {});
      return m.id;
    });
    setMessages((prev) => prev.filter((m) => !removal.includes(m.id)));
    setEditingMessageId(null);
    setEditingContent('');
    // 触发重新发送
    await sendMessage(trimmed);
  }, [editingMessageId, editingContent, messages, currentSessionId, isLoading, sendMessage]);

  /** 重试：删除当前 AI 消息并用上一条用户消息重新请求 */
  const retryAssistantMessage = useCallback(async (assistantMsg: Message) => {
    if (assistantMsg.role !== 'assistant' || isLoading) return;
    const idx = messages.findIndex((m) => m.id === assistantMsg.id);
    if (idx <= 0) return;
    const prevMsg = messages[idx - 1];
    if (prevMsg.role !== 'user') return;
    const messagesAfterRemoval = messages.filter((m) => m.id !== assistantMsg.id);
    const replyId = `msg-${Date.now()}`;
    setMessages((prev) => [
      ...prev.filter((m) => m.id !== assistantMsg.id),
      { id: replyId, role: 'assistant' as const, content: '', timestamp: Date.now(), toolCalls: [] },
    ]);
    setIsLoading(true);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const desktopState = useDesktopStore.getState();
    const configState = useConfigStore.getState();
    const connectionState = useConnectionStore.getState();
    const computerContextStr = formatComputerContextForPrompt(
      buildComputerContext({
        windows: desktopState.windows,
        activeWindowId: desktopState.activeWindowId,
        executionMode: configState.executionMode,
        tasks: useTaskStore.getState().tasks,
        taskbarPinned: configState.taskbarPinned,
        notifications: connectionState.notifications,
      }),
    );
    const taskSummaryStr = formatTaskSummaryForPrompt(useTaskStore.getState().tasks);
    const llmConfig = useLLMConfigStore.getState().llmConfig;
    const vectorSel = llmConfig?.defaultByModality?.vector;
    const vectorConfig =
      vectorSel?.providerId && vectorSel?.modelId
        ? {
            providerId: vectorSel.providerId,
            modelId: vectorSel.modelId,
            baseUrl: llmConfig?.providers?.find((p: { id: string }) => p.id === vectorSel.providerId)?.baseUrl ?? '',
            apiKey: '', // API Key 由服务器端统一管理，前端不存储
          }
        : undefined;
    let memoryStr = '';
    try {
      const recallRes = await api.memoryRecall({ query: prevMsg.content, days: 2, vectorConfig });
      memoryStr = recallRes?.content ?? '';
    } catch {
      /* ignore */
    }
    const sel = llmConfig?.defaultByModality?.chat;
    const providerId = sel?.providerId ?? llmConfig?.providers?.[0]?.id;
    const provider = llmConfig?.providers?.find((p: { id: string }) => p.id === providerId);
    if (!providerId || !provider) {
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === replyId);
        if (i < 0) return prev;
        const next = [...prev];
        next[i] = { ...next[i], content: '请先在「系统设置 → 大模型配置」中配置聊天模型。' };
        return next;
      });
      setIsLoading(false);
      return;
    }
    try {
      const chatMessages = getMessagesForChat(messagesAfterRemoval, prevMsg, DEFAULT_MAX_CHAT_ROUNDS);
      const fullReply = await api.chatAgentStream(
        {
          messages: chatMessages,
          providerId,
          modelId: sel?.modelId ?? '__custom__',
          scene: 'normal_chat',
          computerContext: computerContextStr,
          taskSummary: taskSummaryStr,
          memory: memoryStr,
          agentId: selectedAgentId ?? undefined,
          loadedToolNames: loadedToolNamesRef.current.length > 0 ? loadedToolNamesRef.current : undefined,
        },
        (ev) => {
          setMessages((prev) => {
            const i = prev.findIndex((m) => m.id === replyId);
            if (i < 0) return prev;
            const tcList = [...(prev[i].toolCalls ?? [])];
            if (ev.type === 'tool_start' && ev.id && ev.toolName) {
              const existing = tcList.findIndex((t) => t.id === ev.id);
              if (existing >= 0) tcList[existing] = { ...tcList[existing], status: 'running' };
              else tcList.push({ id: ev.id, toolName: ev.toolName, status: 'running', input: ev.input as Record<string, unknown> });
            } else if (ev.type === 'tool_complete' && ev.id) {
              const j = tcList.findIndex((t) => t.id === ev.id);
              if (j >= 0) tcList[j] = { ...tcList[j], status: ev.error ? 'failed' : 'completed', output: ev.output, error: ev.error, duration: ev.duration };
            }
            const next = [...prev];
            next[i] = { ...next[i], toolCalls: tcList };
            return next;
          });
        },
        {
          signal,
          onContentChunk: (chunk) => {
            setMessages((prev) => {
              const i = prev.findIndex((m) => m.id === replyId);
              if (i < 0) return prev;
              const next = [...prev];
              next[i] = { ...next[i], content: (next[i].content || '') + chunk };
              return next;
            });
          },
        },
      );
      const content = typeof fullReply === 'string' ? fullReply : fullReply?.content ?? '';
      if (fullReply && typeof fullReply === 'object' && Array.isArray(fullReply.loadedToolNames)) {
        loadedToolNamesRef.current = fullReply.loadedToolNames;
      }
      const trimmed = (content ?? '').trim();
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === replyId);
        if (i < 0) return prev;
        const next = [...prev];
        next[i] = { ...next[i], content: trimmed || '（无回复内容）' };
        return next;
      });
      if (trimmed) {
        api.memoryConsiderCapture({
          userMessage: prevMsg.content,
          assistantReply: trimmed,
          providerId,
          modelId: sel?.modelId ?? '__custom__',
          vectorConfig,
        }).catch(() => {});
        api
          .suggestFollowUps({
            userMessage: prevMsg.content,
            assistantReply: trimmed,
            providerId,
            modelId: sel?.modelId ?? '__custom__',
          })
          .then((r) => {
            if (r?.suggestions?.length) {
              setMessages((prev) => {
                const i = prev.findIndex((m) => m.id === replyId);
                if (i < 0) return prev;
                const next = [...prev];
                next[i] = { ...next[i], suggestedFollowUps: r.suggestions };
                return next;
              });
            }
          })
          .catch(() => {});
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === replyId);
          if (i < 0) return prev;
          const next = [...prev];
          next[i] = { ...next[i], content: '（已停止）' };
          return next;
        });
      } else {
        const { content: errContent, quotaError } = formatChatError(err);
        const fallback = quotaError ? errContent : `对话请求失败：${errContent}\n\n请检查设置中的 Base URL、模型与 API Key 是否正确。`;
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === replyId);
          if (i < 0) return prev;
          const next = [...prev];
          next[i] = { ...next[i], content: fallback, quotaError };
          return next;
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, addNotification, ensureSessionId, refreshSessions, selectedAgentId, formatChatError]);

  // Quick action suggestions (i18n)
  const quickActions = [
    { labelKey: 'chat.exampleOrganizeEmail', textKey: 'chat.exampleOrganizeEmail' },
    { labelKey: 'chat.exampleWriteCode', textKey: 'chat.exampleWriteCode' },
    { labelKey: 'chat.exampleWeeklyReport', textKey: 'chat.exampleWeeklyReport' },
    { labelKey: 'chat.exampleSummarizeDoc', textKey: 'chat.exampleSummarizeDoc' },
    { labelKey: 'chat.exampleExplainCode', textKey: 'chat.exampleExplainCode' },
    { labelKey: 'chat.exampleSearchWeb', textKey: 'chat.exampleSearchWeb' },
  ];

  return (
    <div className="h-full flex">
      {/* 会话列表侧边栏 */}
      {sidebarOpen && (
        <div className="w-full sm:w-56 shrink-0 border-r border-white/5 bg-white/[0.02] flex flex-col absolute sm:relative inset-x-0 top-12 sm:top-0 bottom-0 sm:bottom-auto z-20 sm:z-auto">
          <button
            className="flex items-center gap-2 px-3 py-2.5 m-2 rounded-lg bg-desktop-highlight/20 hover:bg-desktop-highlight/30 text-desktop-text text-xs transition-colors"
            onClick={startNewChat}
          >
            <MessageSquarePlus size={14} />
            新对话
          </button>
          <button
            className="flex items-center gap-2 px-3 py-1.5 mx-2 rounded-lg hover:bg-white/10 text-desktop-muted text-xs transition-colors"
            onClick={() => setStatsOpen(true)}
            title="会话统计"
          >
            <BarChart2 size={13} />
          </button>
          <button
            className={`flex items-center gap-2 px-3 py-1.5 mx-2 rounded-lg text-xs transition-colors ${showStarred ? 'bg-desktop-accent/20 text-desktop-accent' : 'hover:bg-white/10 text-desktop-muted'}`}
            onClick={() => setShowStarred((v) => !v)}
            title="收藏消息"
          >
            <Star size={13} />
            {allBookmarks.length > 0 && (
              <span className="text-[10px] bg-desktop-accent/30 px-1 rounded-full">{allBookmarks.length}</span>
            )}
          </button>
          <div className="px-2 mb-1">
            <input
              type="text"
              placeholder="搜索会话..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
            />
          </div>
          <div className="px-2 mb-1">
            <input
              type="text"
              placeholder="搜索所有消息... 🔍"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:border-desktop-accent/40"
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
            />
          </div>
          {globalSearchQuery.trim() && (
            <div className="px-2 mb-1 max-h-48 overflow-auto">
              {globalSearchResults.length === 0 ? (
                <div className="text-[10px] text-desktop-muted/60 px-3 py-2">无结果</div>
              ) : (
                globalSearchResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-desktop-muted text-[10px] leading-snug mb-0.5"
                    onClick={() => {
                      if (currentSessionId !== r.sessionId) selectSession(r.sessionId);
                      setTimeout(() => {
                        document.getElementById(`msg-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        document.getElementById(`msg-${r.id}`)?.classList.add('highlight-flash');
                      }, 300);
                      setGlobalSearchQuery('');
                    }}
                  >
                    <div className="text-[9px] text-desktop-accent/70 truncate mb-0.5">
                      {r.sessionTitle || '会话'} · {r.role === 'user' ? '用户' : '助手'}
                    </div>
                    <div className="truncate opacity-80">{r.snippet}</div>
                  </button>
                ))
              )}
            </div>
          )}
          {/* Tag filter chips */}
          {(() => {
            const allTags = [...new Set(sessions.flatMap((s) => s.tags))].sort();
            if (allTags.length === 0) return null;
            return (
              <div className="px-2 mb-1 flex flex-wrap gap-1">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSessionSearch((prev) => prev === `#${tag}` ? '' : `#${tag}`)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                      sessionSearch === `#${tag}`
                        ? 'bg-desktop-accent/30 border-desktop-accent text-desktop-accent'
                        : 'bg-white/5 border-white/10 text-desktop-muted hover:border-white/20'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            );
          })()}
          {showStarred && (
            <div className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
              <div className="text-[10px] text-desktop-muted px-3 py-1 flex items-center gap-1">
                <Star size={10} /> 全部收藏 ({allBookmarks.length})
              </div>
              {allBookmarks.length === 0 ? (
                <div className="text-[10px] text-desktop-muted/60 px-3 py-2">暂无收藏</div>
              ) : (
                allBookmarks.map((msg) => {
                  const session = sessions.find((s) => s.id === msg.sessionId);
                  const isCurrentSession = currentSessionId === msg.sessionId;
                  return (
                    <button
                      key={msg.id}
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-desktop-muted text-[10px] leading-snug"
                      onClick={() => {
                        if (isCurrentSession) {
                          document.getElementById(`msg-${msg.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          document.getElementById(`msg-${msg.id}`)?.classList.add('highlight-flash');
                        } else {
                          selectSession(msg.sessionId);
                        }
                      }}
                    >
                      <div className="flex items-center gap-1 text-desktop-accent mb-0.5">
                        <Star size={9} />
                        <span className="text-desktop-muted/70 truncate flex-1">
                          {session?.title?.trim() || '会话'} {isCurrentSession ? '' : '→'}
                        </span>
                      </div>
                      <div className="truncate opacity-80">{msg.content?.slice(0, 60)}</div>
                      <div className="text-[9px] text-desktop-muted/50 mt-0.5">
                        {new Date(msg.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
          <div className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
            {filteredSessions.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-0.5 rounded-lg ${
                  currentSessionId === s.id ? 'bg-desktop-accent/30' : 'hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  className={`flex-1 min-w-0 text-left px-3 py-1.5 rounded-lg text-xs transition-colors truncate flex flex-col gap-0.5 ${
                    currentSessionId === s.id ? 'text-desktop-text' : 'text-desktop-muted hover:text-desktop-text'
                  }`}
                  onClick={() => selectSession(s.id)}
                >
                  <span className="truncate">{s.title?.trim() || '新对话'}</span>
                  {s.tags.length > 0 && (
                    <span className="flex gap-0.5 flex-wrap">
                      {s.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[9px] px-1 py-0 rounded-full bg-desktop-accent/20 text-desktop-accent">#{tag}</span>
                      ))}
                      {s.tags.length > 3 && <span className="text-[9px] text-desktop-muted">+{s.tags.length - 3}</span>}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded text-desktop-muted hover:bg-white/10 hover:text-desktop-text opacity-0 group-hover:opacity-100 transition-opacity"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newTitle = window.prompt('会话标题', s.title?.trim() || '新对话');
                    if (newTitle !== null && newTitle.trim()) updateSessionTitle(s.id, newTitle.trim());
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  className={`shrink-0 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                    s.isPinned ? 'text-desktop-accent' : 'text-desktop-muted hover:text-desktop-text hover:bg-white/10'
                  }`}
                  title={s.isPinned ? '取消置顶' : '置顶会话'}
                  onClick={(e) => { e.stopPropagation(); togglePin(s.id); }}
                >
                  <Pin size={12} />
                </button>
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded text-desktop-muted hover:bg-white/10 hover:text-desktop-accent opacity-0 group-hover:opacity-100 transition-opacity"
                  title="标签"
                  onClick={(e) => {
                    e.stopPropagation();
                    const tagInput = window.prompt('添加标签（多个用逗号分隔）', s.tags.join(', '));
                    if (tagInput !== null) {
                      const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
                      updateSessionTags(s.id, tags);
                    }
                  }}
                >
                  <span className="text-[10px] font-bold">#</span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    className="shrink-0 p-1.5 rounded text-desktop-muted hover:bg-white/10 hover:text-desktop-accent opacity-0 group-hover:opacity-100 transition-opacity"
                    title="导出"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExportDropdownSessionId(exportDropdownSessionId === s.id ? null : s.id);
                    }}
                  >
                    <Download size={12} />
                  </button>
                  {exportDropdownSessionId === s.id && (
                    <div className="absolute right-0 top-full mt-1 bg-desktop-surface border border-white/20 rounded-lg shadow-xl z-50 min-w-[140px] py-1">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-desktop-text hover:bg-white/10 flex items-center gap-2"
                        onClick={(e) => { e.stopPropagation(); window.open(api.exportChatSessionMarkdown(s.id), '_blank'); setExportDropdownSessionId(null); }}
                      >
                        <FileText size={12} /> Markdown
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-desktop-text hover:bg-white/10 flex items-center gap-2"
                        onClick={(e) => { e.stopPropagation(); window.open(api.exportChatSessionHtml(s.id), '_blank'); setExportDropdownSessionId(null); }}
                      >
                        <FileText size={12} /> HTML
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-desktop-text hover:bg-white/10 flex items-center gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = api.exportChatSessionHtml(s.id);
                          const w = window.open(url, '_blank');
                          if (w) w.onload = () => w.print();
                          setExportDropdownSessionId(null);
                        }}
                      >
                        <FileText size={12} /> PDF (打印)
                      </button>
                      <div className="border-t border-white/10 my-1" />
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-desktop-text hover:bg-white/10 flex items-center gap-2"
                        onClick={(e) => { e.stopPropagation(); window.open(api.exportChatSessionJson(s.id), '_blank'); setExportDropdownSessionId(null); }}
                      >
                        <FileText size={12} /> JSON
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded text-desktop-muted hover:bg-white/10 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="删除会话"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('确定删除该会话？')) deleteSession(s.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`flex-1 flex flex-col min-w-0 ${sidebarOpen ? 'hidden sm:flex' : 'flex'}`}>
      {/* Header：手机嵌入模式仅保留会话切换；否则显示完整 header */}
      {embeddedInMobile ? (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-transparent">
          <button
            className="p-2 rounded-lg hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors touch-manipulation"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? '收起会话列表' : '展开会话列表'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
          </button>
          <button
            className="text-xs text-desktop-muted hover:text-desktop-text px-2 py-1 rounded hover:bg-white/5"
            onClick={startNewChat}
          >
            新对话
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
          <button
            className="p-1 rounded hover:bg-white/5 text-desktop-muted hover:text-desktop-text transition-colors"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? '收起会话列表' : '展开会话列表'}
          >
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
          </button>
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-desktop-highlight to-purple-500 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-desktop-text">AI 助手</span>
              <select
                className="text-[10px] bg-white/5 border border-white/10 rounded px-2 py-1 text-desktop-text focus:ring-1 focus:ring-desktop-accent outline-none max-w-[140px] truncate"
                value={selectedAgentId ?? ''}
                onChange={(e) => setSelectedAgentId(e.target.value ? e.target.value : null)}
                title="选择对话对象：默认 AI 助手，或与某智能体对话"
              >
                <option value="">默认 AI 助手</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-[10px] text-desktop-muted mt-0.5">
              {tasks.length} 个任务
              {selectedAgentId && agents.find((a) => a.id === selectedAgentId) && (
                <span className="ml-1">· 与「{agents.find((a) => a.id === selectedAgentId)!.name}」对话</span>
              )}
            </div>
          </div>
          <button
            className="text-[10px] text-desktop-muted hover:text-desktop-text px-2 py-1 rounded hover:bg-white/5 transition-colors"
            onClick={() => openApp('task-timeline')}
          >
            查看任务 →
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto px-2 sm:px-4 py-3 space-y-3 sm:space-y-4 relative">
        {currentSessionId && (
          <div className="sticky top-0 z-10 pb-2 -mx-1 sm:-mx-2">
            <div className="flex items-center gap-2 bg-desktop-surface/95 backdrop-blur-sm border border-white/10 rounded-xl px-3 py-2 shadow-sm">
              <Search size={13} className="text-desktop-muted shrink-0" />
              <input
                type="text"
                id="chat-message-search"
                placeholder="搜索消息内容..."
                className="flex-1 bg-transparent outline-none text-xs text-desktop-text placeholder:text-desktop-muted"
                value={messageSearch}
                onChange={(e) => setMessageSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setMessageSearch('');
                }}
              />
              {messageSearch && (
                <button
                  type="button"
                  onClick={() => setMessageSearch('')}
                  className="text-desktop-muted hover:text-desktop-text p-0.5"
                >
                  <X size={12} />
                </button>
              )}
              {messageSearchResults.length > 0 && (
                <span className="text-[10px] text-desktop-accent shrink-0">
                  {messageSearchIndex + 1}/{messageSearchResults.length}
                </span>
              )}
              {messageSearchResults.length > 0 && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigateSearch(-1)}
                    className="p-1 rounded text-desktop-muted hover:text-desktop-text hover:bg-white/10"
                    title="上一个"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateSearch(1)}
                    className="p-1 rounded text-desktop-muted hover:text-desktop-text hover:bg-white/10"
                    title="下一个"
                  >
                    <ChevronDown size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {chatSyncFailed && (
          <div className="rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs px-3 py-2">
            部分消息未同步到云端，请检查网络。恢复后可继续发送，新消息将正常同步。
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            className={`flex gap-2 sm:gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''} ${
              messageSearchResults.length > 0 && messageSearchResults[messageSearchIndex] === msg.id
                ? 'ring-2 ring-desktop-accent rounded-xl'
                : ''
            }`}
          >
            {msg.role !== 'user' && (
              <div className="w-8 sm:w-7 h-8 sm:h-7 rounded-full bg-desktop-accent flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={14} className="text-desktop-highlight" />
              </div>
            )}
            <div
              className={`max-w-[90%] sm:max-w-[85%] rounded-xl px-2 sm:px-3 py-2 sm:py-2.5 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-desktop-highlight/20 text-desktop-text'
                  : msg.role === 'system'
                    ? 'bg-desktop-accent/30 text-desktop-muted'
                    : 'bg-white/5 text-desktop-text/90'
              }`}
            >
              {/* 工具调用列表：可展开查看详情 */}
              {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="space-y-1">
                  {msg.toolCalls.map((tc) => (
                    <ToolCallBlock key={tc.id} tc={tc} />
                  ))}
                </div>
              )}
              {(msg.content || (msg.role === 'assistant' && isLoading && messages[messages.length - 1]?.id === msg.id)) && (
                <div className={msg.toolCalls?.length ? 'mt-2' : ''}>
                  {msg.role === 'assistant' ? (
                    <div className="relative group">
                      <button
                        type="button"
                        onClick={() => speakText(msg.id, msg.content)}
                        title={speakingMsgId === msg.id ? '停止朗读' : '朗读'}
                        className={`absolute -top-1 right-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                          speakingMsgId === msg.id ? 'text-desktop-accent opacity-100' : 'text-desktop-muted hover:text-desktop-text'
                        }`}
                      >
                        {speakingMsgId === msg.id ? <VolumeX size={13} /> : <Speaker size={13} />}
                      </button>
                      <div className="absolute -top-1 right-6 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          title="赞"
                          onClick={async () => {
                            const next = { ...(msg.reactions ?? {}), thumbsUp: !(msg.reactions?.thumbsUp ?? false), thumbsDown: false };
                            setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reactions: next } : m)));
                            try { await api.setMessageReaction(msg.id, next); } catch { /* revert on error */ }
                          }}
                          className={`p-1 rounded transition-colors ${msg.reactions?.thumbsUp ? 'text-desktop-accent' : 'text-desktop-muted hover:text-desktop-text'}`}
                        >
                          <ThumbsUp size={13} />
                        </button>
                        <button
                          type="button"
                          title="踩"
                          onClick={async () => {
                            const next = { ...(msg.reactions ?? {}), thumbsDown: !(msg.reactions?.thumbsDown ?? false), thumbsUp: false };
                            setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reactions: next } : m)));
                            try { await api.setMessageReaction(msg.id, next); } catch { /* revert on error */ }
                          }}
                          className={`p-1 rounded transition-colors ${msg.reactions?.thumbsDown ? 'text-red-400' : 'text-desktop-muted hover:text-desktop-text'}`}
                        >
                          <ThumbsDown size={13} />
                        </button>
                      </div>
                      <div className="chat-markdown text-xs text-desktop-text/90 leading-relaxed [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_li]:block [&_li]:my-0.5 [&_li]:leading-relaxed [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-white/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_strong]:font-semibold [&_a]:text-desktop-highlight [&_a]:underline [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1">
                        <MarkdownWithThink content={msg.content} />
                      </div>
                    </div>
                  ) : msg.role === 'system' ? (
                    <div className="chat-markdown text-xs text-desktop-text/90 leading-relaxed [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_li]:block [&_li]:my-0.5 [&_li]:leading-relaxed [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-white/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_strong]:font-semibold [&_a]:text-desktop-highlight [&_a]:underline [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1">
                      <MarkdownContent content={msg.content} />
                    </div>
                  ) : editingMessageId === msg.id ? (
                    <div className="space-y-2">
                      <textarea
                        autoFocus
                        rows={Math.max(2, editingContent.split('\n').length)}
                        className="w-full bg-white/10 border border-desktop-accent/40 rounded-lg px-3 py-2 text-xs text-desktop-text resize-none focus:outline-none focus:border-desktop-accent"
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleEditSubmit(); }
                          if (e.key === 'Escape') { setEditingMessageId(null); }
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="px-3 py-1 rounded-lg bg-desktop-accent hover:bg-desktop-accent/80 text-desktop-highlight text-[11px] font-medium transition-colors disabled:opacity-40"
                          onClick={handleEditSubmit}
                          disabled={!editingContent.trim() || isLoading}
                        >
                          重新生成
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-desktop-text/70 text-[11px] transition-colors"
                          onClick={() => setEditingMessageId(null)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                  {msg.quotaError && (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg bg-desktop-accent/40 hover:bg-desktop-accent/60 text-desktop-text text-[11px] font-medium transition-colors"
                        onClick={() => openApp('subscription')}
                      >
                        {t('errors.quotaUpgradeLink')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 用户附带图片 / 助手生成图：用户为沙箱路径用 API 加载，助手为 URL */}
              {msg.images && msg.images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.images.map((srcOrPath, i) => {
                    const imgSrc =
                      msg.role === 'user' && !srcOrPath.startsWith('data:') && !srcOrPath.startsWith('http')
                        ? `/api/fs/read-binary?path=${encodeURIComponent(srcOrPath)}`
                        : srcOrPath;
                    return (
                    <div key={i} className="rounded-lg border border-white/10 overflow-hidden max-w-[200px] bg-white/5">
                      <button
                        type="button"
                        className="w-full max-h-[180px] block focus:outline-none focus:ring-2 focus:ring-desktop-accent/50 rounded-t-lg overflow-hidden"
                        onClick={() => setImagePreviewUrl(imgSrc)}
                      >
                        <img src={imgSrc} alt={msg.role === 'user' ? `附带图片 ${i + 1}` : `生成图 ${i + 1}`} className="w-full h-full object-cover block" />
                      </button>
                      <button
                        type="button"
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] text-desktop-muted hover:text-desktop-text hover:bg-white/10 transition-colors"
                        onClick={async () => {
                          const path = await saveImageToSandbox(imgSrc, `生成图-${i + 1}.png`);
                          if (path) addNotification({ type: 'info', title: '已保存到沙箱', message: path });
                          else addNotification({ type: 'error', title: '保存失败', message: '请重试' });
                        }}
                        title="保存到沙箱"
                      >
                        <Download size={12} />
                        保存
                      </button>
                    </div>
                    );
                  })}
                </div>
              )}

              {/* 用户附带文档：在对话中单独展示 */}
              {msg.role === 'user' && msg.attachedFiles && msg.attachedFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {msg.attachedFiles.map((f, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 text-[10px] text-desktop-muted"
                      title={f.path}
                    >
                      <FileText size={12} />
                      {f.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Task link：状态以桌面 store 为准，任务完成后 WebSocket 会更新 store，此处自动从旋转变为已完成 */}
              {msg.taskId && (() => {
                const task = tasks.find((t) => t.id === msg.taskId);
                const displayStatus = task?.status ?? msg.taskStatus;
                return (
                  <button
                    className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-[10px] text-desktop-muted hover:text-desktop-text transition-colors"
                    onClick={() => openApp('task-timeline')}
                  >
                    {displayStatus === 'awaiting_approval' ? (
                      <Clock size={10} className="text-yellow-400" />
                    ) : displayStatus === 'completed' ? (
                      <CheckCircle2 size={10} className="text-green-400" />
                    ) : displayStatus === 'failed' ? (
                      <XCircle size={10} className="text-red-400" />
                    ) : (
                      <Loader2 size={10} className="text-blue-400 animate-spin" />
                    )}
                    {displayStatus === 'completed' ? '任务已完成 · 查看详情' : displayStatus === 'failed' ? '任务失败 · 查看详情' : '查看任务详情'}
                    <ArrowRight size={10} />
                  </button>
                );
              })()}

              <div className="flex items-center justify-end gap-0.5 mt-1.5">
                <span className="text-[9px] text-desktop-muted/40 mr-1">
                  {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}
                </span>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors"
                  onClick={() => copyMessage(msg)}
                  title="复制"
                  disabled={!msg.content}
                >
                  <Copy size={10} />
                </button>
                {msg.role === 'assistant' && (
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors"
                    onClick={() => retryAssistantMessage(msg)}
                    title="重试"
                    disabled={isLoading}
                  >
                    <RotateCcw size={10} />
                  </button>
                )}
                {msg.role === 'user' && !isLoading && (
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors"
                    onClick={() => {
                      setEditingMessageId(msg.id);
                      setEditingContent(msg.content);
                    }}
                    title="编辑"
                  >
                    <Edit2 size={10} />
                  </button>
                )}
                {msg.id !== 'welcome' && (
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-red-400 transition-colors"
                    onClick={() => deleteMessage(msg.id)}
                    title="删除"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
                {msg.id !== 'welcome' && (
                  <button
                    type="button"
                    className={`p-1 rounded transition-colors ${msg.bookmarked ? 'text-desktop-accent' : 'text-desktop-muted hover:text-desktop-accent hover:bg-white/10'}`}
                    onClick={async () => {
                      const next = !msg.bookmarked;
                      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, bookmarked: next } : m)));
                      try { await api.setMessageBookmark(msg.id, next); } catch { /* revert */ }
                    }}
                    title={msg.bookmarked ? '取消收藏' : '收藏'}
                  >
                    <Star size={10} />
                  </button>
                )}
              </div>
              {msg.role === 'assistant' && msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {msg.suggestedFollowUps.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      className="px-2.5 py-1 rounded-lg text-[10px] bg-white/10 hover:bg-white/20 text-desktop-text/90 hover:text-desktop-text border border-white/10 transition-colors text-left max-w-full truncate"
                      title={q}
                      onClick={() => {
                        setInput(q);
                        inputRef.current?.focus();
                      }}
                    >
                      {q.length > 40 ? q.slice(0, 39) + '…' : q}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 sm:w-7 h-8 sm:h-7 rounded-full bg-desktop-surface flex items-center justify-center shrink-0 mt-0.5">
                <User size={14} className="text-desktop-muted" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2 sm:gap-2.5">
            <div className="w-8 sm:w-7 h-8 sm:h-7 rounded-full bg-desktop-accent flex items-center justify-center shrink-0">
              <Bot size={14} className="text-desktop-highlight" />
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3 flex items-center gap-2">
              <Loader2 size={14} className="text-desktop-highlight animate-spin" />
              <span className="text-xs text-desktop-muted">思考中...</span>
            </div>
          </div>
        )}

        {/* Quick actions & task templates (only show when few messages) - 放在滚动区内，避免遮住底部输入框 */}
        {!messages.some((m) => m.role === 'user') && (
          <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <div className="text-[11px] text-desktop-muted font-medium">{t('chat.tryThese')}</div>
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.labelKey}
                  className="shrink-0 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-desktop-muted hover:text-desktop-text border border-white/5 transition-colors"
                  onClick={() => {
                    setInput(t(action.textKey));
                    inputRef.current?.focus();
                  }}
                >
                  {t(action.labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] text-desktop-muted font-medium">{t('templates.quickTasks')}</div>
            <div className="space-y-2">
              {(['student', 'office', 'research', 'dev'] as TaskTemplateCategory[]).map((cat) => {
                const items = TASK_TEMPLATES.filter((tm) => tm.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="flex flex-wrap gap-2 items-center">
                    <span className="text-[10px] text-desktop-muted/80 w-12 shrink-0">{t(`templates.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`)}</span>
                    {items.map((tm) => (
                      <button
                        key={tm.id}
                        className="shrink-0 px-2.5 py-1.5 rounded-lg bg-desktop-accent/20 hover:bg-desktop-accent/30 text-[11px] text-desktop-muted hover:text-desktop-text border border-desktop-accent/30 transition-colors"
                        onClick={() => sendMessage(t(tm.textKey))}
                      >
                        {t(tm.labelKey)}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input - shrink-0 保证不被预置场景挤压，始终可见 */}
      <div className="shrink-0 px-3 py-2 border-t border-white/5 bg-white/[0.02]">
        <input
          ref={attachFileInputRef}
          type="file"
          accept=".txt,.md,.pdf,.doc,.docx,.csv,.json,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (!files?.length) return;
            const items: { name: string; file: File }[] = [];
            for (let i = 0; i < Math.min(files.length, 5); i++) {
              const f = files[i]!;
              items.push({ name: f.name, file: f });
            }
            setAttachedFiles((prev) => [...prev, ...items].slice(0, 5));
            e.target.value = '';
          }}
        />
        <input
          ref={attachInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = e.target.files;
            if (!files?.length) return;
            const readAsDataUrl = (file: File) =>
              new Promise<string>((resolve) => {
                const r = new FileReader();
                r.onload = () => resolve((r.result as string) || '');
                r.onerror = () => resolve('');
                r.readAsDataURL(file);
              });
            const limit = Math.min(files.length, 3);
            const urls = await Promise.all(Array.from({ length: limit }, (_, i) => readAsDataUrl(files[i]!)));
            const valid = urls.filter((u) => u.startsWith('data:image/'));
            setAttachedImages((prev) => [...prev, ...valid].slice(0, 3));
            e.target.value = '';
          }}
        />
        {attachedFiles.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachedFiles.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-[11px] text-desktop-text shrink-0"
              >
                <Paperclip size={12} className="text-desktop-muted shrink-0" />
                <span className="max-w-[120px] truncate" title={item.name}>
                  {item.name}
                </span>
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-red-500/30 text-desktop-muted hover:text-red-400 transition-colors shrink-0"
                  onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="移除"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachedImages.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachedImages.map((url, i) => (
              <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden border border-white/10 bg-white/5 shrink-0">
                <img src={url} alt={`参考图 ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  className="absolute top-0 right-0 p-0.5 rounded-bl bg-black/60 hover:bg-red-500/80 text-white transition-colors"
                  onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="移除"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 sm:gap-2 bg-white/5 rounded-xl px-2 sm:px-3 py-2 border border-white/10 focus-within:border-desktop-highlight/30 transition-colors relative">
          <button
            type="button"
            className="p-2 sm:p-1 rounded-lg sm:rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
            onClick={() => attachFileInputRef.current?.click()}
            title={attachedFiles.length >= 5 ? '最多 5 个文件' : '附加文档（txt、md、pdf、doc、csv、json 等）'}
          >
            <Paperclip size={16} className="sm:size-4" />
          </button>
          <button
            type="button"
            className="p-2 sm:p-1 rounded-lg sm:rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
            onClick={() => attachInputRef.current?.click()}
            title={attachedImages.length >= 3 ? '最多 3 张参考图' : '上传参考图（1–3 张），将随消息发送供图像编辑使用'}
          >
            <ImagePlus size={16} className="sm:size-4" />
          </button>
          <button
            type="button"
            className={`p-2 sm:p-1 rounded-lg sm:rounded transition-colors shrink-0 mb-0.5 touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
              recordingId
                ? 'text-red-400 bg-red-400/20 animate-pulse'
                : 'text-desktop-muted hover:text-desktop-text hover:bg-white/10'
            }`}
            onClick={toggleVoiceInput}
            title={recordingId ? '停止录音' : '语音输入'}
          >
            {recordingId ? <MicOff size={16} className="sm:size-4" /> : <Mic size={16} className="sm:size-4" />}
          </button>
          <button
            type="button"
            className="p-2 sm:p-1 rounded-lg sm:rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
            onClick={() => setSnippetPickerOpen((o) => !o)}
            title="插入代码片段"
          >
            <Code size={16} className="sm:size-4" />
          </button>
          <button
            type="button"
            className="p-2 sm:p-1 rounded-lg sm:rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center relative"
            onClick={() => { setCalcOpen((o) => !o); setSnippetPickerOpen(false); }}
            title="计算器"
          >
            <Calculator size={16} className="sm:size-4" />
          </button>
          <button
            type="button"
            className="p-2 sm:p-1 rounded-lg sm:rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
            onClick={() => setReminderOpen((o) => !o)}
            title="设置提醒"
          >
            <Bell size={16} className="sm:size-4" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="输入消息或任务描述... (Shift+Enter 换行)"
            className="flex-1 bg-transparent outline-none text-sm sm:text-xs text-desktop-text resize-none max-h-[120px] min-h-[32px] sm:min-h-[24px] py-1.5 sm:py-0.5 placeholder:text-desktop-muted/50 leading-relaxed"
            rows={1}
          />
          {isLoading ? (
            <button
              className="p-2 sm:p-1.5 rounded-lg transition-all shrink-0 mb-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
              onClick={stopGenerating}
              title="停止生成"
            >
              <Square size={14} className="sm:size-[13px]" />
            </button>
          ) : (
            <button
              className={`p-2 sm:p-1.5 rounded-lg transition-all shrink-0 mb-0.5 touch-manipulation min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 flex items-center justify-center ${
                input.trim() || attachedImages.length || attachedFiles.length
                  ? 'bg-desktop-highlight hover:bg-desktop-highlight/80 text-white scale-100'
                  : 'bg-white/5 text-desktop-muted scale-95'
              }`}
              onClick={() => sendMessage()}
              disabled={!input.trim() && !attachedImages.length && !attachedFiles.length}
            >
              <Send size={14} className="sm:size-[13px]" />
            </button>
          )}
        </div>

        {/* Code Snippet Picker */}
        {snippetPickerOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-desktop-surface border border-white/20 rounded-xl shadow-2xl z-50 max-h-80 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
              <input
                type="text"
                placeholder="搜索代码片段..."
                value={snippetFilter}
                onChange={(e) => setSnippetFilter(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => { setSnippetPickerOpen(false); setSnippetFilter(''); }}
                className="text-desktop-muted hover:text-desktop-text p-1"
              >
                <X size={14} />
              </button>
            </div>
            <div className="overflow-auto flex-1">
              {snippets.filter((s) =>
                !snippetFilter ||
                s.title.toLowerCase().includes(snippetFilter.toLowerCase()) ||
                s.code.toLowerCase().includes(snippetFilter.toLowerCase()) ||
                s.language.toLowerCase().includes(snippetFilter.toLowerCase())
              ).length === 0 ? (
                <div className="text-xs text-desktop-muted text-center py-6">
                  {snippets.length === 0 ? '暂无代码片段，去设置中添加' : '没有匹配的片段'}
                </div>
              ) : (
                snippets.filter((s) =>
                  !snippetFilter ||
                  s.title.toLowerCase().includes(snippetFilter.toLowerCase()) ||
                  s.code.toLowerCase().includes(snippetFilter.toLowerCase()) ||
                  s.language.toLowerCase().includes(snippetFilter.toLowerCase())
                ).map((snippet) => (
                  <button
                    key={snippet.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0"
                    onClick={() => insertSnippet(snippet.code)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-desktop-accent/20 text-desktop-accent">{snippet.language}</span>
                      <span className="text-xs font-medium text-desktop-text">{snippet.title}</span>
                    </div>
                    <pre className="text-[10px] text-desktop-muted font-mono truncate max-w-full">{snippet.code.split('\n')[0]}</pre>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Inline Calculator */}
        {calcOpen && (
          <div className="border-t border-white/10 bg-desktop-bg/95 backdrop-blur-sm p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Calculator size={14} className="text-desktop-accent shrink-0" />
              <span className="text-xs font-medium text-desktop-text">计算器</span>
              <button
                type="button"
                className="ml-auto text-desktop-muted hover:text-desktop-text transition-colors"
                onClick={() => { setCalcOpen(false); setCalcExpr(''); }}
              >
                <X size={14} />
              </button>
            </div>
            <input
              type="text"
              value={calcExpr}
              onChange={(e) => handleCalcInput(e.target.value)}
              onKeyDown={handleCalcKey}
              placeholder="输入表达式，如 2^10、sqrt(2)、sin(pi/2)"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-desktop-text placeholder:text-desktop-muted/50 outline-none focus:border-desktop-accent/50 font-mono"
              autoFocus
            />
            {calcExpr && (
              <div className="text-xs text-desktop-muted font-mono min-h-[20px]">
                = <span className="text-desktop-accent font-semibold">{evalCalc(calcExpr) || '无效表达式'}</span>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {['+', '-', '*', '/', '^', '(', ')', '.'].map((op) => (
                <button
                  key={op}
                  type="button"
                  className="px-2 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded text-desktop-text transition-colors font-mono"
                  onClick={() => handleCalcInput(calcExpr + op)}
                >
                  {op}
                </button>
              ))}
              {[
                { label: 'sqrt', val: 'sqrt(' },
                { label: 'sin', val: 'sin(' },
                { label: 'cos', val: 'cos(' },
                { label: 'tan', val: 'tan(' },
                { label: 'log', val: 'log(' },
                { label: 'ln', val: 'ln(' },
                { label: 'pi', val: 'pi' },
                { label: 'e', val: 'e' },
                { label: '%', val: '%' },
              ].map(({ label, val }) => (
                <button
                  key={label}
                  type="button"
                  className="px-1.5 py-1 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded text-desktop-muted hover:text-desktop-text transition-colors"
                  onClick={() => handleCalcInput(calcExpr + val)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className="px-2 py-1 text-xs bg-desktop-accent/20 hover:bg-desktop-accent/30 border border-desktop-accent/30 rounded text-desktop-accent transition-colors"
                onClick={() => setCalcExpr(calcExpr.slice(0, -1))}
              >
                DEL
              </button>
              <button
                type="button"
                className="px-2 py-1 text-xs bg-desktop-accent/20 hover:bg-desktop-accent/30 border border-desktop-accent/30 rounded text-desktop-accent transition-colors"
                onClick={() => setCalcExpr('')}
              >
                C
              </button>
            </div>
            <button
              type="button"
              className="w-full py-1.5 bg-desktop-accent/20 hover:bg-desktop-accent/30 border border-desktop-accent/30 rounded text-xs text-desktop-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={insertCalcResult}
              disabled={!calcExpr || !evalCalc(calcExpr)}
            >
              插入结果
            </button>
          </div>
        )}

        {/* Reminder Popover */}
        {reminderOpen && (
          <div className="border-t border-white/10 bg-desktop-bg/95 backdrop-blur-sm p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-desktop-accent shrink-0" />
              <span className="text-xs font-medium text-desktop-text">设置提醒</span>
              <button
                type="button"
                className="ml-auto text-desktop-muted hover:text-desktop-text transition-colors"
                onClick={() => setReminderOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <textarea
              value={reminderMsg}
              onChange={(e) => setReminderMsg(e.target.value)}
              placeholder="提醒内容..."
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted/50 outline-none focus:border-desktop-accent/50 resize-none"
              rows={2}
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={reminderDate}
                onChange={(e) => setReminderDate(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none focus:border-desktop-accent/50"
                min={new Date().toISOString().split('T')[0]}
              />
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none focus:border-desktop-accent/50"
              />
            </div>
            <button
              type="button"
              className="w-full py-1.5 bg-desktop-accent/20 hover:bg-desktop-accent/30 border border-desktop-accent/30 rounded text-xs text-desktop-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={submitReminder}
              disabled={!reminderMsg.trim() || !reminderDate || !reminderTime}
            >
              设置提醒
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Session Stats Modal */}
      {statsOpen && (() => {
        const userMsgs = messages.filter((m) => m.role === 'user');
        const assistantMsgs = messages.filter((m) => m.role === 'assistant');
        const allText = messages.filter((m) => typeof m.content === 'string').map((m) => String(m.content)).join(' ');
        const wordCount = allText.trim() ? allText.trim().split(/\s+/).length : 0;
        const charCount = allText.length;
        const totalMsgs = messages.filter((m) => m.id !== 'welcome').length;
        const firstMsg = messages.find((m) => m.id !== 'welcome');
        const lastMsg = [...messages].reverse().find((m) => m.id !== 'welcome');
        const duration = firstMsg && lastMsg ? Math.round((lastMsg.timestamp - firstMsg.timestamp) / 60000) : null;
        const readingTime = Math.ceil(wordCount / 200);

        const stats = [
          { label: '总消息数', value: totalMsgs },
          { label: '用户消息', value: userMsgs.length },
          { label: '助手回复', value: assistantMsgs.length },
          { label: '字数', value: charCount.toLocaleString() },
          { label: '词数', value: wordCount.toLocaleString() },
          { label: '预计阅读', value: `${readingTime} 分钟` },
          { label: '会话时长', value: duration != null ? (duration < 60 ? `${duration} 分钟` : `${Math.round(duration / 60)} 小时`) : '—' },
        ];

        return (
          <div
            className="fixed inset-0 z-[9998] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setStatsOpen(false)}
          >
            <div
              className="bg-desktop-surface border border-white/20 rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart2 size={16} className="text-desktop-accent" />
                  <h3 className="text-sm font-semibold text-desktop-text">会话统计</h3>
                </div>
                <button
                  type="button"
                  className="text-desktop-muted hover:text-desktop-text transition-colors"
                  onClick={() => setStatsOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {stats.map((s) => (
                  <div key={s.label} className="bg-white/5 rounded-lg px-3 py-2.5 flex flex-col gap-0.5">
                    <span className="text-[10px] text-desktop-muted uppercase tracking-wide">{s.label}</span>
                    <span className="text-sm font-semibold text-desktop-text">{s.value}</span>
                  </div>
                ))}
              </div>
              {totalMsgs > 0 && (
                <div className="text-[11px] text-desktop-muted text-center">
                  {(() => {
                    const d = new Date(firstMsg!.timestamp);
                    const df = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    return `从 ${df.format(d)} 开始`;
                  })()}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 图片点击放大：遮罩层，可保存或关闭 */}
      {imagePreviewUrl && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setImagePreviewUrl(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-14 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={async (e) => {
              e.stopPropagation();
              const path = await saveImageToSandbox(imagePreviewUrl, '生成图.png');
              if (path) addNotification({ type: 'info', title: '已保存到沙箱', message: path });
              else addNotification({ type: 'error', title: '保存失败', message: '请重试' });
            }}
            aria-label="保存"
            title="保存到沙箱"
          >
            <Download size={20} />
          </button>
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={() => setImagePreviewUrl(null)}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
          <img
            src={imagePreviewUrl}
            alt="预览"
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

