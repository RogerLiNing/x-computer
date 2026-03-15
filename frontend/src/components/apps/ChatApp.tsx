import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, Sparkles, Loader2, Clock, CheckCircle2, XCircle, ArrowRight, ChevronDown, ChevronRight, Wrench, Copy, RotateCcw, Trash2, MessageSquarePlus, PanelLeftClose, PanelLeft, Pencil, X, Download, ImagePlus, Square, Paperclip, FileText } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import { useLLMConfigStore } from '@/store/llmConfigStore';
import { useAiDocumentStore } from '@/store/aiDocumentStore';
import { getSystemLogStore } from '@/store/systemLogStore';
import { api, ApiError } from '@/utils/api';
import { TASK_TEMPLATES, type TaskTemplateCategory } from '@/config/taskTemplates';
import { buildComputerContext, formatComputerContextForPrompt, formatTaskSummaryForPrompt } from '@/utils/computerContext';
import type { TaskDomain } from '@shared/index';

/** 单次工具调用记录（用于对话中展示） */
interface ToolCallRecord {
  id: string;
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  duration?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  taskId?: string;
  taskStatus?: string;
  /** 工具/MCP 调用记录，可展开查看详情 */
  toolCalls?: ToolCallRecord[];
  /** 图片：助手为生成图 URL；用户为附带图片的沙箱路径（显示时用 /api/fs/read-binary 加载） */
  images?: string[];
  /** 用户附带的文档（名称与沙箱路径），在对话中单独展示 */
  attachedFiles?: Array<{ name: string; path: string }>;
  /** 建议追问（AI 回复后由服务端生成，可点击填入输入框） */
  suggestedFollowUps?: string[];
  /** 是否为配额超限错误，若是则展示升级入口 */
  quotaError?: boolean;
}

interface Props {
  windowId: string;
  /** 嵌入手机模式布局时使用，隐藏完整 header 仅保留会话切换 */
  embeddedInMobile?: boolean;
}

// Detect task domain from user input.
// Office (含 file.write 保存结果) 优先于 agent，这样「帮我生成本周工作周报」会走 office 并生成文件。
function detectDomain(text: string): TaskDomain {
  const t = text.toLowerCase();
  if (t.includes('代码') || t.includes('编程') || t.includes('修复') || t.includes('bug') || t.includes('编写') || t.includes('函数'))
    return 'coding';
  if (t.includes('邮件') || t.includes('文档') || t.includes('表格') || t.includes('报告') || t.includes('整理') || t.includes('周报') || t.includes('工作周报'))
    return 'office';
  if (t.includes('帮我') || t.includes('执行') || t.includes('自动') || t.includes('任务') || t.includes('搜索') || t.includes('下载'))
    return 'agent';
  return 'chat';
}

const TASK_KEYWORDS = ['帮我', '执行', '创建', '整理', '发送', '编写', '修改', '分析', '生成', '修复', '部署', '搜索', '下载', '安装', '运行'];

/** 将图片 URL（data URL 或 http）转为 Blob */
async function imageUrlToBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const res = await fetch(src);
    return res.blob();
  }
  const res = await fetch(src, { mode: 'cors' });
  return res.blob();
}

/** 根据 data URL 或 blob 推断默认扩展名 */
function getImageExtension(src: string, blob: Blob): string {
  if (src.startsWith('data:')) {
    const m = src.match(/data:image\/(\w+);/);
    if (m) {
      const ext = m[1].toLowerCase();
      return ext === 'jpeg' ? '.jpg' : `.${ext}`;
    }
  }
  const t = blob.type?.toLowerCase() || '';
  if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
  if (t.includes('png')) return '.png';
  if (t.includes('webp')) return '.webp';
  if (t.includes('gif')) return '.gif';
  return '.png';
}

/** Blob 转 base64 字符串 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.includes(',') ? s.split(',')[1]! : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 将图片保存到用户沙箱（非宿主机），路径默认 图片/生成图-{timestamp}.{ext}；返回保存的沙箱路径或 null */
async function saveImageToSandbox(src: string, _suggestedName: string): Promise<string | null> {
  let blob: Blob;
  try {
    blob = await imageUrlToBlob(src);
  } catch {
    return null;
  }
  const ext = getImageExtension(src, blob);
  const sandboxPath = `图片/生成图-${Date.now()}${ext}`;
  let base64: string;
  if (src.startsWith('data:') && src.includes(',')) {
    base64 = src.split(',')[1]!;
  } else {
    try {
      base64 = await blobToBase64(blob);
    } catch {
      return null;
    }
  }
  try {
    await api.writeFileBinary(sandboxPath, base64);
    return sandboxPath;
  } catch {
    return null;
  }
}

