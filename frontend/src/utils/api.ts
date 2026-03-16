/**
 * API client for X-Computer backend.
 * All requests go through the Vite proxy at /api → localhost:4000/api
 */

import { getSystemLogStore } from '@/store/systemLogStore';
import { getUserId, getUserIdOrNull } from './userId.js';
import i18n from '../i18n.js';

/** MCP 服务器配置（与后端、Cursor mcp.json 兼容） */
export interface McpServerConfig {
  id: string;
  /** HTTP 传输：JSON-RPC 端点 URL；支持 ${VAR} 从 env 或环境变量替换 */
  url?: string;
  /** Stdio 传输：启动命令，如 npx */
  command?: string;
  /** Stdio 传输：命令参数，如 ["bing-cn-mcp"] */
  args?: string[];
  name?: string;
  /** HTTP 传输：请求头（如 API Key）；值支持 ${VAR} 替换 */
  headers?: Record<string, string>;
  /** 环境变量（Cursor 兼容）：URL/headers 中 ${VAR} 的替换来源，可填 API Key 等 */
  env?: Record<string, string>;
}

/** MCP 工具列表项（tools/list 返回，含参数 schema） */
export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
}

/** MCP 测试接口返回 */
export interface McpTestResponse {
  ok: boolean;
  toolsCount?: number;
  tools?: McpToolSchema[];
  error?: string;
}

/** 将 mcpServers 对象或 servers 数组规范化为 McpServerConfig[] */
export function normalizeMcpConfig(config: unknown): McpServerConfig[] {
  if (Array.isArray(config)) {
    return config.filter((s) => s && typeof s.id === 'string');
  }
  const obj = config as Record<string, unknown>;
  if (obj && typeof obj === 'object' && typeof obj.id === 'string' && (obj.url || obj.command)) {
    return [obj as unknown as McpServerConfig];
  }
  const mcpServers = obj?.mcpServers;
  if (mcpServers && typeof mcpServers === 'object') {
    return Object.entries(mcpServers).map(([id, cfg]) => {
      const c = (cfg ?? {}) as Record<string, unknown>;
      return { id, ...c, name: (c.name as string) ?? id } as McpServerConfig;
    });
  }
  const servers = obj?.servers;
  if (Array.isArray(servers)) {
    return servers.filter((s) => s && typeof s.id === 'string');
  }
  return [];
}

const BASE = '/api';

/** API 错误：含 status、code，便于前端友好展示 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 判断是否为配额超限错误（429 或 quota_exceeded），便于统一展示升级入口 */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof ApiError && (err.code === 'quota_exceeded' || err.status === 429)) return true;
  const msg = (err as { message?: string })?.message ?? String(err);
  return msg.includes('quota_exceeded') || /quota|429|limit/i.test(msg);
}

function logApiError(opts: {
  path: string;
  method?: string;
  status?: number;
  message: string;
  detail?: string;
}) {
  try {
    const isSystemLogsEndpoint = opts.path.includes('config/system_logs');
    getSystemLogStore().addLog(
      {
        level: 'error',
        category: 'system',
        source: 'api',
        message: opts.message,
        detail: opts.detail,
        url: opts.path,
        method: opts.method,
      },
      isSystemLogsEndpoint ? { skipCloudSync: true } : undefined,
    );
  } catch (_) {
    // avoid breaking callers if store fails
  }
}

/** 构建包含 userId、Accept-Language 的请求头 */
function getDefaultHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const userId = getUserIdOrNull();
  if (userId) headers['X-User-Id'] = userId;
  try {
    const lng = i18n.language || navigator.language;
    headers['Accept-Language'] = lng?.startsWith('zh') ? 'zh-CN' : 'en';
  } catch {
    headers['Accept-Language'] = 'en';
  }
  return headers;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const method = options?.method ?? 'GET';
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...getDefaultHeaders(), ...(options?.headers as Record<string, string> ?? {}) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const code = err?.error;
      const message = err?.message || (typeof code === 'string' ? code : null) || `HTTP ${res.status}`;
      const detail = typeof err === 'object' ? JSON.stringify(err, null, 2) : String(err);
      logApiError({ path: url, method, status: res.status, message, detail });
      throw new ApiError(String(message), res.status, typeof code === 'string' ? code : undefined, err);
    }
    return res.json();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('HTTP')) {
      throw e; // already logged above
    }
    const message = e instanceof Error ? e.message : String(e);
    const detail = e instanceof Error ? e.stack : undefined;
    logApiError({ path: url, method, message, detail });
    throw e;
  }
}

// ── Tasks ──────────────────────────────────────────────────

