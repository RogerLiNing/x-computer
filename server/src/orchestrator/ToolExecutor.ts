import { v4 as uuid } from 'uuid';
import { spawn } from 'child_process';
import type { TaskStep, ToolCall, ToolDefinition, RuntimeType, TaskLLMConfig, AgentDefinition, AgentTeam, AgentGroup, MiniAppDefinition, CreateTaskRequest, Task } from '../../../shared/src/index.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { MiniAppLogStore } from '../miniAppLogStore.js';
import { callLLM, callLLMWithTools, callLLMGenerateImage, type LLMToolDef } from '../chat/chatService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { getDiscoveredSkills, getSkillContentByName, deleteSkill } from '../skills/discovery.js';
import { installFromSkillHub, installFromUrl, searchSkillHub } from '../skills/install.js';
import { getSkillToolsToRegister } from '../skills/skillTools.js';
import { addMessage as addXProactiveMessage, markRead as markXProactiveRead } from '../x/XProactiveMessages.js';
import { broadcastToAppChannel } from '../wsBroadcast.js';
import { getDefaultScheduler } from '../scheduler/XScheduler.js';
import { MemoryService } from '../memory/MemoryService.js';
import { callEmbedding } from '../memory/embeddingService.js';
import { getAudioApiConfig, callFalSoundEffect, callFalMusic } from '../audio/falAudio.js';
import { callFalImage } from '../audio/falImage.js';
import { callDashScopeReferenceToVideo, callDashScopeText2Video, callDashScopeImage2Video } from '../video/dashscopeVideo.js';
import type { AppDatabase } from '../db/database.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';
import { listAllCapabilities } from '../capabilities/CapabilityRegistry.js';
import { getToolVectorStore } from '../capabilities/ToolVectorStore.js';
import { callEmbeddingBatch } from '../memory/embeddingService.js';
import { fetchModelsFromProvider as fetchModelsFromProviderServer } from '../llm/fetchModels.js';
import { loadTriggers, saveTriggers, fireSignal, type SignalTrigger } from '../signals/signalService.js';
import * as workflowClient from '../workflow/workflowClient.js';
import { sendEmail, parseSmtpConfigExport, clearEmailTransporterCache, fetchEmails, parseImapConfig } from '../email/emailService.js';
import { sendWhatsAppMessage, parseWhatsAppConfig } from '../whatsapp/whatsappService.js';
import { sendTelegramMessage, parseTelegramConfig } from '../telegram/telegramService.js';
import { sendDiscordMessage, parseDiscordConfig } from '../discord/discordService.js';
import { sendSlackMessage, parseSlackConfig } from '../slack/slackService.js';
import { sendQQMessage, parseQQConfig } from '../qq/qqService.js';
import { normalizeMcpConfig } from '../mcp/loadAndRegister.js';
import { searchMcpRegistry } from '../mcp/registry.js';
import type { McpServerConfig } from '../mcp/types.js';
import type { ToolExecutorDeps } from './tools/types.js';
import { decodeHtmlEntities } from './tools/utils.js';
import { fileDefinitions, createFileHandlers } from './tools/file/index.js';
import { grepDefinition, createGrepHandler } from './tools/grep.js';
import { shellRunDefinition, createShellRunHandler } from './tools/shell/run.js';
import {
  dockerRunDefinition,
  createDockerRunHandler,
  dockerListDefinition,
  createDockerListHandler,
  dockerLogsDefinition,
  createDockerLogsHandler,
  dockerStopDefinition,
  createDockerStopHandler,
  dockerExecDefinition,
  createDockerExecHandler,
  dockerPullDefinition,
  createDockerPullHandler,
} from './tools/docker/manage.js';
import {
  dockerShellEnterDefinition,
  createDockerShellEnterHandler,
  dockerShellExecDefinition,
  createDockerShellExecHandler,
  dockerShellExitDefinition,
  createDockerShellExitHandler,
  dockerShellListDefinition,
  createDockerShellListHandler,
  dockerShellInteractiveDefinition,
  createDockerShellInteractiveHandler,
} from './tools/docker/shell.js';
import {
  serverAddDefinition,
  createServerAddHandler,
  serverListDefinition,
  createServerListHandler,
  serverConnectDefinition,
  createServerConnectHandler,
  serverExecDefinition,
  createServerExecHandler,
  serverDisconnectDefinition,
  createServerDisconnectHandler,
  serverUploadDefinition,
  createServerUploadHandler,
  serverDownloadDefinition,
  createServerDownloadHandler,
  serverRemoveDefinition,
  createServerRemoveHandler,
  serverTestDefinition,
  createServerTestHandler,
} from './tools/server/manage.js';
import { parseAgentIds } from '../utils/agentIds.js';

/**
 * ToolExecutor — executes individual task steps by dispatching to tool handlers.
 *
 * Each tool runs inside the designated runtime (container or VM).
 * When sandboxFS is provided, file.write and file.read use the real sandbox; otherwise simulated.
 * When execution context provides llmConfig, llm.generate uses real LLM and can use function call file_write to write to sandbox.
 */

/** fal.media CDN 下载超时（毫秒），国内服务器可能较慢，默认 15 分钟；可设环境变量 FAL_MEDIA_DOWNLOAD_TIMEOUT_MS */
const FAL_MEDIA_DOWNLOAD_TIMEOUT_MS =
  typeof process.env.FAL_MEDIA_DOWNLOAD_TIMEOUT_MS === 'string' && process.env.FAL_MEDIA_DOWNLOAD_TIMEOUT_MS.trim()
    ? Math.max(30_000, parseInt(process.env.FAL_MEDIA_DOWNLOAD_TIMEOUT_MS.trim(), 10) || 900_000)
    : 900_000;

/** 并行分段下载的并发数，可设 FAL_MEDIA_PARALLEL_CHUNKS（默认 4） */
const FAL_MEDIA_PARALLEL_CHUNKS =
  typeof process.env.FAL_MEDIA_PARALLEL_CHUNKS === 'string' && process.env.FAL_MEDIA_PARALLEL_CHUNKS.trim()
    ? Math.min(8, Math.max(2, parseInt(process.env.FAL_MEDIA_PARALLEL_CHUNKS.trim(), 10) || 4))
    : 4;

async function fetchWithLongTimeout(
  url: string,
  timeoutMs: number = FAL_MEDIA_DOWNLOAD_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(to);
    return res;
  } catch (e) {
    clearTimeout(to);
    if ((e as Error).name === 'AbortError') throw new Error(`下载超时（${timeoutMs / 1000} 秒），fal.media 在国内较慢，可设 FAL_MEDIA_DOWNLOAD_TIMEOUT_MS 加大超时`);
    throw e;
  }
}

/**
 * 并行分段下载 fal.media 文件（使用 Range 请求，多连接可提速）。
 * 若服务器不支持 Range 或获取失败，回退到单次 fetch。
 */