/** 请求 /api/chat 时携带的最近对话轮数（每轮 = user + assistant），对齐 OpenCode session 思路。 */
const DEFAULT_MAX_CHAT_ROUNDS = 10;

/**
 * 取最近 N 轮对话（仅 user/assistant），用于 API 请求。后端会注入 system 提示，此处不传首条 system。
 * 若需扩展可配置 N，可从设置或 llmConfig 读取。
 */
function getMessagesForChat(
  messages: Message[],
  userMsg: Message,
  maxRounds: number,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const conversation = [...messages, userMsg].filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  ) as Message[];
  const take = maxRounds * 2;
  const last = conversation.length <= take ? conversation : conversation.slice(-take);
  return last.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

const WELCOME_FALLBACK = `我是 X-Computer 主脑，掌控本机所有应用与任务。

你可以：
• 直接说出目标或聊天提问（我会用你配置的大模型回复）
• 让我写某类内容：我会先问清需求，写好后你可说「写入编辑器」由我决定写入哪段
• 描述多步任务：我会创建执行流程，你可在任务时间线中审批或自动执行

需要危险或敏感操作时，我会请求你的确认。试试输入「你好」或「写一篇短文」开始。`;

/** 可展开/收起的工具调用块，类似 Cursor 风格 */
function ToolCallBlock({ tc }: { tc: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const tools = useDesktopStore((s) => s.tools);
  const fetchTools = useDesktopStore((s) => s.fetchTools);
  useEffect(() => {
    fetchTools();
  }, [fetchTools]);
  const toolDisplayName = tools.find((t) => t.name === tc.toolName)?.displayName ?? tc.toolName;
  const statusIcon =
    tc.status === 'running' ? (
      <Loader2 size={10} className="text-blue-400 animate-spin shrink-0" />
    ) : tc.status === 'completed' ? (
      <CheckCircle2 size={10} className="text-green-400 shrink-0" />
    ) : (
      <XCircle size={10} className="text-red-400 shrink-0" />
    );
  const outputStr =
    tc.error != null
      ? String(tc.error)
      : tc.output != null
        ? typeof tc.output === 'string'
          ? tc.output
          : JSON.stringify(tc.output, null, 2)
        : '';
  const hasDetail = (tc.input && Object.keys(tc.input).length > 0) || outputStr;
  return (
    <div className="mt-1.5 rounded-lg border border-white/10 bg-white/5 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
        onClick={() => hasDetail && setExpanded((e) => !e)}
      >
        {hasDetail ? (
          expanded ? (
            <ChevronDown size={10} className="text-desktop-muted shrink-0" />
          ) : (
            <ChevronRight size={10} className="text-desktop-muted shrink-0" />
          )
        ) : (
          <span className="w-[10px]" />
        )}
        <Wrench size={10} className="text-desktop-muted shrink-0" />
        {statusIcon}
        <span className="text-[10px] text-desktop-muted truncate flex-1">
          {toolDisplayName}
          {tc.duration != null && tc.status !== 'running' && (
            <span className="text-desktop-muted/60 ml-1">({tc.duration}ms)</span>
          )}
        </span>
      </button>
      {expanded && hasDetail && (
        <div className="px-2.5 py-1.5 text-[10px] text-desktop-muted/80 border-t border-white/5 space-y-1 max-h-32 overflow-auto">
          {tc.input && Object.keys(tc.input).length > 0 && (
            <div>
              <span className="text-desktop-muted/60">输入:</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(tc.input, null, 2)}
              </pre>
            </div>
          )}
          {outputStr && (
            <div>
              <span className="text-desktop-muted/60">{tc.error ? '错误:' : '输出:'}</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-desktop-text/90">
                {outputStr.length > 500 ? outputStr.slice(0, 500) + '...' : outputStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 会话记录项（与 API 返回格式一致） */
interface ChatSessionItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

const LAST_SESSION_KEY = 'x-computer-last-chat-session-id';
const LAST_SESSION_CLOUD_KEY = 'last_chat_session_id';

function syncLastSessionToCloud(sessionId: string | null) {
  try {
    if (sessionId) localStorage.setItem(LAST_SESSION_KEY, sessionId);
    else localStorage.removeItem(LAST_SESSION_KEY);
  } catch (_) {}
  api.setUserConfigKey(LAST_SESSION_CLOUD_KEY, sessionId).catch(() => {});
}

/** 会话管理：列表、当前会话、切换、新对话、ensure（发送时创建） */
function useChatSessions(setMessages: (fn: (prev: Message[]) => Message[]) => void) {
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
            const converted: Message[] = msgs.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
              timestamp: new Date(m.createdAt).getTime(),
              toolCalls: m.toolCalls ? (m.toolCalls as ToolCallRecord[]) : undefined,
              images: m.images,
              attachedFiles: (m as { attachedFiles?: Array<{ name: string; path: string }> }).attachedFiles,
            }));
            setMessages(() => [
              { id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() },
              ...converted,
            ]);
          })
          .catch(() => setCurrentSessionId(null));
      })
      .catch(() => {
        const local = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SESSION_KEY) : null;
        if (local) setCurrentSessionId(local);
      });
  }, []);

  const selectSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      syncLastSessionToCloud(sessionId);
      api
        .getChatMessages(sessionId)
        .then((msgs) => {
          const converted: Message[] = msgs.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
            toolCalls: m.toolCalls ? (m.toolCalls as ToolCallRecord[]) : undefined,
            images: m.images,
            attachedFiles: (m as { attachedFiles?: Array<{ name: string; path: string }> }).attachedFiles,
          }));
          setMessages(() => [
            { id: 'welcome', role: 'system', content: WELCOME_FALLBACK, timestamp: Date.now() },
            ...converted,
          ]);
        })
        .catch(() => {
          setCurrentSessionId(null);
          syncLastSessionToCloud(null);
        });
    },
    [],
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
    setSessions((prev) => [{ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }, ...prev]);
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
    [currentSessionId],
  );

  const updateSessionTitle = useCallback((sessionId: string, title: string) => {
    api.updateChatSessionTitle(sessionId, title).then(() => loadSessions()).catch(() => {});
  }, []);

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
    setCurrentSessionId,
    refreshSessions: loadSessions,
  };
}

