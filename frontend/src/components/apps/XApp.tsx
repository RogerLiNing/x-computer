import { useChatDraft } from '@/hooks/useChatDraft';
import {useReminderMessages,mergeConcurrentReminders,type ReminderMessage} from '@/hooks/useReminderMessages';
import { shouldSubmitChat } from './ChatApp/chatHelpers';
/**
 * X 主脑入口：与 X 直接对话、查看 X 主动发来的消息；对话界面与 AI 助手一致（Markdown、工具调用展示、气泡布局）。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Brain, Send, Loader2, Bell, Key, HelpCircle, Info, Sparkles, Play, Clock, Bot, User, Wrench, ChevronDown, ChevronRight, CheckCircle2, XCircle, Copy, Check, Users, MessageCircle, Square, MessageSquare, Plus } from 'lucide-react';
import { useDesktopStore } from '@/store/desktopStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useLLMConfigStore } from '@/store/llmConfigStore';
import { useDigitalHumanStore } from '@/store/digitalHumanStore';
import { useConfigStore } from '@/store/configStore';
import { useTaskStore } from '@/store/taskStore';
import { setMiniAppsFromApi } from '@/appRegistry';
import { api, type ChatRunSnapshot, type ChatRunArtifact } from '@/utils/api';
import { buildComputerContext, formatComputerContextForPrompt, formatTaskSummaryForPrompt } from '@/utils/computerContext';
import { MarkdownContent, type ToolCallRecord } from '@/components/shared';
import { LivingAIStatusPanel } from './XApp/LivingAIStatusPanel';
import { useChatRun } from './ChatApp/useChatRun';
import { ChatRunPanel } from './ChatApp/ChatRunPanel';

const DISPLAY_TIMEZONE = 'Asia/Shanghai';
/** 按需加载模式下已加载的工具名，跨消息持久化 */
let loadedToolNamesX: string[] = [];
/** 下次运行时间展示：今日 HH:mm / 明日 HH:mm / M月D日 HH:mm（东八区） */
function formatNextRun(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
  const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
  const dDate = d.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
  const time = d.toLocaleTimeString('zh-CN', { timeZone: DISPLAY_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
  if (dDate === today) return `今日 ${time}`;
  if (dDate === tomorrow) return `明日 ${time}`;
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: DISPLAY_TIMEZONE, month: 'numeric', day: 'numeric' }).formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${month}月${day}日 ${time}`;
}

const TYPE_LABELS: Record<string, { label: string; icon: typeof Info }> = {
  need_api_key: { label: '需要配置', icon: Key },
  skill_ready: { label: '新技能', icon: Sparkles },
  question: { label: '需要你决定', icon: HelpCircle },
  info: { label: 'X 说', icon: Info },
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallRecord[];
  images?: string[];
}

/** 群组执行结果卡片：展示各成员产出，便于用户查看协作过程 */
function GroupRunResultCard({ input, output }: { input?: Record<string, unknown>; output?: unknown }) {
  const goal = input && typeof input.goal === 'string' ? input.goal : '';
  const out = output && typeof output === 'object' && output !== null && 'results' in output ? output as { results?: Array<{ agentId?: string; agentName?: string; content?: string }> } : null;
  const results = out?.results ?? [];
  const [expanded, setExpanded] = useState(true);
  if (results.length === 0) return null;
  return (
    <div className="mt-1.5 rounded-lg border border-desktop-accent/30 bg-desktop-accent/5 overflow-hidden">
      <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors" onClick={() => setExpanded((e) => !e)}>
        {expanded ? <ChevronDown size={10} className="text-desktop-muted shrink-0" /> : <ChevronRight size={10} className="text-desktop-muted shrink-0" />}
        <MessageCircle size={10} className="text-desktop-accent shrink-0" />
        <span className="text-[10px] text-desktop-text">群组执行结果（{results.length} 人）</span>
      </button>
      {expanded && (
        <div className="px-2.5 py-1.5 border-t border-white/5 space-y-2 max-h-48 overflow-auto">
          {goal && <p className="text-[10px] text-desktop-muted">目标：{goal.slice(0, 120)}{goal.length > 120 ? '…' : ''}</p>}
          {results.map((r, i) => (
            <div key={i} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
              <span className="text-[10px] font-medium text-desktop-accent">{r.agentName ?? r.agentId ?? '成员'}</span>
              <p className="text-[10px] text-desktop-text/90 mt-0.5 whitespace-pre-wrap break-words line-clamp-4">{r.content ?? ''}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 团队执行结果卡片：流水线最终输出 */
function TeamRunResultCard({ input, output }: { input?: Record<string, unknown>; output?: unknown }) {
  const goal = input && typeof input.goal === 'string' ? input.goal : '';
  const out = output && typeof output === 'object' && output !== null ? output as { content?: string; steps?: string[] } : null;
  const content = out?.content ?? '';
  const steps = out?.steps ?? [];
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="mt-1.5 rounded-lg border border-desktop-accent/30 bg-desktop-accent/5 overflow-hidden">
      <button type="button" className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors" onClick={() => setExpanded((e) => !e)}>
        {expanded ? <ChevronDown size={10} className="text-desktop-muted shrink-0" /> : <ChevronRight size={10} className="text-desktop-muted shrink-0" />}
        <Users size={10} className="text-desktop-accent shrink-0" />
        <span className="text-[10px] text-desktop-text">团队执行结果</span>
      </button>
      {expanded && (
        <div className="px-2.5 py-1.5 border-t border-white/5 space-y-1.5 max-h-48 overflow-auto">
          {goal && <p className="text-[10px] text-desktop-muted">目标：{goal.slice(0, 120)}{goal.length > 120 ? '…' : ''}</p>}
          {steps.length > 0 && <div className="text-[10px] text-desktop-muted/80">环节：{steps.map((s, i) => <span key={i} className="block mt-0.5">{s.slice(0, 80)}…</span>)}</div>}
          {content && <pre className="text-[10px] text-desktop-text/90 whitespace-pre-wrap break-words">{content.slice(0, 500)}{content.length > 500 ? '…' : ''}</pre>}
        </div>
      )}
    </div>
  );
}

/** 可展开的工具调用块（与 AI 助手一致）；群组/团队执行用专用卡片展示协作过程 */
function ToolCallBlock({ tc }: { tc: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const tools = useConnectionStore((s) => s.tools);
  const fetchTools = useConnectionStore((s) => s.fetchTools);
  useEffect(() => {
    fetchTools();
  }, [fetchTools]);
  const toolDisplayName = tools.find((t) => t.name === tc.toolName)?.displayName ?? tc.toolName;
  const isGroupRun = tc.toolName === 'x.run_group' && tc.status === 'completed' && tc.output != null && typeof tc.output === 'object' && 'results' in (tc.output as object);
  const isTeamRun = tc.toolName === 'x.run_team' && tc.status === 'completed' && tc.output != null;
  if (isGroupRun) {
    return <GroupRunResultCard input={tc.input as Record<string, unknown>} output={tc.output} />;
  }
  if (isTeamRun) {
    return <TeamRunResultCard input={tc.input as Record<string, unknown>} output={tc.output} />;
  }
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

export function XApp({ metadata }: { metadata?: Record<string, unknown> } = {}) {
  const xProactiveMessages = useConnectionStore((s) => s.xProactiveMessages);
  const setXProactiveMessages = useConnectionStore((s) => s.setXProactiveMessages);
  const markXProactiveRead = useConnectionStore((s) => s.markXProactiveRead);
  const openApp = useDesktopStore((s) => s.openApp);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null; createdAt: string; updatedAt: string }>>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput, draftSaveFailed] = useChatDraft(currentSessionId, 'x');
  const [sessionLoading, setSessionLoading] = useState(true);
  const activeSessionRef = useRef(currentSessionId);
  activeSessionRef.current = currentSessionId;
  const sessionRequestRef = useRef(0);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const activeRunIdRef = useRef<string | null>(null);
  const pendingRunRequestRef = useRef<{ sessionId: string; requestId: string } | null>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const reminderArrivals=useRef(new Map<string,number>());
  const chatRun = useChatRun(currentSessionId, async (run: ChatRunSnapshot) => {
    const requestId = sessionRequestRef.current;
    const requestedAt=Date.now();
    if (activeSessionRef.current !== run.sessionId) return;
    try {
      const saved = await api.getChatMessages(run.sessionId);
      if (requestId !== sessionRequestRef.current || activeSessionRef.current !== run.sessionId) return;
      setMessages(previous=>mergeConcurrentReminders(previous,saved.map((message) => ({ ...message, role: message.role as 'user' | 'assistant', timestamp: new Date(message.createdAt).getTime(), toolCalls: message.toolCalls as ToolCallRecord[] | undefined })),reminderArrivals.current,requestedAt));
      if (activeRunIdRef.current === run.id) setLoading(false);
      api.listChatSessions(50, 'x_direct').then(setSessions).catch(() => {});
    } catch (reason) {
      if (requestId === sessionRequestRef.current && activeSessionRef.current === run.sessionId) setError(`恢复任务记录失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  });
  const receiveReminder=useCallback((message:ReminderMessage)=>setMessages(previous=>previous.some(item=>item.id===message.id)?previous:[...previous,{...message,role:'assistant'}]),[]);
  useReminderMessages(currentSessionId,loading||sessionLoading||chatRun.isRunning,receiveReminder,reminderArrivals);
  const stopRun = async () => {
    if (activeRunIdRef.current || chatRun.isRunning) { await chatRun.stop(); return; }
    try {
      const pending = pendingRunRequestRef.current;
      if (pending) await api.stopChatRunRequest(pending.sessionId, pending.requestId);
      streamControllerRef.current?.abort();
    } catch (reason) {
      setError(`停止未确认：${reason instanceof Error ? reason.message : String(reason)}`);
      void chatRun.refresh();
    }
  };
  const openRunArtifact = (artifact: ChatRunArtifact) => {
    const ext = artifact.name.split('.').pop()?.toLowerCase() ?? '';
    const metadata = { filePath: artifact.path, fileName: artifact.name };
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) openApp('image-viewer', metadata);
    else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'].includes(ext)) openApp('office-viewer', metadata);
    else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) openApp('media-viewer', { ...metadata, mediaType: 'audio' });
    else if (['mp4', 'webm', 'mov'].includes(ext)) openApp('media-viewer', { ...metadata, mediaType: 'video' });
    else openApp('text-editor', metadata);
  };

  const [runNowLoading, setRunNowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [figureImageOk, setFigureImageOk] = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState<{
    running: boolean;
    jobCount: number;
    nextRunAt: number | null;
    nextRunAtISO: string | null;
  } | null>(null);
  const [expandedNotificationId, setExpandedNotificationId] = useState<string | null>(null);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  type DoneLogEntry = { at: number; summary: string; schedule?: string; title?: string; action?: string };
  const [doneLog, setDoneLog] = useState<{ oneTime: DoneLogEntry[]; scheduled: DoneLogEntry[] }>({ oneTime: [], scheduled: [] });
  const [doneLogOpen, setDoneLogOpen] = useState(false);

  useEffect(() => {
    if (!notificationPanelOpen) return;
    const close = (e: MouseEvent) => {
      if (notificationPanelRef.current?.contains(e.target as Node)) return;
      setNotificationPanelOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [notificationPanelOpen]);
  const [groupRunProgress, setGroupRunProgress] = useState<{
    groupId: string;
    goal: string;
    results: Array<{ agentId: string; agentName: string; content?: string }>;
    totalAgents: number;
    currentAgentName?: string;
    done: boolean;
    cancelled?: boolean;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const store = useConnectionStore.getState();
    store.sendWs?.({ type: 'subscribe_app', data: { appId: 'x' } });
    const unsub = store.subscribeAppChannel('x', (message: unknown) => {
      const m = message as { type?: string; groupId?: string; goal?: string; results?: unknown[]; totalAgents?: number; currentAgentName?: string; done?: boolean; cancelled?: boolean };
      if (m?.type === 'group_run_progress') {
        setGroupRunProgress({
          groupId: m.groupId ?? '',
          goal: m.goal ?? '',
          results: Array.isArray(m.results) ? m.results as Array<{ agentId: string; agentName: string; content?: string }> : [],
          totalAgents: typeof m.totalAgents === 'number' ? m.totalAgents : 0,
          currentAgentName: m.currentAgentName,
          done: m.done === true,
          cancelled: m.cancelled,
        });
        if (m.done) {
          setTimeout(() => setGroupRunProgress(null), 4000);
        }
      }
    });
    return () => {
      unsub();
      useConnectionStore.getState().sendWs?.({ type: 'unsubscribe_app', data: { appId: 'x' } });
    };
  }, []);

  const handleCancelGroupRun = () => {
    api.cancelGroupRun().catch(() => {});
  };

  const loadSchedulerStatus = () => {
    api.getXSchedulerStatus().then((r) => {
      setSchedulerStatus({
        running: r.running,
        jobCount: r.jobCount,
        nextRunAt: r.nextRunAt,
        nextRunAtISO: r.nextRunAtISO ?? null,
      });
    }).catch(() => {});
  };

  useEffect(() => {
    loadSchedulerStatus();
  }, []);

  const loadDoneLog = useCallback(() => {
    api.getXDoneLog(30).then((r) => {
      if (r.ok) setDoneLog({ oneTime: r.oneTime ?? [], scheduled: r.scheduled ?? [] });
    }).catch(() => {});
  }, []);
  useEffect(() => {
    loadDoneLog();
  }, [loadDoneLog]);
  useEffect(() => {
    if (doneLogOpen) loadDoneLog();
  }, [doneLogOpen, loadDoneLog]);

  useEffect(() => {
    api.getXProactiveMessages().then((r) => {
      if (Array.isArray(r.messages)) setXProactiveMessages(r.messages);
    }).catch(() => {});
  }, [setXProactiveMessages]);

  const loadSessions = () => {
    api.listChatSessions(50, 'x_direct').then(setSessions).catch(() => {});
  };
  useEffect(() => {
    loadSessions();
  }, []);

  const ensureSessionId = async (): Promise<string> => {
    if (currentSessionId) return currentSessionId;
    const s = await api.createChatSession(undefined, 'x_direct');
    activeSessionRef.current = s.id;
    setCurrentSessionId(s.id);
    api.setUserConfigKey('last_x_session_id', s.id).catch(() => {});
    setSessions((prev) => [{ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }, ...prev]);
    return s.id;
  };

  const selectSession = useCallback((sessionId: string) => {
    if (loadingRef.current) { setError('请先停止当前回复，再切换对话。'); return; }
    const requestId = ++sessionRequestRef.current;
    activeSessionRef.current = sessionId;
    setCurrentSessionId(sessionId);
    setSessionLoading(true);
    setError(null);
    api.setUserConfigKey('last_x_session_id', sessionId).catch(() => {});
    api.getChatMessages(sessionId).then((saved) => {
      if (requestId !== sessionRequestRef.current) return;
      setMessages(saved.map((message) => ({ ...message, role: message.role as 'user' | 'assistant', timestamp: new Date(message.createdAt).getTime(), toolCalls: message.toolCalls as ToolCallRecord[] | undefined })));
    }).catch(() => {
      if (requestId !== sessionRequestRef.current) return;
      activeSessionRef.current = null;
      setCurrentSessionId(null);
      setMessages([]);
      setError('对话记录恢复失败，请重新选择。');
    }).finally(() => { if (requestId === sessionRequestRef.current) setSessionLoading(false); });
  }, []);

  const startNewSession = () => {
    if (loadingRef.current) { setError('请先停止当前回复，再新建对话。'); return; }
    sessionRequestRef.current += 1;
    activeSessionRef.current = null;
    setCurrentSessionId(null);
    setSessionLoading(false);
    setMessages([]);
    setError(null);
    api.setUserConfigKey('last_x_session_id', null).catch(() => {});
  };

  useEffect(() => {
    const requestId = sessionRequestRef.current;
    let cancelled = false;
    if (typeof metadata?.sessionId === 'string' && metadata.sessionId) {
      selectSession(metadata.sessionId);
      return () => { sessionRequestRef.current += 1; };
    }
    api.getUserConfigKey('last_x_session_id').then(({ value }) => {
      if (cancelled || requestId !== sessionRequestRef.current) return;
      if (typeof value === 'string' && value) selectSession(value);
      else setSessionLoading(false);
    }).catch(() => { if (!cancelled && requestId === sessionRequestRef.current) setSessionLoading(false); });
    return () => { cancelled = true; sessionRequestRef.current += 1; };
  }, [selectSession, metadata?.sessionId]);

  // 打开主脑时让 X 发一条开场消息（仅当无当前会话且无消息时）
  useEffect(() => {
    if (currentSessionId != null || sessionLoading) return;
    let cancelled = false;
    api
      .postXGreet()
      .then((r) => {
        if (cancelled || !r?.content) return;
        setMessages((prev) => {
          if (prev.length > 0) return prev;
          return [
            {
              id: `a-greet-${Date.now()}`,
              role: 'assistant',
              content: r.content,
              timestamp: Date.now(),
            },
          ];
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentSessionId, sessionLoading]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, xProactiveMessages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading || sessionLoading || chatRun.restoring || chatRun.isRunning) return;
    const sendEpoch = ++sessionRequestRef.current;
    activeRunIdRef.current = null;
    const controller = new AbortController();
    streamControllerRef.current = controller;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setError(null);
    useDigitalHumanStore.getState().setActivity('thinking');

    let sessionId: string;
    try {
      sessionId = await ensureSessionId();
    } catch {
      setLoading(false);
      setError('创建会话失败');
      useDigitalHumanStore.getState().setActivity('alert', 4000);
      return;
    }
    if (controller.signal.aborted) { setLoading(false); return; }
    const isFirstUserMessage = messages.length === 0;


    const llmConfig = useLLMConfigStore.getState().llmConfig;
    const sel = llmConfig?.defaultByModality?.chat;
    const providerId = sel?.providerId ?? llmConfig?.providers?.[0]?.id;
    const modelId = sel?.modelId ?? '__custom__';
    const provider = llmConfig?.providers?.find((p: { id: string }) => p.id === providerId);

    if (!providerId || !provider) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: '请先在「系统设置 → 大模型配置」中配置聊天模型，我才能在这里和你对话。',
          timestamp: Date.now(),
        },
      ]);
      setLoading(false);
      useDigitalHumanStore.getState().setActivity('alert', 4000);
      return;
    }

    const replyId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: replyId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
      },
    ]);
    try {
      const chatMessages = messages.concat(userMsg).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const desktopState = useDesktopStore.getState();
      const computerContext = formatComputerContextForPrompt(buildComputerContext({
        windows: desktopState.windows,
        activeWindowId: desktopState.activeWindowId,
        taskbarPinned: useConfigStore.getState().taskbarPinned,
        notifications: useConnectionStore.getState().notifications,
      }));
      const requestId = crypto.randomUUID();
      pendingRunRequestRef.current = { sessionId, requestId };
      const content = await api.chatAgentStream(
        {
          messages: chatMessages,
          providerId,
          modelId,
          scene: 'x_direct',
          sessionId,
          requestId,
          computerContext,
          taskSummary: formatTaskSummaryForPrompt(useTaskStore.getState().tasks),
          loadedToolNames: loadedToolNamesX.length > 0 ? loadedToolNamesX : undefined,
        },
        (ev) => {
          if (ev.type === 'tool_complete' && ev.toolName === 'x.create_app') {
            api.getMiniApps().then((r) => setMiniAppsFromApi(r?.apps ?? [])).catch(() => {});
          }
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
          signal: controller.signal,
          onRunStarted: (run) => { if (sendEpoch !== sessionRequestRef.current) return; activeRunIdRef.current = run.runId; chatRun.track(run); },
          onContentChunk: (chunk) => {
            useDigitalHumanStore.getState().setActivity('speaking', 1400);
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
      if (sendEpoch !== sessionRequestRef.current) return;
      const text = typeof content === 'string' ? content : content?.content ?? '';
      if (content && typeof content === 'object' && Array.isArray(content.loadedToolNames)) {
        loadedToolNamesX = content.loadedToolNames;
      }
      const trimmed = (text ?? '').trim();
      useDigitalHumanStore.getState().setActivity('speaking', 3000);
      let finalToolCalls: ToolCallRecord[] | undefined;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === replyId);
        if (idx < 0) return prev;
        const next = [...prev];
        const assistantMsg = next[idx];
        finalToolCalls = assistantMsg.toolCalls;
        next[idx] = { ...assistantMsg, content: trimmed || '（无回复）' };
        return next;
      });
      if (content.serverPersisted && content.runId) void api.getChatRun(content.runId).then(chatRun.accept).catch(() => {});
      else {
        await api.addChatMessage(sessionId, 'user', userMsg.content);
        await api.addChatMessage(sessionId, 'assistant', trimmed || '（无回复）', finalToolCalls);
      }
      if (isFirstUserMessage) {
        api.updateChatSessionTitle(sessionId, text.slice(0, 30)).catch(() => {});
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: text.slice(0, 30), updatedAt: new Date().toISOString() } : s)),
        );
      }
      loadSessions();
    } catch (e: unknown) {
      if (sendEpoch !== sessionRequestRef.current) return;
      const errMsg = e instanceof Error && e.name === 'AbortError' ? '执行已停止。' : e instanceof Error ? e.message : '请求失败';
      void chatRun.refresh();
      setError(errMsg);
      useDigitalHumanStore.getState().setActivity('alert', 4000);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === replyId);
        if (idx < 0) return [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: `出错了：${errMsg}`, timestamp: Date.now() }];
        const next = [...prev];
        next[idx] = { ...next[idx], content: `出错了：${errMsg}` };
        return next;
      });
    } finally {
      if (sendEpoch === sessionRequestRef.current) {
        pendingRunRequestRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleRunNow = async () => {
    if (runNowLoading || loading) return;
    setRunNowLoading(true);
    setError(null);
    useDigitalHumanStore.getState().setActivity('thinking');
    try {
      await api.postLivingAIWake();
      let status = await api.getLivingAIStatus();
      for (let attempt = 0; attempt < 90 && status.inCycle; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        status = await api.getLivingAIStatus();
      }
      const content = status.inCycle
        ? '生命循环已唤醒，X 仍在后台观察与行动；可展开「生命循环」继续查看。'
        : [
            status.state.lastReflection && `反思：${status.state.lastReflection}`,
            status.state.lastAction && `行动：${status.state.lastAction}`,
          ].filter(Boolean).join('\n\n') || '生命循环已完成。';
      setMessages((prev) => [
        ...prev,
        {
          id: `run-${Date.now()}`,
          role: 'assistant',
          content: content,
          timestamp: Date.now(),
        },
      ]);
      useDigitalHumanStore.getState().setActivity('speaking', 3000);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '触发执行失败';
      setError(errMsg);
      useDigitalHumanStore.getState().setActivity('alert', 4000);
      setMessages((prev) => [
        ...prev,
        {
          id: `run-err-${Date.now()}`,
          role: 'assistant',
          content: `【执行失败】${errMsg}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setRunNowLoading(false);
      loadSchedulerStatus();
      loadDoneLog();
    }
  };

  return (
    <div className="flex flex-col h-full bg-desktop-bg text-desktop-text">
      <header className="flex items-center gap-3 px-3 py-2 border-b border-desktop-border shrink-0">
        {/* X 形象：有 x-figure.png / x-talking.mp4 时展示，说话时播视频 */}
        <div className="relative w-10 h-10 rounded-full overflow-hidden bg-desktop-surface flex-shrink-0">
          {loading ? (
            <video
              src="/x-talking.mp4"
              className="w-full h-full object-cover"
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <>
              <img
                src="/x-figure.png"
                alt="X"
                className={figureImageOk ? 'w-full h-full object-cover' : 'absolute opacity-0 w-0 h-0'}
                onLoad={() => setFigureImageOk(true)}
                onError={() => setFigureImageOk(false)}
              />
              {!figureImageOk && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-desktop-accent" />
                </span>
              )}
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className="font-medium">X 主脑</span>
          <span className="text-xs text-desktop-muted ml-1 block truncate">电脑是 X 的身体；与你平等对话并持续自主运行</span>
          {schedulerStatus != null && (
            <span className="text-xs text-desktop-muted mt-0.5 block truncate" title="定时任务状态，便于确认是否正常">
              {schedulerStatus.running
                ? `定时：运行中 · ${schedulerStatus.jobCount === 0 ? '暂无任务' : `${schedulerStatus.jobCount} 个任务`}${schedulerStatus.nextRunAt != null ? ` · 下次 ${formatNextRun(schedulerStatus.nextRunAt)}` : ''}`
                : '定时：未运行'}
            </span>
          )}
        </div>
        {/* X 通知：下拉面板，与对话记录分离 */}
        <div className="relative shrink-0" ref={notificationPanelRef}>
          <button
            type="button"
            onClick={() => setNotificationPanelOpen((o) => !o)}
            className="relative rounded-lg border border-desktop-border bg-desktop-surface px-2.5 py-1.5 text-xs font-medium text-desktop-text hover:bg-desktop-surface/80 flex items-center gap-1.5"
            title="X 通知"
          >
            <Bell className="w-3.5 h-3.5 text-desktop-muted" />
            <span className="hidden sm:inline">通知</span>
            {xProactiveMessages.filter((m) => !m.read).length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 bg-desktop-highlight text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                {xProactiveMessages.filter((m) => !m.read).length}
              </span>
            )}
          </button>
          {notificationPanelOpen && (
            <div className="absolute right-0 top-full mt-1 w-[min(320px,100vw-24px)] max-h-[70vh] overflow-hidden rounded-xl border border-desktop-border bg-desktop-surface shadow-xl z-50 flex flex-col">
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-desktop-muted border-b border-desktop-border shrink-0">
                <Bell className="w-3.5 h-3.5" />
                X 通知
                {xProactiveMessages.length > 0 && (
                  <span className="text-desktop-muted/70">({xProactiveMessages.filter((m) => !m.read).length} 未读)</span>
                )}
              </div>
              <ul className="overflow-y-auto p-2 space-y-1.5 min-h-0">
                {xProactiveMessages.length === 0 ? (
                  <li className="text-[11px] text-desktop-muted/70 px-2 py-3 text-center">暂无通知</li>
                ) : (
                  xProactiveMessages.map((msg) => {
                    const meta = TYPE_LABELS[msg.type] ?? TYPE_LABELS.info;
                    const Icon = meta.icon;
                    const isRead = !!msg.read;
                    const isExpanded = expandedNotificationId === msg.id;
                    return (
                      <li
                        key={msg.id}
                        className={`rounded-lg border text-[11px] overflow-hidden ${isRead ? 'border-desktop-border/50 bg-desktop-bg/50 opacity-90' : 'border-desktop-border bg-desktop-bg'}`}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedNotificationId((id) => (id === msg.id ? null : msg.id))}
                          className="w-full text-left p-2 flex items-start justify-between gap-1 hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Icon className="w-3 h-3 shrink-0 text-desktop-muted" />
                            <span className="text-desktop-muted truncate">{meta.label}</span>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 shrink-0 text-desktop-muted" />
                          ) : (
                            <ChevronRight className="w-3 h-3 shrink-0 text-desktop-muted" />
                          )}
                        </button>
                        <div className="px-2 pb-2 pt-0 border-t border-desktop-border/50">
                          <p
                            className={`text-desktop-text whitespace-pre-wrap break-words ${isExpanded ? 'max-h-48 overflow-y-auto' : 'line-clamp-2'}`}
                          >
                            {msg.content}
                          </p>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-desktop-muted/60">
                              {new Date(msg.createdAt).toLocaleString('zh-CN', {
                                timeZone: DISPLAY_TIMEZONE,
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {!isRead && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markXProactiveRead(msg.id);
                                }}
                                className="text-[10px] text-desktop-muted hover:text-desktop-text"
                              >
                                标为已读
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleRunNow}
          disabled={runNowLoading || loading}
          className="shrink-0 rounded-lg border border-desktop-border bg-desktop-surface px-3 py-1.5 text-xs font-medium text-desktop-text hover:bg-desktop-surface/80 disabled:opacity-50 flex items-center gap-1.5"
          title="立即让 X 按定时任务方式执行一次（自检、读对话、更新提示词等），可观察 X 如何操作"
        >
          {runNowLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          立即执行一次
        </button>
        <LivingAIStatusPanel />
      </header>

      <div className="flex-1 flex flex-col sm:flex-row min-h-0 overflow-hidden">
        {/* 左侧：仅对话记录 */}
        <aside className="w-full sm:w-48 shrink-0 border-b sm:border-b-0 sm:border-r border-desktop-border flex flex-col bg-desktop-surface/30 overflow-hidden max-h-[35%] sm:max-h-none">
          <div className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-desktop-muted border-b border-desktop-border shrink-0">
            <MessageSquare className="w-3.5 h-3.5" />
            对话记录
          </div>
          <div className="shrink-0 px-2 py-1.5 border-b border-desktop-border">
            <button
              type="button"
              onClick={startNewSession}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-desktop-border bg-desktop-bg/50 px-2 py-1.5 text-xs text-desktop-text hover:bg-desktop-bg active:bg-desktop-bg transition-colors touch-manipulation"
            >
              <Plus className="w-3.5 h-3.5" />
              新对话
            </button>
          </div>
          <ul className="min-h-[60px] max-h-[120px] sm:max-h-none sm:flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-2 space-y-1 min-h-0">
            {sessions.length === 0 ? (
              <li className="text-[11px] text-desktop-muted/70 px-1 py-1">暂无记录</li>
            ) : (
              sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selectSession(s.id)}
                    className={`w-full text-left rounded-lg px-2 py-1.5 text-[11px] truncate block transition-colors ${
                      currentSessionId === s.id ? 'bg-desktop-accent/20 text-desktop-text border border-desktop-accent/40' : 'text-desktop-muted hover:bg-white/5 border border-transparent'
                    }`}
                    title={s.title ?? new Date(s.updatedAt).toLocaleString('zh-CN')}
                  >
                    {s.title || '未命名对话'}
                  </button>
                </li>
              ))
            )}
          </ul>
          {/* 近期已完成：X 记录的一次性事项与定时任务执行记录 */}
          <div className="shrink-0 border-t border-desktop-border">
            <button
              type="button"
              onClick={() => setDoneLogOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-1 px-2 py-1.5 text-[11px] text-desktop-muted hover:text-desktop-text hover:bg-white/5 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                近期已完成
                {(doneLog.oneTime.length + doneLog.scheduled.length) > 0 && (
                  <span className="text-desktop-muted/70">({doneLog.oneTime.length + doneLog.scheduled.length})</span>
                )}
              </span>
              {doneLogOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            {doneLogOpen && (
              <div className="px-2 pb-2 pt-0 max-h-[200px] overflow-y-auto space-y-2">
                {doneLog.oneTime.length === 0 && doneLog.scheduled.length === 0 ? (
                  <p className="text-[10px] text-desktop-muted/70 px-1">暂无记录</p>
                ) : (
                  <>
                    {doneLog.scheduled.length > 0 && (
                      <div>
                        <p className="text-[10px] text-desktop-muted/80 font-medium px-1 mb-0.5">定时/周期（可重复）</p>
                        <ul className="space-y-0.5">
                          {doneLog.scheduled.slice(0, 10).map((e, i) => (
                            <li key={i} className="text-[10px] text-desktop-text/90 px-1.5 py-0.5 rounded border border-desktop-border/30 bg-desktop-bg/30">
                              <span className="text-desktop-muted/70 block">
                                {new Date(e.at).toLocaleString('zh-CN', { timeZone: DISPLAY_TIMEZONE, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {e.schedule || e.title || e.action ? (
                                <>
                                  {e.schedule && <span className="text-desktop-accent/90 font-medium">[{e.schedule}] </span>}
                                  {e.title && <span>{e.title}</span>}
                                  {e.action && <span className="text-desktop-muted/90">{(e.schedule || e.title) ? ' · ' : ''}{e.action}</span>}
                                </>
                              ) : (
                                e.summary
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {doneLog.oneTime.length > 0 && (
                      <div>
                        <p className="text-[10px] text-desktop-muted/80 font-medium px-1 mb-0.5">一次性（勿重复）</p>
                        <ul className="space-y-0.5">
                          {doneLog.oneTime.slice(0, 10).map((e, i) => (
                            <li key={i} className="text-[10px] text-desktop-text/90 px-1.5 py-0.5 rounded border border-desktop-border/30 bg-desktop-bg/30">
                              <span className="text-desktop-muted/70 block">
                                {new Date(e.at).toLocaleString('zh-CN', { timeZone: DISPLAY_TIMEZONE, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {e.schedule || e.title || e.action ? (
                                <>
                                  {e.schedule && <span className="text-desktop-accent/90 font-medium">[{e.schedule}] </span>}
                                  {e.title && <span>{e.title}</span>}
                                  {e.action && <span className="text-desktop-muted/90">{(e.schedule || e.title) ? ' · ' : ''}{e.action}</span>}
                                </>
                              ) : (
                                e.summary
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* 右侧：仅对话区域 */}
        <section className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
            <section className="flex-1 flex flex-col px-4 py-3 overflow-hidden">
          {messages.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-desktop-muted text-sm text-center px-4">
              <p>这里是 X 主脑的专属入口。</p>
              <p className="mt-2">你可以直接和 X 对话；X 需要你时也会在这里发消息给你。</p>
            </div>
          )}
          <ChatRunPanel run={chatRun.run} error={chatRun.error} onStop={() => void chatRun.stop()} onResume={() => void chatRun.resume()} onRefresh={chatRun.refresh} onRunChanged={chatRun.follow} sessionId={currentSessionId} onOpen={openRunArtifact} />
          {sessionLoading && <p role="status" className="text-xs text-desktop-muted my-2">正在恢复对话和交办记录…</p>}
          <div className="flex-1 overflow-auto space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {m.role === 'user' ? (
                  <div className="w-7 h-7 rounded-full bg-desktop-highlight/30 flex items-center justify-center shrink-0 mt-0.5">
                    <User size={14} className="text-desktop-text" />
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-full bg-desktop-accent flex items-center justify-center shrink-0 mt-0.5">
                    <Brain size={14} className="text-desktop-highlight" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-desktop-highlight/20 text-desktop-text'
                      : 'bg-white/5 text-desktop-text/90 border border-white/5'
                  }`}
                >
                  {m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="space-y-1">
                      {m.toolCalls.map((tc) => (
                        <ToolCallBlock key={tc.id} tc={tc} />
                      ))}
                    </div>
                  )}
                  {(m.content || (m.role === 'assistant' && loading && messages[messages.length - 1]?.id === m.id)) && (
                    <div className={m.toolCalls?.length ? 'mt-2' : ''}>
                      {m.role === 'assistant' ? (
                        <div className="chat-markdown text-desktop-text/90 leading-relaxed [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-white/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_strong]:font-semibold [&_a]:text-desktop-highlight [&_a]:underline [&_table]:border-collapse [&_th]:border [&_th]:border-white/20 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-white/20 [&_td]:px-2 [&_td]:py-1">
                          <MarkdownContent content={m.content || (loading ? '…' : '')} />
                        </div>
                      ) : (
                        <span className="whitespace-pre-wrap">{m.content}</span>
                      )}
                    </div>
                  )}
                  {m.role === 'assistant' && m.images && m.images.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.images.map((src, i) => (
                        <div key={i} className="rounded-lg border border-white/10 overflow-hidden max-w-[200px] bg-white/5">
                          <img src={src} alt={`图 ${i + 1}`} className="w-full h-auto object-cover block max-h-[180px]" />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-0.5 mt-1.5">
                    <span className="text-[9px] text-desktop-muted/40">
                      {new Date(m.timestamp).toLocaleTimeString('zh-CN', { timeZone: DISPLAY_TIMEZONE, hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {typeof m.content === 'string' && m.content.length > 0 && (
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-white/10 text-desktop-muted hover:text-desktop-text transition-colors ml-1"
                        onClick={() => {
                          const text = String(m.content);
                          if (!text) return;
                          navigator.clipboard?.writeText(text).then(
                            () => { /* 复制成功，无需提示 */ },
                            () => { /* 静默处理复制失败 */ },
                          );
                        }}
                        title="复制"
                      >
                        <Copy size={10} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {error && (
            <p className="text-red-500 text-sm mb-2 px-1">{error}</p>
          )}
          {groupRunProgress && (
            <div className="mb-2 rounded-lg border border-desktop-accent/40 bg-desktop-accent/10 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-desktop-text">
                {groupRunProgress.done ? (
                  groupRunProgress.cancelled ? '群组执行已停止' : '群组执行完成'
                ) : (
                  <>
                    群组执行中：{groupRunProgress.results.length}/{groupRunProgress.totalAgents || groupRunProgress.results.length} 人
                    {groupRunProgress.currentAgentName && `，当前：${groupRunProgress.currentAgentName}`}
                  </>
                )}
              </span>
              {!groupRunProgress.done && (
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  onClick={handleCancelGroupRun}
                >
                  <Square size={10} />
                  停止
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
            </section>
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-white/5 bg-white/[0.02]">
            {draftSaveFailed && <p role="alert" className="text-sm text-amber-300">草稿没能存好，关页面前请先复制这段话。</p>}
            <div className="flex items-end gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/10 focus-within:border-desktop-highlight/30 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={(e) => {
                  if (shouldSubmitChat(e)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="和 X 说点什么… (Shift+Enter 换行，Enter 发送)"
                className="flex-1 bg-transparent outline-none text-xs text-desktop-text resize-none max-h-[120px] placeholder:text-desktop-muted/50 leading-relaxed min-h-[24px] py-0.5"
                rows={1}
                disabled={loading || sessionLoading}
              />
              {(loading || chatRun.isRunning) ? <button type="button" onClick={() => void stopRun()} disabled={chatRun.run?.status === 'stopping'} title="停止执行" className="p-2 rounded-lg bg-red-500/15 text-red-400"><Square size={14} /></button> : <button
                type="button"
                onClick={handleSend}
                disabled={sessionLoading || chatRun.restoring || !input.trim()}
                className={`p-1.5 rounded-lg transition-all shrink-0 mb-0.5 ${
                  input.trim() && !loading
                    ? 'bg-desktop-highlight hover:bg-desktop-highlight/80 text-white'
                    : 'bg-white/5 text-desktop-muted'
                }`}
              >
                <Send size={13} />
              </button>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