export const api = {
  // Tasks
  createTask: (data: {
    domain: string;
    title: string;
    description: string;
    mode?: string;
    llmConfig?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string };
    useLlmPlan?: boolean;
    chatContext?: Array<{ role: string; content: string }>;
  }) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),

  getTasks: () => request<any[]>('/tasks'),

  getTask: (id: string) => request<any>(`/tasks/${id}`),

  pauseTask: (id: string) =>
    request(`/tasks/${id}/pause`, { method: 'POST' }),

  resumeTask: (id: string) =>
    request(`/tasks/${id}/resume`, { method: 'POST' }),

  approveStep: (taskId: string, stepId: string) =>
    request(`/tasks/${taskId}/steps/${stepId}/approve`, { method: 'POST' }),

  rejectStep: (taskId: string, stepId: string) =>
    request(`/tasks/${taskId}/steps/${stepId}/reject`, { method: 'POST' }),

  /** 失败任务重试：mode 'restart' 从头，'from_failure' 从失败步骤起 */
  retryTask: (id: string, mode: 'restart' | 'from_failure' = 'restart') =>
    request<{ success: boolean; mode: string }>(`/tasks/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  // Mode
  getMode: () => request<{ mode: string }>('/mode'),

  getXProactiveMessages: () =>
    request<{ messages: Array<{ id: string; content: string; type: string; createdAt: number; read?: boolean }> }>('/x/proactive-messages'),

  /** 标记 X 主动消息为已读（用户点击已读或 X 通过工具标记） */
  markXProactiveMessageRead: (id: string) =>
    request<{ success: boolean; marked: number }>('/x/proactive-messages/read', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  /** 定时任务状态：是否在跑、任务数、下次运行时间，便于确认定时是否正常 */
  getXSchedulerStatus: () =>
    request<{
      running: boolean;
      jobCount: number;
      nextRunAt: number | null;
      nextRunAtISO: string | null;
      jobs: Array<{ id: string; intent: string; runAt: number; runAtISO: string; cron?: string }>;
    }>('/x/scheduler-status'),

  /** X 近期已完成清单（一次性 + 定时/周期），供界面展示 */
  /** 近期已完成：条目含 summary，定时任务可有 schedule/title/action 便于解析展示 */
  getXDoneLog: (limit?: number) =>
    request<{
      ok: boolean;
      oneTime: Array<{ at: number; summary: string; schedule?: string; title?: string; action?: string }>;
      scheduled: Array<{ at: number; summary: string; schedule?: string; title?: string; action?: string }>;
    }>(limit != null ? `/x/done-log?limit=${limit}` : '/x/done-log'),

  /** 获取认证配置（是否允许注册等，无需登录） */
  authGetSettings: () => request<{ allowRegister: boolean }>('/auth/settings'),

  /** 获取验证码（登录/注册前调用） */
  authGetCaptcha: () =>
    request<{ id: string; question: string }>('/auth/captcha'),

  /** 注册：邮箱+密码+验证码；若当前为匿名则自动将匿名数据关联到新账号 */
  authRegister: (email: string, password: string, captchaId: string, captchaAnswer: string) =>
    request<{ userId: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, captchaId, captchaAnswer }),
    }),

  /** 登录：邮箱+密码+验证码；若当前为匿名则自动将匿名数据关联到该账号 */
  authLogin: (email: string, password: string, captchaId: string, captchaAnswer: string) =>
    request<{ userId: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, captchaId, captchaAnswer }),
    }),

  /** 请求密码重置验证码 */
  authRequestPasswordReset: (email: string) =>
    request<{ success: boolean; message?: string; code?: string }>('/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  /** 使用验证码重置密码 */
  authResetPassword: (email: string, code: string, newPassword: string) =>
    request<{ success: boolean; message?: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword }),
    }),

  /** 获取当前用户订阅信息（套餐、额度、使用量）。需已登录，匿名返回 401。canConfigureLLM 表示是否可配置大模型（仅专业版） */
  getSubscriptionMe: () =>
    request<{
      subscription: {
        id: string;
        planId: string;
        status: string;
        billingCycle: string;
        currentPeriodStart: number;
        currentPeriodEnd: number;
        cancelAtPeriodEnd?: boolean;
      } | null;
      limits: { aiCallsLimit: number; storageLimit: number; concurrentTasksLimit: number };
      usage: { aiCalls: number; storage: number; tasks: number };
      canConfigureLLM?: boolean;
    }>('/subscriptions/me'),

  /** 获取所有可用套餐 */
  getSubscriptionPlans: () =>
    request<{ plans: Array<{ id: string; name: string; displayNameEn: string; displayNameZh: string; priceMonthly: number; priceYearly: number; aiCallsLimit: number; storageLimit: number; concurrentTasksLimit: number; features: string[] }> }>('/subscriptions/plans'),

  /** 获取当前用户使用历史 */
  getSubscriptionUsage: (limit?: number) =>
    request<{ history: Array<{ id: string; resourceType: string; amount: number; periodStart: number; periodEnd: number; createdAt: number }> }>(`/subscriptions/me/usage${limit != null ? `?limit=${limit}` : ''}`),

  /** 获取当前用户账单/发票历史 */
  getSubscriptionInvoices: (limit?: number) =>
    request<{ invoices: Array<{ id: string; subscriptionId: string | null; amount: number; currency: string; status: string; stripeInvoiceId: string | null; description: string | null; createdAt: number }> }>(`/subscriptions/me/invoices${limit != null ? `?limit=${limit}` : ''}`),

  /** 创建 Stripe Checkout 跳转升级/购买 */
  postSubscriptionCheckout: (planId: string, billingCycle: 'monthly' | 'yearly', trialPeriodDays?: number) =>
    request<{ sessionId: string; url: string }>('/subscriptions/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, billingCycle, trialPeriodDays }),
    }),

  /** 取消订阅（周期结束时生效） */
  postSubscriptionCancel: () =>
    request<{ success: boolean; message?: string }>('/subscriptions/me/cancel', { method: 'POST' }),

  /** 重新激活已取消的订阅 */
  postSubscriptionReactivate: () =>
    request<{ success: boolean; message?: string }>('/subscriptions/me/reactivate', { method: 'POST' }),

  /** 打开 X 主脑时调用，X 发一条开场消息 */
  postXGreet: () => request<{ content: string }>('/x/greet', { method: 'POST' }),

  /** 用户手动触发 X 立即执行一次（与定时任务同流程）。可选 intent；可选 llm 配置（与系统设置一致时后端优先使用，避免未同步到云端时报未配置） */
  postXRunNow: (intent?: string, llm?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string }) =>
    request<{ content: string; error?: string }>('/x/run-now', {
      method: 'POST',
      body: JSON.stringify({
        ...(intent != null && intent !== '' ? { intent } : {}),
        ...(llm?.providerId && llm?.modelId
          ? {
              providerId: llm.providerId,
              modelId: llm.modelId,
              ...(llm.baseUrl != null ? { baseUrl: llm.baseUrl } : {}),
              ...(llm.apiKey != null ? { apiKey: llm.apiKey } : {}),
            }
          : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
    }),

  setMode: (mode: string) =>
    request('/mode', { method: 'POST', body: JSON.stringify({ mode }) }),

  // Tools
  getTools: () => request<any[]>('/tools'),

  // Policy
  getRules: () => request<any[]>('/policy/rules'),

  // Audit
  getAudit: (limit = 100) => request<any[]>(`/audit?limit=${limit}`),

  getTaskAudit: (taskId: string) => request<any[]>(`/audit/task/${taskId}`),

  // Server Logs
  getServerLogs: (limit = 200) =>
    request<any[]>(`/logs?limit=${limit}`),

  clearServerLogs: () =>
    request<{ success: boolean }>('/logs', { method: 'DELETE' }),

  // Health
  health: () => request<any>('/health'),

  // File system (new)
  listFiles: (path: string) =>
    request<any>(`/fs?path=${encodeURIComponent(path)}`),

  readFile: (path: string) =>
    request<any>(`/fs/read?path=${encodeURIComponent(path)}`),

  writeFile: (path: string, content: string) =>
    request('/fs/write', { method: 'POST', body: JSON.stringify({ path, content }) }),

  /** 将二进制内容（base64）写入沙箱路径，如图片保存到沙箱 */
  writeFileBinary: (path: string, contentBase64: string) =>
    request<{ success: boolean; path: string }>('/fs/write-binary', {
      method: 'POST',
      body: JSON.stringify({ path, contentBase64 }),
    }),

  /** 读取办公文档（docx/xlsx）为可编辑内容 */
  readOfficeFile: (path: string) =>
    request<{ type: 'docx' | 'xlsx' | 'pptx'; path: string; text?: string; sheets?: { name: string; rows: string[][] }[]; unsupported?: boolean; message?: string }>(
      `/fs/read-office?path=${encodeURIComponent(path)}`,
    ),

  /** 保存办公文档；content: docx 为 { text, title? }，xlsx 为 { sheets: [{ name, rows }] } */
  writeOfficeFile: (path: string, type: 'docx' | 'xlsx', content: { text?: string; title?: string; sheets?: { name: string; rows: string[][] }[] }) =>
    request<{ success: boolean; path: string }>('/fs/write-office', {
      method: 'POST',
      body: JSON.stringify({ path, type, content }),
    }),

  /** 获取沙箱在宿主机上的绝对路径 */
  getWorkspacePath: () =>
    request<{ path: string }>('/fs/workspace-path'),

  createDir: (path: string) =>
    request('/fs/mkdir', { method: 'POST', body: JSON.stringify({ path }) }),

  deleteFile: (path: string) =>
    request('/fs/delete', { method: 'POST', body: JSON.stringify({ path }) }),

  renameFile: (oldPath: string, newPath: string) =>
    request('/fs/rename', { method: 'POST', body: JSON.stringify({ oldPath, newPath }) }),

  /** 下载文件：触发浏览器下载（带 X-User-Id 以使用当前用户沙箱，避免找不到文件） */
  downloadFile: async (path: string, fileName?: string) => {
    const url = `/api/fs/download?path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { headers: { 'X-User-Id': getUserId() } });
    if (!res.ok) {
      const text = await res.text();
      let msg = text || `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j && typeof j.error === 'string') msg = j.error;
      } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName || path.split('/').pop() || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  },

  /** 上传文件到沙箱：FormData，字段名 file，可选 path（目标路径）。带 X-User-Id 以使用当前用户沙箱。 */
  uploadFile: async (file: File, targetPath?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (targetPath) formData.append('path', targetPath);
    const headers: Record<string, string> = {};
    const userId = getUserIdOrNull();
    if (userId) headers['X-User-Id'] = userId;
    const res = await fetch('/api/fs/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json() as Promise<{ success: boolean; path: string; fileName: string; size: number }>;
  },

  // Shell (new)
  execCommand: (command: string, cwd?: string) =>
    request<any>('/shell/exec', { method: 'POST', body: JSON.stringify({ command, cwd }) }),

  // Chat (P2: 普通对话走真实 LLM，支持 scene 注入主脑提示)
  chat: (body: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    scene?: string;
    capabilities?: string;
    computerContext?: string;
    taskSummary?: string;
    memory?: string;
  }) => request<{ content: string }>('/chat', { method: 'POST', body: JSON.stringify(body) }),

  /** 主脑欢迎语（与后端一致） */
  getWelcomeMessage: () =>
    request<{ content: string }>('/prompts/welcome'),

  /** 任务完成后 AI 助手回复：根据任务结果生成「任务完成了，根据结果xxxx，我xxxx」风格摘要 */
  taskCompletionReply: (params: {
    sessionId?: string;
    taskId: string;
    userMessage?: string;
    task: { title?: string; description?: string; status?: string; result?: { success?: boolean; output?: unknown; error?: string }; steps?: Array<{ action?: string; output?: unknown; error?: string }> };
  }) =>
    request<{ content: string }>('/chat/task-completion-reply', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  /** 记忆状态（对齐 OpenClaw status）：索引条数、memory 文件数、最近嵌入错误等 */
  memoryStatus: () =>
    request<{
      vectorEnabled: boolean;
      indexCount: number;
      filesInMemory: number;
      indexPath: string;
      workspaceRoot: string;
      lastEmbedError?: string;
    }>('/memory/status'),

  /** 向量/关键词召回。若传 vectorConfig 则 POST 走向量检索，否则 GET 走关键词 */
  memoryRecall: (params?: {
    query?: string;
    days?: number;
    topK?: number;
    vectorConfig?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string };
  }) => {
    const vec = params?.vectorConfig;
    if (vec?.providerId && vec?.modelId && params?.query) {
      return request<{ content: string }>('/memory/recall', {
        method: 'POST',
        body: JSON.stringify({
          query: params.query,
          days: params.days ?? 2,
          topK: params.topK ?? 5,
          providerId: vec.providerId,
          modelId: vec.modelId,
          baseUrl: vec.baseUrl,
          apiKey: vec.apiKey,
        }),
      });
    }
    const sp = new URLSearchParams();
    if (params?.query) sp.set('q', params.query);
    if (params?.days != null) sp.set('days', String(params.days));
    const qs = sp.toString();
    return request<{ content: string }>(`/memory/recall${qs ? `?${qs}` : ''}`);
  },

  /** 记忆捕获：写入当日 Daily，可选 type 为 preference/decision 时同时写入 MEMORY；传 vectorConfig 则建向量索引 */
  memoryCapture: (body: {
    content: string;
    type?: 'preference' | 'decision' | 'fact';
    vectorConfig?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string };
  }) => {
    const payload = body.vectorConfig
      ? { content: body.content, type: body.type, ...body.vectorConfig }
      : { content: body.content, type: body.type };
    return request<{ success: boolean }>('/memory/capture', { method: 'POST', body: JSON.stringify(payload) });
  },

  /** 测试向量嵌入连接（校验配置是否可用） */
  memoryTestEmbedding: (vectorConfig: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string }) =>
    request<{ ok: boolean; error?: string; dimensions?: number }>('/memory/test-embedding', {
      method: 'POST',
      body: JSON.stringify(vectorConfig),
    }),

  /** 从 memory/*.md 重建向量索引（适用于已有大量记忆文件但未建索引时） */
  memoryRebuildIndex: (vectorConfig: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string }) =>
    request<{ indexed: number; filesFound?: number; fileNames?: string[]; workspaceRoot?: string; error?: string; embedError?: string }>('/memory/rebuild-index', {
      method: 'POST',
      body: JSON.stringify(vectorConfig),
    }),

  /** MCP 状态：已加载的服务器与工具数 */
  mcpStatus: () =>
    request<{ servers: { id: string; name?: string; url: string; toolsCount: number; error?: string }[]; totalTools: number }>('/mcp/status'),

  /** MCP 配置：获取当前配置（用于界面展示） */
  mcpGetConfig: () =>
    request<{ servers: McpServerConfig[]; configPath: string; fromEnv: boolean }>('/mcp/config'),

  /** MCP 配置：保存并重载。支持 { servers } 或 { mcpServers } 格式 */
  mcpSaveConfig: (payload: { servers?: McpServerConfig[]; mcpServers?: Record<string, Record<string, unknown>> }) =>
    request<{ success: boolean; configPath: string; result: { servers: unknown[]; totalTools: number } }>('/mcp/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** MCP 测试：测试单个服务器连接，返回工具列表（含 inputSchema） */
  mcpTest: (server: McpServerConfig) =>
    request<McpTestResponse>('/mcp/test', {
      method: 'POST',
      body: JSON.stringify(server),
    }),

  /** MCP Registry 搜索：从 registry.modelcontextprotocol.io 搜索 MCP 服务器 */
  mcpRegistrySearch: (query: string, limit?: number) => {
    const params = new URLSearchParams({ q: query });
    if (typeof limit === 'number') params.set('limit', String(limit));
    return request<{ ok: boolean; servers?: Array<{ name: string; title?: string; description?: string; version?: string; websiteUrl?: string; config: { id: string; name?: string; url?: string; command?: string; args?: string[]; headers?: Record<string, string>; env?: Record<string, string> } }>; error?: string }>(`/mcp/registry/search?${params}`);
  },

  /** MCP 重载：从文件/环境变量重新加载 */
  mcpReload: () =>
    request<{ success: boolean; result: { servers: unknown[]; totalTools: number } }>('/mcp/reload', {
      method: 'POST',
    }),

  /** Skill 发现：扫描 skills 目录，返回可配置的 Skill 列表。extract=llm 时对无 configFields 的 Skill 用大模型提取 */
  getSkills: (opts?: { extract?: 'llm' }) => {
    const q = opts?.extract === 'llm' ? '?extract=llm' : '';
    return request<Array<{ id: string; name: string; description: string; requiresApiKey: boolean; dirName: string; configFields?: Array<{ key: string; label?: string; description?: string }> }>>(`/skills${q}`);
  },

  /** Skill 搜索：从 SkillHub 搜索技能 */
  searchSkills: (query: string, limit?: number) => {
    const params = new URLSearchParams({ q: query });
    if (typeof limit === 'number') params.set('limit', String(limit));
    return request<{ ok: boolean; skills?: Array<{ slug: string; version?: string; description: string; score?: number }>; error?: string }>(`/skills/search?${params}`);
  },

  /** 精选 Skill 推荐：返回预设推荐列表，已安装的会标记 installed */
  getRecommendedSkills: () =>
    request<Array<{ slug: string; name: string; description: string; category?: string; installed: boolean }>>('/skills/recommended'),

  /** 安装 Skill：source 格式 skillhub:<slug> */
  installSkill: (source: string) =>
    request<{ success: boolean; message?: string; dirName?: string }>('/skills/install', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),

  /** 删除 Skill：移除 skills/<dirName> 目录 */
  deleteSkill: (dirName: string) =>
    request<{ success: boolean }>(`/skills/${encodeURIComponent(dirName)}`, { method: 'DELETE' }),

  /** 自动记忆判断：根据本轮对话由 LLM 判断是否写入记忆（OpenClaw 式）；传 vectorConfig 则写入后建向量索引 */
  /** 根据用户问题与 AI 回复，生成 2～4 个建议追问（用于回复下方展示） */
  suggestFollowUps: (body: {
    userMessage: string;
    assistantReply: string;
    providerId?: string;
    modelId?: string;
    baseUrl?: string;
    apiKey?: string;
  }) =>
    request<{ suggestions: string[] }>('/chat/suggest-follow-ups', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  memoryConsiderCapture: (body: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    vectorConfig?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string };
  }) => {
    const { vectorConfig, ...rest } = body;
    const payload = {
      ...rest,
      ...(vectorConfig
        ? {
            vectorProviderId: vectorConfig.providerId,
            vectorModelId: vectorConfig.modelId,
            vectorBaseUrl: vectorConfig.baseUrl,
            vectorApiKey: vectorConfig.apiKey,
          }
        : {}),
    };
    return request<{ ok?: boolean }>('/memory/consider-capture', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 写作意图分类：调用后端主脑 intent_classify 场景 */
  classifyWritingIntent: (body: {
    userMessage: string;
    hasOpenAiDocument: boolean;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  }) =>
    request<{ intent: 'generate_image' | 'generate_and_save_to_editor' | 'save_to_editor' | 'edit_current_document' | 'normal_chat' | 'create_task'; suggestedPath?: string }>('/chat/classify-writing-intent', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 图片生成：使用配置的 image 模态模型，根据描述生成图片（OpenRouter modalities: ["image"]） */
  generateImage: (body: { prompt: string; providerId: string; modelId: string; baseUrl?: string; apiKey?: string }) =>
    request<{ content: string; images: string[] }>('/chat/generate-image', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 从一条 AI 回复中提取「仅正文」：使用主脑 extract_clean_content 场景 */
  extractCleanContent: async (body: {
    message: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<string> => {
    const res = await request<{ content: string }>('/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{ role: 'user', content: body.message }],
        scene: 'extract_clean_content',
        providerId: body.providerId,
        modelId: body.modelId,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
      }),
    });
    const out = (res?.content ?? '').trim();
    return out || body.message;
  },

  /** 带 tools 的聊天；支持 scene 注入主脑提示 */
  chatWithTools: (body: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    scene?: string;
    capabilities?: string;
    computerContext?: string;
    taskSummary?: string;
    memory?: string;
  }) =>
    request<{
      content: string;
      toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
      /** 本轮所有工具调用记录（含服务端执行的 MCP 等），供前端展示调用过程 */
      toolCallHistory?: Array<{ id: string; name: string; input: Record<string, unknown>; output?: unknown; error?: string; duration?: number }>;
    }>('/chat/with-tools', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 聊天 Agent 循环：带工具执行。loadedToolNames：按需加载模式下本会话已加载的工具，由上次响应返回，跨消息持久化。 */
  chatAgent: (body: {
    messages: Array<{ role: string; content: string }>;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    scene?: string;
    computerContext?: string;
    taskSummary?: string;
    memory?: string;
    referenceImagePaths?: string[];
    attachedFilePaths?: string[];
    loadedToolNames?: string[];
  }) =>
    request<{ content: string; loadedToolNames?: string[] }>('/chat/agent', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** 聊天 Agent 流式：SSE 推送工具调用进度及内容片段。loadedToolNames 按需加载模式下本会话已加载的工具。返回 { content, loadedToolNames? }。 */
  chatAgentStream: async (
    body: {
      messages: Array<{ role: string; content: string }>;
      providerId: string;
      modelId: string;
      baseUrl?: string;
      apiKey?: string;
      scene?: string;
      computerContext?: string;
      taskSummary?: string;
      memory?: string;
      agentId?: string;
      referenceImagePaths?: string[];
      attachedFilePaths?: string[];
      loadedToolNames?: string[];
    },
    onToolEvent: (event: { type: string; id?: string; toolName?: string; input?: object; output?: unknown; error?: string; duration?: number }) => void,
    opts?: AbortSignal | { signal?: AbortSignal; onContentChunk?: (chunk: string) => void },
  ): Promise<{ content: string; loadedToolNames?: string[] }> => {
    const optsObj = opts && typeof opts === 'object' && !('aborted' in opts) ? opts : { signal: opts as AbortSignal | undefined };
    const signal = optsObj.signal;
    let loadedToolNames: string[] | undefined;
    const res = await fetch(`${BASE}/chat/agent/stream`, {
      method: 'POST',
      headers: getDefaultHeaders(),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('无法读取流');
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\n\n+/);
        buffer = parts.pop() ?? '';
        for (const block of parts) {
          let eventType = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ') && eventType) {
              const data = line.slice(6);
              try {
                const obj = JSON.parse(data);
                if (eventType === 'tool_start') {
                  onToolEvent({ type: 'tool_start', id: obj.id, toolName: obj.toolName, input: obj.input });
                } else if (eventType === 'tool_complete') {
                  onToolEvent({
                    type: 'tool_complete',
                    id: obj.id,
                    toolName: obj.toolName,
                    output: obj.output,
                    error: obj.error,
                    duration: obj.duration,
                  });
                } else if (eventType === 'content_chunk' && typeof obj.content === 'string') {
                  optsObj.onContentChunk?.(obj.content);
                } else if (eventType === 'done') {
                  content = obj.content ?? '';
                  if (Array.isArray(obj.loadedToolNames)) loadedToolNames = obj.loadedToolNames;
                } else if (eventType === 'error') {
                  throw new Error(obj.error || '未知错误');
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return loadedToolNames?.length ? { content, loadedToolNames } : { content };
  },

  /** 流式聊天：支持 scene 注入主脑提示；onChunk 每收到一段内容调用一次。可选 signal 用于中止请求。 */
  chatStream: async (
    body: {
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      providerId: string;
      modelId: string;
      baseUrl?: string;
      apiKey?: string;
      scene?: string;
      capabilities?: string;
      computerContext?: string;
      taskSummary?: string;
      memory?: string;
    },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> => {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: getDefaultHeaders(),
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const message = err?.error || `HTTP ${res.status}`;
      const detail = typeof err === 'object' ? JSON.stringify(err, null, 2) : String(err);
      logApiError({ path: `${BASE}/chat`, method: 'POST', status: res.status, message, detail });
      throw new Error(message);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('无法读取流');
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data) as { content?: string; error?: string };
              if (parsed.error) throw new Error(parsed.error);
              if (typeof parsed.content === 'string') {
                full += parsed.content;
                onChunk(parsed.content);
              }
            } catch (e) {
              if (e instanceof Error) throw e;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return full;
  },

  /** 编辑器 Agent 流式写入：主 AI 对话驱动，后端根据 instruction 流式生成并推送到指定编辑器（通过 WebSocket editor_stream），先返回 202 接受请求 */
  editorAgentStream: (body: {
    windowId: string;
    instruction: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  }) =>
    request<{ ok: boolean; windowId: string }>('/chat/editor-agent-stream', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 用户与配置 API ──────────────────────────────────────

  /** 获取当前用户信息 */
  getMe: () =>
    request<{ id: string; displayName: string | null; email: string | null; createdAt: string; updatedAt: string }>('/users/me'),

  /** 获取所有用户配置 */
  getUserConfig: () => request<Record<string, unknown>>('/users/me/config'),

  /** 批量更新用户配置 */
  setUserConfig: (config: Record<string, unknown>) =>
    request<{ success: boolean }>('/users/me/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  /** 拉取 IMAP 收件箱邮件，供邮件应用展示。需登录并配置 IMAP（设置→通知/邮件） */
  getEmailInbox: (limit = 20) =>
    request<{ ok: boolean; emails: Array<{ uid: number; from: string; subject: string; date?: string; text?: string; unseen?: boolean }>; error?: string }>(
      `/email/inbox?limit=${limit}`,
    ),

  /** R052 WhatsApp 状态 */
  getWhatsAppStatus: () =>
    request<{ ok: boolean; enabled: boolean; status: string; allowFrom: string[]; allowSelfChat?: boolean; proxy?: string; error?: string }>('/whatsapp/status'),

  /** R052 WhatsApp 系统代理检测（macOS）：返回当前系统代理 URL */
  getWhatsAppSystemProxy: () =>
    request<{ ok: boolean; proxy?: string; error?: string }>('/whatsapp/system-proxy'),

  /** R052 WhatsApp 登录，返回 QR 码或 alreadyConnected。可选传 proxy 覆盖当前配置 */
  whatsAppLogin: (proxy?: string) =>
    request<{ ok: boolean; qr?: string; alreadyConnected?: boolean; error?: string }>(
      '/whatsapp/login',
      { method: 'POST', body: JSON.stringify(proxy ? { proxy } : {}) },
    ),

  /** R052 WhatsApp 登出 */
  whatsAppLogout: () =>
    request<{ ok: boolean; message?: string; error?: string }>('/whatsapp/logout', { method: 'POST' }),

  /** R052 WhatsApp 收件箱 */
  getWhatsAppInbox: (limit = 20) =>
    request<{
      ok: boolean;
      messages: Array<{ id: string; fromJid: string; text?: string; timestamp?: number; isGroup: boolean; unseen: boolean; createdAt: string }>;
      error?: string;
    }>(`/whatsapp/inbox?limit=${limit}`),

  // ── Telegram ──
  getTelegramStatus: () =>
    request<{ ok: boolean; enabled: boolean; status: string; botInfo?: { username?: string; id?: number }; allowFrom: string[]; dmPolicy?: string; error?: string }>('/telegram/status'),
  telegramConnect: () =>
    request<{ ok: boolean; error?: string }>('/telegram/connect', { method: 'POST' }),
  telegramDisconnect: () =>
    request<{ ok: boolean; error?: string }>('/telegram/disconnect', { method: 'POST' }),
  getTelegramInbox: (limit = 20) =>
    request<{ ok: boolean; messages: Array<{ id: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup: boolean }>; error?: string }>(`/telegram/inbox?limit=${limit}`),

  // ── Discord ──
  getDiscordStatus: () =>
    request<{ ok: boolean; enabled: boolean; status: string; botInfo?: { username?: string; id?: string }; allowFrom: string[]; dmPolicy?: string; error?: string }>('/discord/status'),
  discordConnect: () =>
    request<{ ok: boolean; error?: string }>('/discord/connect', { method: 'POST' }),
  discordDisconnect: () =>
    request<{ ok: boolean; error?: string }>('/discord/disconnect', { method: 'POST' }),
  getDiscordInbox: (limit = 20) =>
    request<{ ok: boolean; messages: Array<{ id: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup: boolean }>; error?: string }>(`/discord/inbox?limit=${limit}`),

  // ── Slack ──
  getSlackStatus: () =>
    request<{ ok: boolean; enabled: boolean; status: string; allowFrom: string[]; dmPolicy?: string; error?: string }>('/slack/status'),
  slackConnect: () =>
    request<{ ok: boolean; error?: string }>('/slack/connect', { method: 'POST' }),
  slackDisconnect: () =>
    request<{ ok: boolean; error?: string }>('/slack/disconnect', { method: 'POST' }),
  getSlackInbox: (limit = 20) =>
    request<{ ok: boolean; messages: Array<{ id: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup: boolean }>; error?: string }>(`/slack/inbox?limit=${limit}`),

  // ── QQ 渠道
  getQQStatus: () =>
    request<{ ok: boolean; enabled: boolean; status: string; botInfo?: { id?: string; username?: string }; dmPolicy?: string; groupPolicy?: string; selfOpenid?: string | null; error?: string }>('/qq/status'),
  qqConnect: () =>
    request<{ ok: boolean; error?: string }>('/qq/connect', { method: 'POST' }),
  qqDisconnect: () =>
    request<{ ok: boolean; error?: string }>('/qq/disconnect', { method: 'POST' }),
  getQQInbox: (limit = 20) =>
    request<{ ok: boolean; messages: Array<{ id: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup: boolean }>; error?: string }>(`/qq/inbox?limit=${limit}`),

  /** 获取单个配置 */
  getUserConfigKey: (key: string) =>
    request<{ key: string; value: unknown }>(`/users/me/config/${key}`),

  /** 更新单个配置 */
  /** X 制作的小程序列表（按用户隔离） */
  getMiniApps: () =>
    request<{ apps: Array<{ id: string; name: string; path: string }> }>('/apps'),

  /** X 智能体管理：与 x.create_agent / x.list_agents 共用同一存储 */
  listAgents: () =>
    request<{ agents: Array<{ id: string; name: string; role?: string; systemPrompt: string; toolNames: string[]; goalTemplate?: string; outputDescription?: string; createdAt: number; updatedAt: number }> }>('/agents'),
  createAgent: (body: { name: string; system_prompt: string; tool_names?: string[]; role?: string; goal_template?: string; output_description?: string }) =>
    request<{ agent: { id: string; name: string; role?: string; systemPrompt: string; toolNames: string[]; goalTemplate?: string; outputDescription?: string; createdAt: number; updatedAt: number }; message: string }>('/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id: string, body: { name?: string; system_prompt?: string; tool_names?: string[]; role?: string; goal_template?: string; output_description?: string }) =>
    request<{ agent: { id: string; name: string; role?: string; systemPrompt: string; toolNames: string[]; goalTemplate?: string; outputDescription?: string; createdAt: number; updatedAt: number }; message: string }>(`/agents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  removeAgent: (id: string) =>
    request<{ message: string }>(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** X 智能体团队：与 x.create_team / x.list_teams / x.run_team 共用同一存储 */
  listTeams: () =>
    request<{ teams: Array<{ id: string; name: string; agentIds: string[]; createdAt: number; updatedAt: number }> }>('/teams'),
  createTeam: (body: { name: string; agent_ids: string[] }) =>
    request<{ team: { id: string; name: string; agentIds: string[]; createdAt: number; updatedAt: number }; message: string }>('/teams', { method: 'POST', body: JSON.stringify(body) }),
  updateTeam: (id: string, body: { name?: string; agent_ids?: string[] }) =>
    request<{ team: { id: string; name: string; agentIds: string[]; createdAt: number; updatedAt: number }; message: string }>(`/teams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  removeTeam: (id: string) =>
    request<{ message: string }>(`/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** X 智能体群组：与 x.create_group / x.list_groups / x.run_group 共用同一存储 */
  listGroups: () =>
    request<{ groups: Array<{ id: string; name: string; agentIds: string[]; createdAt: number; updatedAt: number }> }>('/groups'),
  createGroup: (body: { name: string; agent_ids?: string[] }) =>
    request<{ group: { id: string; name: string; agentIds: string[]; createdAt: number; updatedAt: number }; message: string }>('/groups', { method: 'POST', body: JSON.stringify(body) }),
  updateGroup: (id: string, body: { name?: string; agent_ids?: string[] }) =>
    request<{ group: { id: string; name: string; agentIds: string[]; createdAt: number; updatedAt: number }; message: string }>(`/groups/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  removeGroup: (id: string) =>
    request<{ message: string }>(`/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** 请求停止当前用户正在执行的群组任务（x.run_group 会在每名成员间检查） */
  cancelGroupRun: () =>
    request<{ success: boolean; message?: string }>('/x/cancel-group-run', { method: 'POST' }),

  /** 群组执行记录（对话与工作过程），可选按 groupId 筛选 */
  getGroupRunHistory: (params?: { groupId?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.groupId) q.set('groupId', params.groupId);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const query = q.toString();
    return request<{ runs: Array<{ id: string; groupId: string; groupName: string; goal: string; results: Array<{ agentId: string; agentName: string; content: string }>; cancelled?: boolean; createdAt: number }> }>(
      `/x/group-run-history${query ? `?${query}` : ''}`,
    );
  },

  setUserConfigKey: (key: string, value: unknown) =>
    request<{ success: boolean }>(`/users/me/config/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  /** 从提供商 baseUrl 导入模型列表（服务端代理，避免 CORS） */
  importLLMModels: (baseUrl: string, apiKey?: string) =>
    request<{ models: Array<{ id: string; name?: string }> }>('/llm/import-models', {
      method: 'POST',
      body: JSON.stringify({ baseUrl, apiKey: apiKey ?? '' }),
    }),

  // ── 聊天会话 API（云端持久化）──────────────────────────

  /** 获取会话列表；scene 可选：x_direct（仅 X 主脑）、normal_chat（仅 AI 助手） */
  listChatSessions: (limit = 50, scene?: string) =>
    request<Array<{ id: string; title: string | null; createdAt: string; updatedAt: string }>>(
      scene ? `/chat/sessions?limit=${limit}&scene=${encodeURIComponent(scene)}` : `/chat/sessions?limit=${limit}`,
    ),

  /** 创建新会话；scene 可选：x_direct（X 主脑）、normal_chat（AI 助手） */
  createChatSession: (title?: string, scene?: string) =>
    request<{ id: string; title: string | null; createdAt: string; updatedAt: string }>(
      '/chat/sessions',
      { method: 'POST', body: JSON.stringify({ title, scene }) },
    ),

  /** 获取会话详情 */
  getChatSession: (sessionId: string) =>
    request<{ id: string; title: string | null; createdAt: string; updatedAt: string }>(
      `/chat/sessions/${sessionId}`,
    ),

  /** 更新会话标题 */
  updateChatSessionTitle: (sessionId: string, title: string) =>
    request<{ success: boolean }>(`/chat/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    }),

  /** 删除会话 */
  deleteChatSession: (sessionId: string) =>
    request<{ success: boolean }>(`/chat/sessions/${sessionId}`, { method: 'DELETE' }),

  /** 获取会话消息 */
  getChatMessages: (sessionId: string, limit = 200) =>
    request<
      Array<{
        id: string;
        role: string;
        content: string;
        toolCalls?: unknown;
        images?: string[];
        attachedFiles?: Array<{ name: string; path: string }>;
        createdAt: string;
      }>
    >(`/chat/sessions/${sessionId}/messages?limit=${limit}`),

  /** 追加消息到会话。images: 图片路径或 URL；attachedFiles: 用户附带文档 [{ name, path }] */
  addChatMessage: (
    sessionId: string,
    role: string,
    content: string,
    toolCalls?: unknown,
    images?: string[],
    attachedFiles?: Array<{ name: string; path: string }>,
  ) =>
    request<{
      id: string;
      role: string;
      content: string;
      toolCalls?: unknown;
      images?: string[];
      attachedFiles?: Array<{ name: string; path: string }>;
      createdAt: string;
    }>(`/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role, content, toolCalls, images, attachedFiles }),
    }),

  /** 删除单条消息 */
  deleteChatMessage: (sessionId: string, messageId: string) =>
    request<{ success: boolean }>(`/chat/sessions/${sessionId}/messages/${messageId}`, {
      method: 'DELETE',
    }),

  // ── X Board (任务看板) ──────────────────────────────────

  getBoardItems: () =>
    request<{ ok: boolean; items: Array<{ id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }> }>('/x/board'),

  createBoardItem: (data: { title: string; description?: string; status?: string; priority?: string }) =>
    request<{ ok: boolean; item: { id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string } }>('/x/board', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateBoardItem: (id: string, data: { title?: string; description?: string; status?: string; priority?: string; sort_order?: number }) =>
    request<{ ok: boolean; item: { id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string } }>(`/x/board/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteBoardItem: (id: string) =>
    request<{ ok: boolean }>(`/x/board/${id}`, { method: 'DELETE' }),

  // ── 服务器管理 ──────────────────────────────────
  
  listServers: () =>
    request<{
      count: number;
      servers: Array<{
        serverId: string;
        name: string;
        host: string;
        port: number;
        username: string;
        authType: 'password' | 'privateKey';
        description?: string;
        tags?: string[];
        createdAt: string;
      }>;
    }>('/servers'),

  addServer: (data: {
    name: string;
    host: string;
    port?: number;
    username: string;
    authType: 'password' | 'privateKey';
    password?: string;
    privateKey?: string;
    passphrase?: string;
    description?: string;
    tags?: string[];
  }) =>
    request<{
      serverId: string;
      name: string;
      host: string;
      port: number;
      username: string;
      message: string;
    }>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateServer: (serverId: string, data: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    authType?: 'password' | 'privateKey';
    password?: string;
    privateKey?: string;
    passphrase?: string;
    description?: string;
    tags?: string[];
  }) =>
    request<{ success: boolean }>(`/servers/${serverId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteServer: (serverId: string) =>
    request<{ success: boolean }>(`/servers/${serverId}`, { method: 'DELETE' }),

  testServerConnection: (serverId: string) =>
    request<{
      serverId: string;
      success: boolean;
      message: string;
      duration: number;
    }>(`/servers/${serverId}/test`, { method: 'POST' }),

  // Admin（需管理员权限）
  adminCheck: () => request<{ admin: boolean }>('/admin/check'),
  adminListUsers: (params?: { limit?: number; offset?: number; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    if (params?.search) q.set('search', params.search);
    return request<{
      users: Array<{
        id: string;
        displayName: string | null;
        email: string | null;
        createdAt: string;
        updatedAt: string;
        banned: boolean;
        planId?: string;
        planStatus?: string | null;
        limits?: { aiCallsLimit: number; storageLimit: number; concurrentTasksLimit: number } | null;
        usage?: { aiCalls: number; storage: number; tasks: number } | null;
      }>;
      total: number;
    }>(`/admin/users?${q.toString()}`);
  },
  adminGetUser: (userId: string) =>
    request<{ id: string; displayName: string | null; email: string | null; createdAt: string; updatedAt: string; banned: boolean }>(`/admin/users/${encodeURIComponent(userId)}`),
  adminBanUser: (userId: string) =>
    request<{ success: boolean; banned: boolean }>(`/admin/users/${encodeURIComponent(userId)}/ban`, { method: 'POST' }),
  adminUnbanUser: (userId: string) =>
    request<{ success: boolean; banned: boolean }>(`/admin/users/${encodeURIComponent(userId)}/unban`, { method: 'POST' }),
  adminSetUserPlan: (userId: string, planId: string, billingCycle?: 'monthly' | 'yearly') =>
    request<{ success: boolean; planId: string; billingCycle: string }>(`/admin/users/${encodeURIComponent(userId)}/plan`, {
      method: 'POST',
      body: JSON.stringify({ planId, billingCycle: billingCycle ?? 'monthly' }),
    }),
  adminGetPlans: () =>
    request<{ plans: Array<{ id: string; name: string; displayNameEn: string; displayNameZh: string; aiCallsLimit: number; storageLimit: number; concurrentTasksLimit: number }> }>('/admin/plans'),
  adminStats: () =>
    request<{ totalUsers: number; totalTasks: number }>('/admin/stats'),
  adminConfig: () =>
    request<{ allowRegister: boolean }>('/admin/config'),
};