/** 智能体简要（用于选择器） */
interface AgentOption {
  id: string;
  name: string;
}

/** 格式化 API 错误为展示内容；配额超限时返回 quotaError 以显示升级入口 */
function useFormatChatError() {
  const { t } = useTranslation();
  return useCallback((err: unknown): { content: string; quotaError: boolean } => {
    if (err instanceof ApiError && (err.code === 'quota_exceeded' || err.status === 429)) {
      return { content: t('errors.quotaExceededFriendly'), quotaError: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('quota_exceeded') || msg.includes('quota')) {
      return { content: t('errors.quotaExceededFriendly'), quotaError: true };
    }
    return { content: msg, quotaError: false };
  }, [t]);
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
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  /** 按需加载模式下本会话已加载的工具名，跨消息持久化 */
  const loadedToolNamesRef = useRef<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 已追加过「任务完成」跟帖的 taskId，避免重复 */
  const completedTaskFollowUpsRef = useRef<Set<string>>(new Set());

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
    refreshSessions,
  } = useChatSessions(setMessages);
  const tasks = useDesktopStore((s) => s.tasks);
  const { addNotification, openApp, setWindowTitle } = useDesktopStore();
  const aiDoc = useAiDocumentStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    loadedToolNamesRef.current = [];
  }, [currentSessionId]);

  useEffect(() => {
    api.getWelcomeMessage().then((r) => {
      if (r?.content?.trim())
        setMessages((prev) => prev.map((m) => (m.id === 'welcome' ? { ...m, content: r.content!.trim() } : m)));
    }).catch(() => {});
  }, []);

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
    let sid: string = '';
    try {
      const res = await ensureSessionId();
      sid = res.id;
      if (res.isNew) {
        api.updateChatSessionTitle(sid, text.slice(0, 30)).catch(() => {});
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
    const computerContextStr = formatComputerContextForPrompt(
      buildComputerContext({
        windows: desktopState.windows,
        activeWindowId: desktopState.activeWindowId,
        executionMode: desktopState.executionMode,
        tasks: desktopState.tasks,
        taskbarPinned: desktopState.taskbarPinned,
        notifications: desktopState.notifications,
      }),
    );
    const taskSummaryStr = formatTaskSummaryForPrompt(desktopState.tasks);

    const llmConfig = useLLMConfigStore.getState().llmConfig;
    const vectorSel = llmConfig?.defaultByModality?.vector;
    const vectorConfig =
      vectorSel?.providerId && vectorSel?.modelId
        ? {
            providerId: vectorSel.providerId,
            modelId: vectorSel.modelId,
            baseUrl: llmConfig?.providers?.find((p: { id: string }) => p.id === vectorSel.providerId)?.baseUrl ?? '',
            apiKey: useLLMConfigStore.getState().getProviderApiKey(vectorSel.providerId),
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
      const baseUrl = provider?.baseUrl ?? '';
      const apiKey = useLLMConfigStore.getState().getProviderApiKey(providerId ?? '');
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
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
      });

      // 图片生成：仅当用户未附带参考图时走直接文生图；附带了图片则必须走 Agent 流程，以便主脑使用 llm.edit_image 等工具基于参考图修改
      if (intent === 'generate_image' && referenceImagePaths.length === 0) {
        const imageSel = llmConfig?.defaultByModality?.image;
        const imgProviderId = imageSel?.providerId ?? llmConfig?.providers?.[0]?.id;
        const imgProvider = llmConfig?.providers?.find((p: { id: string }) => p.id === imgProviderId);
        const imgBaseUrl = imgProvider?.baseUrl ?? '';
        const imgApiKey = useLLMConfigStore.getState().getProviderApiKey(imgProviderId ?? '');
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
            baseUrl: imgBaseUrl || undefined,
            apiKey: imgApiKey || undefined,
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
            baseUrl: baseUrl || undefined,
            apiKey: apiKey || undefined,
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
              baseUrl: baseUrl || undefined,
              apiKey: apiKey || undefined,
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
            baseUrl: baseUrl || undefined,
            apiKey: apiKey || undefined,
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
              baseUrl: baseUrl || undefined,
              apiKey: apiKey || undefined,
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
              baseUrl: baseUrl || undefined,
              apiKey: apiKey || undefined,
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
                apiKey: llmState.getProviderApiKey(providerId) || undefined,
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
        useDesktopStore.getState().upsertTask(task.id, task);

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
        const baseUrl = provider?.baseUrl ?? '';
        const apiKey = useLLMConfigStore.getState().getProviderApiKey(providerId ?? '');

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
                baseUrl: baseUrl || undefined,
                apiKey: apiKey || undefined,
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
                baseUrl: baseUrl || undefined,
                apiKey: apiKey || undefined,
                vectorConfig,
              }).catch(() => {});
              api
                .suggestFollowUps({
                  userMessage: text,
                  assistantReply: trimmed,
                  providerId,
                  modelId,
                  baseUrl: baseUrl || undefined,
                  apiKey: apiKey || undefined,
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
    const text = msg.content || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => addNotification({ type: 'info', title: '已复制', message: '消息已复制到剪贴板' }),
      () => addNotification({ type: 'error', title: '复制失败', message: '无法写入剪贴板' }),
    );
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
    const computerContextStr = formatComputerContextForPrompt(
      buildComputerContext({
        windows: desktopState.windows,
        activeWindowId: desktopState.activeWindowId,
        executionMode: desktopState.executionMode,
        tasks: desktopState.tasks,
        taskbarPinned: desktopState.taskbarPinned,
        notifications: desktopState.notifications,
      }),
    );
    const taskSummaryStr = formatTaskSummaryForPrompt(desktopState.tasks);
    const llmConfig = useLLMConfigStore.getState().llmConfig;
    const vectorSel = llmConfig?.defaultByModality?.vector;
    const vectorConfig =
      vectorSel?.providerId && vectorSel?.modelId
        ? {
            providerId: vectorSel.providerId,
            modelId: vectorSel.modelId,
            baseUrl: llmConfig?.providers?.find((p: { id: string }) => p.id === vectorSel.providerId)?.baseUrl ?? '',
            apiKey: useLLMConfigStore.getState().getProviderApiKey(vectorSel.providerId),
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
    const baseUrl = provider?.baseUrl ?? '';
    const apiKey = useLLMConfigStore.getState().getProviderApiKey(providerId ?? '');
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
          baseUrl: baseUrl || undefined,
          apiKey: apiKey || undefined,
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
          baseUrl: baseUrl || undefined,
          apiKey: apiKey || undefined,
          vectorConfig,
        }).catch(() => {});
        api
          .suggestFollowUps({
            userMessage: prevMsg.content,
            assistantReply: trimmed,
            providerId,
            modelId: sel?.modelId ?? '__custom__',
            baseUrl: baseUrl || undefined,
            apiKey: apiKey || undefined,
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
        <div className="w-56 shrink-0 border-r border-white/5 bg-white/[0.02] flex flex-col">
          <button
            className="flex items-center gap-2 px-3 py-2.5 m-2 rounded-lg bg-desktop-highlight/20 hover:bg-desktop-highlight/30 text-desktop-text text-xs transition-colors"
            onClick={startNewChat}
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
                  onClick={() => selectSession(s.id)}
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
                    if (newTitle !== null && newTitle.trim()) updateSessionTitle(s.id, newTitle.trim());
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

      <div className="flex-1 flex flex-col min-w-0">
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
      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
        {chatSyncFailed && (
          <div className="rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs px-3 py-2">
            部分消息未同步到云端，请检查网络。恢复后可继续发送，新消息将正常同步。
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            {msg.role !== 'user' && (
              <div className="w-7 h-7 rounded-full bg-desktop-accent flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={14} className="text-desktop-highlight" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
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
                  {(msg.role === 'assistant' || msg.role === 'system') ? (
                    <div className="chat-markdown text-xs text-desktop-text/90 leading-relaxed [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_li]:block [&_li]:my-0.5 [&_li]:leading-relaxed [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px] [&_pre]:bg-white/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-1.5 [&_strong]:font-semibold [&_a]:text-desktop-highlight [&_a]:underline [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-desktop-highlight underline">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
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
              <div className="w-7 h-7 rounded-full bg-desktop-surface flex items-center justify-center shrink-0 mt-0.5">
                <User size={14} className="text-desktop-muted" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-full bg-desktop-accent flex items-center justify-center shrink-0">
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
        <div className="flex items-end gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/10 focus-within:border-desktop-highlight/30 transition-colors">
          <button
            type="button"
            className="p-1 rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text"
            onClick={() => attachFileInputRef.current?.click()}
            title={attachedFiles.length >= 5 ? '最多 5 个文件' : '附加文档（txt、md、pdf、doc、csv、json 等）'}
          >
            <Paperclip size={14} />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white/10 transition-colors shrink-0 mb-0.5 text-desktop-muted hover:text-desktop-text"
            onClick={() => attachInputRef.current?.click()}
            title={attachedImages.length >= 3 ? '最多 3 张参考图' : '上传参考图（1–3 张），将随消息发送供图像编辑使用'}
          >
            <ImagePlus size={14} />
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
            className="flex-1 bg-transparent outline-none text-xs text-desktop-text resize-none max-h-[120px] min-h-[24px] py-0.5 placeholder:text-desktop-muted/50 leading-relaxed"
            rows={1}
          />
          {isLoading ? (
            <button
              className="p-1.5 rounded-lg transition-all shrink-0 mb-0.5 bg-red-500/20 hover:bg-red-500/30 text-red-400"
              onClick={stopGenerating}
              title="停止生成"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              className={`p-1.5 rounded-lg transition-all shrink-0 mb-0.5 ${
                input.trim() || attachedImages.length || attachedFiles.length
                  ? 'bg-desktop-highlight hover:bg-desktop-highlight/80 text-white scale-100'
                  : 'bg-white/5 text-desktop-muted scale-95'
              }`}
              onClick={() => sendMessage()}
              disabled={!input.trim() && !attachedImages.length && !attachedFiles.length}
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
      </div>

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