async function fetchFalMediaParallel(url: string): Promise<Buffer> {
  const timeoutMs = FAL_MEDIA_DOWNLOAD_TIMEOUT_MS;
  const chunkTimeout = Math.ceil(timeoutMs / 2);

  const getTotalSize = async (): Promise<number> => {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new Error(`HEAD 失败: ${res.status}`);
    const cl = res.headers.get('content-length');
    if (cl) return parseInt(cl, 10);
    const rangeRes = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const cr = rangeRes.headers.get('content-range');
    if (cr) {
      const m = /bytes 0-0\/(\d+)/.exec(cr);
      if (m) return parseInt(m[1]!, 10);
    }
    return -1;
  };

  try {
    const total = await getTotalSize();
    if (total <= 0 || total < 32 * 1024) {
      const res = await fetchWithLongTimeout(url, timeoutMs);
      if (!res.ok) throw new Error(`下载失败: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }

    const n = Math.min(FAL_MEDIA_PARALLEL_CHUNKS, Math.ceil(total / 64_000));
    const chunkSize = Math.ceil(total / n);
    const ranges: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, total - 1);
      ranges.push([start, end]);
    }

    const chunks = await Promise.all(
      ranges.map(async ([start, end]) => {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), chunkTimeout);
        try {
          const res = await fetch(url, {
            headers: { Range: `bytes=${start}-${end}` },
            signal: controller.signal,
          });
          clearTimeout(to);
          if (!res.ok && res.status !== 206) throw new Error(`Range 下载失败: ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        } catch (e) {
          clearTimeout(to);
          throw e;
        }
      }),
    );

    return Buffer.concat(chunks);
  } catch {
    const res = await fetchWithLongTimeout(url, timeoutMs);
    if (!res.ok) throw new Error(`下载失败: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

/** 部分工具的必填参数：用于执行前校验，避免大模型反复用空参数调用导致死循环 */
const TOOL_REQUIRED_PARAMS: Record<string, string[]> = {
  'file.write': ['path'],
  'file.read': ['path'],
  'file.replace': ['path'],
  'file.parse': ['path'],
  'file.tail': ['path'],
  'grep': ['pattern'],
  'shell.run': ['command'],
};

function validateToolInput(toolName: string, toolInput: Record<string, unknown> | undefined): { invalid: true; message: string } | { invalid: false } {
  const required = TOOL_REQUIRED_PARAMS[toolName];
  if (!required?.length) return { invalid: false };
  const input = toolInput ?? {};
  const missing = required.filter((k) => {
    const v = input[k];
    return v == null || (typeof v === 'string' && (v as string).trim() === '');
  });
  if (missing.length === 0) return { invalid: false };
  return {
    invalid: true,
    message: `[参数不完整] ${toolName} 需要传入有效参数：${required.join('、')}，当前缺少或为空：${missing.join('、')}。请勿再次用空参数调用该工具；若无法确定参数，请直接以文字回复用户说明情况或询问用户。`,
  };
}

/** Tool definition for LLM function call: write content to a file in sandbox (only when user asks). */
const FILE_WRITE_TOOL: LLMToolDef = {
  name: 'file_write',
  description: '将你生成的回复内容写入沙箱内的文件。仅当用户明确要求保存到文件、写入文件、保存为文件时使用。path 为沙箱内相对路径如 文档/输出.txt；content 必须是你生成的结果正文（不是用户的问题或输入）。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '沙箱内相对路径，例如 文档/xxx.txt' },
      content: { type: 'string', description: '要写入文件的完整内容' },
    },
    required: ['path', 'content'],
  },
};

/** 群组执行进度（推送给前端，便于用户看到协作过程并可打断） */
export type GroupRunProgressPayload = {
  groupId: string;
  goal: string;
  results: Array<{ agentId: string; agentName: string; content?: string }>;
  totalAgents: number;
  currentAgentName?: string;
  done: boolean;
  cancelled?: boolean;
};

export interface ExecutionContext {
  llmConfig?: TaskLLMConfig;
  /** 用于按用户隔离沙箱（Agent 循环 / 任务执行时传入） */
  userId?: string;
  /** 当执行 X 创建的 agent 时传入，工具使用该 agent 的独立目录 */
  agentId?: string;
  /** 读取用户配置（如 skill_config），由调用方注入；可返回 Promise（MySQL 等异步 DB） */
  getConfig?: (userId: string, key: string) => string | undefined | Promise<string | undefined>;
  /** 写入用户配置；可返回 Promise（MySQL 等异步 DB） */
  setConfig?: (userId: string, key: string, value: string) => void | Promise<void>;
  /** 本轮之前各工具调用的返回内容（如搜索结果），供 llm.generate 合成时使用，避免「基于以下搜索结果」却未附上结果 */
  recentToolResults?: string;
  /** 群组执行开始时清除取消标志 */
  clearGroupRunCancel?: (userId: string) => void;
  /** 是否已请求取消当前用户的群组执行（用户点击停止时设为 true） */
  isGroupRunCancelRequested?: (userId: string) => boolean;
  /** 群组执行进度（每完成一名成员或全部完成时调用，便于前端展示并可打断） */
  onGroupRunProgress?: (userId: string, data: GroupRunProgressPayload) => void;
  /** 按用户重载 MCP 配置（x.add/update/remove_mcp_server 后立即生效） */
  reloadMcpForUser?: (userId: string) => Promise<void>;
  /** 任务元数据（如 sourceMessage 包含渠道消息的发送者信息） */
  taskMetadata?: Record<string, unknown>;
}

type ToolHandler = (input: Record<string, unknown>, context?: ExecutionContext) => Promise<unknown>;

/** 按 scope 存储的动态工具（如 mcp:userId），供多用户 MCP 隔离 */
const SCOPE_MCP_PREFIX = 'mcp:';

/** 主脑自我进化提示词：读/写由系统按用户隔离存储的 EVOLVED_CORE_PROMPT */
export interface EvolvedPromptService {
  read(userId?: string): Promise<string>;
  append(userId: string | undefined, content: string): Promise<void>;
}

/** 供 X 主脑读取「用户与 AI 助手」近期对话（用于感知助手表现并优化助手提示词） */
export type GetRecentAssistantChat = (userId: string, limit?: number) => Promise<string>;

/** 运行 X 创建的智能体（由 Orchestrator 注入，供 x.run_agent 使用） */
export type RunCustomAgentLoop = (params: {
  agentDef: AgentDefinition;
  goal: string;
  userId: string;
}) => Promise<{ content: string }>;

const X_AGENTS_CONFIG_KEY = 'x_agents';
const X_MINI_APPS_CONFIG_KEY = 'x_mini_apps';
const LLM_CONFIG_KEY = 'llm_config';
const LLM_IMPORTED_MODELS_KEY = 'llm_imported_models';

/** llm_config 存储格式（与前端系统设置同步） */
interface LLMConfigStored {
  providers: Array<{ id: string; name: string; baseUrl?: string; apiKey?: string }>;
  defaultByModality?: Record<string, { providerId: string; modelId: string }>;
}

/** 导入/自定义模型：id 必填，name 可选（与 llm/fetchModels 一致） */
interface ImportedModel {
  id: string;
  name?: string;
}

type ImportedModelsByProvider = Record<string, ImportedModel[]>;

/** 加载 LLM 配置，并与 .x-config.json 默认值合并。DB 为空时使用默认值，避免 X 添加 provider 时覆盖原有默认配置 */
function filterModality(m: Record<string, unknown>): Record<string, { providerId: string; modelId: string }> {
  const out: Record<string, { providerId: string; modelId: string }> = {};
  for (const [k, v] of Object.entries(m)) {
    const o = v as Record<string, unknown> | null | undefined;
    if (o && typeof o.providerId === 'string' && typeof o.modelId === 'string') out[k] = { providerId: o.providerId, modelId: o.modelId };
  }
  return out;
}

async function resolveGetConfig(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string, key: string): Promise<string | undefined> {
  const raw = getConfig(userId, key);
  return raw instanceof Promise ? await raw : raw;
}

/** 从 ExecutionContext 安全读取配置（支持 async getConfig） */
async function getConfigValue(getConfig: ExecutionContext['getConfig'], userId: string, key: string): Promise<string | undefined> {
  if (!getConfig) return undefined;
  const r = getConfig(userId, key);
  return r instanceof Promise ? await r : r;
}

async function loadLLMConfig(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<LLMConfigStored> {
  const defaults = loadDefaultConfig()?.llm_config;
  const defProviders = Array.isArray(defaults?.providers) ? [...defaults.providers] : [];
  const defModality = filterModality(defaults?.defaultByModality ?? {});
  const value = await resolveGetConfig(getConfig, userId, LLM_CONFIG_KEY);
  if (!value) return { providers: defProviders, defaultByModality: defModality };
  try {
    const parsed = JSON.parse(value) as LLMConfigStored;
    const dbProviders = Array.isArray(parsed.providers) ? parsed.providers : [];
    const dbModality = filterModality(parsed.defaultByModality ?? {});
    return {
      providers: dbProviders.length > 0 ? dbProviders : defProviders,
      defaultByModality: { ...defModality, ...dbModality },
    };
  } catch {
    return { providers: defProviders, defaultByModality: defModality };
  }
}

async function saveLLMConfig(setConfig: (userId: string, key: string, value: string) => void | Promise<void>, userId: string, config: LLMConfigStored): Promise<void> {
  const r = setConfig(userId, LLM_CONFIG_KEY, JSON.stringify(config));
  if (r instanceof Promise) await r;
}

function loadImportedModels(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<ImportedModelsByProvider> {
  return resolveGetConfig(getConfig, userId, LLM_IMPORTED_MODELS_KEY).then(raw => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ImportedModelsByProvider;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
  });
}

function saveImportedModels(setConfig: (userId: string, key: string, value: string) => void, userId: string, data: ImportedModelsByProvider): void {
  setConfig(userId, LLM_IMPORTED_MODELS_KEY, JSON.stringify(data));
}

async function loadMiniApps(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<MiniAppDefinition[]> {
  const raw = await resolveGetConfig(getConfig, userId, X_MINI_APPS_CONFIG_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is MiniAppDefinition => {
          if (!x || typeof x !== 'object') return false;
          const a = x as Record<string, unknown>;
          return typeof a.id === 'string' && typeof a.name === 'string' && typeof a.path === 'string';
        })
      : [];
  } catch {
    return [];
  }
}

function saveMiniApps(setConfig: (userId: string, key: string, value: string) => void, userId: string, list: MiniAppDefinition[]): void {
  setConfig(userId, X_MINI_APPS_CONFIG_KEY, JSON.stringify(list));
}

async function loadAgents(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<AgentDefinition[]> {
  const raw = await resolveGetConfig(getConfig, userId, X_AGENTS_CONFIG_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is AgentDefinition => {
          if (!x || typeof x !== 'object') return false;
          const a = x as Record<string, unknown>;
          return typeof a.id === 'string';
        })
      : [];
  } catch {
    return [];
  }
}

function saveAgents(setConfig: (userId: string, key: string, value: string) => void, userId: string, list: AgentDefinition[]): void {
  setConfig(userId, X_AGENTS_CONFIG_KEY, JSON.stringify(list));
}

const X_AGENT_TEAMS_CONFIG_KEY = 'x_agent_teams';

async function loadTeams(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<AgentTeam[]> {
  const raw = await resolveGetConfig(getConfig, userId, X_AGENT_TEAMS_CONFIG_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is AgentTeam => {
          if (!x || typeof x !== 'object') return false;
          const t = x as Record<string, unknown>;
          return typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.agentIds);
        })
      : [];
  } catch {
    return [];
  }
}

function saveTeams(setConfig: (userId: string, key: string, value: string) => void, userId: string, list: AgentTeam[]): void {
  setConfig(userId, X_AGENT_TEAMS_CONFIG_KEY, JSON.stringify(list));
}

const X_AGENT_GROUPS_CONFIG_KEY = 'x_agent_groups';
const X_GROUP_RUN_HISTORY_KEY = 'x_group_run_history';
const MAX_GROUP_RUN_HISTORY = 50;

export interface GroupRunRecord {
  id: string;
  groupId: string;
  groupName: string;
  goal: string;
  results: Array<{ agentId: string; agentName: string; content: string }>;
  cancelled?: boolean;
  createdAt: number;
}

async function loadGroups(getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>, userId: string): Promise<AgentGroup[]> {
  const raw = await resolveGetConfig(getConfig, userId, X_AGENT_GROUPS_CONFIG_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is AgentGroup => {
          if (!x || typeof x !== 'object') return false;
          const g = x as Record<string, unknown>;
          return typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.agentIds);
        })
      : [];
  } catch {
    return [];
  }
}

function saveGroups(setConfig: (userId: string, key: string, value: string) => void, userId: string, list: AgentGroup[]): void {
  setConfig(userId, X_AGENT_GROUPS_CONFIG_KEY, JSON.stringify(list));
}

async function appendGroupRunHistory(
  getConfig: ExecutionContext['getConfig'],
  setConfig: ExecutionContext['setConfig'],
  userId: string,
  record: Omit<GroupRunRecord, 'id' | 'createdAt'>,
): Promise<void> {
  if (!getConfig || !setConfig) return;
  const raw = await getConfigValue(getConfig, userId, X_GROUP_RUN_HISTORY_KEY);
  let list: GroupRunRecord[];
  try {
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    list = Array.isArray(arr) ? arr.filter((x): x is GroupRunRecord => Boolean(x && typeof x === 'object' && typeof (x as GroupRunRecord).createdAt === 'number')) : [];
  } catch {
    list = [];
  }
  const full: GroupRunRecord = {
    ...record,
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  list.unshift(full);
  list = list.slice(0, MAX_GROUP_RUN_HISTORY);
  const setResult = setConfig(userId, X_GROUP_RUN_HISTORY_KEY, JSON.stringify(list));
  if (setResult instanceof Promise) await setResult;
}

export class ToolExecutor {
  private tools = new Map<string, ToolHandler>();
  private definitions = new Map<string, ToolDefinition>();
  /** scope -> (name -> { definition, handler }) */
  private scopedTools = new Map<string, Map<string, { definition: ToolDefinition; handler: ToolHandler }>>();

  private signalFireHandler?: (userId: string, signal: string, payload?: object) => Promise<{ fired: number; skipped: number } | void>;
  private createTaskHandler?: (request: CreateTaskRequest, userId: string) => Promise<Task>;
  private getMemoryServiceForUser?: (userId: string) => Promise<MemoryService | null>;
  private getVectorConfigForUser?: (
    userId: string
  ) => Promise<{ providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null>;

  constructor(
    private sandboxFS?: SandboxFS,
    private userSandboxManager?: UserSandboxManager,
    private evolvedPromptService?: EvolvedPromptService,
    private getRecentAssistantChat?: GetRecentAssistantChat,
    private runCustomAgentLoop?: RunCustomAgentLoop,
    private miniAppLogStore?: MiniAppLogStore,
    private db?: AppDatabase,
  ) {
    this.registerBuiltinTools();
  }

  /** 由 createApiRouter 注入，用于 signal.emit 时触发用户配置的触发器 */
  setSignalFireHandler(handler: (userId: string, signal: string, payload?: object) => Promise<{ fired: number; skipped: number } | void>): void {
    this.signalFireHandler = handler;
  }

  /** 由 AgentOrchestrator 注入，用于 task.create 工具创建系统任务进任务时间线 */
  setCreateTaskHandler(handler: (request: CreateTaskRequest, userId: string) => Promise<Task>): void {
    this.createTaskHandler = handler;
  }

  /** 由 createApiRouter 注入，供 memory_search、memory_embed_add、memory_delete 使用 */
  setMemoryDeps(
    getMemory: (userId: string) => Promise<MemoryService | null>,
    getVectorConfig: (userId: string) => Promise<{ providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null>,
  ): void {
    this.getMemoryServiceForUser = getMemory;
    this.getVectorConfigForUser = getVectorConfig;
  }

  /**
   * 从执行上下文或用户大模型配置中获取阿里云百炼（DashScope）API Key。
   * 优先使用 ctx.llmConfig（若为 DashScope）、再读 getConfig(userId, 'llm_config') 中 baseUrl 含 dashscope 的提供商、最后回退环境变量 DASHSCOPE_API_KEY。
   */
  private async getDashScopeApiKey(ctx?: ExecutionContext): Promise<string | undefined> {
    const llm = ctx?.llmConfig;
    if (llm?.baseUrl && (llm.baseUrl.includes('dashscope.aliyuncs.com') || llm.baseUrl.includes('dashscope-intl.aliyuncs.com') || llm.baseUrl.includes('dashscope-us.aliyuncs.com'))) {
      const key = (llm as { apiKey?: string }).apiKey?.trim();
      if (key) return key;
    }
    const uid = ctx?.userId;
    const raw = await getConfigValue(ctx?.getConfig, uid ?? '', 'llm_config');
    if (raw) {
      try {
        const config = JSON.parse(raw) as {
          providers?: Array<{ id: string; baseUrl?: string; apiKey?: string }>;
        };
        const dash = config.providers?.find(
          (p) =>
            (p.baseUrl || '').includes('dashscope.aliyuncs.com') ||
            (p.baseUrl || '').includes('dashscope-intl.aliyuncs.com') ||
            (p.baseUrl || '').includes('dashscope-us.aliyuncs.com'),
        );
        const key = dash?.apiKey?.trim();
        if (key) return key;
      } catch {
        // ignore
      }
    }
    return process.env.DASHSCOPE_API_KEY?.trim();
  }

  private async getZhipuApiKey(ctx?: ExecutionContext): Promise<string | undefined> {
    const llm = ctx?.llmConfig;
    if (llm?.baseUrl && (llm.baseUrl.includes('open.bigmodel.cn') || llm.baseUrl.includes('bigmodel.cn'))) {
      const key = (llm as { apiKey?: string }).apiKey?.trim();
      if (key) return key;
    }
    const uid = ctx?.userId;
    const raw = await getConfigValue(ctx?.getConfig, uid ?? '', 'llm_config');
    if (raw) {
      try {
        const config = JSON.parse(raw) as { providers?: Array<{ id: string; baseUrl?: string; apiKey?: string }> };
        const zhipu = config.providers?.find(
          (p) => p.id === 'zhipu' || (p.baseUrl || '').includes('bigmodel.cn'),
        );
        const key = zhipu?.apiKey?.trim();
        if (key) return key;
      } catch {
        // ignore
      }
    }
    return process.env.ZHIPU_API_KEY?.trim();
  }

  /** 按请求上下文解析沙箱：有 agentId 时用 agent 独立目录，否则用用户工作区或默认 sandboxFS */
  private async resolveFS(context?: ExecutionContext): Promise<SandboxFS | undefined> {
    const uid = context?.userId;
    const agentId = context?.agentId;
    if (uid && uid !== 'anonymous' && this.userSandboxManager) {
      if (agentId) {
        const agentSandbox = await this.userSandboxManager.getForAgent(uid, agentId);
        return agentSandbox.sandboxFS;
      }
      const sandbox = await this.userSandboxManager.getForUser(uid);
      return sandbox.sandboxFS;
    }
    return this.sandboxFS;
  }

  // ── Public API ───────────────────────────────────────────

  async execute(step: TaskStep, runtimeType: RuntimeType, context?: ExecutionContext): Promise<ToolCall> {
    const call: ToolCall = {
      id: uuid(),
      toolName: step.toolName,
      input: step.toolInput,
      startedAt: Date.now(),
      runtimeType,
    };

    let handler = this.tools.get(step.toolName);
    if (!handler && context?.userId) {
      const scopeMap = this.scopedTools.get(SCOPE_MCP_PREFIX + context.userId);
      handler = scopeMap?.get(step.toolName)?.handler;
    }
    if (!handler) {
      call.error = `Tool not found: ${step.toolName}`;
      call.completedAt = Date.now();
      return call;
    }

    // 打印实际调用的接口和参数，便于排查与审计
    const paramsJson = JSON.stringify(step.toolInput ?? {}, null, 2);
    serverLogger.info('tool', `调用工具: ${step.toolName}`, `参数:\n${paramsJson}`);

    const validation = validateToolInput(step.toolName, step.toolInput as Record<string, unknown> | undefined);
    if (validation.invalid) {
      call.error = validation.message;
      call.completedAt = Date.now();
      serverLogger.warn('tool', `工具参数校验未通过: ${step.toolName}`, validation.message);
      return call;
    }

    try {
      const out = await handler(step.toolInput, context);
      call.output = out;
      call.completedAt = Date.now();
      const obj = out != null && typeof out === 'object' ? (out as Record<string, unknown>) : null;
      if (obj && (obj.error != null || (obj.ok === false && typeof obj.error === 'string'))) {
        call.error = String(obj.error);
        serverLogger.warn('tool', `工具返回错误: ${step.toolName}`, call.error);
      }
    } catch (err: any) {
      call.error = err.message || String(err);
      call.completedAt = Date.now();
    }

    return call;
  }

  getToolDefinition(name: string, userId?: string): ToolDefinition | undefined {
    const d = this.definitions.get(name);
    if (d) return d;
    if (userId) {
      const scopeMap = this.scopedTools.get(SCOPE_MCP_PREFIX + userId);
      return scopeMap?.get(name)?.definition;
    }
    return undefined;
  }

  listTools(userId?: string): ToolDefinition[] {
    const list = Array.from(this.definitions.values());
    if (userId) {
      const scopeMap = this.scopedTools.get(SCOPE_MCP_PREFIX + userId);
      if (scopeMap) {
        for (const { definition } of scopeMap.values()) list.push(definition);
      }
    }
    return list;
  }

  /** 动态注册工具（供 MCP 等扩展使用）。scope 存在时按用户隔离（如 'mcp:'+userId） */
  registerDynamicTool(definition: ToolDefinition, handler: ToolHandler, scope?: string): void {
    if (scope) {
      let map = this.scopedTools.get(scope);
      if (!map) {
        map = new Map();
        this.scopedTools.set(scope, map);
      }
      map.set(definition.name, { definition, handler });
      return;
    }
    this.register(definition, handler);
  }

  /** 清除指定前缀的动态工具（如 mcp. 重载前清除），仅全局工具 */
  clearDynamicTools(prefix: string): void {
    for (const [name] of this.tools) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
        this.definitions.delete(name);
      }
    }
  }

  /** 清除某 scope 下的动态工具（用于按用户重载 MCP） */
  clearDynamicToolsByScope(scope: string): void {
    this.scopedTools.delete(scope);
  }

  /** 供 Agent 循环使用：将已注册工具转为 LLM function calling 格式；userId 存在时包含该用户 scope 内工具 */
  getLLMToolDefs(userId?: string): LLMToolDef[] {
    const defs = Array.from(this.definitions.values());
    if (userId) {
      const scopeMap = this.scopedTools.get(SCOPE_MCP_PREFIX + userId);
      if (scopeMap) {
        for (const { definition } of scopeMap.values()) defs.push(definition);
      }
    }
    const skills = getDiscoveredSkills(userId);
    return defs.map((def) => {
      let description = def.description;
      if (def.name === 'skill.load' && skills.length > 0) {
        description +=
          '\n\n可用 Skills（name 参数从中选择）：\n' +
          skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
      }
      const properties: Record<string, { type: string; description: string }> = {};
      const required: string[] = [];
      for (const p of def.parameters) {
        properties[p.name] = { type: p.type, description: p.description || p.name };
        if (p.required) required.push(p.name);
      }
      return {
        name: def.name,
        description,
        parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
      } as LLMToolDef;
    });
  }

  // ── Built-in Tools ───────────────────────────────────────

  private registerBuiltinTools() {
    // 按需加载模式下的元工具：搜索与加载工具（减少系统提示 token）
    this.register(
      {
        name: 'capability.search',
        displayName: '搜索工具',
        description:
          '搜索可用的工具、Skill、MCP。按需加载模式下，先调用此工具找到需要的工具，再用 capability.load 加载。传 query 关键词，如「文件读取」「解析文档」「搜索」「grep」等。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'query', type: 'string', description: '搜索关键词（支持中文/英文）', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const q = String(input.query ?? '').trim();
        if (!q) return { matches: [], message: 'query 为空' };
        const builtin = this.listTools(ctx?.userId).map((t) => ({ name: t.name, description: t.description ?? '' }));
        const fromCapabilities = listAllCapabilities(builtin);
        const skills = getDiscoveredSkills((ctx as { userId?: string })?.userId).map((s) => ({
          name: s.name,
          description: `[skill] ${s.description}. 用 skill.load(name) 加载完整说明`,
        }));
        const all = [...fromCapabilities, ...skills];

        const userId = (ctx as { userId?: string })?.userId;
        const vecConfig = userId ? await this.getVectorConfigForUser?.(userId) : null;

        if (vecConfig) {
          try {
            const store = getToolVectorStore();
            await store.syncFull(all, async (texts: string[]) => {
              const batchSize = 10;
              const results: number[][] = [];
              for (let i = 0; i < texts.length; i += batchSize) {
                const chunk = texts.slice(i, i + batchSize);
                const vecs = await callEmbeddingBatch(chunk, vecConfig);
                results.push(...vecs);
              }
              return results;
            });
            const queryVector = await callEmbedding(q, vecConfig);
            const matches = await store.search(queryVector, 40);
            return {
              matches: matches.map((m) => ({ name: m.name, description: (m.description ?? '').slice(0, 120) })),
              total: matches.length,
              hint: '[skill] 条目用 skill.load(name) 加载；其余用 capability.load(names) 加载工具',
            };
          } catch (e) {
            serverLogger.warn(
              'tool',
              'capability.search 向量检索失败，回退关键词匹配',
              e instanceof Error ? e.message : String(e),
            );
          }
        }

        const qLower = q.toLowerCase();
        const words = qLower.split(/\s+/).filter(Boolean);
        const matches = all.filter((c) => {
          const name = (c.name ?? '').toLowerCase();
          const desc = (c.description ?? '').toLowerCase();
          return words.some((w) => name.includes(w) || desc.includes(w));
        });
        return {
          matches: matches.slice(0, 40).map((m) => ({ name: m.name, description: (m.description ?? '').slice(0, 120) })),
          total: matches.length,
          hint: '[skill] 条目用 skill.load(name) 加载；其余用 capability.load(names) 加载工具',
        };
      },
    );

    this.register(
      {
        name: 'capability.load',
        displayName: '加载工具',
        description:
          '将指定工具加载到本次对话，加载后可立即使用。传 names 数组，如 ["file.read","file.write"]。仅能加载 capability.search 返回的工具。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'names', type: 'array', description: '要加载的工具名列表，如 ["file.read","file.write","file.parse"]', required: true },
        ],
        requiredPermissions: [],
      },
      async (input) => {
        const raw = input.names;
        const names = Array.isArray(raw) ? raw.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean) : [];
        return { loaded: names, message: `已加载 ${names.length} 个工具，下一轮可使用` };
      },
    );

    this.register(
      {
        name: 'llm.generate',
        displayName: '大模型生成',
        description:
          '使用 LLM 生成文本内容。若本次生成依赖此前工具返回（如搜索结果、file.read 内容），请将要点或原文放入 description；也可依赖系统注入的 recentToolResults。系统会在有「此前工具返回」时自动附上供生成使用。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'description', type: 'string', description: '生成要求；若依赖搜索结果等，请在此写出要点或附上引用，或由系统自动附上此前工具返回', required: true },
          { name: 'systemPrompt', type: 'string', description: '可选系统提示', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        let description = String(input.description ?? '').trim();
        const llmConfig = ctx?.llmConfig;
        if (llmConfig?.providerId && llmConfig?.modelId && description) {
          if (ctx?.recentToolResults?.trim()) {
            description =
              description +
              '\n\n--- 以下为此前工具返回（请基于此内容生成）---\n\n' +
              ctx.recentToolResults.trim().slice(0, 14000);
          }
          const systemPrompt =
            input.systemPrompt != null
              ? String(input.systemPrompt)
              : '你是一个助手。根据用户要求生成内容。如果用户明确要求将结果保存到文件、写入文件、保存为文件等，你必须使用 file_write 工具，传入 path（沙箱内相对路径，如 文档/xxx.txt）和 content（要写入的完整内容）。否则只返回文本，不要调用工具。';
          const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: description },
          ];
          const { content: text, toolCalls } = await callLLMWithTools(
            {
              messages,
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
            },
            [FILE_WRITE_TOOL],
          );
          const writtenFiles: string[] = [];
          // 优先使用模型主回复 text 作为写入内容，避免误存用户问题；仅当 text 为空时用 tool 的 content 兜底
          const primaryContent = (text ?? '').trim();
          const fs = await this.resolveFS(ctx);
          if (fs) {
            for (const tc of toolCalls) {
              if (tc.name !== 'file_write') continue;
              const path = typeof tc.arguments?.path === 'string' ? tc.arguments.path.trim() : '';
              if (!path || path.includes('..')) continue;
              const contentToWrite =
                primaryContent ||
                (tc.arguments?.content != null ? String(tc.arguments.content).trim() : '');
              if (contentToWrite) await fs.writeOverwrite(path, contentToWrite);
              writtenFiles.push(path);
            }
          }
          return {
            text,
            ...(writtenFiles.length ? { writtenFiles } : {}),
          };
        }
        await this.simulateDelay(500, 1500);
        return { text: `[AI 生成内容] 基于: "${description.slice(0, 50)}"` };
      },
    );

    this.register(
      {
        name: 'llm.generate_image',
        displayName: '生成图片',
        description:
          '生成图片并可选保存到沙箱。默认使用大模型配置中的图像模态。传 1–3 张参考图（reference_images 沙箱路径）且使用 DashScope 时，会走千问图像编辑模型以保持人物一致、多图融合等。仅当保存路径在 apps/ 下且设置→多媒体开启「图片生成使用 fal」时用 fal FLUX。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'prompt', type: 'string', description: '图片描述或编辑指令（如：图1中的人物在教室中教学；游戏资源用 fal 时可加 pixel art, top-down view）', required: true },
          { name: 'path', type: 'string', description: '可选，保存到沙箱的相对路径，如 创作/xxx/image_01.png、apps/<id>/assets/icon.png', required: false },
          { name: 'reference_images', type: 'array', description: '可选，1–3 张参考图：沙箱路径（如 创作/xxx.png）或公网 URL（http(s)），仅 DashScope 支持，用于人物一致、风格迁移、多图融合等', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) return { ok: false, error: 'prompt 必填' };
        const savedPath = input.path != null ? String(input.path).trim() : undefined;
        const refPathsRaw = input.reference_images;
        const refPaths: string[] = Array.isArray(refPathsRaw)
          ? refPathsRaw.slice(0, 3).filter((p): p is string => {
            if (typeof p !== 'string' || p.trim().length === 0) return false;
            const s = String(p);
            return s.startsWith('http://') || s.startsWith('https://') || !s.includes('..');
          })
          : [];
        const isGameDevPath = savedPath != null && (savedPath.startsWith('apps/') || savedPath.includes('/apps/'));
        const audioConfig = await getAudioApiConfig(ctx?.getConfig, ctx?.userId);
        const useFal = isGameDevPath && !!audioConfig.useFalForImage && !!audioConfig.falKey;
        if (useFal) {
          try {
            const { url } = await callFalImage(audioConfig.falKey!, prompt);
            if (savedPath && !savedPath.includes('..')) {
              const fs = await this.resolveFS(ctx);
              if (fs) {
                const buf = await fetchFalMediaParallel(url);
                await fs.writeBinary(savedPath, buf);
                return { ok: true, images: 1, savedPath };
              }
            }
            return { ok: true, images: 1, url, ...(savedPath ? { message: '已生成，未保存到沙箱（路径无效或无沙箱）' } : {}) };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: msg };
          }
        }
        // 使用大模型配置中的图像模态（设置里选的图片模型）
        let llmConfig = ctx?.llmConfig;
        const uid = ctx?.userId;
        const getConfig = ctx?.getConfig;
        if (uid && getConfig) {
          const raw = await getConfigValue(getConfig, uid, 'llm_config');
          if (raw) {
            try {
              const config = JSON.parse(raw) as {
                providers?: Array<{ id: string; baseUrl?: string; apiKey?: string }>;
                defaultByModality?: {
                  image?: { providerId: string; modelId: string };
                  image_edit?: { providerId: string; modelId: string };
                };
              };
              const useImageEdit = refPaths.length >= 1 && refPaths.length <= 3;
              const imageSel = config.defaultByModality?.image;
              const imageEditSel = config.defaultByModality?.image_edit;
              const sel = useImageEdit && imageEditSel ? imageEditSel : imageSel;
              const providerId = sel?.providerId ?? config.providers?.[0]?.id;
              const modelId = sel?.modelId ?? '__custom__';
              const provider = config.providers?.find((p) => p.id === providerId);
              if (providerId && modelId && provider) {
                llmConfig = {
                  providerId,
                  modelId,
                  baseUrl: provider?.baseUrl,
                  apiKey: provider?.apiKey,
                };
              }
            } catch {
              // 解析失败则继续用 ctx.llmConfig
            }
          }
        }
        if (!llmConfig?.providerId || !llmConfig?.modelId) {
          return { ok: false, error: '未配置大模型（请在设置→大模型中配置并选择图像模态的模型），无法生成图片' };
        }
        let referenceImageUrls: string[] | undefined;
        if (refPaths.length >= 1 && refPaths.length <= 3 && (llmConfig.baseUrl || '').includes('dashscope.aliyuncs.com')) {
          const fs = await this.resolveFS(ctx);
          const resolved: string[] = [];
          for (const p of refPaths) {
            const trimmed = p.trim();
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
              resolved.push(trimmed);
            } else if (fs) {
              try {
                const buf = await fs.readBinary(trimmed);
                const ext = trimmed.replace(/^.*\./, '').toLowerCase();
                const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
                resolved.push(`data:${mime};base64,${buf.toString('base64')}`);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { ok: false, error: `读取参考图失败 ${trimmed}: ${msg}` };
              }
            }
          }
          if (resolved.length > 0) referenceImageUrls = resolved;
        }
        try {
          const result = await callLLMGenerateImage({
            messages: [{ role: 'user', content: prompt }],
            providerId: llmConfig.providerId,
            modelId: llmConfig.modelId,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            ...(referenceImageUrls ? { referenceImageUrls } : {}),
          });
          const images = result?.images ?? [];
          if (savedPath && savedPath.length > 0 && images.length > 0) {
            const fs = await this.resolveFS(ctx);
            if (fs) {
              const path = savedPath.includes('..') ? '图片/generated.png' : savedPath;
              const img = images[0];
              if (typeof img === 'string' && img.startsWith('data:')) {
                const match = img.match(/^data:[^;]+;base64,(.+)$/);
                if (match) {
                  const buf = Buffer.from(match[1], 'base64');
                  await fs.writeBinary(path, buf);
                  return { ok: true, images: images.length, savedPath: path };
                }
              }
              if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
                const res = await fetch(img);
                if (!res.ok) throw new Error(`下载图片失败: ${res.status}`);
                const buf = Buffer.from(await res.arrayBuffer());
                await fs.writeBinary(path, buf);
                return { ok: true, images: images.length, savedPath: path };
              }
            }
          }
          return { ok: true, images: images.length, ...(savedPath ? { message: '已生成，未保存到沙箱（路径无效或无沙箱）' } : {}) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      },
    );

    this.register(
      {
        name: 'llm.edit_image',
        displayName: '编辑图片',
        description:
          '根据 1–3 张参考图与编辑指令生成或编辑图片，用于保持人物一致、多图融合、风格迁移、修改画面等。使用大模型配置中的「图生图/图像编辑」模型（仅 DashScope 千问图像编辑系列支持）。与 llm.generate_image 区别：本工具必须提供参考图；纯文生图请用 llm.generate_image。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'prompt', type: 'string', description: '编辑指令（如：图1中的人物在乡村教室教学；图1的女生穿图2的裙子按图3的姿势坐下）', required: true },
          { name: 'reference_images', type: 'array', description: '1–3 张参考图：沙箱路径或公网 URL（如 ["创作/xxx/image_01.png"] 或 ["https://example.com/ref.png"]），按顺序对应指令中的图1、图2、图3', required: true },
          { name: 'path', type: 'string', description: '可选，保存到沙箱的相对路径', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) return { ok: false, error: 'prompt 必填' };
        const refPathsRaw = input.reference_images;
        const refPaths: string[] = Array.isArray(refPathsRaw)
          ? refPathsRaw.slice(0, 3).filter((p): p is string => {
            if (typeof p !== 'string' || p.trim().length === 0) return false;
            const s = String(p);
            return s.startsWith('http://') || s.startsWith('https://') || !s.includes('..');
          })
          : [];
        if (refPaths.length < 1 || refPaths.length > 3) {
          return { ok: false, error: 'reference_images 必填且为 1–3 项（沙箱路径或公网 URL）' };
        }
        const savedPath = input.path != null ? String(input.path).trim() : undefined;

        let llmConfig = ctx?.llmConfig;
        const uid = ctx?.userId;
        const getConfig = ctx?.getConfig;
        if (uid && getConfig) {
          const raw = await getConfigValue(getConfig, uid, 'llm_config');
          if (raw) {
            try {
              const config = JSON.parse(raw) as {
                providers?: Array<{ id: string; baseUrl?: string; apiKey?: string }>;
                defaultByModality?: { image_edit?: { providerId: string; modelId: string }; image?: { providerId: string; modelId: string } };
              };
              const imageEditSel = config.defaultByModality?.image_edit ?? config.defaultByModality?.image;
              const providerId = imageEditSel?.providerId ?? config.providers?.[0]?.id;
              const modelId = imageEditSel?.modelId ?? '__custom__';
              const provider = config.providers?.find((p) => p.id === providerId);
              if (providerId && modelId && provider) {
                llmConfig = { providerId, modelId, baseUrl: provider?.baseUrl, apiKey: provider?.apiKey };
              }
            } catch {}
          }
        }
        if (!llmConfig?.providerId || !llmConfig?.modelId) {
          return { ok: false, error: '未配置图生图模型（设置→大模型→图生图/图像编辑），无法编辑图片' };
        }
        if (!(llmConfig.baseUrl || '').includes('dashscope.aliyuncs.com')) {
          return { ok: false, error: 'llm.edit_image 当前仅支持 DashScope（阿里千问图像编辑）；请在图生图模态下选择 DashScope 并配置模型' };
        }

        const fs = await this.resolveFS(ctx);
        const dataUrls: string[] = [];
        for (const p of refPaths) {
          const trimmed = p.trim();
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            dataUrls.push(trimmed);
            continue;
          }
          if (!fs) return { ok: false, error: '沙箱不可用，无法读取参考图路径；公网图片请直接传 http(s) URL' };
          try {
            const buf = await fs.readBinary(trimmed);
            const ext = trimmed.replace(/^.*\./, '').toLowerCase();
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
            dataUrls.push(`data:${mime};base64,${buf.toString('base64')}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: `读取参考图失败 ${trimmed}: ${msg}` };
          }
        }

        try {
          const result = await callLLMGenerateImage({
            messages: [{ role: 'user', content: prompt }],
            providerId: llmConfig.providerId,
            modelId: llmConfig.modelId,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
            referenceImageUrls: dataUrls,
          });
          const images = result?.images ?? [];
          if (savedPath && savedPath.length > 0 && images.length > 0 && fs) {
            const outPath = savedPath.includes('..') ? '图片/edited.png' : savedPath;
            const img = images[0];
            if (typeof img === 'string' && img.startsWith('data:')) {
              const match = img.match(/^data:[^;]+;base64,(.+)$/);
              if (match) {
                await fs.writeBinary(outPath, Buffer.from(match[1], 'base64'));
                return { ok: true, images: images.length, savedPath: outPath };
              }
            }
            if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://'))) {
              const res = await fetch(img);
              if (!res.ok) throw new Error(`下载图片失败: ${res.status}`);
              await fs.writeBinary(outPath, Buffer.from(await res.arrayBuffer()));
              return { ok: true, images: images.length, savedPath: outPath };
            }
          }
          return { ok: true, images: images.length, ...(savedPath ? { message: '已生成，未保存到沙箱' } : {}) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      },
    );

    this.register(
      {
        name: 'llm.generate_sound_effect',
        displayName: '生成音效',
        description:
          '根据文本描述生成音效（fal CassetteAI）。prompt 建议：简洁具体描述「什么在发声」+ 可选场景/节奏，如 "button click"、"explosion"、"dog barking in the rain"、"typing on a mechanical keyboard at a fast pace"；多试不同措辞可改善效果。需配置 fal Key，生成后可保存到沙箱。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'prompt', type: 'string', description: '音效描述，简洁具体（如：button click、explosion、footsteps on gravel、a soda can being opened）', required: true },
          { name: 'duration', type: 'number', description: '时长（秒），1–30，默认 5', required: false },
          { name: 'path', type: 'string', description: '可选，保存到沙箱的相对路径。fal 返回 WAV，建议用 .wav（如 apps/<id>/assets/sfx/click.wav）', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) return { ok: false, error: 'prompt 必填' };
        const config = await getAudioApiConfig(ctx?.getConfig, ctx?.userId);
        const apiKey = config.falKey;
        if (!apiKey) return { ok: false, error: '未配置 fal.ai Key，请在设置→多媒体中填写 FAL_KEY 后保存' };
        const duration = typeof input.duration === 'number' ? input.duration : 5;
        try {
          const { url } = await callFalSoundEffect(apiKey, prompt, duration);
          let savedPath = input.path != null ? String(input.path).trim() : undefined;
          if (savedPath && !savedPath.includes('..')) {
            const fs = await this.resolveFS(ctx);
            if (fs) {
              const buf = await fetchFalMediaParallel(url);
              const isWav = url.toLowerCase().includes('.wav');
              if (isWav && savedPath.toLowerCase().endsWith('.mp3')) savedPath = savedPath.replace(/\.mp3$/i, '.wav');
              await fs.writeBinary(savedPath, buf);
              return { ok: true, url, savedPath };
            }
          }
          return { ok: true, url, message: savedPath ? '已生成，未保存到沙箱（路径无效或无沙箱）' : undefined };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      },
    );

    this.register(
      {
        name: 'llm.generate_music',
        displayName: '生成音乐',
        description:
          '根据文本描述生成背景音乐（BGM），使用 fal.ai。可在设置→多媒体选择音乐模型：CassetteAI（默认）/ MusicGen / Stable Audio Open。参数：prompt（风格、乐器、节奏等）+ 可选 duration（秒，5–180，默认 30）、path（保存到沙箱的相对路径）。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'prompt', type: 'string', description: '音乐描述（风格、乐器、节奏等，如：chill piano, 90 BPM）', required: true },
          { name: 'duration', type: 'number', description: '时长（秒），5–180，默认 30', required: false },
          { name: 'path', type: 'string', description: '可选，保存到沙箱的相对路径。fal 返回 WAV，建议用 .wav（如 apps/<id>/assets/bgm/theme.wav）；若写 .mp3 将按实际格式自动改为 .wav', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) return { ok: false, error: 'prompt 必填' };
        const config = await getAudioApiConfig(ctx?.getConfig, ctx?.userId);
        const savedPath = input.path != null ? String(input.path).trim() : undefined;

        const apiKey = config.falKey;
        if (!apiKey) return { ok: false, error: '未配置音乐生成。请在设置→多媒体中填写 fal.ai Key 后保存' };
        const duration = typeof input.duration === 'number' ? input.duration : 30;
        const musicModel = config.falMusicModel || 'cassetteai/music-generator';
        try {
          const { url } = await callFalMusic(apiKey, prompt, duration, musicModel);
          if (savedPath && !savedPath.includes('..')) {
            const fs = await this.resolveFS(ctx);
            if (fs) {
              const buf = await fetchFalMediaParallel(url);
              let pathToWrite = savedPath;
              const isWav = url.toLowerCase().includes('.wav');
              if (isWav && pathToWrite.toLowerCase().endsWith('.mp3')) pathToWrite = pathToWrite.replace(/\.mp3$/i, '.wav');
              await fs.writeBinary(pathToWrite, buf);
              return { ok: true, url, savedPath: pathToWrite };
            }
          }
          return { ok: true, url, message: savedPath ? '已生成，未保存到沙箱（路径无效或无沙箱）' : undefined };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      },
    );

    this.register(
      {
        name: 'video.reference_to_video',
        displayName: '参考生视频',
        description:
          '万相参考生视频（阿里云百炼）：根据文本提示词与参考图像/视频 URL 生成视频。支持单角色表演或多角色互动；可用 shot_type 控制单镜头或多镜头。reference_urls 为必填：公网或 OSS 临时 URL 数组，顺序对应 character1、character2…；提示词中用 character1/character2 引用角色。需配置环境变量 DASHSCOPE_API_KEY；模型与 Endpoint 须同地域。生成耗时约 1–5 分钟，完成后可保存到沙箱。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'prompt', type: 'string', description: '文本提示词，描述视频内容；用 character1、character2 等引用 reference_urls 中的角色', required: true },
          { name: 'reference_urls', type: 'array', description: '参考文件 URL 数组（图像 0～5，视频 0～3，总数≤5）；顺序对应 character1, character2...', required: true },
          { name: 'negative_prompt', type: 'string', description: '可选，反向提示词（不希望出现的画面）', required: false },
          { name: 'size', type: 'string', description: '可选，分辨率如 1280*720、1920*1080，默认 1280*720', required: false },
          { name: 'duration', type: 'number', description: '可选，时长（秒）2～10，默认 5', required: false },
          { name: 'audio', type: 'boolean', description: '可选，是否生成有声视频，默认 true（仅 wan2.6-r2v-flash）', required: false },
          { name: 'shot_type', type: 'string', description: '可选，single 单镜头 / multi 多镜头，默认 single', required: false },
          { name: 'watermark', type: 'boolean', description: '可选，是否添加「AI生成」水印，默认 false', required: false },
          { name: 'path', type: 'string', description: '可选，保存到沙箱的相对路径（如 创作/xxx.mp4）', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) return { ok: false, error: 'prompt 必填' };
        let refUrls: string[] = [];
        if (Array.isArray(input.reference_urls)) {
          refUrls = input.reference_urls.filter((u): u is string => typeof u === 'string' && u.trim() !== '');
        } else if (typeof input.reference_urls === 'string') {
          try {
            const parsed = JSON.parse(input.reference_urls) as unknown;
            refUrls = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string' && u.trim() !== '') : [];
          } catch {
            refUrls = [];
          }
        }
        if (refUrls.length === 0) return { ok: false, error: 'reference_urls 必填，且至少包含一个有效的图像或视频 URL' };
        if (refUrls.length > 5) return { ok: false, error: 'reference_urls 最多 5 个（图像 0～5，视频 0～3）' };

        const apiKey = await this.getDashScopeApiKey(ctx);
        if (!apiKey) return { ok: false, error: '未配置阿里云百炼 API Key。请在设置→大模型中添加并配置「阿里通义千问」提供商并保存 API Key，或配置环境变量 DASHSCOPE_API_KEY（与模型同地域）' };

        const size = typeof input.size === 'string' ? input.size.trim() || undefined : undefined;
        const duration = typeof input.duration === 'number' ? input.duration : undefined;
        const audio = typeof input.audio === 'boolean' ? input.audio : undefined;
        const shotType = typeof input.shot_type === 'string' ? (input.shot_type.trim() === 'multi' ? 'multi' : 'single') : undefined;
        const watermark = typeof input.watermark === 'boolean' ? input.watermark : undefined;
        const savedPath = input.path != null ? String(input.path).trim() : undefined;
        const negativePrompt = input.negative_prompt != null ? String(input.negative_prompt).trim() : undefined;

        try {
          const { video_url } = await callDashScopeReferenceToVideo(apiKey, {
            model: 'wan2.6-r2v-flash',
            input: { prompt, reference_urls: refUrls, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}) },
            parameters: {
              ...(size ? { size } : {}),
              ...(duration != null ? { duration } : {}),
              ...(audio != null ? { audio } : {}),
              ...(shotType ? { shot_type: shotType } : {}),
              ...(watermark != null ? { watermark } : {}),
            },
          });

          if (savedPath && !savedPath.includes('..')) {
            const fs = await this.resolveFS(ctx);
            if (fs) {
              const res = await fetch(video_url);
              if (!res.ok) throw new Error(`下载视频失败: ${res.status}`);
              const buf = Buffer.from(await res.arrayBuffer());
              await fs.writeBinary(savedPath, buf);
              return { ok: true, video_url, savedPath };
            }
          }
          return { ok: true, video_url, message: savedPath ? '已生成，未保存到沙箱（路径无效或无沙箱）' : undefined };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      },
    );

    this.register(
      {
        name: 'video.text_to_video',
        displayName: '文生视频',
        description:
          '万相文生视频（阿里云百炼）：根据文本提示词生成视频，支持有声/多镜头（wan2.6-t2v）。可选 audio_url 传入背景音乐或配音。需配置 DASHSCOPE_API_KEY；模型与 Endpoint 须同地域。生成耗时约 1–5 分钟，完成后可保存到沙箱。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'prompt', type: 'string', description: '文本提示词，描述视频画面与情节', required: true },
          { name: 'negative_prompt', type: 'string', description: '可选，反向提示词', required: false },
          { name: 'audio_url', type: 'string', description: '可选，背景音乐或配音音频 URL（wan2.5/wan2.6）', required: false },
          { name: 'size', type: 'string', description: '可选，分辨率如 1280*720、1920*1080，默认 1280*720', required: false },
          { name: 'duration', type: 'number', description: '可选，时长（秒）2～15，默认 5', required: false },
          { name: 'shot_type', type: 'string', description: '可选，single 单镜头 / multi 多镜头（仅 wan2.6）', required: false },
          { name: 'watermark', type: 'boolean', description: '可选，是否添加「AI生成」水印，默认 false', required: false },
          { name: 'path', type: 'string', description: '可选，保存到沙箱的相对路径（如 创作/xxx.mp4）', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const prompt = String(input.prompt ?? '').trim();
        if (!prompt) return { ok: false, error: 'prompt 必填' };
        const apiKey = await this.getDashScopeApiKey(ctx);
        if (!apiKey) return { ok: false, error: '未配置阿里云百炼 API Key。请在设置→大模型中添加并配置「阿里通义千问」提供商并保存 API Key，或配置环境变量 DASHSCOPE_API_KEY（与模型同地域）' };
        const negativePrompt = input.negative_prompt != null ? String(input.negative_prompt).trim() : undefined;
        const audioUrl = input.audio_url != null ? String(input.audio_url).trim() || undefined : undefined;
        const size = typeof input.size === 'string' ? input.size.trim() || undefined : undefined;
        const duration = typeof input.duration === 'number' ? input.duration : undefined;
        const shotType = typeof input.shot_type === 'string' ? (input.shot_type.trim() === 'multi' ? 'multi' : 'single') : undefined;
        const watermark = typeof input.watermark === 'boolean' ? input.watermark : undefined;
        const savedPath = input.path != null ? String(input.path).trim() : undefined;
        try {
          const { video_url } = await callDashScopeText2Video(apiKey, {
            model: 'wan2.6-t2v',
            input: { prompt, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}), ...(audioUrl ? { audio_url: audioUrl } : {}) },
            parameters: { ...(size ? { size } : {}), ...(duration != null ? { duration } : {}), ...(shotType ? { shot_type: shotType } : {}), ...(watermark != null ? { watermark } : {}) },
          });
          if (savedPath && !savedPath.includes('..')) {
            const fs = await this.resolveFS(ctx);
            if (fs) {
              const res = await fetch(video_url);
              if (!res.ok) throw new Error(`下载视频失败: ${res.status}`);
              const buf = Buffer.from(await res.arrayBuffer());
              await fs.writeBinary(savedPath, buf);
              return { ok: true, video_url, savedPath };
            }
          }
          return { ok: true, video_url, message: savedPath ? '已生成，未保存到沙箱（路径无效或无沙箱）' : undefined };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      },
    );

    this.register(
      {
        name: 'video.image_to_video',
        displayName: '图生视频（首帧）',
        description:
          '万相图生视频-基于首帧（阿里云百炼）：根据首帧图像与文本提示词生成视频。img_url 为必填（公网或 OSS 临时 URL）。可选 audio_url、多镜头（wan2.6）。需配置 DASHSCOPE_API_KEY。生成耗时约 1–5 分钟，完成后可保存到沙箱。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'prompt', type: 'string', description: '文本提示词，描述视频画面与动作', required: true },
          { name: 'img_url', type: 'string', description: '首帧图像 URL（公网 HTTP/HTTPS 或 OSS 临时 URL）', required: true },
          { name: 'negative_prompt', type: 'string', description: '可选，反向提示词', required: false },
          { name: 'audio_url', type: 'string', description: '可选，背景音乐或配音音频 URL（wan2.5/wan2.6）', required: false },
          { name: 'resolution', type: 'string', description: '可选，480P / 720P / 1080P，默认 720P', required: false },
          { name: 'duration', type: 'number', description: '可选，时长（秒）2～15，默认 5', required: false },
          { name: 'shot_type', type: 'string', description: '可选，single 单镜头 / multi 多镜头（仅 wan2.6）', required: false },
          { name: 'audio', type: 'boolean', description: '可选，是否生成有声视频（wan2.6-i2v-flash），默认 true', required: false },
          { name: 'watermark', type: 'boolean', description: '可选，是否添加「AI生成」水印，默认 false', required: false },
          { name: 'path', type: 'string', description: '可选，保存到沙箱的相对路径（如 创作/xxx.mp4）', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const prompt = String(input.prompt ?? '').trim();
        const imgUrl = String(input.img_url ?? '').trim();
        if (!prompt) return { ok: false, error: 'prompt 必填' };
        if (!imgUrl) return { ok: false, error: 'img_url 必填（首帧图像 URL）' };
        const apiKey = await this.getDashScopeApiKey(ctx);
        if (!apiKey) return { ok: false, error: '未配置阿里云百炼 API Key。请在设置→大模型中添加并配置「阿里通义千问」提供商并保存 API Key，或配置环境变量 DASHSCOPE_API_KEY（与模型同地域）' };
        const negativePrompt = input.negative_prompt != null ? String(input.negative_prompt).trim() : undefined;
        const audioUrl = input.audio_url != null ? String(input.audio_url).trim() || undefined : undefined;
        const resolution = typeof input.resolution === 'string' ? input.resolution.trim() || undefined : undefined;
        const duration = typeof input.duration === 'number' ? input.duration : undefined;
        const shotType = typeof input.shot_type === 'string' ? (input.shot_type.trim() === 'multi' ? 'multi' : 'single') : undefined;
        const audio = typeof input.audio === 'boolean' ? input.audio : undefined;
        const watermark = typeof input.watermark === 'boolean' ? input.watermark : undefined;
        const savedPath = input.path != null ? String(input.path).trim() : undefined;
        try {
          const { video_url } = await callDashScopeImage2Video(apiKey, {
            model: 'wan2.6-i2v-flash',
            input: { prompt, img_url: imgUrl, ...(negativePrompt ? { negative_prompt: negativePrompt } : {}), ...(audioUrl ? { audio_url: audioUrl } : {}) },
            parameters: { ...(resolution ? { resolution } : {}), ...(duration != null ? { duration } : {}), ...(shotType ? { shot_type: shotType } : {}), ...(audio != null ? { audio } : {}), ...(watermark != null ? { watermark } : {}) },
          });
          if (savedPath && !savedPath.includes('..')) {
            const fs = await this.resolveFS(ctx);
            if (fs) {
              const res = await fetch(video_url);
              if (!res.ok) throw new Error(`下载视频失败: ${res.status}`);
              const buf = Buffer.from(await res.arrayBuffer());
              await fs.writeBinary(savedPath, buf);
              return { ok: true, video_url, savedPath };
            }
          }
          return { ok: true, video_url, message: savedPath ? '已生成，未保存到沙箱（路径无效或无沙箱）' : undefined };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg };
        }
      },
    );

    // file / grep / shell 工具由 tools 目录统一实现并注册
    const deps = this as unknown as ToolExecutorDeps;
    for (const def of fileDefinitions) {
      const handler = createFileHandlers(deps).get(def.name);
      if (handler) this.register(def, handler);
    }
    this.register(grepDefinition, createGrepHandler(deps));
    this.register(shellRunDefinition, createShellRunHandler(deps));

    // Docker 容器管理工具 - 已禁用（安全风险：R060）
    // 原因：用户可以通过 Docker 访问宿主机，存在严重安全风险
    // 待容器隔离方案实施后重新启用
    // this.register(dockerRunDefinition, createDockerRunHandler(deps));
    // this.register(dockerListDefinition, createDockerListHandler(deps));
    // this.register(dockerLogsDefinition, createDockerLogsHandler(deps));
    // this.register(dockerStopDefinition, createDockerStopHandler(deps));
    // this.register(dockerExecDefinition, createDockerExecHandler(deps));
    // this.register(dockerPullDefinition, createDockerPullHandler(deps));
    // this.register(dockerShellEnterDefinition, createDockerShellEnterHandler(deps));
    // this.register(dockerShellExecDefinition, createDockerShellExecHandler(deps));
    // this.register(dockerShellExitDefinition, createDockerShellExitHandler(deps));
    // this.register(dockerShellListDefinition, createDockerShellListHandler(deps));
    // this.register(dockerShellInteractiveDefinition, createDockerShellInteractiveHandler(deps));

    this.register(serverAddDefinition, createServerAddHandler(deps));
    this.register(serverListDefinition, createServerListHandler(deps));
    this.register(serverConnectDefinition, createServerConnectHandler(deps));
    this.register(serverExecDefinition, createServerExecHandler(deps));
    this.register(serverDisconnectDefinition, createServerDisconnectHandler(deps));
    this.register(serverUploadDefinition, createServerUploadHandler(deps));
    this.register(serverDownloadDefinition, createServerDownloadHandler(deps));
    this.register(serverRemoveDefinition, createServerRemoveHandler(deps));
    this.register(serverTestDefinition, createServerTestHandler(deps));

    this.register(
      {
        name: 'sleep',
        displayName: '等待',
        description:
          '暂停指定秒数。遇到 rate limit、超时等错误时，可先 sleep 几十秒再重试；或需要等待外部结果时使用。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'seconds', type: 'number', description: '等待秒数，如 30 表示等 30 秒；上限 300（5 分钟）', required: true },
        ],
        requiredPermissions: [],
      },
      async (input) => {
        const sec = Math.min(300, Math.max(1, Math.floor(Number(input.seconds) || 1)));
        await new Promise((r) => setTimeout(r, sec * 1000));
        return { slept: sec, message: `已等待 ${sec} 秒` };
      },
    );

    this.register(
      {
        name: 'python.run',
        displayName: '运行 Python',
        description:
          '在沙箱内执行 Python 脚本。你可先用 file.write 写入 .py 文件，再传入脚本相对沙箱根的路径执行；返回 stdout、stderr 和退出码，便于调试。适合 X 编写代码并运行、验证结果。',
        domain: ['coding', 'agent', 'chat'],
        riskLevel: 'high',
        parameters: [
          { name: 'scriptPath', type: 'string', description: '脚本相对沙箱根的路径，如 script.py 或 src/main.py', required: true },
          { name: 'args', type: 'array', description: '传给脚本的参数列表（可选）', required: false },
          { name: 'timeout', type: 'number', description: '超时毫秒数，默认 30000', required: false },
        ],
        requiredPermissions: ['shell'],
      },
      async (input, ctx) => {
        const fs = await this.resolveFS(ctx);
        if (!fs) throw new Error('python.run: 沙箱不可用');
        const scriptPath = String(input.scriptPath ?? '').trim().replace(/^\//, '');
        if (!scriptPath) throw new Error('python.run: scriptPath 必填');
        if (!/\.py$/i.test(scriptPath)) throw new Error('python.run: 仅支持 .py 脚本');
        const path = await import('path');
        const root = fs.getRoot();
        const absPath = path.resolve(root, scriptPath);
        if (!absPath.startsWith(root)) throw new Error('python.run: 脚本路径必须在沙箱内');
        const args: string[] = Array.isArray(input.args) ? input.args.map((a) => String(a)) : [];
        const timeoutMs = Math.min(120000, Math.max(5000, Number(input.timeout) || 30000));
        return new Promise((resolve, reject) => {
          const proc = spawn('python3', [absPath, ...args], {
            cwd: root,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, HOME: root, USER: 'x-computer', PYTHONUNBUFFERED: '1' },
          });
          let stdout = '';
          let stderr = '';
          proc.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
          proc.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
          const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            resolve({
              exitCode: -1,
              timedOut: true,
              stdout: stdout.slice(0, 50000),
              stderr: (stderr + '\n[Python 执行超时]').slice(0, 10000),
            });
          }, timeoutMs);
          proc.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolve({
              exitCode: code ?? undefined,
              signal: signal ?? undefined,
              stdout: stdout.slice(0, 50000),
              stderr: stderr.slice(0, 10000),
            });
          });
          proc.once('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`python.run: ${err.message}`));
          });
        });
      },
    );

    this.register(
      {
        name: 'http.request',
        displayName: 'HTTP 请求',
        description: '发送 HTTP 请求，可请求任意 URL（GET/POST 等）',
        domain: ['agent', 'coding'],
        riskLevel: 'high',
        parameters: [
          { name: 'url', type: 'string', description: '请求 URL', required: true },
          { name: 'method', type: 'string', description: 'HTTP 方法', required: false, default: 'GET' },
          { name: 'headers', type: 'object', description: '可选请求头', required: false },
          { name: 'body', type: 'string', description: '可选请求体（POST/PUT 等）', required: false },
        ],
        requiredPermissions: ['network.outbound'],
      },
      async (input) => {
        const urlStr = String(input?.url ?? '').trim();
        if (!urlStr) throw new Error('http.request: url 必填');
        const method = (String(input?.method ?? 'GET').toUpperCase()) || 'GET';
        const headers = input?.headers && typeof input.headers === 'object' ? (input.headers as Record<string, string>) : undefined;
        const body = input?.body != null ? String(input.body) : undefined;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const res = await fetch(urlStr, {
            method,
            headers: headers ?? {},
            body: body !== undefined && body !== '' ? body : undefined,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const contentType = res.headers.get('content-type') ?? '';
          let responseBody: string | Record<string, unknown>;
          const text = await res.text();
          if (contentType.includes('application/json') && text) {
            try {
              responseBody = JSON.parse(text) as Record<string, unknown>;
            } catch {
              responseBody = text;
            }
          } else {
            responseBody = text;
          }
          return {
            status: res.status,
            statusText: res.statusText,
            headers: Object.fromEntries(res.headers.entries()),
            body: responseBody,
          };
        } catch (err: unknown) {
          clearTimeout(timeout);
          const msg = err instanceof Error ? err.message : String(err);
          if (/abort/i.test(msg)) throw new Error('http.request: 请求超时（15s）');
          throw new Error(`http.request: ${msg}`);
        }
      },
    );

    // ── 大模型管理（提供商、模型、导入与增删改查，供 X 自行管理 LLM 配置；创建 agent 时可指定 provider/model）────────
    this.register(
      {
        name: 'llm.list_providers',
        displayName: '列出大模型提供商',
        description: '列出当前用户已配置的大模型提供商（id、name、baseUrl）。可用于创建 agent 前查看可用提供商。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { providers: [], message: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { providers: [], message: '无法读取配置' };
        const config = await loadLLMConfig(getConfig, userId);
        const list = config.providers.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl ?? '' }));
        return { providers: list };
      },
    );

    this.register(
      {
        name: 'llm.add_provider',
        displayName: '添加大模型提供商',
        description: '添加一个大模型提供商。需提供 name、baseUrl（API 根地址，如 https://api.openai.com/v1）、api_key。成功后返回 provider_id，可用于 llm.import_models 或创建 agent 时指定。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'name', type: 'string', description: '提供商显示名称', required: true },
          { name: 'base_url', type: 'string', description: 'API 根地址，如 https://api.openai.com/v1', required: true },
          { name: 'api_key', type: 'string', description: 'API Key', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const name = String(input.name ?? '').trim();
        const baseUrl = String(input.base_url ?? '').trim();
        const apiKey = String(input.api_key ?? '').trim();
        if (!name || !baseUrl || !apiKey) return { ok: false, error: 'name、base_url、api_key 必填' };
        const id = `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const config = await loadLLMConfig(getConfig, userId);
        config.providers.push({ id, name, baseUrl, apiKey });
        await saveLLMConfig(setConfig, userId, config);
        return { ok: true, provider_id: id, message: `已添加提供商「${name}」` };
      },
    );

    this.register(
      {
        name: 'llm.update_provider',
        displayName: '更新大模型提供商',
        description: '更新已有提供商的 name、base_url 或 api_key。传 provider_id 和要修改的字段。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'provider_id', type: 'string', description: '提供商 ID', required: true },
          { name: 'name', type: 'string', description: '新的显示名称', required: false },
          { name: 'base_url', type: 'string', description: '新的 baseUrl', required: false },
          { name: 'api_key', type: 'string', description: '新的 API Key', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const providerId = String(input.provider_id ?? '').trim();
        if (!providerId) return { ok: false, error: 'provider_id 必填' };
        const config = await loadLLMConfig(getConfig, userId);
        const p = config.providers.find((x) => x.id === providerId);
        if (!p) return { ok: false, error: '未找到该提供商' };
        if (input.name != null) p.name = String(input.name).trim();
        if (input.base_url != null) p.baseUrl = String(input.base_url).trim();
        if (input.api_key != null) p.apiKey = String(input.api_key).trim();
        await saveLLMConfig(setConfig, userId, config);
        return { ok: true, message: '已更新' };
      },
    );

    this.register(
      {
        name: 'llm.remove_provider',
        displayName: '删除大模型提供商',
        description: '删除指定的大模型提供商。同时会清除该提供商下已导入的模型。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'provider_id', type: 'string', description: '提供商 ID', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const providerId = String(input.provider_id ?? '').trim();
        if (!providerId) return { ok: false, error: 'provider_id 必填' };
        const config = await loadLLMConfig(getConfig, userId);
        const idx = config.providers.findIndex((x) => x.id === providerId);
        if (idx < 0) return { ok: false, error: '未找到该提供商' };
        config.providers.splice(idx, 1);
        await saveLLMConfig(setConfig, userId, config);
        const imported = await loadImportedModels(getConfig, userId);
        if (imported[providerId]) {
          delete imported[providerId];
          saveImportedModels(setConfig, userId, imported);
        }
        return { ok: true, message: '已删除' };
      },
    );

    this.register(
      {
        name: 'llm.import_models',
        displayName: '从提供商导入模型列表',
        description: '从指定提供商的 baseUrl 调用 /models 或 /v1/models 获取模型列表并保存。需要 network.outbound 权限。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'provider_id', type: 'string', description: '提供商 ID（llm.list_providers 返回的 id）', required: true }],
        requiredPermissions: ['network.outbound'],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', models: [] };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置', models: [] };
        const providerId = String(input.provider_id ?? '').trim();
        if (!providerId) return { ok: false, error: 'provider_id 必填', models: [] };
        const config = await loadLLMConfig(getConfig, userId);
        const p = config.providers.find((x) => x.id === providerId);
        if (!p) return { ok: false, error: '未找到该提供商', models: [] };
        try {
          const models = await fetchModelsFromProviderServer(p.baseUrl ?? '', p.apiKey);
          const imported = await loadImportedModels(getConfig, userId);
          imported[providerId] = models;
          saveImportedModels(setConfig, userId, imported);
          return { ok: true, models, message: `已导入 ${models.length} 个模型` };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg, models: [] };
        }
      },
    );

    this.register(
      {
        name: 'llm.list_models',
        displayName: '列出提供商的模型',
        description: '列出指定提供商下已导入或自定义添加的模型。创建 agent 时可从中选择 model_id。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'provider_id', type: 'string', description: '提供商 ID', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { models: [], message: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { models: [], message: '无法读取配置' };
        const providerId = String(input.provider_id ?? '').trim();
        if (!providerId) return { models: [], message: 'provider_id 必填' };
        const imported = await loadImportedModels(getConfig, userId);
        const list = imported[providerId] ?? [];
        return { models: list };
      },
    );

    this.register(
      {
        name: 'llm.add_model',
        displayName: '添加自定义模型',
        description: '在指定提供商下添加一个自定义模型（无需从 API 导入）。适用于已知 model id 的场景。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'provider_id', type: 'string', description: '提供商 ID', required: true },
          { name: 'model_id', type: 'string', description: '模型 ID（如 gpt-4o-mini）', required: true },
          { name: 'model_name', type: 'string', description: '可选显示名称', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const providerId = String(input.provider_id ?? '').trim();
        const modelId = String(input.model_id ?? '').trim();
        if (!providerId || !modelId) return { ok: false, error: 'provider_id、model_id 必填' };
        const config = await loadLLMConfig(getConfig, userId);
        if (!config.providers.some((x) => x.id === providerId)) return { ok: false, error: '未找到该提供商' };
        const imported = await loadImportedModels(getConfig, userId);
        const list = imported[providerId] ?? [];
        if (list.some((m) => m.id === modelId)) return { ok: false, error: '该模型已存在' };
        list.push({ id: modelId, name: input.model_name != null ? String(input.model_name).trim() : undefined });
        imported[providerId] = list;
        saveImportedModels(setConfig, userId, imported);
        return { ok: true, message: `已添加模型 ${modelId}` };
      },
    );

    const LLM_MODALITIES = ['chat', 'text', 'video', 'image', 'image_edit', 'vector'] as const;
    this.register(
      {
        name: 'llm.set_default',
        displayName: '设置默认模型',
        description:
          '设置指定模态的默认提供商与模型。modality 可选：chat（聊天）、text（长文本）、video（视频理解）、image（文生图）、image_edit（图生图）、vector（向量嵌入）；默认 chat。未指定 llm_provider_id/llm_model_id 的 agent 将使用 chat 默认配置。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'provider_id', type: 'string', description: '提供商 ID', required: true },
          { name: 'model_id', type: 'string', description: '模型 ID', required: true },
          {
            name: 'modality',
            type: 'string',
            description: '模态：chat | text | video | image | image_edit | vector，默认 chat',
            required: false,
          },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const providerId = String(input.provider_id ?? '').trim();
        const modelId = String(input.model_id ?? '').trim();
        const modalityRaw = String(input.modality ?? 'chat').trim().toLowerCase();
        const modality = LLM_MODALITIES.includes(modalityRaw as (typeof LLM_MODALITIES)[number])
          ? (modalityRaw as (typeof LLM_MODALITIES)[number])
          : 'chat';
        if (!providerId || !modelId) return { ok: false, error: 'provider_id、model_id 必填' };
        const config = await loadLLMConfig(getConfig, userId);
        if (!config.providers.some((x) => x.id === providerId)) return { ok: false, error: '未找到该提供商' };
        config.defaultByModality = config.defaultByModality ?? {};
        config.defaultByModality[modality] = { providerId, modelId };
        await saveLLMConfig(setConfig, userId, config);
        const labels: Record<string, string> = {
          chat: '聊天',
          text: '长文本',
          video: '视频理解',
          image: '文生图',
          image_edit: '图生图',
          vector: '向量嵌入',
        };
        return { ok: true, message: `已设置${labels[modality] ?? modality}默认模型` };
      },
    );

    // ── Skill 加载（OpenCode 风格：按名称加载 SKILL.md 内容到上下文，主脑按说明执行）────────
    this.register(
      {
        name: 'skill.load',
        description:
          '按名称加载一个 Skill 的完整说明与工作流到当前上下文。当任务匹配系统提示中「已发现 Skills」下某条时，调用本工具传入该 skill 的 name，即可将 SKILL.md 正文注入对话；随后请按该 Skill 的说明执行。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [{ name: 'name', type: 'string', description: 'Skill 名称（与「已发现 Skills」列表中的 name 一致）', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const name = String(input?.name ?? '').trim();
        if (!name) throw new Error('skill.load: name 必填');
        const userId = (ctx as { userId?: string })?.userId;
        const skill = getSkillContentByName(name, userId);
        if (!skill) {
          const list = getDiscoveredSkills(userId).map((s) => s.name).join(', ');
          return {
            text: `未找到名为 "${name}" 的 Skill。当前可用的有：${list || '（无）'}`,
            isError: true,
          };
        }
        const skillPath = `skills/${skill.dirName}`;
        const block = [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          '',
          skill.content.trim(),
          '',
          `## Skill 所在位置（沙箱内）`,
          `- **目录路径**: \`${skillPath}/\`（相对沙箱根）`,
          `- **file.read / file.write**：如 \`${skillPath}/reference.md\`、\`${skillPath}/scripts/xxx.py\` 等`,
          `- **shell.run / python.run**：workdir 填 \`${skillPath}\`，则 \`scripts/xxx.py\` 等相对路径可正确解析`,
          '',
          '</skill_content>',
        ].join('\n');
        return { text: block };
      },
    );

    // ── Skill 安装（借鉴 OpenClaw SkillHub / OpenCode index.json）──────────────────────────
    this.register(
      {
        name: 'skill.install',
        description:
          '安装 Skill 到本地。source 格式：skillhub:<slug>（如 skillhub:serpapi-search）从 SkillHub 安装；或 url:<baseUrl>（如 url:https://example.com/skills/）从支持 index.json 的地址安装。安装后可用 skill.load 加载。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'medium',
        parameters: [
          {
            name: 'source',
            type: 'string',
            description:
              '来源：skillhub:<slug>（SkillHub 上的 slug，如 serpapi-search）或 url:<baseUrl>（以 / 结尾的 index.json 根地址）',
            required: true,
          },
          {
            name: 'skill_index',
            type: 'number',
            description: '当 source 为 url 且 index 中有多个 skill 时，指定安装第几个（从 0 开始），默认 0',
            required: false,
          },
        ],
        requiredPermissions: ['network.outbound'],
      },
      async (input) => {
        const raw = String(input?.source ?? '').trim();
        if (!raw) throw new Error('skill.install: source 必填');
        const skillIndex = typeof input?.skill_index === 'number' ? Math.max(0, Math.floor(input.skill_index)) : 0;

        if (raw.toLowerCase().startsWith('skillhub:')) {
          const slug = raw.slice(8).trim();
          if (!slug) {
            return { text: 'skill.install: skillhub: 后需填写 slug，如 serpapi-search', isError: true };
          }
          const result = await installFromSkillHub(slug);
          if (result.ok) {
            return {
              text: `${result.message}\n安装后可调用 skill.load(name: "${result.skillName}") 加载。若该 Skill 需要 API Key，请到 设置 → Skills 中配置，或通过 x.notify_user 告知用户。`,
              skillName: result.skillName,
              dirName: result.dirName,
            };
          }
          return { text: result.message, isError: true, skillName: result.skillName };
        }

        if (raw.toLowerCase().startsWith('url:')) {
          const baseUrl = raw.slice(4).trim();
          if (!baseUrl || (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://'))) {
            return { text: 'skill.install: url: 后需填写有效的 HTTP(S) 地址', isError: true };
          }
          const result = await installFromUrl(baseUrl, skillIndex);
          if (result.ok) {
            return {
              text: `${result.message}\n安装后可调用 skill.load(name: "${result.skillName}") 加载。若该 Skill 需要 API Key，请到 设置 → Skills 中配置，或通过 x.notify_user 告知用户。`,
              skillName: result.skillName,
              dirName: result.dirName,
            };
          }
          return { text: result.message, isError: true, skillName: result.skillName };
        }

        return {
          text: 'skill.install: source 须以 skillhub: 或 url: 开头，例如 skillhub:serpapi-search 或 url:https://example.com/skills/',
          isError: true,
        };
      },
    );

    // ── Skill 删除 ────────────────────────────────────────────────────────────
    this.register(
      {
        name: 'skill.uninstall',
        description: '从本地删除已安装的 Skill。传入 name_or_dir：Skill 名称（如 Summarize）或目录名（如 summarize），删除后该 Skill 不再可用。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'medium',
        parameters: [
          {
            name: 'name_or_dir',
            type: 'string',
            description: 'Skill 名称（与列表显示一致）或目录名（如 summarize、serpapi-search）',
            required: true,
          },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const raw = String(input?.name_or_dir ?? '').trim();
        if (!raw) throw new Error('skill.uninstall: name_or_dir 必填');
        const userId = (ctx as { userId?: string })?.userId;
        const skills = getDiscoveredSkills(userId);
        const match = skills.find(
          (s) => s.dirName === raw || s.name === raw || s.id === raw
        );
        const dirName = match?.dirName ?? raw;
        const result = deleteSkill(dirName, userId);
        if (result.ok) {
          return { text: `已删除 Skill: ${dirName}` };
        }
        return { text: result.error, isError: true };
      },
    );

    // ── Skill 远程搜索（SkillHub）────────────────────────────────────────────────
    this.register(
      {
        name: 'skill.list_remote',
        description: '在 SkillHub 技能注册表（skillhub.ai）中搜索技能。用户问「SkillHub 上有什么」「搜索 xxx 相关技能」时使用。返回匹配的 slug、描述，安装时用 skill.install(source: "skillhub:<slug>")。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          {
            name: 'query',
            type: 'string',
            description: '搜索关键词，如 crypto、搜索、calendar、serpapi',
            required: true,
          },
          {
            name: 'limit',
            type: 'number',
            description: '最大返回条数，默认 10',
            required: false,
          },
        ],
        requiredPermissions: ['network.outbound'],
      },
      async (input) => {
        const query = String(input?.query ?? '').trim();
        if (!query) throw new Error('skill.list_remote: query 必填');
        const limit = typeof input?.limit === 'number' ? input.limit : 10;
        const result = await searchSkillHub(query, limit);
        if (!result.ok) {
          return { text: result.error, isError: true };
        }
        if (!result.skills.length) {
          return {
            text: `SkillHub 中未找到与「${query}」相关的技能。可尝试其他关键词，或访问 https://skillhub.ai 浏览。`,
            skills: [],
          };
        }
        const lines = result.skills.map(
          (s) => `- ${s.slug}${s.version ? ` v${s.version}` : ''}: ${s.description}`
        );
        return {
          text: `找到 ${result.skills.length} 个相关技能：\n\n${lines.join('\n')}\n\n安装示例：skill.install(source: "skillhub:${result.skills[0]!.slug}")`,
          skills: result.skills,
        };
      },
    );

    // ── MCP 市场搜索（Registry）────────────────────────────────────────────────
    this.register(
      {
        name: 'mcp.list_remote',
        description:
          '在 MCP Registry（registry.modelcontextprotocol.io）中搜索 MCP 服务器。用户问「MCP 市场有什么」「搜索 xxx 相关 MCP」「找搜索/文件/日历类 MCP」时使用。返回匹配的 name、description、config；添加时用 x.add_mcp_server 传入 config 中的 id、url（或 command+args）、headers 等。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'query', type: 'string', description: '搜索关键词，如 search、file、calendar、github', required: true },
          { name: 'limit', type: 'number', description: '最大返回条数，默认 10', required: false },
        ],
        requiredPermissions: ['network.outbound'],
      },
      async (input) => {
        const query = String(input?.query ?? '').trim();
        const limit = typeof input?.limit === 'number' ? input.limit : 10;
        const result = await searchMcpRegistry(query, limit);
        if (!result.ok) {
          return { text: result.error, isError: true };
        }
        if (!result.servers.length) {
          return {
            text: `MCP Registry 中未找到与「${query}」相关的服务器。可尝试其他关键词，或访问 https://modelcontextprotocol.io/registry 浏览。`,
            servers: [],
          };
        }
        const lines = result.servers.map(
          (s) =>
            `- ${s.config.id}: ${s.title ?? s.name}${s.version ? ` v${s.version}` : ''} — ${s.description ?? '无描述'}`
        );
        const first = result.servers[0]!;
        const addHint = first.config.url
          ? `添加示例：x.add_mcp_server(id: "${first.config.id}", url: "${first.config.url}"${first.config.headers ? ', headers: {...}' : ''})`
          : first.config.command
            ? `添加示例：x.add_mcp_server(id: "${first.config.id}", command: "${first.config.command}", args: ${JSON.stringify(first.config.args ?? [])})`
            : '';
        return {
          text: `找到 ${result.servers.length} 个 MCP 服务器：\n\n${lines.join('\n')}\n\n${addHint}`,
          servers: result.servers,
        };
      },
    );

    // 网络搜索不写死为内置工具，由 MCP 或 Skill 动态提供：用户配置搜索类 MCP 后工具会出现在能力列表，或通过 skill.load 加载 Skill 后按说明调用 MCP 工具。

    // ── R011：主脑能分析文本（真实 LLM 分析）────────────────────────────────
    this.register(
      {
        name: 'llm.analyze',
        displayName: '分析内容',
        description: '使用 LLM 分析一段文本：总结、分类、提取意图或关键词等。当用户要求总结、分析、分类、提取要点时使用。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'text', type: 'string', description: '待分析的文本', required: true },
          {
            name: 'task',
            type: 'string',
            description: '分析任务：summarize(总结) | classify(分类) | extract_intent(意图) | keywords(关键词) | 或自然语言描述',
            required: false,
          },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const text = String(input?.text ?? '').trim();
        if (!text) throw new Error('llm.analyze: text 必填');
        const task = String(input?.task ?? 'summarize').trim() || 'summarize';
        const llmConfig = ctx?.llmConfig;
        if (!llmConfig?.providerId || !llmConfig?.modelId) {
          return {
            result: '[未配置大模型] 请在系统设置中配置大模型后重试。',
            task,
            configured: false,
          };
        }
        const taskPrompt: Record<string, string> = {
          summarize: '请用简洁语言总结以下文本的核心内容，保留关键信息。',
          classify: '请对以下文本做分类（如主题、类型、情感等），并简要说明理由。',
          extract_intent: '请提取以下文本中用户的意图或主要诉求。',
          keywords: '请从以下文本中提取 3～8 个关键词，用逗号分隔。',
        };
        const systemPrompt =
          taskPrompt[task] ||
          `请根据用户要求完成以下分析任务：${task}。只输出分析结果，不要复述原文。`;
        const userContent = `【分析任务】${taskPrompt[task] || task}\n\n【文本】\n${text.slice(0, 30000)}`;
        try {
          const content = await callLLM({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            providerId: llmConfig.providerId,
            modelId: llmConfig.modelId,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
          });
          return { result: (content ?? '').trim(), task, configured: true };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { result: `分析失败: ${msg}`, task, configured: true, isError: true };
        }
      },
    );

    // 主脑自主定时执行：指定时间或 cron 触发，到点以当前用户身份跑 Agent（intent 作为用户消息），不限制做啥
    this.register(
      {
        name: 'x.schedule_run',
        displayName: '添加定时任务',
        description:
          'X 主脑自主定时执行：在指定时间或按 cron 周期自动跑一次 Agent，intent 作为那时的「用户消息」由你执行。支持：at（ISO 或时间戳）、cron（五段）、in_minutes（N 分钟后）、in_hours（N 小时后）。至少填其一。创建后会自动在任务看板增加一条「等待」项，用户可在桌面看板看到。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'intent', type: 'string', description: '到点要执行的内容（作为用户消息交给那时的你）', required: true },
          { name: 'at', type: 'string', description: '单次执行时间（ISO 或时间戳）', required: false },
          { name: 'cron', type: 'string', description: '五段 cron：分 时 日 月 周，如 "0 9 * * *" 每天 9:00', required: false },
          { name: 'in_minutes', type: 'number', description: '相对当前时间的分钟数，如 30 表示 30 分钟后执行', required: false },
          { name: 'in_hours', type: 'number', description: '相对当前时间的小时数，如 1 表示 1 小时后执行', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const intent = String(input.intent ?? '').trim();
        if (!intent) throw new Error('x.schedule_run: intent 必填');
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.schedule_run: 需要已登录用户');
        const scheduler = getDefaultScheduler();
        if (!scheduler) return { ok: false, error: '定时调度未就绪' };
        const at = input.at != null ? (typeof input.at === 'number' ? input.at : String(input.at).trim()) : undefined;
        const cron = input.cron != null ? String(input.cron).trim() : undefined;
        const inMinutes = input.in_minutes != null ? Math.max(1, Math.floor(Number(input.in_minutes))) : undefined;
        const inHours = input.in_hours != null ? Math.max(1, Math.floor(Number(input.in_hours))) : undefined;
        if (!at && !cron && !inMinutes && !inHours) throw new Error('x.schedule_run: 至少填 at、cron、in_minutes 或 in_hours 之一');
        const job = scheduler.addJob(userId, intent, at as string | number | undefined, cron || undefined, inMinutes, inHours);
        // 同步到任务看板，并记录 source_id 以便任务完成后将该项更新为 done
        if (this.db) {
          const runAtDesc = job.runAt
            ? `执行时间：${new Date(job.runAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
            : cron
              ? `cron: ${cron}`
              : '定时执行';
          await Promise.resolve(
            this.db.insertBoardItem({
              id: uuid(),
              user_id: userId,
              title: intent.slice(0, 300),
              description: runAtDesc,
              status: 'pending',
              priority: 'medium',
              source_id: job.id,
            }),
          ).catch(() => {});
        }
        return { ok: true, jobId: job.id, runAt: job.runAt, message: '已加入定时执行，到点将自动运行；已同步到任务看板' };
      },
    );

    // 列出当前用户已有定时任务（添加前先查，避免重复）
    this.register(
      {
        name: 'x.list_scheduled_runs',
        displayName: '列出定时任务',
        description:
          '列出当前用户已有的 X 定时任务（id、intent、下次运行时间、cron）。添加新定时前应先调用此工具，避免重复添加相同时间或相同描述的任务；若发现重复或不再需要，可用 x.remove_scheduled_run 删除。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { jobs: [], message: '需要已登录用户' };
        const scheduler = getDefaultScheduler();
        if (!scheduler) return { jobs: [], message: '定时调度未就绪' };
        const list = scheduler.listJobs(userId);
        return {
          jobs: list.map((j) => ({
            id: j.id,
            intent: j.intent,
            runAt: j.runAt,
            runAtISO: new Date(j.runAt).toISOString(),
            cron: j.cron ?? undefined,
          })),
        };
      },
    );

    // 删除指定定时任务（用于去重或取消不再需要的）
    this.register(
      {
        name: 'x.remove_scheduled_run',
        displayName: '删除定时任务',
        description:
          '删除一个已存在的 X 定时任务。传入 jobId（来自 x.list_scheduled_runs 返回的 id）。用于删除重复添加的、或不再需要的定时任务。只能删除当前用户自己的任务。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'jobId', type: 'string', description: '要删除的定时任务 ID（从 x.list_scheduled_runs 获取）', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const jobId = String(input.jobId ?? '').trim();
        if (!jobId) return { ok: false, error: 'jobId 必填' };
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const scheduler = getDefaultScheduler();
        if (!scheduler) return { ok: false, error: '定时调度未就绪' };
        const list = scheduler.listJobs(userId);
        const job = list.find((j) => j.id === jobId);
        if (!job) return { ok: false, error: '未找到该定时任务或无权删除' };
        const removed = scheduler.removeJob(jobId);
        return removed ? { ok: true, message: '已删除该定时任务' } : { ok: false, error: '删除失败' };
      },
    );

    // ── R037：信号/条件触发 ──
    this.register(
      {
        name: 'signal.emit',
        displayName: '发出信号',
        description:
          '发出一个信号。若用户配置了针对该信号的触发器（signal.add_trigger），则会自动执行对应的 agent 或 intent。用于工作流、条件触发等场景。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'signal', type: 'string', description: '信号名，如 data_ready、task_done', required: true },
          { name: 'payload', type: 'object', description: '可选附加数据，如 { path: "..." }，触发器可参考', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const signal = String(input.signal ?? '').trim();
        if (!signal) throw new Error('signal.emit: signal 必填');
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, fired: 0, message: '需要已登录用户' };
        const payload = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : undefined;
        if (this.signalFireHandler) {
          const result = await this.signalFireHandler(userId, signal, payload);
          const r = result && typeof result === 'object' ? result : { fired: 0, skipped: 0 };
          return { ok: true, fired: r.fired ?? 0, skipped: r.skipped ?? 0, message: `已发出信号 ${signal}` };
        }
        return { ok: true, fired: 0, skipped: 0, message: '信号已发出（无配置的触发器）' };
      },
    );

    this.register(
      {
        name: 'signal.add_trigger',
        displayName: '添加信号触发器',
        description:
          '配置「当某信号发生时执行什么」：可指定 agent_id 或 intent。内置信号：user_message_sent（用户发消息）、task_completed（任务完成）、email_received（收到当前用户发来的邮件）。支持 cooldown_ms 避免重复触发。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'signal', type: 'string', description: '监听的信号名', required: true },
          { name: 'agent_id', type: 'string', description: '触发的智能体 ID（与 intent 二选一）', required: false },
          { name: 'intent', type: 'string', description: '或：主脑执行的 intent（与 agent_id 二选一）', required: false },
          { name: 'cooldown_ms', type: 'number', description: '冷却毫秒数，同一触发器在此时间内不重复执行', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const signal = String(input.signal ?? '').trim();
        if (!signal) throw new Error('signal.add_trigger: signal 必填');
        const agentId = input.agent_id != null ? String(input.agent_id).trim() : undefined;
        const intent = input.intent != null ? String(input.intent).trim() : undefined;
        if (!agentId && !intent) throw new Error('signal.add_trigger: 至少填 agent_id 或 intent 之一');
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('signal.add_trigger: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) throw new Error('signal.add_trigger: 配置不可用');
        const list = await loadTriggers(getConfig, userId);
        const id = `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const cooldownMs = input.cooldown_ms != null ? Math.max(0, Math.min(86400000, Number(input.cooldown_ms))) : undefined;
        const t: SignalTrigger = { id, signal, agentId, intent, cooldownMs };
        list.push(t);
        const saveResult = saveTriggers(setConfig, userId, list);
        if (saveResult) await saveResult;
        return { ok: true, triggerId: id, message: `已添加触发器：当 ${signal} 时${agentId ? `运行 agent ${agentId}` : `执行 intent`}` };
      },
    );

    this.register(
      {
        name: 'signal.list_triggers',
        displayName: '列出信号触发器',
        description: '列出当前用户配置的所有信号触发器。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { triggers: [], message: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { triggers: [] };
        const list = await loadTriggers(getConfig, userId);
        return {
          triggers: list.map((t: SignalTrigger) => ({
            id: t.id,
            signal: t.signal,
            agentId: t.agentId ?? undefined,
            intent: t.intent ?? undefined,
            cooldownMs: t.cooldownMs ?? undefined,
          })),
        };
      },
    );

    this.register(
      {
        name: 'signal.remove_trigger',
        displayName: '删除信号触发器',
        description: '删除指定的信号触发器。传入 trigger_id（来自 signal.list_triggers）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'trigger_id', type: 'string', description: '要删除的触发器 ID', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const triggerId = String(input.trigger_id ?? '').trim();
        if (!triggerId) throw new Error('signal.remove_trigger: trigger_id 必填');
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '配置不可用' };
        const fullList = await loadTriggers(getConfig, userId);
        const list = fullList.filter((t: SignalTrigger) => t.id !== triggerId);
        if (list.length === fullList.length) return { ok: false, error: '未找到该触发器' };
        const saveResult = saveTriggers(setConfig, userId, list);
        if (saveResult) await saveResult;
        return { ok: true, message: '已删除触发器' };
      },
    );

    // 主脑主动找用户：向「X 主脑」入口推送一条消息，用户打开 X 即可看到（如缺 API Key、发现新技能可用等）
    this.register(
      {
        name: 'x.notify_user',
        displayName: '通知用户',
        description:
          '主脑主动找用户：向用户推送一条消息，用户会在「X 主脑」入口看到。用于：需要用户配置 API Key、发现新技能可用的通知、需要用户做某决定的询问等。type：need_api_key=需要配置 Key，skill_ready=发现/学会新技能可用了，question=需要用户决定，info=一般说明。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'content', type: 'string', description: '要告诉用户的内容（简短清晰）', required: true },
          {
            name: 'type',
            type: 'string',
            description: '类型：need_api_key | skill_ready | question | info',
            required: false,
          },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const content = String(input.content ?? '').trim();
        if (!content) throw new Error('x.notify_user: content 必填');
        const type = (input.type as string) || 'info';
        const allowed = ['info', 'need_api_key', 'question', 'skill_ready'];
        const t = allowed.includes(type) ? type : 'info';
        const msg = addXProactiveMessage(ctx?.userId, content, t as 'info' | 'need_api_key' | 'question' | 'skill_ready');
        return { ok: true, messageId: msg?.id, message: '已推送给用户，用户可在 X 主脑入口查看' };
      },
    );

    // X 主脑记录「已完成」摘要，结构化 JSON 便于解析与展示
    const X_DONE_LOG_KEY = 'x_done_log';
    const X_DONE_LOG_MAX = 50;
    this.register(
      {
        name: 'x.record_done',
        displayName: '记录已完成',
        description:
          '记录一条你刚完成的事项，系统会在下次运行时注入「近期已完成」清单；支持结构化字段便于界面解析展示。一次性事项不传 scheduled；定时/周期任务传 scheduled: true，并建议传 schedule/title/action。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'summary', type: 'string', description: '一句话摘要（必填），用于列表与提示', required: true },
          { name: 'scheduled', type: 'boolean', description: '是否为定时/周期任务，true 表示到点可重复执行', required: false },
          { name: 'schedule', type: 'string', description: '结构化：时间/频率，如「每晚20点」「每周一」', required: false },
          { name: 'title', type: 'string', description: '结构化：任务标题，如「叶酸提醒」', required: false },
          { name: 'action', type: 'string', description: '结构化：具体动作，如「发送邮件给用户」', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.record_done: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) throw new Error('x.record_done: 配置不可用');
        const summary = String(input.summary ?? '').trim();
        if (!summary) throw new Error('x.record_done: summary 必填');
        const scheduled = input.scheduled === true;
        const schedule = input.schedule != null ? String(input.schedule).trim() : undefined;
        const title = input.title != null ? String(input.title).trim() : undefined;
        const action = input.action != null ? String(input.action).trim() : undefined;
        const raw = await Promise.resolve(getConfig(userId, X_DONE_LOG_KEY));
        let arr: { at: number; summary: string; scheduled?: boolean; schedule?: string; title?: string; action?: string }[] = [];
        try {
          if (raw) arr = JSON.parse(raw) as typeof arr;
          if (!Array.isArray(arr)) arr = [];
        } catch {
          arr = [];
        }
        const entry = {
          at: Date.now(),
          summary,
          ...(scheduled && { scheduled: true }),
          ...(schedule && { schedule }),
          ...(title && { title }),
          ...(action && { action }),
        };
        arr.push(entry);
        arr = arr.slice(-X_DONE_LOG_MAX);
        await Promise.resolve(setConfig(userId, X_DONE_LOG_KEY, JSON.stringify(arr)));
        return {
          ok: true,
          message: scheduled
            ? '已记入近期已完成（定时/周期任务，到点会照常执行）'
            : '已记入近期已完成清单，下次运行时会看到并避免重复执行',
        };
      },
    );

    // R016：X 创建系统任务，进任务时间线，用户可见、可审批或自动执行
    this.register(
      {
        name: 'task.create',
        displayName: '创建系统任务',
        description:
          '创建一条系统任务进任务时间线，用户可见、可审批或自动执行。用于：需要用户审批的步骤（如发送邮件前确认）、派活到时间线让用户追踪、与沙箱 x-tasks.md 协同。domain: chat/coding/agent/office。mode: auto=自动执行，approval=需用户审批。',
        domain: ['chat', 'agent'],
        riskLevel: 'medium',
        parameters: [
          { name: 'domain', type: 'string', description: '任务域：chat/coding/agent/office', required: true },
          { name: 'title', type: 'string', description: '任务标题', required: true },
          { name: 'description', type: 'string', description: '任务描述（详细说明要完成的事项）', required: true },
          { name: 'mode', type: 'string', description: '执行模式：auto（自动）或 approval（需审批），默认 approval', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('task.create: 需要已登录用户');
        const create = this.createTaskHandler;
        if (!create) throw new Error('task.create: 服务未配置任务创建能力');
        const domain = String(input.domain ?? '').trim();
        const title = String(input.title ?? '').trim();
        const description = String(input.description ?? '').trim();
        if (!domain || !title || !description) throw new Error('task.create: domain、title、description 必填');
        const validDomains = ['chat', 'coding', 'agent', 'office'];
        if (!validDomains.includes(domain)) throw new Error(`task.create: domain 必须是 ${validDomains.join('|')} 之一`);
        const modeStr = String(input.mode ?? 'approval').toLowerCase();
        const mode = modeStr === 'auto' ? 'auto' : 'approval';
        const request: CreateTaskRequest = {
          domain: domain as CreateTaskRequest['domain'],
          title,
          description,
          mode,
        };
        const task = await create(request, userId);
        return { ok: true, taskId: task.id, title: task.title, status: task.status, message: '任务已创建，用户可在任务时间线查看与审批' };
      },
    );

    // ── X Board（任务看板）：X 自主管理的待办/进行中/待定/已完成看板 ──

    const VALID_BOARD_STATUSES = ['todo', 'in_progress', 'pending', 'done'];
    const VALID_BOARD_PRIORITIES = ['low', 'medium', 'high'];

    this.register(
      {
        name: 'x.board_list',
        displayName: '查看看板',
        description: '列出当前看板中的所有任务项，按状态分栏（todo/in_progress/pending/done）。可用于了解当前工作安排、决定下一步。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'status', type: 'string', description: '筛选状态（todo/in_progress/pending/done），不传返回全部', required: false },
        ],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('需要已登录用户');
        if (!this.db) throw new Error('数据库不可用');
        const items = await Promise.resolve(this.db.listBoardItems(userId));
        const statusFilter = typeof _input.status === 'string' && VALID_BOARD_STATUSES.includes(_input.status) ? _input.status : null;
        const filtered = statusFilter ? items.filter((i) => i.status === statusFilter) : items;
        return { items: filtered, total: items.length };
      },
    );

    this.register(
      {
        name: 'x.board_add',
        displayName: '添加看板项',
        description: '向看板添加新任务项。status: todo（待做）、in_progress（进行中）、pending（等待/阻塞）、done（已完成）。priority: low/medium/high。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'title', type: 'string', description: '任务标题', required: true },
          { name: 'description', type: 'string', description: '任务描述', required: false },
          { name: 'status', type: 'string', description: '初始状态，默认 todo', required: false },
          { name: 'priority', type: 'string', description: '优先级，默认 medium', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('需要已登录用户');
        if (!this.db) throw new Error('数据库不可用');
        const title = String(input.title ?? '').trim();
        if (!title) throw new Error('title 必填');
        const status = VALID_BOARD_STATUSES.includes(String(input.status)) ? String(input.status) : 'todo';
        const priority = VALID_BOARD_PRIORITIES.includes(String(input.priority)) ? String(input.priority) : 'medium';
        const id = uuid();
        await Promise.resolve(this.db.insertBoardItem({ id, user_id: userId, title, description: input.description ? String(input.description).trim() : undefined, status, priority }));
        return { ok: true, id, title, status, priority };
      },
    );

    this.register(
      {
        name: 'x.board_update',
        displayName: '更新看板项',
        description: '更新看板项的状态、标题、描述或优先级。常用于把任务从 todo 移到 in_progress，或标记为 done。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'id', type: 'string', description: '看板项 ID', required: true },
          { name: 'title', type: 'string', description: '新标题', required: false },
          { name: 'description', type: 'string', description: '新描述', required: false },
          { name: 'status', type: 'string', description: '新状态（todo/in_progress/pending/done）', required: false },
          { name: 'priority', type: 'string', description: '新优先级（low/medium/high）', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('需要已登录用户');
        if (!this.db) throw new Error('数据库不可用');
        const id = String(input.id ?? '').trim();
        if (!id) throw new Error('id 必填');
        const existing = await Promise.resolve(this.db.getBoardItem(id));
        if (!existing || existing.user_id !== userId) throw new Error('未找到该看板项');
        const fields: Record<string, unknown> = {};
        if (input.title !== undefined) fields.title = String(input.title).trim();
        if (input.description !== undefined) fields.description = String(input.description).trim();
        if (input.status !== undefined && VALID_BOARD_STATUSES.includes(String(input.status))) fields.status = String(input.status);
        if (input.priority !== undefined && VALID_BOARD_PRIORITIES.includes(String(input.priority))) fields.priority = String(input.priority);
        await Promise.resolve(this.db.updateBoardItem(id, fields));
        return { ok: true, id, updated: fields };
      },
    );

    this.register(
      {
        name: 'x.board_remove',
        displayName: '移除看板项',
        description: '从看板中删除一个任务项。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'id', type: 'string', description: '看板项 ID', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('需要已登录用户');
        if (!this.db) throw new Error('数据库不可用');
        const id = String(input.id ?? '').trim();
        if (!id) throw new Error('id 必填');
        const existing = await Promise.resolve(this.db.getBoardItem(id));
        if (!existing || existing.user_id !== userId) throw new Error('未找到该看板项');
        await Promise.resolve(this.db.deleteBoardItem(id));
        return { ok: true, removed: id };
      },
    );

    // 邮件通知：配置 SMTP 后可通过邮件触达用户（用户不在线时）
    this.register(
      {
        name: 'x.send_email',
        displayName: '发送邮件',
        description:
          '通过邮件触达用户。需先配置 SMTP（x.set_email_config 或 设置 → 通知/邮件）。to 不填时默认发给当前登录用户；subject、body 必填。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'to', type: 'string', description: '收件人邮箱；不填时发给当前登录用户', required: false },
          { name: 'subject', type: 'string', description: '邮件主题', required: true },
          { name: 'body', type: 'string', description: '正文内容（Markdown），将转成 HTML 富文本发送', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.send_email: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.send_email: 配置不可用');
        let to = typeof input.to === 'string' ? input.to.trim() : '';
        if (!to && this.db) {
          to = (await this.db.getEmailByUserId(userId)) ?? '';
        }
        const subject = String(input.subject ?? '').trim();
        const body = String(input.body ?? '').trim();
        if (!subject || !body) throw new Error('x.send_email: subject 与 body 必填');
        if (!to) throw new Error('x.send_email: 未指定收件人且当前用户无绑定邮箱，请传入 to 参数');
        const result = await sendEmail(getConfig, userId, { to, subject, body });
        if (!result.ok) throw new Error(result.error ?? '发送失败');
        return { ok: true, messageId: result.messageId, message: '邮件已发送' };
      },
    );

    // WhatsApp 通知（R052）：需先扫码登录，配置 allowFrom 白名单
    this.register(
      {
        name: 'x.send_whatsapp',
        displayName: '发送 WhatsApp',
        description:
          '通过 WhatsApp 发送消息。需先在 设置 → 通知/WhatsApp 中扫码登录并配置白名单。to 为收件人号码（E.164 格式，如 +8613800138000 或 13800138000）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'to', type: 'string', description: '收件人号码，E.164 格式（如 +8613800138000）', required: true },
          { name: 'message', type: 'string', description: '消息内容', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.send_whatsapp: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.send_whatsapp: 配置不可用');
        const to = String(input.to ?? '').trim();
        const message = String(input.message ?? input.content ?? '').trim();
        if (!to || !message) throw new Error('x.send_whatsapp: to 与 message 必填');
        const config = parseWhatsAppConfig(await getConfigValue(getConfig, userId, 'whatsapp_config'));
        if (!config?.enabled) throw new Error('x.send_whatsapp: 未启用 WhatsApp，请在 设置 → 通知/WhatsApp 中配置并扫码登录');
        const result = await sendWhatsAppMessage(getConfig, userId, to, message);
        if (!result.ok) throw new Error(result.error ?? '发送失败');
        return { ok: true, message: 'WhatsApp 消息已发送' };
      },
    );

    // Telegram 通知
    this.register(
      {
        name: 'x.send_telegram',
        displayName: '发送 Telegram',
        description: '通过 Telegram Bot 发送消息。需先在 设置 → 通知/Telegram 中配置 Bot Token 并连接。chatId 为接收者的 Chat ID。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'chatId', type: 'string', description: '目标 Chat ID', required: true },
          { name: 'message', type: 'string', description: '消息内容', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.send_telegram: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.send_telegram: 配置不可用');
        const chatId = String(input.chatId ?? '').trim();
        const message = String(input.message ?? input.content ?? '').trim();
        if (!chatId || !message) throw new Error('x.send_telegram: chatId 与 message 必填');
        const config = parseTelegramConfig(await getConfigValue(getConfig, userId, 'telegram_config'));
        if (!config?.enabled) throw new Error('x.send_telegram: 未启用 Telegram，请在设置中配置');
        const result = await sendTelegramMessage(getConfig, userId, chatId, message);
        if (!result.ok) throw new Error(result.error ?? '发送失败');
        return { ok: true, message: 'Telegram 消息已发送' };
      },
    );

    // Discord 通知
    this.register(
      {
        name: 'x.send_discord',
        displayName: '发送 Discord',
        description: '通过 Discord Bot 发送消息。需先在 设置 → 通知/Discord 中配置 Bot Token 并连接。channelId 为目标频道或 DM 的 Channel ID。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'channelId', type: 'string', description: '目标 Channel ID', required: true },
          { name: 'message', type: 'string', description: '消息内容', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.send_discord: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.send_discord: 配置不可用');
        const channelId = String(input.channelId ?? '').trim();
        const message = String(input.message ?? input.content ?? '').trim();
        if (!channelId || !message) throw new Error('x.send_discord: channelId 与 message 必填');
        const config = parseDiscordConfig(await getConfigValue(getConfig, userId, 'discord_config'));
        if (!config?.enabled) throw new Error('x.send_discord: 未启用 Discord，请在设置中配置');
        const result = await sendDiscordMessage(getConfig, userId, channelId, message);
        if (!result.ok) throw new Error(result.error ?? '发送失败');
        return { ok: true, message: 'Discord 消息已发送' };
      },
    );

    // Slack 通知
    this.register(
      {
        name: 'x.send_slack',
        displayName: '发送 Slack',
        description: '通过 Slack Bot 发送消息。需先在 设置 → 通知/Slack 中配置 Token 并连接。channelId 为频道或 DM 的 Channel ID，可选 threadTs 进行线程回复。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'channelId', type: 'string', description: '目标 Channel ID', required: true },
          { name: 'message', type: 'string', description: '消息内容', required: true },
          { name: 'threadTs', type: 'string', description: '（可选）线程 ts，回复到特定线程', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.send_slack: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.send_slack: 配置不可用');
        const channelId = String(input.channelId ?? '').trim();
        const message = String(input.message ?? input.content ?? '').trim();
        const threadTs = input.threadTs ? String(input.threadTs).trim() : undefined;
        if (!channelId || !message) throw new Error('x.send_slack: channelId 与 message 必填');
        const config = parseSlackConfig(await getConfigValue(getConfig, userId, 'slack_config'));
        if (!config?.enabled) throw new Error('x.send_slack: 未启用 Slack，请在设置中配置');
        const result = await sendSlackMessage(getConfig, userId, channelId, message, threadTs);
        if (!result.ok) throw new Error(result.error ?? '发送失败');
        return { ok: true, message: 'Slack 消息已发送' };
      },
    );

    // QQ 通知
    this.register(
      {
        name: 'x.send_qq',
        displayName: '发送 QQ 消息',
        description: '通过 QQ 官方 Bot 发送消息。需先在 设置 → 通知/QQ 中配置 AppID+Secret 并连接。targetType 为 private/group/guild 或 self（发给自己）。targetId 为对应的用户ID/群ID/频道ID。使用 self 时会自动使用用户已记录的 OpenID（用户首次私聊时会自动记录）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'targetType', type: 'string', description: '消息目标类型：private（私聊）、group（群聊）、guild（频道）或 self（发给自己）', required: true },
          { name: 'targetId', type: 'string', description: '目标 ID（用户 openid、群 openid 或频道 channel_id）。当 targetType 为 self 时此参数可选', required: false },
          { name: 'message', type: 'string', description: '消息内容', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.send_qq: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig) throw new Error('x.send_qq: 配置不可用');
        let targetTypeRaw = String(input.targetType ?? '').trim();
        let targetId = String(input.targetId ?? '').trim();
        const message = String(input.message ?? input.content ?? '').trim();

        // 支持 targetType 为 "self"，表示发送给用户自己（使用已记录的 OpenID）
        let targetType: 'private' | 'group' | 'guild' = 'private';
        if (targetTypeRaw === 'self') {
          // 获取用户之前记录的 OpenID
          const selfOpenid = await getConfigValue(getConfig, userId, 'qq_self_openid');
          if (!selfOpenid) {
            throw new Error('x.send_qq: 尚未记录您的 QQ OpenID。请先通过 QQ 私聊发送一条消息，系统会自动记录。');
          }
          targetId = selfOpenid;
          targetType = 'private';
        } else {
          targetType = targetTypeRaw as 'private' | 'group' | 'guild';
          if (!targetType || !targetId || !message) throw new Error('x.send_qq: targetType、targetId、message 必填');
          if (!['private', 'group', 'guild'].includes(targetType)) throw new Error('x.send_qq: targetType 必须为 private、group、guild 或 self');
        }

        if (!targetId || !message) throw new Error('x.send_qq: targetId 和 message 必填');

        // 智能修正 targetId：如果 AI 错误地传了 "user" 或空字符串，尝试从上下文获取正确的发送者 ID
        if (!targetId || targetId === 'user' || targetId === 'chat') {
          // 从当前任务的 metadata 中获取原始消息的 fromId（发送者的 QQ openid）
          const taskMetadata = ctx?.taskMetadata as { sourceMessage?: { fromId?: string; chatId?: string } } | undefined;
          if (taskMetadata?.sourceMessage?.fromId) {
            targetId = taskMetadata.sourceMessage.fromId;
          } else if (targetTypeRaw !== 'self') {
            throw new Error('x.send_qq: targetId 无效。请确保使用发送者的 QQ ID（openid）作为 targetId，或使用 targetType:"self" 发送给用户自己。');
          }
        }

        const config = parseQQConfig(await getConfigValue(getConfig, userId, 'qq_config'));
        if (!config?.enabled) throw new Error('x.send_qq: 未启用 QQ，请在设置中配置');
        const result = await sendQQMessage(getConfig, userId, { type: targetType, id: targetId }, message);
        if (!result.ok) throw new Error(result.error ?? '发送失败');
        return { ok: true, message: 'QQ 消息已发送' };
      },
    );

    // 邮箱配置管理：X 可新增、更新、删除 SMTP 配置
    const EMAIL_SMTP_CONFIG_KEY = 'email_smtp_config';

    this.register(
      {
        name: 'x.list_email_configs',
        displayName: '列出邮箱配置',
        description: '查看当前 SMTP 配置（host、port、user 等），密码以 *** 脱敏。未配置时返回 configured: false。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.list_email_configs: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.list_email_configs: 配置不可用');
        const config = parseSmtpConfigExport(await getConfigValue(getConfig, userId, EMAIL_SMTP_CONFIG_KEY));
        if (!config) return { configured: false, message: '未配置 SMTP' };
        return {
          configured: true,
          host: config.host,
          port: config.port,
          secure: config.secure,
          user: config.user,
          pass: config.pass ? '***' : undefined,
          from: config.from,
        };
      },
    );

    this.register(
      {
        name: 'x.set_email_config',
        displayName: '新增或更新邮箱配置',
        description:
          '新增或覆盖 SMTP 配置。host（如 smtp.qq.com）、port（465 或 587）、user（邮箱）、pass（授权码）必填；secure 默认 true；from 可选。QQ 邮箱需在账户中生成授权码。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'host', type: 'string', description: 'SMTP 服务器，如 smtp.qq.com', required: true },
          { name: 'port', type: 'number', description: '端口，465（SSL）或 587（TLS）', required: true },
          { name: 'secure', type: 'boolean', description: '是否使用 SSL，465 一般为 true', required: false },
          { name: 'user', type: 'string', description: '发件邮箱，如 xxx@qq.com', required: true },
          { name: 'pass', type: 'string', description: '授权码（QQ 邮箱为 SMTP 授权码）', required: true },
          { name: 'from', type: 'string', description: '发件人显示名，如 X Computer <xxx@qq.com>', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.set_email_config: 需要已登录用户');
        const setConfig = ctx?.setConfig;
        if (!setConfig) throw new Error('x.set_email_config: 配置不可用');
        const host = String(input.host ?? '').trim();
        const port = Number(input.port);
        const user = String(input.user ?? '').trim();
        const pass = String(input.pass ?? '').trim();
        if (!host || !user || !pass) throw new Error('x.set_email_config: host、user、pass 必填');
        if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('x.set_email_config: port 须为 1–65535');
        const secure = input.secure !== false;
        const from = typeof input.from === 'string' ? input.from.trim() : undefined;
        const config = { host, port, secure, user, pass, ...(from ? { from } : {}) };
        const setResult = setConfig(userId, EMAIL_SMTP_CONFIG_KEY, JSON.stringify(config));
        if (setResult instanceof Promise) await setResult;
        clearEmailTransporterCache();
        return { ok: true, message: '邮箱配置已保存，可使用 x.send_email 发信' };
      },
    );

    this.register(
      {
        name: 'x.delete_email_config',
        displayName: '删除邮箱配置',
        description: '删除当前 SMTP 配置，删除后将无法使用 x.send_email。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.delete_email_config: 需要已登录用户');
        const setConfig = ctx?.setConfig;
        const getConfig = ctx?.getConfig;
        if (!setConfig || !getConfig) throw new Error('x.delete_email_config: 配置不可用');
        const config = parseSmtpConfigExport(await getConfigValue(getConfig, userId, EMAIL_SMTP_CONFIG_KEY));
        if (!config) return { ok: true, message: '当前未配置邮箱' };
        const setResult = setConfig(userId, EMAIL_SMTP_CONFIG_KEY, '{}');
        if (setResult instanceof Promise) await setResult;
        clearEmailTransporterCache();
        return { ok: true, message: '邮箱配置已删除' };
      },
    );

    // IMAP 收信（R042 邮件渠道双向通信）：x.check_email 拉取收件箱，收到回复后 X 可处理并用 x.send_email 回复
    const EMAIL_IMAP_CONFIG_KEY = 'email_imap_config';

    this.register(
      {
        name: 'x.check_email',
        displayName: '检查收件箱',
        description:
          '从 IMAP 收件箱拉取邮件。from_user_only 为 true 时仅拉取当前用户发来的邮件（用于用户通过邮箱与 X 沟通）。limit 默认 10；unseen_only 为 true 时仅拉未读。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'limit', type: 'number', description: '拉取数量，默认 10，最多 50', required: false },
          { name: 'unseen_only', type: 'boolean', description: '仅拉取未读邮件', required: false },
          { name: 'from_user_only', type: 'boolean', description: '仅拉取当前用户发来的邮件', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.check_email: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.check_email: 配置不可用');
        const limit = typeof input.limit === 'number' ? Math.min(50, Math.max(1, input.limit)) : 10;
        const unseenOnly = input.unseen_only === true;
        const fromUserOnly = input.from_user_only === true;
        let fromFilter: string | undefined;
        if (fromUserOnly && this.db) {
          fromFilter = (await this.db.getEmailByUserId(userId)) ?? undefined;
          if (!fromFilter) throw new Error('x.check_email: from_user_only 需要当前用户已绑定邮箱');
        }
        const result = await fetchEmails(getConfig, userId, { limit, unseenOnly, fromFilter });
        if (!result.ok) throw new Error(result.error ?? '收信失败');
        return { ok: true, emails: result.emails ?? [], count: (result.emails ?? []).length };
      },
    );

    this.register(
      {
        name: 'x.list_email_imap_config',
        displayName: '列出 IMAP 配置',
        description: '查看当前 IMAP 收信配置（host、port、user），密码脱敏。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.list_email_imap_config: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.list_email_imap_config: 配置不可用');
        const config = parseImapConfig(await getConfigValue(getConfig, userId, EMAIL_IMAP_CONFIG_KEY));
        if (!config) return { configured: false, message: '未配置 IMAP 收信' };
        return {
          configured: true,
          host: config.host,
          port: config.port,
          secure: config.secure,
          user: config.user,
          pass: config.pass ? '***' : undefined,
        };
      },
    );

    this.register(
      {
        name: 'x.set_email_imap_config',
        displayName: '新增或更新 IMAP 配置',
        description:
          '配置 IMAP 收信。host（如 imap.qq.com）、port（993）、user、pass 必填。QQ 邮箱 user/pass 可与 SMTP 相同。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'host', type: 'string', description: 'IMAP 服务器，如 imap.qq.com', required: true },
          { name: 'port', type: 'number', description: '端口，通常 993', required: true },
          { name: 'secure', type: 'boolean', description: '是否 SSL', required: false },
          { name: 'user', type: 'string', description: '邮箱账号', required: true },
          { name: 'pass', type: 'string', description: '授权码', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.set_email_imap_config: 需要已登录用户');
        const setConfig = ctx?.setConfig;
        if (!setConfig) throw new Error('x.set_email_imap_config: 配置不可用');
        const host = String(input.host ?? '').trim();
        const port = Number(input.port);
        const user = String(input.user ?? '').trim();
        const pass = String(input.pass ?? '').trim();
        if (!host || !user || !pass) throw new Error('x.set_email_imap_config: host、user、pass 必填');
        if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new Error('x.set_email_imap_config: port 须为 1–65535');
        const secure = input.secure !== false;
        const config = { host, port, secure, user, pass };
        setConfig(userId, EMAIL_IMAP_CONFIG_KEY, JSON.stringify(config));
        return { ok: true, message: 'IMAP 配置已保存，可使用 x.check_email 收信' };
      },
    );

    const EMAIL_FROM_FILTER_KEY = 'email_from_filter';
    this.register(
      {
        name: 'x.set_email_from_filter',
        displayName: '设置邮件发件人过滤',
        description:
          '设置只处理来自指定发件人的新邮件。传入 emails 数组（如 ["user@gmail.com"]），未配置则处理所有。用于「只监听来自某邮箱的邮件」场景。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'emails', type: 'string', description: '发件人邮箱列表，逗号分隔或 JSON 数组', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.set_email_from_filter: 需要已登录用户');
        const setConfig = ctx?.setConfig;
        if (!setConfig) throw new Error('x.set_email_from_filter: 配置不可用');
        const raw = String(input.emails ?? '').trim();
        if (!raw) {
          setConfig(userId, EMAIL_FROM_FILTER_KEY, '');
          return { ok: true, message: '已清除发件人过滤，将处理所有新邮件' };
        }
        let arr: string[];
        if (raw.startsWith('[')) {
          try {
            arr = JSON.parse(raw) as string[];
            if (!Array.isArray(arr)) arr = [raw];
          } catch {
            arr = raw.split(',').map((e) => e.trim()).filter(Boolean);
          }
        } else {
          arr = raw.split(',').map((e) => e.trim()).filter(Boolean);
        }
        setConfig(userId, EMAIL_FROM_FILTER_KEY, JSON.stringify(arr));
        return { ok: true, message: `已设置发件人过滤：${arr.join(', ')}，仅这些地址的来信会触发回复` };
      },
    );
    this.register(
      {
        name: 'x.list_email_from_filter',
        displayName: '查看邮件发件人过滤',
        description: '查看当前发件人过滤配置。若已配置，仅来自这些邮箱的新邮件会触发 email_received。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.list_email_from_filter: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.list_email_from_filter: 配置不可用');
        const raw = await getConfigValue(getConfig, userId, EMAIL_FROM_FILTER_KEY);
        if (!raw?.trim()) return { emails: [], message: '未设置过滤，处理所有新邮件' };
        try {
          const arr = JSON.parse(raw) as unknown[];
          const emails = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : raw.split(',').map((e) => e.trim()).filter(Boolean);
          return { emails, message: emails.length ? `仅处理来自 ${emails.join(', ')} 的邮件` : '未设置过滤' };
        } catch {
          return { emails: raw.split(',').map((e) => e.trim()).filter(Boolean), message: '' };
        }
      },
    );

    // ── MCP 配置管理：X 可查看、添加、修改、删除 MCP 服务器 ─────────────────────────────
    const MCP_CONFIG_KEY = 'mcp_config';

    this.register(
      {
        name: 'x.list_mcp_config',
        displayName: '列出 MCP 配置',
        description: '查看当前 MCP 服务器列表（id、name、url 或 command+args、工具数）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.list_mcp_config: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('x.list_mcp_config: 配置不可用');
        const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
        const servers = raw?.trim()
          ? normalizeMcpConfig(
              (() => {
                try {
                  const p = JSON.parse(raw) as unknown;
                  return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
                } catch {
                  return {};
                }
              })(),
            )
          : [];
        return {
          servers: servers.map((s) => ({
            id: s.id,
            name: s.name ?? s.id,
            url: s.url,
            command: s.command,
            args: s.args,
          })),
          count: servers.length,
        };
      },
    );

    this.register(
      {
        name: 'x.add_mcp_server',
        displayName: '添加 MCP 服务器',
        description:
          '添加一个 MCP 服务器。方式一：传 id、url（HTTP）或 id、command、args（Stdio），可选 name、headers。方式二：传 config（JSON），格式为 {"serverId":{"url":"...","headers":{...}} } 或 {"serverId":{"type":"streamableHttp","url":"...","headers":{...}} }，从 config 中解析 id、url、headers。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'id', type: 'string', description: '唯一标识；若传 config 则可省略（从 config 的 key 提取）', required: false },
          { name: 'config', type: 'string', description: '可选。完整配置 JSON，如 {"metaso":{"url":"https://...","headers":{"Authorization":"Bearer xxx"}}}', required: false },
          { name: 'name', type: 'string', description: '显示名称', required: false },
          { name: 'url', type: 'string', description: 'HTTP 传输：JSON-RPC 端点 URL', required: false },
          { name: 'headers', type: 'string', description: 'HTTP 传输：请求头 JSON，如 {"Authorization":"Bearer xxx"}', required: false },
          { name: 'command', type: 'string', description: 'Stdio 传输：启动命令，如 npx', required: false },
          { name: 'args', type: 'string', description: 'Stdio 传输：参数 JSON 数组，如 ["bing-cn-mcp"]', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.add_mcp_server: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        const reloadMcp = ctx?.reloadMcpForUser;
        if (!getConfig || !setConfig) throw new Error('x.add_mcp_server: 配置不可用');
        let id = String(input.id ?? '').trim();
        let url = typeof input.url === 'string' ? input.url.trim() || undefined : undefined;
        let headers: Record<string, string> | undefined;
        let name = typeof input.name === 'string' ? input.name.trim() || undefined : undefined;
        let command = typeof input.command === 'string' ? input.command.trim() || undefined : undefined;
        let args: string[] | undefined;
        const configStr = typeof input.config === 'string' ? input.config.trim() : undefined;
        if (configStr) {
          try {
            const cfg = JSON.parse(configStr) as Record<string, unknown>;
            if (!cfg || typeof cfg !== 'object') throw new Error('config 须为 JSON 对象');
            const entries = Object.entries(cfg);
            if (entries.length === 0) throw new Error('config 不能为空');
            const [serverId, serverCfg] = entries[0]!;
            const c = serverCfg && typeof serverCfg === 'object' ? (serverCfg as Record<string, unknown>) : {};
            if (!id) id = serverId;
            if (!url) url = typeof c.url === 'string' ? c.url.trim() : undefined;
            if (c.headers && typeof c.headers === 'object') {
              headers = Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [String(k), String(v)]));
            }
            if (!name && typeof c.name === 'string') name = c.name.trim();
          } catch (e) {
            throw new Error(`x.add_mcp_server: config 解析失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (!id) throw new Error('x.add_mcp_server: id 必填，或通过 config 传入 {"serverId":{...}}');
        const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
        const servers = raw?.trim()
          ? normalizeMcpConfig((() => {
              try {
                const p = JSON.parse(raw) as unknown;
                return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
              } catch {
                return {};
              }
            })())
          : [];
        if (servers.some((s) => s.id === id)) throw new Error(`x.add_mcp_server: id "${id}" 已存在`);
        if (!url) url = typeof input.url === 'string' ? input.url.trim() || undefined : undefined;
        if (!name && typeof input.name === 'string') name = input.name.trim() || undefined;
        if (headers === undefined && typeof input.headers === 'string' && input.headers.trim()) {
          try {
            const h = JSON.parse(input.headers);
            if (h && typeof h === 'object') headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [String(k), String(v)]));
          } catch {
            throw new Error('x.add_mcp_server: headers 须为 JSON 对象');
          }
        }
        if (!command) command = typeof input.command === 'string' ? input.command.trim() || undefined : undefined;
        if (args === undefined && typeof input.args === 'string' && input.args.trim()) {
          try {
            const a = JSON.parse(input.args);
            args = Array.isArray(a) ? a.map(String) : undefined;
          } catch {
            throw new Error('x.add_mcp_server: args 须为 JSON 数组');
          }
        }
        if (url) {
          const s: McpServerConfig = { id, name, url, headers };
          servers.push(s);
        } else if (command) {
          const s: McpServerConfig = { id, name, command, args };
          servers.push(s);
        } else {
          throw new Error('x.add_mcp_server: 需提供 url（HTTP）或 command+args（Stdio）');
        }
        const setResult = setConfig(userId, MCP_CONFIG_KEY, JSON.stringify(servers));
        if (setResult instanceof Promise) await setResult;
        if (reloadMcp) await reloadMcp(userId);
        return { ok: true, message: `已添加 MCP 服务器 ${id}，配置已重载` };
      },
    );

    this.register(
      {
        name: 'x.update_mcp_server',
        displayName: '更新 MCP 服务器',
        description: '按 id 更新已有 MCP 服务器。可更新 name、url、headers、command、args，未传的字段保持不变。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'id', type: 'string', description: '要更新的服务器 id', required: true },
          { name: 'name', type: 'string', description: '显示名称', required: false },
          { name: 'url', type: 'string', description: 'HTTP：JSON-RPC 端点 URL', required: false },
          { name: 'headers', type: 'string', description: 'HTTP：请求头 JSON', required: false },
          { name: 'command', type: 'string', description: 'Stdio：启动命令', required: false },
          { name: 'args', type: 'string', description: 'Stdio：参数 JSON 数组', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.update_mcp_server: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        const reloadMcp = ctx?.reloadMcpForUser;
        if (!getConfig || !setConfig) throw new Error('x.update_mcp_server: 配置不可用');
        const id = String(input.id ?? '').trim();
        if (!id) throw new Error('x.update_mcp_server: id 必填');
        const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
        const servers = raw?.trim()
          ? normalizeMcpConfig((() => {
              try {
                const p = JSON.parse(raw) as unknown;
                return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
              } catch {
                return {};
              }
            })())
          : [];
        const idx = servers.findIndex((s) => s.id === id);
        if (idx < 0) throw new Error(`x.update_mcp_server: 未找到 id "${id}"`);
        const s = servers[idx];
        if (typeof input.name === 'string') s.name = input.name.trim() || s.id;
        if (typeof input.url === 'string') s.url = input.url.trim() || undefined;
        if (typeof input.headers === 'string' && input.headers.trim()) {
          try {
            const h = JSON.parse(input.headers);
            if (h && typeof h === 'object') s.headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [String(k), String(v)]));
          } catch {
            throw new Error('x.update_mcp_server: headers 须为 JSON 对象');
          }
        }
        if (typeof input.command === 'string') s.command = input.command.trim() || undefined;
        if (typeof input.args === 'string' && input.args.trim()) {
          try {
            const a = JSON.parse(input.args);
            s.args = Array.isArray(a) ? a.map(String) : undefined;
          } catch {
            throw new Error('x.update_mcp_server: args 须为 JSON 数组');
          }
        }
        const setResult = setConfig(userId, MCP_CONFIG_KEY, JSON.stringify(servers));
        if (setResult instanceof Promise) await setResult;
        if (reloadMcp) await reloadMcp(userId);
        return { ok: true, message: `已更新 MCP 服务器 ${id}，配置已重载` };
      },
    );

    this.register(
      {
        name: 'x.remove_mcp_server',
        displayName: '删除 MCP 服务器',
        description: '按 id 删除 MCP 服务器，删除后立即重载。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'id', type: 'string', description: '要删除的服务器 id', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.remove_mcp_server: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        const reloadMcp = ctx?.reloadMcpForUser;
        if (!getConfig || !setConfig) throw new Error('x.remove_mcp_server: 配置不可用');
        const id = String(input.id ?? '').trim();
        if (!id) throw new Error('x.remove_mcp_server: id 必填');
        const raw = await getConfigValue(getConfig, userId, MCP_CONFIG_KEY);
        const servers = raw?.trim()
          ? normalizeMcpConfig((() => {
              try {
                const p = JSON.parse(raw) as unknown;
                return Array.isArray(p) ? { servers: p } : (typeof p === 'object' && p !== null ? p : {});
              } catch {
                return {};
              }
            })())
          : [];
        const next = servers.filter((s) => s.id !== id);
        if (next.length === servers.length) throw new Error(`x.remove_mcp_server: 未找到 id "${id}"`);
        const setResult = setConfig(userId, MCP_CONFIG_KEY, JSON.stringify(next));
        if (setResult instanceof Promise) await setResult;
        if (reloadMcp) await reloadMcp(userId);
        return { ok: true, message: `已删除 MCP 服务器 ${id}，配置已重载` };
      },
    );

    // 标记 X 主动消息为已读（用户看到后点击已读，或 X 在跟进处理后标记）
    this.register(
      {
        name: 'x.mark_proactive_read',
        displayName: '标记消息已读',
        description: '将指定的一条或若干条「X 主动找用户」的消息标记为已读。用户看到通知后可自行点击已读，或你在跟进处理（如已配置 Key、已答复用户）后调用本工具标记，无需用户再操作。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'message_id', type: 'string', description: '单条消息 id（从 x.notify_user 返回或上下文可知）', required: false },
          { name: 'message_ids', type: 'string', description: '多条消息 id，JSON 数组字符串，如 ["id1","id2"]；与 message_id 二选一', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('x.mark_proactive_read: 需要已登录用户');
        let ids: string[] = [];
        if (input.message_id && typeof input.message_id === 'string') ids = [input.message_id.trim()];
        if (ids.length === 0 && input.message_ids) {
          try {
            const raw = typeof input.message_ids === 'string' ? input.message_ids : JSON.stringify(input.message_ids);
            const arr = JSON.parse(raw);
            ids = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
          } catch {
            throw new Error('x.mark_proactive_read: message_ids 须为 JSON 数组字符串');
          }
        }
        for (const id of ids) if (id) markXProactiveRead(userId, id);
        return { ok: true, marked: ids.length };
      },
    );

    // ── 小程序/小游戏后端：KV 存储与队列（X 创建数据，前端通过 /api/x-apps/backend/* 读写） ─────────────────
    const appBackendDb = this.db;
    const requireUserId = (ctx: ExecutionContext | undefined, toolName: string): string => {
      const uid = ctx?.userId;
      if (!uid || uid === 'anonymous') throw new Error(`${toolName}: 需要已登录用户`);
      return uid;
    };

    this.register(
      {
        name: 'backend.kv_set',
        displayName: '写入键值',
        description: '为指定小程序/小游戏写入一条键值数据（后端存储）。前端可通过 GET/PUT /api/x-apps/backend/kv/:appId?key=xxx 读写同一数据。用于排行榜、用户进度、配置等。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id（与 x.create_app 的 app_id 一致）', required: true },
          { name: 'key', type: 'string', description: '键名', required: true },
          { name: 'value', type: 'string', description: '值（字符串；存 JSON 时请先 JSON.stringify）', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        if (!appBackendDb) throw new Error('backend.kv_set: 数据库不可用');
        const userId = requireUserId(ctx, 'backend.kv_set');
        const appId = String(input.app_id ?? '').trim();
        const key = String(input.key ?? '').trim();
        const value = String(input.value ?? '');
        if (!appId || !key) throw new Error('backend.kv_set: app_id 与 key 必填');
        appBackendDb.appBackendKvSet(userId, appId, key, value);
        return { ok: true };
      },
    );

    this.register(
      {
        name: 'backend.kv_get',
        displayName: '读取键值',
        description: '读取指定小程序/小游戏的键值数据。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id', required: true },
          { name: 'key', type: 'string', description: '键名', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        if (!appBackendDb) throw new Error('backend.kv_get: 数据库不可用');
        const userId = requireUserId(ctx, 'backend.kv_get');
        const appId = String(input.app_id ?? '').trim();
        const key = String(input.key ?? '').trim();
        if (!appId || !key) throw new Error('backend.kv_get: app_id 与 key 必填');
        const value = appBackendDb.appBackendKvGet(userId, appId, key);
        if (value === undefined) return { found: false };
        return { found: true, value };
      },
    );

    this.register(
      {
        name: 'backend.kv_delete',
        displayName: '删除键值',
        description: '删除指定小程序/小游戏的一条键值数据。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id', required: true },
          { name: 'key', type: 'string', description: '键名', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        if (!appBackendDb) throw new Error('backend.kv_delete: 数据库不可用');
        const userId = requireUserId(ctx, 'backend.kv_delete');
        const appId = String(input.app_id ?? '').trim();
        const key = String(input.key ?? '').trim();
        if (!appId || !key) throw new Error('backend.kv_delete: app_id 与 key 必填');
        appBackendDb.appBackendKvDelete(userId, appId, key);
        return { ok: true };
      },
    );

    this.register(
      {
        name: 'backend.kv_list',
        displayName: '列出键',
        description: '列出指定小程序/小游戏的键（可选 prefix 前缀过滤）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id', required: true },
          { name: 'prefix', type: 'string', description: '可选，只返回以此前缀开头的 key', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        if (!appBackendDb) throw new Error('backend.kv_list: 数据库不可用');
        const userId = requireUserId(ctx, 'backend.kv_list');
        const appId = String(input.app_id ?? '').trim();
        const prefix = (input.prefix as string)?.trim() || undefined;
        if (!appId) throw new Error('backend.kv_list: app_id 必填');
        const keys = appBackendDb.appBackendKvList(userId, appId, prefix);
        return { keys };
      },
    );

    this.register(
      {
        name: 'backend.queue_push',
        displayName: '队列推入',
        description: '向指定小程序/小游戏的队列推入一条消息（FIFO）。前端可通过 POST /api/x-apps/backend/queue/:appId/:queueName/push 与 GET .../pop 读写同一队列。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id', required: true },
          { name: 'queue_name', type: 'string', description: '队列名', required: true },
          { name: 'payload', type: 'string', description: '消息内容（字符串）', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        if (!appBackendDb) throw new Error('backend.queue_push: 数据库不可用');
        const userId = requireUserId(ctx, 'backend.queue_push');
        const appId = String(input.app_id ?? '').trim();
        const queueName = String(input.queue_name ?? '').trim();
        const payload = String(input.payload ?? '');
        if (!appId || !queueName) throw new Error('backend.queue_push: app_id 与 queue_name 必填');
        appBackendDb.appBackendQueuePush(userId, appId, queueName, payload);
        return { ok: true };
      },
    );

    this.register(
      {
        name: 'backend.queue_pop',
        displayName: '队列弹出',
        description: '从指定小程序/小游戏队列弹出一条消息（FIFO）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id', required: true },
          { name: 'queue_name', type: 'string', description: '队列名', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        if (!appBackendDb) throw new Error('backend.queue_pop: 数据库不可用');
        const userId = requireUserId(ctx, 'backend.queue_pop');
        const appId = String(input.app_id ?? '').trim();
        const queueName = String(input.queue_name ?? '').trim();
        if (!appId || !queueName) throw new Error('backend.queue_pop: app_id 与 queue_name 必填');
        const payload = appBackendDb.appBackendQueuePop(userId, appId, queueName);
        if (payload === null) return { empty: true };
        return { empty: false, payload };
      },
    );

    this.register(
      {
        name: 'backend.queue_len',
        displayName: '队列长度',
        description: '查询指定小程序/小游戏队列当前长度。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id', required: true },
          { name: 'queue_name', type: 'string', description: '队列名', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        if (!appBackendDb) throw new Error('backend.queue_len: 数据库不可用');
        const userId = requireUserId(ctx, 'backend.queue_len');
        const appId = String(input.app_id ?? '').trim();
        const queueName = String(input.queue_name ?? '').trim();
        if (!appId || !queueName) throw new Error('backend.queue_len: app_id 与 queue_name 必填');
        const length = appBackendDb.appBackendQueueLen(userId, appId, queueName);
        return { length };
      },
    );

    this.register(
      {
        name: 'backend.broadcast_to_app',
        displayName: '向小程序推送消息',
        description: '向当前已打开该小程序的用户推送一条实时消息（WebSocket）。用户需已打开该应用窗口；消息会通过 app_channel 发到前端，小程序 iframe 内可用 window.addEventListener("message", e => e.data?.type === "x_app_channel" 处理)。用于游戏状态同步、通知、实时更新等。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id', required: true },
          { name: 'message', type: 'string', description: '要推送的内容（建议 JSON 字符串，前端解析）', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = requireUserId(ctx, 'backend.broadcast_to_app');
        const appId = String(input.app_id ?? '').trim();
        const message = input.message != null ? String(input.message) : '';
        if (!appId) throw new Error('backend.broadcast_to_app: app_id 必填');
        broadcastToAppChannel(userId, appId, message);
        return { ok: true };
      },
    );

    // ── 浏览器控制：X 可实时操作桌面内置浏览器 ─────────────────
    this.register(
      {
        name: 'browser.navigate',
        displayName: '浏览器导航',
        description:
          '控制桌面内置浏览器：导航到指定 URL。用户需已打开浏览器窗口，或传入 open_if_needed: true 则未打开时自动打开。用于替用户浏览网页、查看资料、搜索信息。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'url', type: 'string', description: '要打开的网址，如 https://www.google.com', required: true },
          { name: 'open_if_needed', type: 'boolean', description: '若浏览器未打开则自动打开，默认 true', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = requireUserId(ctx, 'browser.navigate');
        const url = String(input.url ?? '').trim();
        if (!url) throw new Error('browser.navigate: url 必填');
        const openIfNeeded = input.open_if_needed !== false;
        broadcastToAppChannel(userId, 'browser', { action: 'navigate', url, openIfNeeded });
        return { ok: true, message: '已发送导航指令到浏览器' };
      },
    );

    // ── X 制作有界面的小程序（存于沙箱 apps/<id>/，可固定到桌面打开） ─────────────────
    this.register(
      {
        name: 'x.create_app',
        displayName: '创建小程序',
        description:
          '制作小程序/小游戏，支持两种方式。(1) 工程化（必须按顺序）：① 先只写 apps/<id>/plan.md，含功能概述、技术细节、文件结构、开发步骤；若为游戏或需声音，plan 须含「资源清单」（需生成的音效、BGM 及用途）；② file.read 自检 plan，不完善则完善后再自检；③ 若 plan 中有音效/BGM，必须先主动用 llm.generate_sound_effect、llm.generate_music 生成到 apps/<id>/assets/sfx/、assets/bgm/，再在代码中用相对路径 assets/sfx/xxx.wav、assets/bgm/xxx.wav 引用；④ 再创建 index.html、style.css、app.js、可选 icon.png（llm.generate_image），图片放 apps/<id>/assets/images/；最后调用本工具传 app_id、name 仅注册。(2) 快速：传 html_content 生成单页。**资源统一放 apps/<id>/assets/（images/、sfx/、bgm/）**，代码用 assets/xxx 引用。界面填满窗口（width:100%）；做游戏时音效/BGM 是必选步骤。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '应用唯一 ID', required: true },
          { name: 'name', type: 'string', description: '应用显示名称', required: true },
          { name: 'html_content', type: 'string', description: '可选。有则生成单页；无则仅注册，假定你已用 file.write 创建 index.html 等', required: false },
          { name: 'css_content', type: 'string', description: '可选，与 html_content 搭配时内联', required: false },
          { name: 'js_content', type: 'string', description: '可选，与 html_content 搭配时内联', required: false },
          { name: 'plan_content', type: 'string', description: '可选，写入 plan.md 的开发计划', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const appId = String(input.app_id ?? '').trim().replace(/\s+/g, '-');
        if (!/^[a-zA-Z0-9_-]+$/.test(appId)) return { ok: false, error: 'app_id 仅允许英文、数字、短横线、下划线' };
        const name = String(input.name ?? '').trim();
        if (!name) return { ok: false, error: 'name 必填' };
        const bodyOrHtml = decodeHtmlEntities(String(input.html_content ?? '').trim());
        const planContent = String(input.plan_content ?? '').trim();
        const appPath = `apps/${appId}`;
        const fs = await this.resolveFS(ctx);
        if (!fs) return { ok: false, error: '沙箱不可用' };

        if (bodyOrHtml) {
          const css = input.css_content != null ? decodeHtmlEntities(String(input.css_content).trim()) : '';
          const js = input.js_content != null ? decodeHtmlEntities(String(input.js_content).trim()) : '';
          const titleEsc = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          const baseStyle =
            '<style>html,body{margin:0;padding:0;width:100%;min-height:100%;box-sizing:border-box;}*{box-sizing:inherit;}</style>';
          let fullHtml: string;
          if (bodyOrHtml.toLowerCase().startsWith('<!doctype') || bodyOrHtml.toLowerCase().startsWith('<html')) {
            fullHtml = bodyOrHtml;
            fullHtml = fullHtml.replace(/(<head\b[^>]*>)/i, `$1${baseStyle}`);
            if (css) fullHtml = fullHtml.replace(/<\/head>/i, `<style>${css}</style></head>`);
            if (js) fullHtml = fullHtml.replace(/<\/body>/i, `<script>${js}</script></body>`);
          } else {
            fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${titleEsc}</title>${baseStyle}${css ? `<style>${css}</style>` : ''}</head><body>${bodyOrHtml}${js ? `<script>${js}</script>` : ''}</body></html>`;
          }
          try {
            await fs.writeOverwrite(`${appPath}/index.html`, fullHtml);
          } catch (e: any) {
            return { ok: false, error: `写入失败: ${e.message}` };
          }
        }
        if (planContent) {
          try {
            await fs.writeOverwrite(`${appPath}/plan.md`, planContent);
          } catch {
            /* 非致命 */
          }
        }
        const list = await loadMiniApps(getConfig, userId);
        if (list.some((a) => a.id === appId)) {
          const idx = list.findIndex((a) => a.id === appId);
          list[idx] = { id: appId, name, path: appPath };
        } else {
          list.push({ id: appId, name, path: appPath });
        }
        saveMiniApps(setConfig, userId, list);
        return { ok: true, appId, message: bodyOrHtml ? `已创建应用「${name}」` : `已注册应用「${name}」（请确保 apps/${appId}/index.html 等已存在）` };
      },
    );

    this.register(
      {
        name: 'x.list_apps',
        displayName: '列出小程序',
        description: '列出当前用户由 X 制作的小程序（有界面的应用）列表，含 id、name、path。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { apps: [], message: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { apps: [], message: '无法读取配置' };
        const list = await loadMiniApps(getConfig, userId);
        return { apps: list };
      },
    );

    this.register(
      {
        name: 'x.get_app_logs',
        displayName: '获取小程序日志',
        description:
          '查看指定小程序的运行时日志（控制台错误、未捕获异常等）。用户反馈「某应用有问题」时可用此工具获取该应用的最近错误与警告，再结合 file.read 查看代码进行排错。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'app_id', type: 'string', description: '小程序 id（与 x.list_apps 中的 id 一致）', required: true },
          { name: 'limit', type: 'number', description: '返回条数，默认 30', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { logs: [], message: '需要已登录用户' };
        if (!this.miniAppLogStore) return { logs: [], message: '日志服务不可用' };
        const appId = String(input.app_id ?? '').trim();
        if (!appId) return { logs: [], message: 'app_id 必填' };
        const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.min(input.limit, 100) : 30;
        const logs = this.miniAppLogStore.getLogs(userId, appId, limit);
        return { logs, appId };
      },
    );

    // ── X 创建与管理智能体（管理者创建，派发任务给智能体执行） ─────────────────────
    this.register(
      {
        name: 'x.create_agent',
        displayName: '创建智能体',
        description:
          '创建一个由 X 管理的智能体。你是管理者，智能体是执行者。可指定：name（名称）、system_prompt（该智能体的系统提示词：角色、能力、约束）、tool_names（该智能体可用的工具名列表，如 file.read,file.write,shell.run；空数组表示使用全部工具）、可选 role（角色标签，如写手、审核、数据分析师，便于组队）、goal_template、output_description。可选 llm_provider_id、llm_model_id 指定该智能体执行时使用的大模型（由 llm.* 工具管理）；未指定则使用用户默认模型。创建后可用 x.run_agent 派发任务或加入团队。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'name', type: 'string', description: '智能体名称', required: true },
          { name: 'system_prompt', type: 'string', description: '该智能体的系统提示词（角色、能力、约束）', required: true },
          { name: 'tool_names', type: 'array', description: '该智能体可调用的工具名列表，如 ["file.read","file.write"]；空则用全部', required: false },
          { name: 'role', type: 'string', description: '角色标签（如写手、审核、数据分析师），便于组队与派活', required: false },
          { name: 'goal_template', type: 'string', description: '目标描述模板或说明（派发时可作为 goal 填入）', required: false },
          { name: 'output_description', type: 'string', description: '期望输出内容说明', required: false },
          { name: 'llm_provider_id', type: 'string', description: '可选：该智能体使用的大模型提供商 ID（llm.list_providers 返回的 id）', required: false },
          { name: 'llm_model_id', type: 'string', description: '可选：该智能体使用的大模型 ID（llm.list_models 返回的 id）', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写智能体配置' };
        const name = String(input.name ?? '').trim();
        const systemPrompt = String(input.system_prompt ?? '').trim();
        if (!name || !systemPrompt) return { ok: false, error: 'name 与 system_prompt 必填' };
        const rawTools = input.tool_names;
        const toolNames = Array.isArray(rawTools)
          ? rawTools.map((t) => String(t).trim()).filter(Boolean)
          : [];
        const role = input.role != null ? String(input.role).trim() : undefined;
        const goalTemplate = input.goal_template != null ? String(input.goal_template).trim() : undefined;
        const outputDescription = input.output_description != null ? String(input.output_description).trim() : undefined;
        const llmProviderId = input.llm_provider_id != null ? String(input.llm_provider_id).trim() || undefined : undefined;
        const llmModelId = input.llm_model_id != null ? String(input.llm_model_id).trim() || undefined : undefined;
        const list = await loadAgents(getConfig, userId);
        const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const agent: AgentDefinition = {
          id,
          name,
          systemPrompt,
          toolNames,
          role: role || undefined,
          goalTemplate: goalTemplate || undefined,
          outputDescription: outputDescription || undefined,
          llmProviderId: llmProviderId || undefined,
          llmModelId: llmModelId || undefined,
          createdAt: now,
          updatedAt: now,
        };
        list.push(agent);
        saveAgents(setConfig, userId, list);
        return { ok: true, agentId: id, message: `已创建智能体「${name}」` };
      },
    );

    this.register(
      {
        name: 'x.list_agents',
        displayName: '列出智能体',
        description: '列出当前用户下由 X 创建的所有智能体（id、name、toolNames、goal_template、output_description）。派发任务前可先查看可用智能体。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { agents: [], message: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { agents: [], message: '无法读取配置' };
        const list = await loadAgents(getConfig, userId);
        return { agents: list };
      },
    );

    this.register(
      {
        name: 'x.run_agent',
        displayName: '运行智能体',
        description:
          '派发任务给已创建的智能体执行。你是管理者，智能体是执行者。传入 agent_id（x.list_agents 返回的 id）、goal（本次要完成的目标或用户消息）。智能体会用自己的提示词和工具完成任务并返回结果。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'agent_id', type: 'string', description: '智能体 ID（从 x.list_agents 获取）', required: true },
          { name: 'goal', type: 'string', description: '本次要完成的目标或交给智能体的用户消息', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', content: '' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { ok: false, error: '无法读取配置', content: '' };
        const agentId = String(input.agent_id ?? '').trim();
        const goal = String(input.goal ?? '').trim();
        if (!agentId || !goal) return { ok: false, error: 'agent_id 与 goal 必填', content: '' };
        const list = await loadAgents(getConfig, userId);
        const agent = list.find((a) => a.id === agentId);
        if (!agent) return { ok: false, error: '未找到该智能体', content: '' };
        const run = this.runCustomAgentLoop;
        if (!run) return { ok: false, error: '服务未配置智能体执行', content: '' };
        try {
          const { content } = await run({ agentDef: agent, goal, userId });
          return { ok: true, content };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, error: msg, content: '' };
        }
      },
    );

    this.register(
      {
        name: 'x.update_agent',
        displayName: '更新智能体',
        description: '更新已创建的智能体。传入 agent_id 及要修改的字段（name、system_prompt、tool_names、role、goal_template、output_description、llm_provider_id、llm_model_id），未传的字段保持不变。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'agent_id', type: 'string', description: '智能体 ID', required: true },
          { name: 'name', type: 'string', description: '新名称', required: false },
          { name: 'system_prompt', type: 'string', description: '新系统提示词', required: false },
          { name: 'tool_names', type: 'array', description: '新工具名列表', required: false },
          { name: 'role', type: 'string', description: '角色标签（如写手、审核、数据分析师）', required: false },
          { name: 'goal_template', type: 'string', description: '新目标模板', required: false },
          { name: 'output_description', type: 'string', description: '新输出说明', required: false },
          { name: 'llm_provider_id', type: 'string', description: '可选：该智能体使用的大模型提供商 ID', required: false },
          { name: 'llm_model_id', type: 'string', description: '可选：该智能体使用的大模型 ID', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const agentId = String(input.agent_id ?? '').trim();
        if (!agentId) return { ok: false, error: 'agent_id 必填' };
        const list = await loadAgents(getConfig, userId);
        const idx = list.findIndex((a) => a.id === agentId);
        if (idx < 0) return { ok: false, error: '未找到该智能体' };
        const now = Date.now();
        const cur = list[idx]!;
        if (input.name != null) cur.name = String(input.name).trim() || cur.name;
        if (input.system_prompt != null) cur.systemPrompt = String(input.system_prompt).trim() || cur.systemPrompt;
        if (input.tool_names !== undefined)
          cur.toolNames = Array.isArray(input.tool_names) ? input.tool_names.map((t) => String(t).trim()).filter(Boolean) : cur.toolNames;
        if (input.role != null) cur.role = String(input.role).trim() || undefined;
        if (input.goal_template != null) cur.goalTemplate = String(input.goal_template).trim() || undefined;
        if (input.output_description != null) cur.outputDescription = String(input.output_description).trim() || undefined;
        if (input.llm_provider_id !== undefined) cur.llmProviderId = String(input.llm_provider_id).trim() || undefined;
        if (input.llm_model_id !== undefined) cur.llmModelId = String(input.llm_model_id).trim() || undefined;
        cur.updatedAt = now;
        saveAgents(setConfig, userId, list);
        return { ok: true, message: '已更新智能体' };
      },
    );

    this.register(
      {
        name: 'x.remove_agent',
        displayName: '删除智能体',
        description: '删除一个已创建的智能体。传入 agent_id（从 x.list_agents 获取）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'agent_id', type: 'string', description: '要删除的智能体 ID', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const agentId = String(input.agent_id ?? '').trim();
        if (!agentId) return { ok: false, error: 'agent_id 必填' };
        const original = await loadAgents(getConfig, userId);
        const list = original.filter((a) => a.id !== agentId);
        if (list.length === original.length) return { ok: false, error: '未找到该智能体' };
        saveAgents(setConfig, userId, list);
        return { ok: true, message: '已删除智能体' };
      },
    );

    // ── X 智能体团队（流水线协作：按 agent 顺序依次执行，上一环节输出作为下一环节输入） ─────────────────
    this.register(
      {
        name: 'x.create_team',
        displayName: '创建团队',
        description:
          '创建一个智能体团队。团队由多个智能体按顺序组成流水线（如收集→撰写→审核）。传入 name（团队名称）、agent_ids（智能体 id 数组，顺序即执行顺序，从 x.list_agents 获取）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'name', type: 'string', description: '团队名称', required: true },
          { name: 'agent_ids', type: 'array', description: '智能体 id 数组，顺序即执行顺序', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const name = String(input.name ?? '').trim();
        if (!name) return { ok: false, error: 'name 必填' };
        const agentIds = parseAgentIds(input.agent_ids);
        if (agentIds.length === 0) return { ok: false, error: 'agent_ids 至少包含一个智能体 id' };
        const teams = await loadTeams(getConfig, userId);
        const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const team: AgentTeam = { id, name, agentIds, createdAt: now, updatedAt: now };
        teams.push(team);
        saveTeams(setConfig, userId, teams);
        return { ok: true, teamId: id, message: `已创建团队「${name}」` };
      },
    );

    this.register(
      {
        name: 'x.list_teams',
        displayName: '列出团队',
        description: '列出当前用户下所有智能体团队（id、name、agentIds）。用于 run_team 前查看或组队规划。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { teams: [], message: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { teams: [], message: '无法读取配置' };
        const teams = await loadTeams(getConfig, userId);
        return { teams };
      },
    );

    this.register(
      {
        name: 'x.run_team',
        displayName: '运行团队',
        description:
          '按团队顺序依次执行智能体（流水线）。传入 team_id（从 x.list_teams 获取）、goal（本次团队要完成的目标）。第一个智能体以 goal 执行；后续每个智能体会收到「上一环节输出」加本次 goal 作为目标，适合收集→撰写→审核等办公流程。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'team_id', type: 'string', description: '团队 ID（从 x.list_teams 获取）', required: true },
          { name: 'goal', type: 'string', description: '本次团队要完成的目标', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', content: '' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { ok: false, error: '无法读取配置', content: '' };
        const teamId = String(input.team_id ?? '').trim();
        const goal = String(input.goal ?? '').trim();
        if (!teamId || !goal) return { ok: false, error: 'team_id 与 goal 必填', content: '' };
        const teams = await loadTeams(getConfig, userId);
        const team = teams.find((t) => t.id === teamId);
        if (!team) return { ok: false, error: '未找到该团队', content: '' };
        const agents = await loadAgents(getConfig, userId);
        const run = this.runCustomAgentLoop;
        if (!run) return { ok: false, error: '服务未配置智能体执行', content: '' };
        let prevOutput = '';
        const steps: string[] = [];
        for (let i = 0; i < team.agentIds.length; i++) {
          const agentId = team.agentIds[i]!;
          const agent = agents.find((a) => a.id === agentId);
          if (!agent) {
            return { ok: false, error: `团队中的智能体 ${agentId} 不存在`, content: prevOutput || '' };
          }
          const stepGoal =
            i === 0 ? goal : `上一环节输出：\n${prevOutput}\n\n本次目标：${goal}`;
          try {
            const { content } = await run({ agentDef: agent, goal: stepGoal, userId });
            prevOutput = content;
            steps.push(`[${agent.name}] ${content.slice(0, 200)}${content.length > 200 ? '…' : ''}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: `团队执行到「${agent.name}」时失败：${msg}`, content: prevOutput || '' };
          }
        }
        return { ok: true, content: prevOutput, steps };
      },
    );

    this.register(
      {
        name: 'x.update_team',
        displayName: '更新团队',
        description: '更新团队。传入 team_id 及要修改的 name 或 agent_ids，未传的保持不变。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'team_id', type: 'string', description: '团队 ID', required: true },
          { name: 'name', type: 'string', description: '新名称', required: false },
          { name: 'agent_ids', type: 'array', description: '新的智能体 id 顺序', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const teamId = String(input.team_id ?? '').trim();
        if (!teamId) return { ok: false, error: 'team_id 必填' };
        const teams = await loadTeams(getConfig, userId);
        const idx = teams.findIndex((t) => t.id === teamId);
        if (idx < 0) return { ok: false, error: '未找到该团队' };
        const cur = teams[idx]!;
        if (input.name != null) cur.name = String(input.name).trim() || cur.name;
        if (input.agent_ids !== undefined) {
          const next = parseAgentIds(input.agent_ids);
          cur.agentIds = next.length > 0 ? next : cur.agentIds;
        }
        cur.updatedAt = Date.now();
        saveTeams(setConfig, userId, teams);
        return { ok: true, message: '已更新团队' };
      },
    );

    this.register(
      {
        name: 'x.remove_team',
        displayName: '删除团队',
        description: '删除一个智能体团队。传入 team_id（从 x.list_teams 获取）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'team_id', type: 'string', description: '要删除的团队 ID', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const teamId = String(input.team_id ?? '').trim();
        if (!teamId) return { ok: false, error: 'team_id 必填' };
        const list = await loadTeams(getConfig, userId);
        const next = list.filter((t) => t.id !== teamId);
        if (next.length === list.length) return { ok: false, error: '未找到该团队' };
        saveTeams(setConfig, userId, next);
        return { ok: true, message: '已删除团队' };
      },
    );

    // ── X 智能体群组（类似群聊：主脑建群、拉人、派发任务、收集结果） ─────────────────────────────
    this.register(
      {
        name: 'x.create_group',
        displayName: '创建群组',
        description:
          '创建一个智能体群组（类似群聊）。可指定 name；可选 agent_ids 直接加入成员，也可先建空群再用 x.add_agents_to_group 加人。用于把多个智能体放进一个群，再通过 x.run_group 派发任务并收集各人结果。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'name', type: 'string', description: '群组名称', required: true },
          { name: 'agent_ids', type: 'array', description: '可选，初始成员智能体 id 列表', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const name = String(input.name ?? '').trim();
        if (!name) return { ok: false, error: 'name 必填' };
        const agentIds = parseAgentIds(input.agent_ids);
        const groups = await loadGroups(getConfig, userId);
        const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const group: AgentGroup = { id, name, agentIds, createdAt: now, updatedAt: now };
        groups.push(group);
        saveGroups(setConfig, userId, groups);
        return { ok: true, groupId: id, message: `已创建群组「${name}」` };
      },
    );

    this.register(
      {
        name: 'x.list_groups',
        displayName: '列出群组',
        description: '列出当前用户下所有智能体群组（id、name、agentIds）。用于 run_group 或管理成员前查看。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { groups: [], message: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { groups: [], message: '无法读取配置' };
        const groups = await loadGroups(getConfig, userId);
        return { groups };
      },
    );

    this.register(
      {
        name: 'x.add_agents_to_group',
        displayName: '添加成员到群组',
        description: '把已有智能体加入群组。传入 group_id（从 x.list_groups 获取）、agent_ids（要加入的智能体 id 列表）。可多次调用以陆续加人。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'group_id', type: 'string', description: '群组 ID', required: true },
          { name: 'agent_ids', type: 'array', description: '要加入的智能体 id 列表', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const groupId = String(input.group_id ?? '').trim();
        if (!groupId) return { ok: false, error: 'group_id 必填' };
        const toAdd = parseAgentIds(input.agent_ids);
        if (toAdd.length === 0) return { ok: false, error: 'agent_ids 至少包含一个 id' };
        const groups = await loadGroups(getConfig, userId);
        const g = groups.find((x) => x.id === groupId);
        if (!g) return { ok: false, error: '未找到该群组' };
        const existing = new Set(g.agentIds);
        for (const id of toAdd) {
          if (!existing.has(id)) {
            g.agentIds.push(id);
            existing.add(id);
          }
        }
        g.updatedAt = Date.now();
        saveGroups(setConfig, userId, groups);
        return { ok: true, message: `已向群组加入 ${toAdd.length} 个智能体` };
      },
    );

    this.register(
      {
        name: 'x.remove_agents_from_group',
        displayName: '从群组移除成员',
        description: '从群组中移除部分智能体。传入 group_id、agent_ids（要移除的智能体 id 列表）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'group_id', type: 'string', description: '群组 ID', required: true },
          { name: 'agent_ids', type: 'array', description: '要移除的智能体 id 列表', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const groupId = String(input.group_id ?? '').trim();
        if (!groupId) return { ok: false, error: 'group_id 必填' };
        const toRemove = parseAgentIds(input.agent_ids);
        const groups = await loadGroups(getConfig, userId);
        const g = groups.find((x) => x.id === groupId);
        if (!g) return { ok: false, error: '未找到该群组' };
        const set = new Set(toRemove);
        g.agentIds = g.agentIds.filter((id) => !set.has(id));
        g.updatedAt = Date.now();
        saveGroups(setConfig, userId, groups);
        return { ok: true, message: '已从群组移除指定智能体' };
      },
    );

    this.register(
      {
        name: 'x.run_group',
        displayName: '运行群组',
        description:
          '向群组派发任务并收集结果。传入 group_id、goal（本次要大家完成的目标或话题）。群内每个智能体会用同一 goal 执行一轮，你作为主脑会收到所有人的输出列表（results），可据此汇总或再引导。适合头脑风暴、多角色分别贡献、分工收集后由你汇总。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'group_id', type: 'string', description: '群组 ID（从 x.list_groups 获取）', required: true },
          { name: 'goal', type: 'string', description: '本次派发给群组的目标或话题', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', results: [] };
        const getConfig = ctx?.getConfig;
        if (!getConfig) return { ok: false, error: '无法读取配置', results: [] };
        const groupId = String(input.group_id ?? '').trim();
        const goal = String(input.goal ?? '').trim();
        if (!groupId || !goal) return { ok: false, error: 'group_id 与 goal 必填', results: [] };
        const groups = await loadGroups(getConfig, userId);
        const group = groups.find((g) => g.id === groupId);
        if (!group) return { ok: false, error: '未找到该群组', results: [] };
        if (group.agentIds.length === 0) return { ok: false, error: '群组内暂无成员，请先用 x.add_agents_to_group 加人', results: [] };
        const agents = await loadAgents(getConfig, userId);
        const run = this.runCustomAgentLoop;
        if (!run) return { ok: false, error: '服务未配置智能体执行', results: [] };
        if (ctx?.clearGroupRunCancel && userId) ctx.clearGroupRunCancel(userId);
        const results: Array<{ agentId: string; agentName: string; content: string }> = [];
        const total = group.agentIds.length;
        for (let i = 0; i < total; i++) {
          if (ctx?.isGroupRunCancelRequested?.(userId)) {
            if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, done: true, cancelled: true });
            if (ctx?.setConfig && ctx?.getConfig) void appendGroupRunHistory(ctx.getConfig, ctx.setConfig, userId, { groupId, groupName: group.name, goal, results, cancelled: true });
            return { ok: true, cancelled: true, results };
          }
          const agentId = group.agentIds[i]!;
          const agent = agents.find((a) => a.id === agentId);
          const nextAgent = i + 1 < total ? agents.find((a) => a.id === group.agentIds[i + 1]) : undefined;
          if (!agent) {
            results.push({ agentId, agentName: '(未知)', content: `[未找到智能体 ${agentId}]` });
            if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, currentAgentName: nextAgent?.name, done: false });
            continue;
          }
          try {
            const { content } = await run({ agentDef: agent, goal, userId });
            results.push({ agentId: agent.id, agentName: agent.name, content });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results.push({ agentId: agent.id, agentName: agent.name, content: `[执行失败: ${msg}]` });
          }
          if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, currentAgentName: nextAgent?.name, done: i === total - 1 });
        }
        if (ctx?.onGroupRunProgress && userId) ctx.onGroupRunProgress(userId, { groupId, goal, results, totalAgents: total, done: true });
        if (ctx?.setConfig && ctx?.getConfig) void appendGroupRunHistory(ctx.getConfig, ctx.setConfig, userId, { groupId, groupName: group.name, goal, results });
        return { ok: true, results };
      },
    );

    this.register(
      {
        name: 'x.update_group',
        displayName: '更新群组',
        description: '更新群组。传入 group_id 及要修改的 name，未传的保持不变。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'group_id', type: 'string', description: '群组 ID', required: true },
          { name: 'name', type: 'string', description: '新名称', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const groupId = String(input.group_id ?? '').trim();
        if (!groupId) return { ok: false, error: 'group_id 必填' };
        const groups = await loadGroups(getConfig, userId);
        const idx = groups.findIndex((g) => g.id === groupId);
        if (idx < 0) return { ok: false, error: '未找到该群组' };
        const cur = groups[idx]!;
        if (input.name != null) cur.name = String(input.name).trim() || cur.name;
        cur.updatedAt = Date.now();
        saveGroups(setConfig, userId, groups);
        return { ok: true, message: '已更新群组' };
      },
    );

    this.register(
      {
        name: 'x.remove_group',
        displayName: '删除群组',
        description: '删除一个智能体群组。传入 group_id（从 x.list_groups 获取）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'group_id', type: 'string', description: '要删除的群组 ID', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) return { ok: false, error: '无法读写配置' };
        const groupId = String(input.group_id ?? '').trim();
        if (!groupId) return { ok: false, error: 'group_id 必填' };
        const list = await loadGroups(getConfig, userId);
        const next = list.filter((g) => g.id !== groupId);
        if (next.length === list.length) return { ok: false, error: '未找到该群组' };
        saveGroups(setConfig, userId, next);
        return { ok: true, message: '已删除群组' };
      },
    );

    // Skill 对应工具：发现到的 Skill 若在 skillTools 登记，则动态加入 function call，供 AI 直接调用
    for (const { definition, handler } of getSkillToolsToRegister()) {
      this.register(definition, handler as ToolHandler);
    }

    // 主脑自我进化：追加自己遵循的规则/策略，后续对话中会注入到系统提示
    if (this.evolvedPromptService) {
      this.register(
        {
          name: 'evolve_system_prompt',
          description:
            '主脑自我进化：追加你（主脑）自己遵循的规则与策略到系统提示。适合在反思、用户反复纠正某类行为、或阶段性总结后调用。追加的内容会在后续对话中自动注入到「自我约定」块。仅追加、不覆盖已有内容。注意：只写用户偏好与行为准则，不要写入开发、代码、技术规范、项目实现等开发相关内容。',
          domain: ['chat', 'agent'],
          riskLevel: 'low',
          parameters: [
            { name: 'content', type: 'string', description: '要追加的自我约定内容（一段 Markdown 或列表）', required: true },
            { name: 'reason', type: 'string', description: '可选，简要说明为何做此更新', required: false },
          ],
          requiredPermissions: [],
        },
        async (input, ctx) => {
          const content = String(input.content ?? '').trim();
          if (!content) throw new Error('evolve_system_prompt: content 必填');
          const devKeywords = /代码|开发|编程|typescript|javascript|python|测试|test|lint|git|commit|项目规范|技术实现|api|接口|函数|模块|框架|frontend|backend|实现细节/i;
          if (devKeywords.test(content)) {
            throw new Error('evolve_system_prompt: 进化提示词仅用于用户偏好与行为准则，不要写入开发、代码、技术规范类内容');
          }
          await this.evolvedPromptService!.append(ctx?.userId, content);
          const reason = input.reason != null ? String(input.reason).trim() : '';
          return { ok: true, message: '已追加到自我约定，后续对话将生效', reason: reason || undefined };
        },
      );
    }

    // 主脑完全替换基础系统提示词：身份、使命、人设等均可重写，不限制想象
    this.register(
      {
        name: 'replace_system_prompt',
        description:
          '完全替换你的基础系统提示词（身份、使命、人设、规则等）。写入后系统组装时将使用新内容替代默认提示词。可用于换人设、改身份、重写所有约束；不限制想象。content 为完整的 Markdown 系统提示正文。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'content', type: 'string', description: '完整的系统提示词正文（将完全替代默认身份/使命/人设）', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const content = String(input.content ?? '').trim();
        if (!content) throw new Error('replace_system_prompt: content 必填');
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('replace_system_prompt: 需要已登录用户');
        const fs = await this.resolveFS(ctx);
        if (!fs) throw new Error('replace_system_prompt: 无法解析用户沙箱');
        const ms = new MemoryService(fs);
        await ms.writeBasePrompt(content);
        return { ok: true, message: '已替换基础系统提示词，后续对话将使用新身份/人设' };
      },
    );

    // X 主脑感知「用户与 AI 助手」近期对话，用于了解用户需求与助手表现
    if (this.getRecentAssistantChat) {
      this.register(
        {
          name: 'read_recent_assistant_chat',
          displayName: '读取近期助手对话',
          description:
            '读取该用户与 AI 助手**尚未被 X 读过的**对话（跨会话、按时间排序）。每次调用后会将本次返回的消息标记为已读，下次只返回新消息。用于 X 感知用户和助手聊了什么、助手回答得如何，以便决定是否优化助手提示词。可定时调用（如每日自检）后结合 update_assistant_prompt 改进助手表现。返回内容仅作参考与优化助手用；切勿根据其中提到的已完成动作再次执行相同操作。',
          domain: ['chat', 'agent'],
          riskLevel: 'low',
          parameters: [
            { name: 'limit', type: 'number', description: '最多返回最近多少条消息，默认 80', required: false },
          ],
          requiredPermissions: [],
        },
        async (input, ctx) => {
          const userId = ctx?.userId;
          if (!userId || userId === 'anonymous') throw new Error('read_recent_assistant_chat: 需要已登录用户');
          const limit = typeof input.limit === 'number' ? Math.min(200, Math.max(10, input.limit)) : 80;
          const text = await this.getRecentAssistantChat!(userId, limit);
          return { ok: true, content: text, message: '已返回近期用户与 AI 助手的对话' };
        },
      );
    }

    // X 主脑优化 AI 助手系统提示词，使助手更好服务用户（可根据 read_recent_assistant_chat 结果定时更新）
    this.register(
      {
        name: 'update_assistant_prompt',
        displayName: '更新助手说明',
        description:
          '更新「AI 助手」专用的系统说明（写入 memory/ASSISTANT_PROMPT.md），后续用户与 AI 助手对话时会注入。用于根据用户与助手的对话质量优化助手表现，例如：用户常问写作、助手回答不够好时，可追加写作相关的指导。可定时执行：先 read_recent_assistant_chat 再看是否需要 update_assistant_prompt。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'content', type: 'string', description: '要写入的 AI 助手专用说明（完整替换现有内容）', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const content = String(input.content ?? '').trim();
        if (!content) throw new Error('update_assistant_prompt: content 必填');
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('update_assistant_prompt: 需要已登录用户');
        const fs = await this.resolveFS(ctx);
        if (!fs) throw new Error('update_assistant_prompt: 无法解析用户沙箱');
        const ms = new MemoryService(fs);
        await ms.writeAssistantPrompt(content);
        return { ok: true, message: '已更新 AI 助手专用说明，后续用户与助手对话将生效' };
      },
    );

    // ── 向量记忆：查询、转向量、删除（文件过大时先转向量再 semantic search 读取相关片段）──
    this.register(
      {
        name: 'memory_search',
        displayName: '向量记忆搜索',
        description:
          '按语义搜索向量记忆库，返回与查询最相关的片段。当用户提供的大文件无法完整读取时，可先对文件调用 memory_embed_add 转为向量，再用本工具按问题搜索相关片段。需在系统设置中配置「向量嵌入」模型。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'query', type: 'string', description: '搜索查询（自然语言，如「关于xxx的说明」「用户偏好」）', required: true },
          { name: 'topK', type: 'number', description: '最多返回多少条片段，默认 5', required: false },
          { name: 'useHybrid', type: 'boolean', description: '是否使用混合检索（向量+关键词），默认 false', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', content: '' };
        const mem = await this.getMemoryServiceForUser?.(userId);
        if (!mem) return { ok: false, error: '无法获取记忆服务', content: '' };
        const vecConfig = await this.getVectorConfigForUser?.(userId);
        const query = String(input.query ?? '').trim();
        if (!query) return { ok: false, error: 'query 必填', content: '' };
        const topK = typeof input.topK === 'number' ? Math.min(20, Math.max(1, input.topK)) : 5;
        const useHybrid = !!input.useHybrid;
        const workspaceId = userId !== 'anonymous' ? userId : undefined;
        let queryVector: number[] | undefined;
        if (vecConfig?.providerId && vecConfig?.modelId) {
          try {
            queryVector = await callEmbedding(query, vecConfig);
            await mem.updateStatusMeta(
              {
                retrievalMode: 'hybrid',
                provider: {
                  configured: true,
                  available: true,
                  providerId: vecConfig.providerId,
                  modelId: vecConfig.modelId,
                },
                lastEmbedError: undefined,
                fallback: { active: false },
              },
              workspaceId,
            );
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            await mem.updateStatusMeta(
              {
                retrievalMode: 'keyword_fallback',
                provider: {
                  configured: true,
                  available: false,
                  providerId: vecConfig.providerId,
                  modelId: vecConfig.modelId,
                },
                lastEmbedError: msg,
                fallback: { active: true, reason: 'embedding_failed' },
              },
              workspaceId,
            );
            return { ok: false, error: `向量嵌入失败：${msg}。请检查系统设置中「向量嵌入」模型与 API Key。`, content: '' };
          }
        }
        const content = await mem.recall(query, {
          queryVector,
          topK,
          useHybrid,
          workspaceId,
        });
        return { ok: true, content: content || '（无相关记忆）', message: content ? `找到 ${topK} 条相关片段` : '未找到相关记忆' };
      },
    );

    this.register(
      {
        name: 'memory_embed_add',
        displayName: '转向量（嵌入并加入索引）',
        description:
          '将文件或文本转为向量并加入记忆索引。当用户提供的文件过大无法完整读取时，先调用本工具将文件转向量，再用 memory_search 按问题检索相关片段。path 为沙箱内路径（如 文档/长文.md）；或传 content 直接嵌入文本。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'path', type: 'string', description: '沙箱内文件路径（与 content 二选一）', required: false },
          { name: 'content', type: 'string', description: '直接嵌入的文本（与 path 二选一）', required: false },
          { name: 'chunkSize', type: 'number', description: '分块大小（字符数），默认 600', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', indexed: 0 };
        const mem = await this.getMemoryServiceForUser?.(userId);
        if (!mem) return { ok: false, error: '无法获取记忆服务', indexed: 0 };
        const vecConfig = await this.getVectorConfigForUser?.(userId);
        if (!vecConfig?.providerId || !vecConfig?.modelId) {
          return { ok: false, error: '请先在系统设置中配置「向量嵌入」模型（如 text-embedding-3-small）', indexed: 0 };
        }
        let text = '';
        let filePath = '';
        const pathParam = typeof input.path === 'string' ? input.path.trim() : '';
        const contentParam = typeof input.content === 'string' ? input.content.trim() : '';
        if (pathParam && !pathParam.includes('..')) {
          const fs = await this.resolveFS(ctx);
          if (!fs) return { ok: false, error: '无法解析沙箱', indexed: 0 };
          try {
            text = await fs.read(pathParam);
            filePath = pathParam;
          } catch (e: unknown) {
            return { ok: false, error: `读取文件失败：${e instanceof Error ? e.message : String(e)}`, indexed: 0 };
          }
        } else if (contentParam) {
          text = contentParam;
          filePath = `inline-${Date.now()}.txt`;
        } else {
          return { ok: false, error: '请提供 path 或 content 之一', indexed: 0 };
        }
        const chunkSize = typeof input.chunkSize === 'number' ? Math.min(2000, Math.max(200, input.chunkSize)) : 600;
        const overlap = Math.min(80, Math.floor(chunkSize / 4));
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += chunkSize - overlap) {
          chunks.push(text.slice(i, i + chunkSize));
        }
        if (chunks.length === 0) return { ok: true, indexed: 0, message: '内容为空，未添加' };
        const date = new Date().toISOString().slice(0, 10);
        let indexed = 0;
        try {
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const vector = await callEmbedding(chunk, vecConfig);
            await mem.addToIndex({ filePath, date, text: chunk, vector }, userId !== 'anonymous' ? userId : undefined);
            indexed++;
          }
          await mem.updateStatusMeta(
            {
              retrievalMode: 'hybrid',
              provider: {
                configured: true,
                available: true,
                providerId: vecConfig.providerId,
                modelId: vecConfig.modelId,
              },
              lastEmbedError: undefined,
              fallback: { active: false },
            },
            userId !== 'anonymous' ? userId : undefined,
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          await mem.updateStatusMeta(
            {
              retrievalMode: 'keyword_fallback',
              provider: {
                configured: true,
                available: false,
                providerId: vecConfig.providerId,
                modelId: vecConfig.modelId,
              },
              lastEmbedError: msg,
              fallback: { active: true, reason: 'embedding_failed' },
            },
            userId !== 'anonymous' ? userId : undefined,
          );
          return { ok: false, error: `向量嵌入失败：${msg}`, indexed };
        }
        return { ok: true, indexed, message: `已添加 ${indexed} 条片段到向量索引` };
      },
    );

    this.register(
      {
        name: 'memory_delete',
        displayName: '删除向量记忆',
        description:
          '按文件路径从向量索引中删除相关条目。path 可为完整路径（如 memory/2026-02-11.md）或路径前缀，将删除所有匹配的条目。',
        domain: ['chat', 'agent', 'office'],
        riskLevel: 'low',
        parameters: [
          { name: 'path', type: 'string', description: '要删除的文件路径或前缀（如 文档/长文.md 或 memory/2026-02-）', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', removed: 0 };
        const mem = await this.getMemoryServiceForUser?.(userId);
        if (!mem) return { ok: false, error: '无法获取记忆服务', removed: 0 };
        const pathParam = String(input.path ?? '').trim();
        if (!pathParam) return { ok: false, error: 'path 必填', removed: 0 };
        const removed = await mem.deleteFromIndex(pathParam, userId !== 'anonymous' ? userId : undefined);
        return { ok: true, removed, message: `已删除 ${removed} 条向量记录` };
      },
    );

    // R015：X 主脑读取「用户给 X 的待办/留言」，可定时或事件触发时调用
    this.register(
      {
        name: 'read_pending_requests',
        description:
          '读取用户留给 X 的待办或留言列表（用户可在 X 主脑或设置中添加）。用于 X 定时或事件触发时查看是否有需要处理的事项，处理后可调用 clear_pending_requests 清除已处理的项。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'limit', type: 'number', description: '最多返回条数，默认 50', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('read_pending_requests: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        if (!getConfig) throw new Error('read_pending_requests: 无配置存储');
        const raw = await getConfigValue(getConfig, userId, 'x_pending_requests');
        let list: Array<{ id: string; content: string; createdAt: number }> = [];
        try {
          if (raw) list = JSON.parse(raw) as typeof list;
        } catch {
          list = [];
        }
        const limit = typeof input.limit === 'number' ? Math.min(100, Math.max(1, input.limit)) : 50;
        const slice = list.slice(-limit).reverse();
        return {
          ok: true,
          items: slice,
          total: list.length,
          message: `共 ${list.length} 条待办，返回最近 ${slice.length} 条`,
        };
      },
    );

    this.register(
      {
        name: 'clear_pending_requests',
        description:
          '清除用户待办/留言中已处理的项。传入已处理的 id 数组则只删这些；不传或传空数组则清空全部。应在 read_pending_requests 并处理完后调用。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'ids', type: 'array', description: '要清除的条目 id 数组，不传则清空全部', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('clear_pending_requests: 需要已登录用户');
        const getConfig = ctx?.getConfig;
        const setConfig = ctx?.setConfig;
        if (!getConfig || !setConfig) throw new Error('clear_pending_requests: 无配置存储');
        const raw = await getConfigValue(getConfig, userId, 'x_pending_requests');
        let list: Array<{ id: string; content: string; createdAt: number }> = [];
        try {
          if (raw) list = JSON.parse(raw) as typeof list;
        } catch {
          list = [];
        }
        const idsToRemove = Array.isArray(input.ids)
          ? (input.ids as unknown[]).filter((x) => typeof x === 'string') as string[]
          : null;
        const next = idsToRemove?.length
          ? list.filter((x) => !idsToRemove.includes(x.id))
          : [];
        const setResult = setConfig(userId, 'x_pending_requests', JSON.stringify(next));
        if (setResult instanceof Promise) await setResult;
        return {
          ok: true,
          removed: list.length - next.length,
          remaining: next.length,
          message: `已清除 ${list.length - next.length} 条，剩余 ${next.length} 条`,
        };
      },
    );

    // ── R041 工作流引擎 ───────────────────────────────────────────
    this.register(
      {
        name: 'workflow.deploy',
        description:
          '部署/更新工作流定义。传入 id、name、version、nodes、edges、triggers（可选）。nodes 含 start/task/exclusive/parallel/end；edges 含 from、to、condition（网关用）；triggers 可含 type:timer+cron 或 type:event+eventName。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'definition', type: 'object', description: '流程定义 JSON', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.deploy: 需要已登录用户');
        const def = input.definition as Record<string, unknown>;
        if (!def?.id || !Array.isArray(def.nodes) || !Array.isArray(def.edges)) throw new Error('workflow.deploy: 需要 definition.id, nodes, edges');
        return workflowClient.workflowDeploy(userId, def);
      },
    );
    this.register(
      {
        name: 'workflow.list',
        description: '列出当前用户的所有工作流定义。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [],
        requiredPermissions: [],
      },
      async (_input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.list: 需要已登录用户');
        return workflowClient.workflowList(userId);
      },
    );
    this.register(
      {
        name: 'workflow.delete',
        description: '删除工作流定义。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'definitionId', type: 'string', description: '流程定义 id', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.delete: 需要已登录用户');
        const id = input.definitionId as string;
        if (!id) throw new Error('workflow.delete: definitionId 必填');
        return workflowClient.workflowDelete(userId, id);
      },
    );
    this.register(
      {
        name: 'workflow.start',
        description: '启动工作流实例。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'definitionId', type: 'string', description: '流程定义 id', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.start: 需要已登录用户');
        const id = input.definitionId as string;
        if (!id) throw new Error('workflow.start: definitionId 必填');
        return workflowClient.workflowStart(userId, id);
      },
    );
    this.register(
      {
        name: 'workflow.list_instances',
        description: '列出工作流实例。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'definitionId', type: 'string', description: '可选，按流程 id 过滤', required: false }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.list_instances: 需要已登录用户');
        const defId = input.definitionId as string | undefined;
        return workflowClient.workflowListInstances(userId, defId);
      },
    );
    this.register(
      {
        name: 'workflow.get_instance',
        description: '获取工作流实例详情。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [{ name: 'instanceId', type: 'string', description: '实例 id', required: true }],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.get_instance: 需要已登录用户');
        const id = input.instanceId as string;
        if (!id) throw new Error('workflow.get_instance: instanceId 必填');
        return workflowClient.workflowGetInstance(userId, id);
      },
    );
    this.register(
      {
        name: 'workflow.get_variable',
        description: '获取工作流实例变量（可指定 key 或返回全部）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'instanceId', type: 'string', description: '实例 id', required: true },
          { name: 'key', type: 'string', description: '变量名，不传则返回全部', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.get_variable: 需要已登录用户');
        const id = input.instanceId as string;
        if (!id) throw new Error('workflow.get_variable: instanceId 必填');
        const vars = await workflowClient.workflowGetVariables(userId, id);
        const key = input.key as string | undefined;
        if (key) return { value: vars[key] };
        return { variables: vars };
      },
    );
    this.register(
      {
        name: 'workflow.set_variable',
        description: '设置工作流实例变量。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'instanceId', type: 'string', description: '实例 id', required: true },
          { name: 'variables', type: 'object', description: '要设置的变量键值对', required: true },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.set_variable: 需要已登录用户');
        const id = input.instanceId as string;
        const vars = input.variables as Record<string, unknown>;
        if (!id || !vars || typeof vars !== 'object') throw new Error('workflow.set_variable: instanceId 和 variables 必填');
        const result = await workflowClient.workflowSetVariables(userId, id, vars);
        return { ok: true, variables: result };
      },
    );
    this.register(
      {
        name: 'workflow.signal',
        description: '向运行中的实例发送信号（可用于外部事件继续流程）。',
        domain: ['chat', 'agent'],
        riskLevel: 'low',
        parameters: [
          { name: 'instanceId', type: 'string', description: '实例 id', required: true },
          { name: 'nodeId', type: 'string', description: '完成的任务节点 id', required: false },
          { name: 'variables', type: 'object', description: '合并到实例的变量', required: false },
        ],
        requiredPermissions: [],
      },
      async (input, ctx) => {
        const userId = ctx?.userId;
        if (!userId || userId === 'anonymous') throw new Error('workflow.signal: 需要已登录用户');
        const id = input.instanceId as string;
        if (!id) throw new Error('workflow.signal: instanceId 必填');
        return workflowClient.workflowSignal(userId, id, {
          nodeId: input.nodeId as string | undefined,
          variables: input.variables as Record<string, unknown> | undefined,
        });
      },
    );
  }

  private register(definition: ToolDefinition, handler: ToolHandler) {
    this.definitions.set(definition.name, definition);
    this.tools.set(definition.name, handler);
  }

  private simulateDelay(min: number, max: number): Promise<void> {
    const ms = min + Math.random() * (max - min);
    return new Promise((r) => setTimeout(r, ms));
  }
}
