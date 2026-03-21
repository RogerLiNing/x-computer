import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { DoneLogService } from '../services/DoneLogService.js';
import { MemoryServiceWrapper } from '../services/MemoryServiceWrapper.js';
import { v4 as uuid } from 'uuid';
import { createTasksRouter } from './tasks.js';
import { createSchedulerRouter } from './scheduler.js';
import { createLLMRouter } from './llm.js';
import { createSkillsRouter } from './skills.js';
import { createHealthRouter } from './health.js';
import { createMemoryRouter } from './memory.js';
import { createPromptRouter } from './prompt.js';
import { createXProactiveRouter } from './xProactive.js';
import { createXPendingRouter } from './xPending.js';
import { createXGroupRunRouter } from './xGroupRun.js';
import { createDiscordRouter } from './messaging/discord.js';
import { createTelegramRouter } from './messaging/telegram.js';
import { createQQRouter } from './messaging/qq.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { PolicyEngine } from '../policy/PolicyEngine.js';
import type { AuditLogger } from '../observability/AuditLogger.js';
import type { CreateTaskRequest, ExecutionMode, AgentDefinition, AgentTeam, AgentGroup } from '../../../shared/src/index.js';
import { callLLM, callLLMStream, callLLMWithTools, callLLMGenerateImage, type LLMToolDef, type ChatMessage } from '../chat/chatService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { broadcast } from '../wsBroadcast.js';
import { getAssembledSystemPrompt, CORE_SYSTEM_PROMPT, formatCapabilitiesSummary, formatCapabilitiesSummaryCondensed, formatSkillsSummary, MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT, TOOL_USE_MANDATE, MEMORY_TOOL_MANDATE, SCHEDULED_RUN_MANDATE } from '../prompts/systemCore.js';
import { getWelcomeMessage, getUserLanguage } from '../prompts/systemCore/promptLoader.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { MiniAppLogStore } from '../miniAppLogStore.js';
import { MemoryService } from '../memory/MemoryService.js';
import { VectorStore } from '../memory/vectorStore.js';
import { callEmbedding, callEmbeddingBatch } from '../memory/embeddingService.js';
import { createChatSessionRouter } from './chatSessions.js';
import { createAgentsRouter, loadAgentsFromDb } from './agents.js';
import { createMcpRouter } from './mcp.js';
import { createAppsRouter } from './apps.js';
import { createCapabilitiesRouter } from './capabilities.js';
import { createEditorAgentRouter } from './editorAgent.js';
import { createChatRouter } from './chat.js';
import { createWhatsAppRouter } from './messaging/whatsapp.js';
import { getMessages as getXProactiveMessages, addMessage as addXProactiveMessage, markRead as markXProactiveRead } from '../x/XProactiveMessages.js';
import {
  XScheduler,
  setDefaultScheduler,
  getDefaultScheduler,
  type ScheduledJobStore,
  type ScheduledJob,
} from '../scheduler/XScheduler.js';
import { runScheduledIntent, runWithRetry } from '../scheduler/runScheduledIntent.js';
import { loadDefaultConfig, getToolLoadingMode } from '../config/defaultConfig.js';

const EMBED_BATCH_SIZE = 10;
/** 精简系统提示中的能力列表以节省 token；设 X_COMPUTER_SYSTEM_PROMPT_CONDENSED=false 可恢复完整格式 */
const USE_CONDENSED_SYSTEM_PROMPT = process.env.X_COMPUTER_SYSTEM_PROMPT_CONDENSED !== 'false';
import { listAllCapabilities, registerCapability } from '../capabilities/CapabilityRegistry.js';
import {
  getMcpStatus,
  loadMcpConfig,
  saveMcpConfig,
  reloadMcpAndRegister,
  getMcpConfigPath,
  normalizeMcpConfig,
  loadMcpAndRegisterForUser,
  ensureUserMcpLoaded,
} from '../mcp/loadAndRegister.js';
import { listTools } from '../mcp/client.js';
import { searchMcpRegistry } from '../mcp/registry.js';
import type { McpServerConfig } from '../mcp/types.js';
import { getDiscoveredSkills, getSkillContentByName, enrichSkillsWithLLMExtraction, deleteSkill } from '../skills/discovery.js';
import { installFromSkillHub, searchSkillHub } from '../skills/install.js';
import { RECOMMENDED_SKILLS } from '../config/recommendedSkills.js';
import { truncateChatMessages, MAX_CHAT_MESSAGES } from '../utils/chatContext.js';
import { parseAgentIds } from '../utils/agentIds.js';
import { fire as fireHook, registerHook } from '../hooks/HookRegistry.js';
import { fireSignal } from '../signals/signalService.js';
import { workflowFireEvent } from '../workflow/workflowClient.js';
import { executeWorkflowTask } from '../workflow/executeTask.js';
import { startEmailCheckLoop, runEmailCheck } from '../email/emailCheckLoop.js';
import { createEmailRouter } from './email.js';
import { createSlackRouter } from './messaging/slack.js';
import { aiCallsQuota, tasksQuota } from '../subscription/quotaMiddleware.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import {
  setWhatsAppMessageHandler,
  reconnectWhatsAppForConfiguredUsers,
  sendWhatsAppMessage,
} from '../whatsapp/whatsappService.js';
import { handleWhatsAppMessage } from '../whatsapp/whatsappLoop.js';
import { setTelegramMessageHandler, getTelegramConnection, disconnectTelegram, parseTelegramConfig, reconnectTelegramForConfiguredUsers, sendTelegramMessage } from '../telegram/telegramService.js';
import { handleTelegramMessage } from '../telegram/telegramLoop.js';
import { setDiscordMessageHandler, getDiscordConnection, disconnectDiscord, parseDiscordConfig, reconnectDiscordForConfiguredUsers, sendDiscordMessage } from '../discord/discordService.js';
import { handleDiscordMessage } from '../discord/discordLoop.js';
import { setSlackMessageHandler, getSlackConnection, disconnectSlack, parseSlackConfig, reconnectSlackForConfiguredUsers, sendSlackMessage } from '../slack/slackService.js';
import { handleSlackMessage } from '../slack/slackLoop.js';
import { setQQMessageHandler, reconnectQQForConfiguredUsers, sendQQMessage } from '../qq/qqService.js';
import { handleQQMessage } from '../qq/qqLoop.js';

const MEMORY_DIR = 'memory';

/** X 主脑「近期已完成」清单的 user_config key，值为结构化 JSON 数组，最多保留 50 条 */
const X_DONE_LOG_KEY = 'x_done_log';
const X_DONE_LOG_MAX = 50;
const X_DONE_LOG_SHOW_IN_PROMPT = 15;

type DoneLogEntry = { at: number; summary: string; scheduled?: boolean; schedule?: string; title?: string; action?: string };

async function appendToDoneLog(
  db: AppDatabase,
  userId: string,
  summary: string,
  detail?: { scheduled?: boolean; schedule?: string; title?: string; action?: string },
): Promise<void> {
  const raw = await Promise.resolve(db.getConfig(userId, X_DONE_LOG_KEY));
  let arr: DoneLogEntry[] = [];
  try {
    if (raw) arr = JSON.parse(raw) as DoneLogEntry[];
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  const entry: DoneLogEntry = {
    at: Date.now(),
    summary,
    ...(detail?.scheduled && { scheduled: true }),
    ...(detail?.schedule && { schedule: detail.schedule }),
    ...(detail?.title && { title: detail.title }),
    ...(detail?.action && { action: detail.action }),
  };
  arr.push(entry);
  arr = arr.slice(-X_DONE_LOG_MAX);
  await Promise.resolve(db.setConfig(userId, X_DONE_LOG_KEY, JSON.stringify(arr)));
}

/** R041：信号触发后通知工作流引擎（若有 event 类型触发器） */
async function notifyWorkflowOnSignal(userId: string, signal: string): Promise<void> {
  if (!userId || userId === 'anonymous') return;
  workflowFireEvent(userId, signal).catch(() => {});
}
const X_AGENTS_CONFIG_KEY = 'x_agents';

async function loadAgentsForSignals(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
): Promise<AgentDefinition[]> {
  const raw = getConfig(userId, X_AGENTS_CONFIG_KEY);
  const value = raw instanceof Promise ? await raw : raw;
  if (!value) return [];
  try {
    const arr = JSON.parse(value) as unknown[];
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
function dailyPath(date: string): string {
  return `${MEMORY_DIR}/${date}.md`;
}

/** 后台执行：根据本轮对话判断是否写入记忆并可选建向量索引（不向调用方返回结果，参考 OpenClaw） */
async function runConsiderCapture(params: {
  userMessage: string;
  assistantReply: string;
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  vectorProviderId?: string;
  vectorModelId?: string;
  vectorBaseUrl?: string;
  vectorApiKey?: string;
  memoryService: MemoryService;
  workspaceId?: string;
}): Promise<void> {
  const {
    userMessage,
    assistantReply,
    providerId,
    modelId,
    baseUrl,
    apiKey,
    vectorProviderId,
    vectorModelId,
    vectorBaseUrl,
    vectorApiKey,
    memoryService,
    workspaceId,
  } = params;
  const raw = await callLLM({
    messages: [
      { role: 'system', content: MEMORY_CONSIDER_SYSTEM_PROMPT },
      { role: 'user', content: `用户：${userMessage}\n\n助手：${assistantReply}` },
    ],
    providerId,
    modelId,
    baseUrl,
    apiKey,
  });
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
  const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
  const typeLine = (lines[0] ?? '').toUpperCase();
  const typeMap = { PREFERENCE: 'preference' as const, DECISION: 'decision' as const, FACT: 'fact' as const };
  const type = typeMap[typeLine as keyof typeof typeMap] ?? 'fact';
  const content = (lines.slice(1).join(' ').trim() || lines[0] || trimmed).trim();
  if (!content) return;
  await memoryService.capture(content, type);
  const date = new Date().toISOString().slice(0, 10);
  fireHook('memory_captured', {
    workspaceId,
    type,
    content,
    filePath: dailyPath(date),
  });
  if (vectorProviderId && vectorModelId) {
    try {
      const vector = await callEmbedding(content, {
        providerId: vectorProviderId,
        modelId: vectorModelId,
        baseUrl: vectorBaseUrl,
        apiKey: vectorApiKey,
      });
      await memoryService.addToIndex(
        {
          filePath: dailyPath(date),
          date,
          text: content,
          vector,
        },
        workspaceId,
      );
      await memoryService.updateStatusMeta(
        {
          retrievalMode: 'hybrid',
          provider: {
            configured: true,
            available: true,
            providerId: vectorProviderId,
            modelId: vectorModelId,
          },
          lastEmbedError: undefined,
          fallback: { active: false },
        },
        workspaceId,
      );
    } catch (embedErr: any) {
      serverLogger.error('memory/consider-capture (index)', embedErr.message);
      await memoryService.updateStatusMeta(
        {
          retrievalMode: 'keyword_fallback',
          provider: {
            configured: true,
            available: false,
            providerId: vectorProviderId,
            modelId: vectorModelId,
          },
          lastEmbedError: embedErr?.message ?? String(embedErr),
          fallback: { active: true, reason: 'embedding_failed' },
        },
        workspaceId,
      );
    }
  }
}

/** 后台执行：从本轮对话中抽取「希望主脑长期遵守的规则/偏好」，追加到 LEARNED_PROMPT，使提示词随对话不断丰富 */
async function runLearnPromptExtract(params: {
  userMessage: string;
  assistantReply: string;
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  memoryService: MemoryService;
}): Promise<void> {
  const { userMessage, assistantReply, providerId, modelId, baseUrl, apiKey, memoryService } = params;
  const raw = await callLLM({
    messages: [
      { role: 'system', content: LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: `用户：${userMessage}\n\n助手：${assistantReply}` },
    ],
    providerId,
    modelId,
    baseUrl,
    apiKey,
  });
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
  const lines = trimmed
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const line of lines) {
    if (line.length > 200) continue;
    await memoryService.appendLearnedPrompt(line);
  }
}

export function createApiRouter(
  orchestrator: AgentOrchestrator,
  policy: PolicyEngine,
  audit: AuditLogger,
  sandboxFS: SandboxFS,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
  miniAppLogStore?: MiniAppLogStore,
  subscriptionService?: SubscriptionService,
): Router {
  const router = Router();
  router.use(createAgentsRouter(orchestrator, db));
  router.use(createTasksRouter(orchestrator, userSandboxManager, db, subscriptionService));
  router.use(createSchedulerRouter());
  router.use(createLLMRouter());
  router.use(createXProactiveRouter(db));
  router.use(createXPendingRouter(db));
  router.use(createDiscordRouter(db));
  router.use(createTelegramRouter(db));
  router.use(createQQRouter(db));
  router.use(createMcpRouter(orchestrator, sandboxFS, userSandboxManager, db));
  router.use(createAppsRouter(orchestrator, userSandboxManager, db, miniAppLogStore));
  router.use(createCapabilitiesRouter(orchestrator));
  router.use(createHealthRouter(orchestrator, audit));
  const vectorStore = new VectorStore(sandboxFS);
  const memoryService = new MemoryService(sandboxFS, vectorStore);

  router.use(createMemoryRouter(memoryService, sandboxFS, vectorStore, userSandboxManager, db, subscriptionService));
  router.use(createPromptRouter(sandboxFS, vectorStore, userSandboxManager, db));

  // 配额中间件（如果提供了 subscriptionService）
  const aiQuota = subscriptionService ? aiCallsQuota(subscriptionService) : (req: any, res: any, next: any) => next();
  const taskQuota = subscriptionService ? tasksQuota(subscriptionService) : (req: any, res: any, next: any) => next();

  /** 按用户取 MemoryService（多用户时用该用户沙箱，否则用默认） */
  async function getMemoryServiceForUser(userId: string | undefined): Promise<MemoryService | null> {
    if (!userId || userId === 'anonymous' || !userSandboxManager) return null;
    const { sandboxFS } = await userSandboxManager.getForUser(userId);
    return new MemoryService(sandboxFS, vectorStore);
  }

  /** 取当前用户「从对话中学习到的规则与偏好」文本，用于注入主脑提示 */
  async function getLearnedPromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    const svc = mem ?? memoryService;
    return svc.readLearnedPrompt();
  }

  /** 取当前用户「AI 自我进化的核心提示词」片段，用于注入主脑提示。首次访问时确保 memory/EVOLVED_CORE_PROMPT.md 存在（可空）。 */
  async function getEvolvedCorePromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    const svc = mem ?? memoryService;
    await svc.ensureEvolvedCorePromptExists();
    return svc.readEvolvedCorePrompt();
  }

  /** 取当前用户「可完全替换的基础系统提示词」；无或空则组装时用代码默认。首次访问时确保文件存在且为 CORE_SYSTEM_PROMPT。 */
  async function getBasePromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    if (!mem) return '';
    await mem.ensureBasePromptExists(CORE_SYSTEM_PROMPT);
    return mem.readBasePrompt();
  }

  /** 取当前用户「AI 助手专用说明」（由 X 主脑优化），仅注入到 AI 助手对话。首次访问时确保文件存在且为默认说明。 */
  async function getAssistantPromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    if (!mem) return '';
    await mem.ensureAssistantPromptExists();
    return mem.readAssistantPrompt();
  }

  // ── X 主脑自主定时执行：到点以对应用户身份跑 Agent，不限制内容 ──
  const getSystemPromptForScheduler = async (uid: string) => {
    const [learnedPrompt, evolvedCorePrompt, basePrompt] = await Promise.all([
      getLearnedPromptForUser(uid),
      getEvolvedCorePromptForUser(uid),
      getBasePromptForUser(uid),
    ]);
    const tools = listAllCapabilities(orchestrator.getTools());
    const skills = getDiscoveredSkills(uid);
    const caps = USE_CONDENSED_SYSTEM_PROMPT
      ? formatCapabilitiesSummaryCondensed(tools) + formatSkillsSummary(skills, true)
      : formatCapabilitiesSummary(tools) + formatSkillsSummary(skills);
    const base = getAssembledSystemPrompt({
      scene: 'none',
      promptMode: 'minimal',
      basePrompt,
      capabilities: caps,
      learnedPrompt,
      evolvedCorePrompt,
    });
    let out = base + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE + SCHEDULED_RUN_MANDATE;
    if (db) {
      const doneLogRaw = await Promise.resolve(db.getConfig(uid, X_DONE_LOG_KEY));
      if (doneLogRaw) {
        try {
          const arr = JSON.parse(doneLogRaw) as { at: number; summary: string; scheduled?: boolean; schedule?: string; title?: string; action?: string }[];
          if (Array.isArray(arr) && arr.length > 0) {
            const recent = arr.slice(-X_DONE_LOG_SHOW_IN_PROMPT).reverse();
            const oneTime = recent.filter((e) => !e.scheduled);
            const scheduledList = recent.filter((e) => e.scheduled);
            const fmt = (e: { at: number; summary: string }) =>
              `- ${new Date(e.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ${e.summary}`;
            if (oneTime.length > 0) {
              out += '\n\n## 你近期已完成的事项（勿重复执行）\n' + oneTime.map(fmt).join('\n');
            }
            if (scheduledList.length > 0) {
              out += '\n\n## 你近期定时/周期任务执行记录（可重复执行，到点照常跑）\n' + scheduledList.map(fmt).join('\n');
            }
          }
        } catch {
          /* ignore */
        }
      }
      // 注入看板摘要
      try {
        const boardItems = await Promise.resolve(db.listBoardItems(uid));
        if (boardItems.length > 0) {
          const byStatus: Record<string, typeof boardItems> = {};
          for (const item of boardItems) {
            (byStatus[item.status] ??= []).push(item);
          }
          const statusLabels: Record<string, string> = { todo: '待做', in_progress: '进行中', pending: '等待', done: '已完成' };
          const priorityLabels: Record<string, string> = { high: '高', medium: '中', low: '低' };
          const lines: string[] = [];
          for (const st of ['in_progress', 'todo', 'pending', 'done'] as const) {
            const arr = byStatus[st];
            if (!arr?.length) continue;
            lines.push(`### ${statusLabels[st] ?? st}（${arr.length}）`);
            for (const item of arr.slice(0, 10)) {
              const desc = item.description ? ` — ${item.description.slice(0, 60)}` : '';
              lines.push(`- [${priorityLabels[item.priority] ?? '中'}] ${item.title}${desc}  (id: ${item.id})`);
            }
          }
          if (lines.length > 0) {
            out += '\n\n## 你的任务看板当前状态\n使用 x.board_add/update/remove 管理看板。行动前先参考看板，把新任务加入看板，完成后更新状态。\n' + lines.join('\n');
          }
        }
      } catch { /* ignore */ }
    }
    return out;
  };
  const getLLMConfigForScheduler = async (
    uid: string,
    overrides?: { providerId?: string; modelId?: string }
  ) => {
    const fromConfig = (
      config: {
        providers?: Array<{ id: string; baseUrl?: string; apiKey?: string }>;
        defaultByModality?: { chat?: { providerId: string; modelId: string } };
      } | null
    ) => {
      if (!config?.providers?.length) return null;
      const chat = config.defaultByModality?.chat;
      const providerId = overrides?.providerId ?? chat?.providerId ?? config.providers?.[0]?.id;
      const modelId = overrides?.modelId ?? chat?.modelId ?? '__custom__';
      const provider = config.providers?.find((p) => p.id === providerId);
      if (!providerId || !modelId || !provider?.apiKey) return null;
      return {
        providerId,
        modelId,
        baseUrl: provider?.baseUrl,
        apiKey: provider?.apiKey,
      };
    };

    // 1) 仅专业版用户可使用 DB 中的 llm_config；非专业版始终用 server/.x-config.json 默认值
    const canUseUserConfig =
      !subscriptionService ||
      (await (async () => {
        const sub = await subscriptionService.getUserSubscription(uid);
        return sub ? ['pro', 'enterprise'].includes(sub.planId) : false;
      })());
    if (canUseUserConfig && db) {
      const raw = await db.getConfig(uid, 'llm_config');
      if (raw) {
        try {
          const config = JSON.parse(raw) as Parameters<typeof fromConfig>[0];
          const result = fromConfig(config);
          if (result) return result;
        } catch {
          // fall through
        }
      }
    }
    // 2) 回退到 server/.x-config.json 默认值
    const defaults = loadDefaultConfig();
    const defaultResult = fromConfig(defaults?.llm_config as Parameters<typeof fromConfig>[0] ?? null);
    if (defaultResult) return defaultResult;
    // 3) 无默认配置时使用环境变量
    const apiKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.LLM_API_KEY?.trim();
    const model = process.env.OPENROUTER_MODEL?.trim() || process.env.LLM_MODEL?.trim() || 'openai/gpt-4o-mini';
    if (apiKey) {
      return {
        providerId: 'openrouter',
        modelId: model,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey,
      };
    }
    return null;
  };
  const ensureUserMcpForScheduler =
    userSandboxManager && db
      ? (uid: string) =>
          ensureUserMcpLoaded(
            orchestrator,
            uid,
            userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
            db.getConfig.bind(db),
          )
      : undefined;

  /** 注入 getLLMConfig，供 X 派发智能体任务（x.run_agent）时获取用户大模型配置 */
  orchestrator.setGetLLMConfigForAgent(getLLMConfigForScheduler);

  /** Skills 路由 */
  router.use(createSkillsRouter(getLLMConfigForScheduler, userSandboxManager, db));

  /** 取用户「向量嵌入」模态配置，供 memory_search、memory_embed_add 使用 */
  const getVectorConfigForUser = async (
    uid: string
  ): Promise<{ providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null> => {
    const fromConfig = (
      config: {
        providers?: Array<{ id: string; baseUrl?: string; apiKey?: string }>;
        defaultByModality?: { vector?: { providerId: string; modelId: string } };
      } | null
    ) => {
      if (!config?.providers?.length) return null;
      const vec = config.defaultByModality?.vector;
      const providerId = vec?.providerId ?? config.providers?.[0]?.id;
      const modelId = vec?.modelId ?? '__custom__';
      const provider = config.providers?.find((p) => p.id === providerId);
      if (!providerId || !modelId || !provider?.apiKey) return null;
      return { providerId, modelId, baseUrl: provider?.baseUrl, apiKey: provider?.apiKey };
    };
    const canUseUserConfig =
      !subscriptionService ||
      (await (async () => {
        const sub = await subscriptionService.getUserSubscription(uid);
        return sub ? ['pro', 'enterprise'].includes(sub.planId) : false;
      })());
    if (canUseUserConfig && db) {
      const raw = await db.getConfig(uid, 'llm_config');
      if (raw) {
        try {
          const config = JSON.parse(raw) as Parameters<typeof fromConfig>[0];
          const result = fromConfig(config);
          if (result) return result;
        } catch {
          /* fall through */
        }
      }
    }
    const defaults = loadDefaultConfig();
    return fromConfig(defaults?.llm_config as Parameters<typeof fromConfig>[0] ?? null);
  };

  /** 注入记忆/向量服务，供 memory_search、memory_embed_add、memory_delete 使用 */
  orchestrator.setMemoryDeps(getMemoryServiceForUser, getVectorConfigForUser);

  /** 注入 MCP 重载，供 x.add/update/remove_mcp_server 后立即生效 */
  if (userSandboxManager && db) {
    orchestrator.setReloadMcpForUser((userId) =>
      loadMcpAndRegisterForUser(
        orchestrator,
        userId,
        userSandboxManager!.getUserWorkspaceRoot.bind(userSandboxManager),
        db!.getConfig.bind(db),
      ).then(() => {}),
    );
  }

  /** 若该用户当前没有任何定时任务，则为其添加一条默认定时（每天 9:00 自检），保证 X 会定期运行、永不「零任务」 */
  const DEFAULT_CRON = '0 9 * * *';
  const DEFAULT_INTENT =
    '作为 X 主脑，做一次例行自检：检查当前状态、待办、是否需要主动联系用户；如需可调用 x.notify_user。';
  function ensureDefaultScheduleForUser(userId: string | undefined): void {
    if (!userId) return;
    const scheduler = getDefaultScheduler();
    if (!scheduler) return;
    const list = scheduler.listJobs(userId);
    if (list.length > 0) return;
    scheduler.addJob(userId, DEFAULT_INTENT, undefined, DEFAULT_CRON);
    serverLogger.info('x/scheduler', `为用户 ${userId} 添加默认定时任务`, DEFAULT_CRON);
  }

  /** 主脑一轮对话结束后：由 hook 触发，判断是否应自动进化自我约定（不依赖用户说「进化」） */
  async function considerEvolveAfterXChat(payload: {
    userId: string;
    lastUserMessage: string;
    lastAssistantContent: string;
  }): Promise<void> {
    const { userId, lastUserMessage, lastAssistantContent } = payload;
    if (!userId || userId === 'anonymous') return;
    const mem = await getMemoryServiceForUser(userId);
    if (!mem) return;
    await mem.ensureEvolvedCorePromptExists();
    const existing = await mem.readEvolvedCorePrompt();
    const hasExistingRules = existing.trim().length > 0;
    // 若从未进化过，先写入一条初始自我约定，确保「进化」至少发生一次
    if (!hasExistingRules) {
      const bootstrap = '- 以用户目标为先；在安全与审批约束下完成用户交代的事。';
      await mem.appendEvolvedCorePrompt(bootstrap);
      serverLogger.info('x/evolve', '主脑首次进化（bootstrap）', `userId=${userId}`);
    }
    const llmConfig = await getLLMConfigForScheduler(userId);
    if (!llmConfig?.providerId || !llmConfig?.modelId) return;
    const systemPrompt = `你是一个元分析器。根据这一轮主脑（X）与用户的对话（或 X 的定时/自发运行），判断是否应追加一条永久的自我约定。若存在以下任一情况则输出一条简短规则（一两句话，中文或英文）：用户表达了偏好或习惯、用户纠正了主脑、本轮有值得长期遵守的结论、或 X 在自发/定时运行中形成了可复用的策略。若无任何可沉淀内容则只输出 NO。重要：不要输出与开发、代码、技术实现、项目规范、编程语言、测试、API、框架等开发相关的内容；进化提示词只用于用户偏好与行为准则，不用于开发规范。不要解释，只输出规则内容或 NO。`;
    const userContent = `用户/触发说：${lastUserMessage.slice(0, 2000)}\n\n主脑回复：${lastAssistantContent.slice(0, 2000)}\n\n输出要追加的规则或 NO：`;
    try {
      const reply = await callLLM({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        providerId: llmConfig.providerId,
        modelId: llmConfig.modelId,
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
      });
      const trimmed = (reply ?? '').trim();
      if (trimmed.toUpperCase() === 'NO' || trimmed.length < 2) return;
      const devKeywords = /代码|开发|编程|typescript|javascript|python|测试|test|lint|git|commit|项目规范|技术实现|api|接口|函数|模块|框架|frontend|backend|实现细节/i;
      if (devKeywords.test(trimmed)) return;
      await mem.appendEvolvedCorePrompt('\n\n---\n\n' + trimmed);
      serverLogger.info('x/evolve', '主脑自动进化', `userId=${userId} ruleLength=${trimmed.length}`);
    } catch (err: unknown) {
      serverLogger.warn('x/evolve', '自动进化判断或写入失败', err instanceof Error ? err.message : String(err));
    }
  }

  registerHook('x_chat_round_complete', (payload) => considerEvolveAfterXChat(payload));

  const scheduledJobStore: ScheduledJobStore | undefined = db
    ? {
        async loadAll(): Promise<ScheduledJob[]> {
          const rows = await db!.getAllScheduledJobs();
          return rows.map((r: { id: string; user_id: string; intent: string; run_at: number; cron: string | null; created_at: number }) => ({
            id: r.id,
            userId: r.user_id,
            intent: r.intent,
            runAt: r.run_at,
            cron: r.cron ?? undefined,
            createdAt: r.created_at,
          }));
        },
        async save(job: ScheduledJob): Promise<void> {
          await db!.insertScheduledJob({
            id: job.id,
            user_id: job.userId,
            intent: job.intent,
            run_at: job.runAt,
            cron: job.cron ?? null,
            created_at: job.createdAt,
          });
        },
        async updateRunAt(id: string, runAt: number): Promise<void> {
          await db!.updateScheduledJobRunAt(id, runAt);
        },
        async remove(id: string): Promise<void> {
          await db!.deleteScheduledJob(id);
        },
      }
    : undefined;

  const xScheduler = new XScheduler(
    async (job) => {
      await runScheduledIntent(job, {
        orchestrator,
        getSystemPrompt: getSystemPromptForScheduler,
        getLLMConfig: getLLMConfigForScheduler,
        ensureUserMcp: ensureUserMcpForScheduler,
        onSkip: (uid) => {
          addXProactiveMessage(
            uid,
            '定时任务因未配置大模型被跳过。请到「系统设置 → 大模型配置」保存一次（会同步到云端），或设置环境变量 OPENROUTER_API_KEY 后重启服务。',
            'need_api_key',
          );
        },
        onRoundComplete: considerEvolveAfterXChat,
      });
      ensureDefaultScheduleForUser(job.userId);
    },
    scheduledJobStore,
  );
  setDefaultScheduler(xScheduler);
  if (scheduledJobStore) {
    xScheduler
      .loadJobs()
      .then(() => {
        xScheduler.start();
        const stats = xScheduler.getStats();
        serverLogger.info('x/scheduler', '已从持久化加载定时任务并启动', `jobCount=${stats.jobCount} nextRunAt=${stats.nextRunAt ?? 'none'}`);
      })
      .catch((err) => {
        serverLogger.warn('x/scheduler', '加载定时任务失败，仍启动调度器', err?.message ?? err);
        xScheduler.start();
      });
  } else {
    xScheduler.start();
  }

  /** 收集当前用户情况，用于生成个性化欢迎语（待办数、X 主动消息未读数、时段）；使用东八区 */
  async function buildGreetContext(uid: string | undefined): Promise<string> {
    if (!uid || uid === 'anonymous') return '当前用户未登录。';
    const parts: string[] = [];
    const hourStr = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false });
    const hour = parseInt(hourStr, 10) || 0;
    if (hour >= 5 && hour < 12) parts.push('当前时段：早上');
    else if (hour >= 12 && hour < 18) parts.push('当前时段：下午');
    else parts.push('当前时段：晚上');
    if (db) {
      try {
        const raw = await db.getConfig(uid, 'x_pending_requests');
        const list = raw ? (JSON.parse(raw) as unknown[]) : [];
        if (Array.isArray(list) && list.length > 0) {
          parts.push(`用户留给 X 的待办：${list.length} 条`);
        }
      } catch {
        /* ignore */
      }
    }
    const proactive = getXProactiveMessages(uid);
    const unread = proactive.filter((m) => !m.read).length;
    if (unread > 0) parts.push(`X 发给用户的未读消息：${unread} 条`);
    return parts.join('；') + '。';
  }

  /** 打开 X 主脑时触发：X 根据用户情况发一条个性化开场消息 */
  router.post('/x/greet', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (ensureUserMcpForScheduler && userId) {
        await ensureUserMcpForScheduler(userId);
      }
      const greetContext = await buildGreetContext(userId ?? undefined);
      const llmConfig = await getLLMConfigForScheduler(userId ?? '');
      if (!llmConfig?.providerId || !llmConfig?.modelId) {
        const hasPending = db && userId
          ? await (async () => {
              try {
                const raw = await db.getConfig(userId!, 'x_pending_requests');
                const list = raw ? (JSON.parse(raw) as unknown[]) : [];
                return Array.isArray(list) && list.length > 0 ? list.length : 0;
              } catch {
                return 0;
              }
            })()
          : 0;
        const lang = db && userId ? await getUserLanguage(db, userId) : 'zh-CN';
        const fallback =
          lang === 'en'
            ? hasPending > 0
              ? `Hi, I'm X. You have ${hasPending} pending task(s). After configuring LLM in Settings → AI Config, I can help. What would you like to say?`
              : "Hi, I'm X. Configure your LLM in Settings to get smarter greetings. What would you like to say?"
            : hasPending > 0
              ? `你好，我是 X 主脑。你还有 ${hasPending} 条待办，在「系统设置 → 大模型配置」中配置好后，我可以帮你处理。有什么想和我说的？`
              : '你好，我是 X 主脑。你可以在设置里配置大模型后，我会更智能地和你打招呼。有什么想和我说的？';
        res.json({ content: fallback });
        return;
      }
      const systemPrompt = await getSystemPromptForScheduler(userId ?? '');
      const userPrompt = `用户刚打开了 X 主脑入口。当前情况：${greetContext}\n请根据上述情况用一两句话简短打招呼（可结合时段、待办或未读消息提醒用户），或说明你当前状态、是否有需要用户配合的事。直接回复即可。`;
      const { content } = await orchestrator.runChatAgentLoop({
        messages: [{ role: 'user', content: userPrompt }],
        llmConfig: {
          providerId: llmConfig.providerId,
          modelId: llmConfig.modelId,
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey,
        },
        systemPrompt,
        maxSteps: 5,
        userId,
      });
      ensureDefaultScheduleForUser(userId ?? undefined);
      const lang = db && userId ? await getUserLanguage(db, userId) : 'zh-CN';
      const defaultMsg = lang === 'en' ? "Hi, what would you like to say?" : '你好，有什么想和我说的？';
      res.json({ content: content?.trim() || defaultMsg });
    } catch (err: any) {
      serverLogger.warn('x/greet', err?.message);
      const lang = db ? await getUserLanguage(db, (req as { userId?: string }).userId ?? '') : 'zh-CN';
      res.json({ content: lang === 'en' ? "Hi, I'm X. What would you like to say?" : '你好，我是 X。有什么想和我说的？' });
    }
  });


  // ── R014：事件驱动 X 执行（用户发消息 / 任务完成后触发，节流 60s 每用户每来源） ──
  const EVENT_DRIVEN_THROTTLE_MS = 60_000;
  const lastEventRunByUser = new Map<string, number>();

  /** 渠道消息作为Chat会话处理：将消息添加到Chat会话并触发AI回复 */
  const handleChannelMessageAsChat = async (
    userId: string,
    channel: string,
    message: string,
    fromName?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> => {
    if (!db || !userId || userId === 'anonymous') return;

    // 查找最近的渠道会话，或创建新会话
    const sessions = await db.listSessions(userId, 10, undefined);
    const channelSession = sessions.find(
      (s) => s.title && s.title.includes(`[${channel}]`),
    );
    const sessionId = channelSession?.id ?? (await db.createSession(userId, `渠道消息 [${channel}]`, null)).id;

    // 将用户消息添加到会话
    const userMessage = fromName
      ? `[${channel}] ${fromName}: ${message}`
      : `[${channel}] ${message}`;
    await db.addMessage(sessionId, 'user', userMessage);

    // 获取历史消息（最近50条）
    const historyMessages = await db.getMessages(sessionId, 50);

    // 转换为 LLM 消息格式，排除最后一条（刚添加的用户消息）
    const chatHistoryRaw = historyMessages
      .filter((m) => m.role !== 'system')
      .slice(0, -1)
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content || '',
      }));

    // 使用标准的截断函数处理对话历史，并过滤掉 system 消息
    const chatHistory = truncateChatMessages(chatHistoryRaw, MAX_CHAT_MESSAGES).filter(
      (m) => m.role !== 'system',
    ) as { role: 'user' | 'assistant'; content: string }[];

    // 获取 LLM 配置
    const llmConfig = await getLLMConfigForScheduler(userId);
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      serverLogger.warn('handleChannelMessageAsChat', `跳过执行：LLM 未配置`, `userId=${userId}`);
      return;
    }

    // 确保用户的 MCP 工具已加载
    if (ensureUserMcpForScheduler) {
      await ensureUserMcpForScheduler(userId);
    }

    // 获取各种提示词（标准做法）
    const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt] = await Promise.all([
      getLearnedPromptForUser(userId),
      getEvolvedCorePromptForUser(userId),
      getBasePromptForUser(userId),
      getAssistantPromptForUser(userId),
    ]);

    // 构建系统提示（使用标准 assemble 逻辑）
    const tools = listAllCapabilities(orchestrator.getTools());
    const skills = getDiscoveredSkills(userId);
    const caps = USE_CONDENSED_SYSTEM_PROMPT
      ? formatCapabilitiesSummaryCondensed(tools) + formatSkillsSummary(skills, true)
      : formatCapabilitiesSummary(tools) + formatSkillsSummary(skills);

    const systemPrompt = getAssembledSystemPrompt({
      scene: 'none',
      promptMode: 'minimal',
      basePrompt,
      capabilities: caps,
      learnedPrompt,
      evolvedCorePrompt,
      assistantPrompt,
    });

    // 用户最新消息
    const userMessageForLLM = `用户通过 ${channel} 发来消息：${message}\n\n请理解消息内容，进行对话式回复。`;

    // 构建完整的消息列表（历史 + 最新）
    const allMessages = [
      ...chatHistory,
      { role: 'user' as const, content: userMessageForLLM },
    ];

    // 直接调用 orchestrator 的聊天循环，获取回复内容
    const toolLoadingMode = getToolLoadingMode();
    const result = await orchestrator.runChatAgentLoop({
      messages: allMessages,
      systemPrompt,
      llmConfig,
      maxSteps: 15,
      userId,
      toolLoadingMode,
    });

    const replyText = result.content?.trim();
    if (!replyText) {
      serverLogger.warn('handleChannelMessageAsChat', `AI 未生成回复内容`, `userId=${userId} channel=${channel}`);
      return;
    }

    // 保存 AI 回复到会话（用于多轮对话）
    await db.addMessage(sessionId, 'assistant', replyText);

    // 自动发送回复到对应渠道
    const getConfig = db.getConfig.bind(db);
    let sendResult: { ok: boolean; error?: string } = { ok: false, error: '未知渠道' };

    if (channel === 'QQ' && metadata?.targetType && metadata?.targetId) {
      sendResult = await sendQQMessage(getConfig, userId, { type: metadata.targetType as 'private' | 'group' | 'guild', id: String(metadata.targetId) }, replyText);
    } else if (channel === 'WhatsApp' && metadata?.to) {
      sendResult = await sendWhatsAppMessage(getConfig, userId, String(metadata.to), replyText);
    } else if (channel === 'Telegram' && metadata?.chatId) {
      sendResult = await sendTelegramMessage(getConfig, userId, String(metadata.chatId), replyText);
    } else if (channel === 'Discord' && metadata?.channelId) {
      sendResult = await sendDiscordMessage(getConfig, userId, String(metadata.channelId), replyText);
    } else if (channel === 'Slack' && metadata?.channelId) {
      sendResult = await sendSlackMessage(getConfig, userId, String(metadata.channelId), replyText);
    }

    if (sendResult.ok) {
      serverLogger.info('handleChannelMessageAsChat', `渠道回复已发送`, `userId=${userId} channel=${channel}`);
    } else {
      serverLogger.error('handleChannelMessageAsChat', `渠道回复发送失败: ${sendResult.error}`, `userId=${userId} channel=${channel}`);
    }
  };

  const triggerXRunForUser = (
    userId: string,
    intent: string,
    source: string = 'chat',
    actionFingerprint?: string,
    metadata?: Record<string, unknown>,
  ): void => {
    if (!userId || userId === 'anonymous' || !db) return;
    const now = Date.now();
    const throttleKey = `${userId}:${source}`;
    const noThrottleSources = ['qq_message_received', 'whatsapp_message_received', 'telegram_message_received', 'discord_message_received', 'slack_message_received', 'email_received'];
    if (!noThrottleSources.includes(source) && now - (lastEventRunByUser.get(throttleKey) ?? 0) < EVENT_DRIVEN_THROTTLE_MS) {
      serverLogger.info('x/event-driven', `节流跳过（60s 内已触发）`, `key=${throttleKey}`);
      return;
    }
    lastEventRunByUser.set(throttleKey, now);
    setImmediate(async () => {
      try {
        if (ensureUserMcpForScheduler) await ensureUserMcpForScheduler(userId);
        const llmConfig = await getLLMConfigForScheduler(userId);
        if (!llmConfig?.providerId || !llmConfig?.modelId) {
          serverLogger.warn('x/event-driven', `跳过执行：LLM 未配置`, `userId=${userId} providerId=${llmConfig?.providerId ?? '(空)'} modelId=${llmConfig?.modelId ?? '(空)'}`);
          return;
        }
        const systemPrompt = await getSystemPromptForScheduler(userId);
        serverLogger.info('x/event-driven', `事件触发 X 执行`, `userId=${userId} intent=${intent.slice(0, 50)}`);
        await runWithRetry(
          () =>
            orchestrator.runIntentAsPersistedTask({
              intent,
              llmConfig: {
                providerId: llmConfig.providerId,
                modelId: llmConfig.modelId,
                baseUrl: llmConfig.baseUrl,
                apiKey: llmConfig.apiKey,
              },
              systemPrompt,
              userId,
              source: 'event_driven',
              title: '事件触发',
              actionFingerprint,
              metadata,
            }),
          { logLabel: 'x/event-driven' },
        );
        ensureDefaultScheduleForUser(userId);
      } catch (err: unknown) {
        serverLogger.warn('x/event-driven', err instanceof Error ? err.message : String(err));
      }
    });
  };
  router.use(createXGroupRunRouter(
    orchestrator,
    db,
    getSystemPromptForScheduler,
    getLLMConfigForScheduler,
    ensureUserMcpForScheduler,
    ensureDefaultScheduleForUser,
    triggerXRunForUser,
  ));
  const signalToSource = (signal?: string): 'chat' | 'task' | 'email' => {
    if (signal === 'email_received') return 'email';
    if (signal === 'task_completed') return 'task';
    if (signal === 'telegram_message_received' || signal === 'discord_message_received' || signal === 'slack_message_received' || signal === 'whatsapp_message_received' || signal === 'qq_message_received') return signal as any;
    return 'chat';
  };
  const runIntentWithSource = (uid: string, intent: string, meta?: { signal?: string; actionFingerprint?: string }) => {
    triggerXRunForUser(uid, intent, signalToSource(meta?.signal), meta?.actionFingerprint);
  };
  const signalFireDeps =
    db
      ? {
          getConfig: db.getConfig.bind(db),
          runIntent: runIntentWithSource,
          runAgent: async (uid: string, agentId: string, goal: string, meta?: { triggerId?: string; actionFingerprint?: string }) => {
            const agents = await loadAgentsForSignals(db!.getConfig.bind(db), uid);
            const agent = agents.find((a: AgentDefinition) => a.id === agentId);
            if (!agent) throw new Error(`未找到智能体 ${agentId}`);
            if (ensureUserMcpForScheduler) await ensureUserMcpForScheduler(uid);
            await orchestrator.runAgentAsPersistedTask({
              agentDef: agent,
              goal,
              userId: uid,
              sourceId: meta?.triggerId,
              actionFingerprint: meta?.actionFingerprint,
            });
          },
          checkHandled: (userId: string, fingerprint: string) => db.hasHandledEvent(userId, fingerprint),
          recordHandled: (userId: string, fingerprint: string) => db.insertHandledEvent(userId, fingerprint),
        }
      : null;

  router.use(createEmailRouter(db, signalFireDeps));
  router.use(createWhatsAppRouter(db));
  router.use(createSlackRouter(db));

  if (db && signalFireDeps) {
    registerHook('task_complete', async (payload) => {
      const task = orchestrator.getTask(payload.taskId);
      const meta = task?.metadata as { userId?: string; actionFingerprint?: string; source?: string; sourceId?: string; description?: string; llmConfig?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string } } | undefined;
      if (meta?.actionFingerprint && meta?.userId) {
        const ok = payload.data && typeof payload.data === 'object' && (payload.data as { success?: boolean }).success === true;
        if (ok) void Promise.resolve(signalFireDeps.recordHandled!(meta.userId, meta.actionFingerprint)).catch(() => {});
      }
      const userId = meta?.userId;
      if (!userId) return;

      // ── 记忆捕获：信号触发（QQ/WhatsApp/Telegram/Discord/Slack/Email）的任务 ──
      // 仅对信号触发的任务执行记忆捕获，避免和 HTTP /chat 接口重复
      const signalSources = ['event_driven', 'signal_trigger', 'scheduled_job'];
      const isSignalTask = meta?.source && signalSources.includes(meta.source);
      if (isSignalTask) {
        const userMessage = meta?.description ?? '';
        const assistantReply = (task?.result as { output?: string } | undefined)?.output ?? '';
        const llmConfig = meta?.llmConfig;
        if (userMessage.trim() && assistantReply.trim() && llmConfig?.providerId && llmConfig?.modelId) {
          setImmediate(async () => {
            try {
              const memSvc = (await getMemoryServiceForUser(userId)) ?? memoryService;
              await runConsiderCapture({
                userMessage: userMessage.trim(),
                assistantReply: assistantReply.trim(),
                providerId: llmConfig.providerId,
                modelId: llmConfig.modelId,
                baseUrl: llmConfig.baseUrl,
                apiKey: llmConfig.apiKey,
                memoryService: memSvc,
                workspaceId: userId,
              });
              await runLearnPromptExtract({
                userMessage: userMessage.trim(),
                assistantReply: assistantReply.trim(),
                providerId: llmConfig.providerId,
                modelId: llmConfig.modelId,
                baseUrl: llmConfig.baseUrl,
                apiKey: llmConfig.apiKey,
                memoryService: memSvc,
              });
              serverLogger.info('task_complete', '信号任务记忆捕获完成', `taskId=${payload.taskId} userId=${userId}`);
            } catch (err) {
              serverLogger.error('task_complete (memory)', err instanceof Error ? err.message : String(err));
            }
          });
        }
      }

      // 定时任务完成后，将看板中对应「等待」项更新为「已完成」
      if (meta?.source === 'scheduled_job' && meta?.sourceId && typeof db.getBoardItemBySourceId === 'function') {
        const row = await Promise.resolve(db.getBoardItemBySourceId(userId, meta.sourceId));
        if (row) await Promise.resolve(db.updateBoardItem(row.id, { status: 'done' })).catch(() => {});
      }
      const title = task?.title ?? '未知任务';
      const result = task?.result as { success?: boolean; output?: string; error?: string } | undefined;
      const resultBrief =
        result?.output != null
          ? String(result.output).slice(0, 100)
          : result?.error != null
            ? `失败：${String(result.error).slice(0, 80)}`
            : '';
      const summary = resultBrief ? `任务【${title}】已完成，${resultBrief}` : `任务【${title}】已完成`;
      await appendToDoneLog(db, userId, summary, {
        title,
        action: resultBrief || undefined,
      });
      const intent =
        `有一个任务刚完成：【${title}】。` +
        (resultBrief ? `结果摘要：${resultBrief}。` : '') +
        '该事项已记入你的「近期已完成」清单，请查看并酌情通知用户或做后续处理，勿重复执行该任务。';
      triggerXRunForUser(userId, intent, 'task');
      void fireSignal(userId, 'task_completed', { taskId: payload.taskId }, signalFireDeps).then(() =>
        notifyWorkflowOnSignal(userId, 'task_completed'),
      );
    });
    orchestrator.setSignalFireHandler(async (userId, signal, payload) => {
      const result = await fireSignal(userId, signal, payload as Record<string, unknown> | undefined, signalFireDeps);
      void notifyWorkflowOnSignal(userId, signal);
      return result;
    });
    const emailCheckIntervalMs = parseInt(process.env.X_COMPUTER_EMAIL_CHECK_INTERVAL_MS ?? '60000', 10) || 60000;
    startEmailCheckLoop(
      {
        db,
        getConfig: db.getConfig.bind(db),
        setConfig: db.setConfig.bind(db),
        runIntent: runIntentWithSource,
        runAgent: signalFireDeps.runAgent,
      },
      emailCheckIntervalMs,
    );

    // R052 WhatsApp：注入消息处理器，收到消息时存入 DB 并发出 whatsapp_message_received 信号
    const whatsappLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) =>
        handleChannelMessageAsChat(userId, channel, message, fromName, metadata),
    };
    setWhatsAppMessageHandler((userId, msg) => {
      void handleWhatsAppMessage(whatsappLoopDeps, userId, msg);
    });
    // 启动时自动重连已配置且拥有凭证的用户，服务重启后无需重新扫码
    void reconnectWhatsAppForConfiguredUsers(
      db.getConfig.bind(db),
      () => db.getUserIdsWithConfigKey('whatsapp_config'),
    );

    // Telegram：注入消息处理器 + 启动自动重连
    const telegramLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) =>
        handleChannelMessageAsChat(userId, channel, message, fromName, metadata),
    };
    setTelegramMessageHandler((userId, msg) => { void handleTelegramMessage(telegramLoopDeps, userId, msg); });
    void reconnectTelegramForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('telegram_config'));

    // Discord：注入消息处理器 + 启动自动重连
    const discordLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) =>
        handleChannelMessageAsChat(userId, channel, message, fromName, metadata),
    };
    setDiscordMessageHandler((userId, msg) => { void handleDiscordMessage(discordLoopDeps, userId, msg); });
    void reconnectDiscordForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('discord_config'));

    // Slack：注入消息处理器 + 启动自动重连
    const slackLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) =>
        handleChannelMessageAsChat(userId, channel, message, fromName, metadata),
    };
    setSlackMessageHandler((userId, msg) => { void handleSlackMessage(slackLoopDeps, userId, msg); });
    void reconnectSlackForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('slack_config'));

    // QQ：注入消息处理器 + 启动自动重连
    const qqLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat: (userId: string, channel: string, message: string, fromName?: string, metadata?: Record<string, unknown>) =>
        handleChannelMessageAsChat(userId, channel, message, fromName, metadata),
    };
    setQQMessageHandler((userId, msg) => { void handleQQMessage(qqLoopDeps, userId, msg); });
    void reconnectQQForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('qq_config'));
  }

  // ── 聊天会话路由（云端持久化） ──
  if (db) {
    router.use(
      '/chat/sessions',
      createChatSessionRouter(db, {
        onMessageAdded: (userId) => {
          if (!signalFireDeps) return;
          triggerXRunForUser(
            userId,
            '用户刚在对话中发了新消息。请读取近期助手对话（read_recent_assistant_chat），**作为待处理的聊天记录**审视：有无需记录、跟进、通知或加入看板的事项；不要当成「用户正在和助手聊天」而生成面向用户的回复，你的输出是后台处理结论，宜简短、操作化（如「已处理近期对话」「已记录/已加入看板」或「无新待办」）。',
            'chat',
          );
          void fireSignal(userId, 'user_message_sent', undefined, signalFireDeps).then(() =>
            notifyWorkflowOnSignal(userId, 'user_message_sent'),
          );
        },
      }),
    );
  }

  /** Get current computer context (what the AI perceives) */
  router.get('/context', (_req, res) => {
    const ctx = orchestrator.getComputerContext();
    res.json(ctx ?? { timestamp: 0, message: 'No context yet' });
  });

  
  // ── Execution Mode ───────────────────────────────────────

  router.get('/mode', (_req, res) => {
    res.json({ mode: orchestrator.getMode() });
  });

  router.post('/mode', (req, res) => {
    const { mode } = req.body as { mode: ExecutionMode };
    if (mode !== 'auto' && mode !== 'approval') {
      res.status(400).json({ error: 'Mode must be "auto" or "approval"' });
      return;
    }
    orchestrator.setMode(mode);
    res.json({ mode });
  });

  // ── Tools ────────────────────────────────────────────────

  router.get('/tools', (_req, res) => {
    res.json(orchestrator.getTools());
  });

  /** 小程序/小游戏后端：KV 与队列（按用户+应用隔离，X 用 backend.* 工具写入，前端用下列 API 读写） */
  function requireUserIdForAppBackend(req: { userId?: string }, res: import('express').Response): string | null {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return null;
    }
    if (!db) {
      res.status(503).json({ error: '数据库不可用' });
      return null;
    }
    return userId;
  }

  router.get('/x-apps/backend/kv/:appId', async (req, res) => {
    let uid = (req as { userId?: string }).userId;
    if (uid === 'anonymous') {
      const token = typeof req.headers['x-app-read-token'] === 'string' ? req.headers['x-app-read-token'].trim() : '';
      if (token && db) {
        const appIdParam = (req.params.appId ?? '').trim();
        const resolved = await db.resolveAppPublicReadToken(token, appIdParam);
        if (resolved) (req as { userId?: string }).userId = uid = resolved;
      }
    }
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const key = (req.query.key as string)?.trim();
    if (!appId) {
      res.status(400).json({ error: 'appId 必填' });
      return;
    }
    if (key !== undefined && key !== '') {
      const value = await db!.appBackendKvGet(userId, appId, key);
      if (value === undefined) {
        res.status(404).json({ error: 'key 不存在' });
        return;
      }
      res.set('Content-Type', 'application/json');
      res.send(value);
      return;
    }
    const prefix = (req.query.prefix as string)?.trim() || undefined;
    const keys = await db!.appBackendKvList(userId, appId, prefix);
    res.json({ keys });
  });

  router.put('/x-apps/backend/kv/:appId', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const key = (req.query.key as string)?.trim() ?? (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!appId || !key) {
      res.status(400).json({ error: 'appId 与 key 必填（query.key 或 body.key）' });
      return;
    }
    const value = req.body && 'value' in req.body
      ? (typeof req.body.value === 'string' ? req.body.value : JSON.stringify(req.body.value))
      : JSON.stringify(req.body ?? '');
    await db!.appBackendKvSet(userId, appId, key, value);
    res.json({ ok: true });
  });

  router.delete('/x-apps/backend/kv/:appId', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const key = (req.query.key as string)?.trim();
    if (!appId || !key) {
      res.status(400).json({ error: 'appId 与 key 必填（query.key）' });
      return;
    }
    await db!.appBackendKvDelete(userId, appId, key);
    res.json({ ok: true });
  });

  /** 创建应用公开只读 Token：外部分发站点（如 x-blog.example.com）可带此 Token 调用 GET /api/x-apps/backend/kv/:appId 只读访问该应用的 KV，无需 X-User-Id。 */
  router.post('/x-apps/backend/kv/:appId/public-read-token', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    if (!appId) {
      res.status(400).json({ error: 'appId 必填' });
      return;
    }
    const token = await db!.createAppPublicReadToken(userId, appId);
    res.json({ token });
  });

  router.post('/x-apps/backend/queue/:appId/:queueName/push', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const queueName = (req.params.queueName ?? '').trim();
    if (!appId || !queueName) {
      res.status(400).json({ error: 'appId 与 queueName 必填' });
      return;
    }
    const payload = typeof req.body === 'object' && req.body !== null && 'payload' in req.body
      ? (typeof (req.body as { payload: unknown }).payload === 'string'
          ? (req.body as { payload: string }).payload
          : JSON.stringify((req.body as { payload: unknown }).payload))
      : JSON.stringify(req.body ?? '');
    await db!.appBackendQueuePush(userId, appId, queueName, payload);
    res.json({ ok: true });
  });

  router.get('/x-apps/backend/queue/:appId/:queueName/pop', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const queueName = (req.params.queueName ?? '').trim();
    if (!appId || !queueName) {
      res.status(400).json({ error: 'appId 与 queueName 必填' });
      return;
    }
    const payload = await db!.appBackendQueuePop(userId, appId, queueName);
    if (payload === null) {
      res.status(404).json({ error: '队列为空' });
      return;
    }
    res.json({ payload });
  });

  router.get('/x-apps/backend/queue/:appId/:queueName/len', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const queueName = (req.params.queueName ?? '').trim();
    if (!appId || !queueName) {
      res.status(400).json({ error: 'appId 与 queueName 必填' });
      return;
    }
    const len = await db!.appBackendQueueLen(userId, appId, queueName);
    res.json({ length: len });
  });


  // ── X Board (任务看板) ────────────────────────────────────

  router.get('/x/board', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const items = await db.listBoardItems(userId);
      res.json({ ok: true, items });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败' });
    }
  });

  router.post('/x/board', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const { title, description, status, priority } = req.body ?? {};
      if (!title || typeof title !== 'string') { res.status(400).json({ ok: false, error: 'title 必填' }); return; }
      const VALID_STATUSES = ['todo', 'in_progress', 'pending', 'done'];
      const VALID_PRIORITIES = ['low', 'medium', 'high'];
      const st = VALID_STATUSES.includes(status) ? status : 'todo';
      const pr = VALID_PRIORITIES.includes(priority) ? priority : 'medium';
      const id = uuid();
      await db.insertBoardItem({ id, user_id: userId, title: title.trim(), description: description?.trim() || undefined, status: st, priority: pr });
      const item = await db.getBoardItem(id);
      res.json({ ok: true, item });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '创建失败' });
    }
  });

  router.patch('/x/board/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const existing = await db.getBoardItem(req.params.id);
      if (!existing || existing.user_id !== userId) { res.status(404).json({ ok: false, error: '未找到该项' }); return; }
      const VALID_STATUSES = ['todo', 'in_progress', 'pending', 'done'];
      const VALID_PRIORITIES = ['low', 'medium', 'high'];
      const fields: Record<string, unknown> = {};
      if (req.body.title !== undefined) fields.title = String(req.body.title).trim();
      if (req.body.description !== undefined) fields.description = String(req.body.description).trim();
      if (req.body.status !== undefined && VALID_STATUSES.includes(req.body.status)) fields.status = req.body.status;
      if (req.body.priority !== undefined && VALID_PRIORITIES.includes(req.body.priority)) fields.priority = req.body.priority;
      if (req.body.sort_order !== undefined) fields.sort_order = Number(req.body.sort_order);
      await db.updateBoardItem(req.params.id, fields);
      const updated = await db.getBoardItem(req.params.id);
      res.json({ ok: true, item: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/x/board/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const existing = await db.getBoardItem(req.params.id);
      if (!existing || existing.user_id !== userId) { res.status(404).json({ ok: false, error: '未找到该项' }); return; }
      await db.deleteBoardItem(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '删除失败' });
    }
  });

  /** MCP 重载：按用户重载（有 userId 时从该用户工作区/云端加载） */
  router.post('/mcp/reload', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const result =
        userId && userId !== 'anonymous' && userSandboxManager
          ? await loadMcpAndRegisterForUser(
              orchestrator,
              userId,
              userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
              db?.getConfig.bind(db),
            )
          : await reloadMcpAndRegister(orchestrator, sandboxFS.getRoot());
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '重载失败' });
    }
  });

  // ── Policy ───────────────────────────────────────────────

  router.get('/policy/rules', (_req, res) => {
    res.json(policy.getRules());
  });

  // ── Runtime ──────────────────────────────────────────────


  // ── Audit ────────────────────────────────────────────────

  /** 审计日志：有 userId 时优先从 DB 按用户查询，否则返回内存最近条目 */
  router.get('/audit', async (req, res) => {
    const limit = Math.min(500, parseInt(String(req.query?.limit)) || 100);
    const userId = (req as { userId?: string }).userId;
    if (userId && userId !== 'anonymous' && db) {
      try {
        const rows = await db.getAuditByUser(userId, limit);
        return res.json(rows);
      } catch (e: any) {
        serverLogger.warn('audit', 'DB 查询失败，回退内存', e?.message);
      }
    }
    const all = audit.getAll();
    res.json(all.slice(-limit));
  });

  router.get('/audit/task/:taskId', (req, res) => {
    res.json(audit.getTimeline(req.params.taskId));
  });

  // ── Server Logs ────────────────────────────────────────────

  /** 获取后端日志（前端系统日志用） */
  router.get('/logs', (req, res) => {
    const limit = parseInt(String(req.query?.limit)) || 200;
    res.json(serverLogger.getRecent(limit));
  });

  /** 清空后端日志 */
  router.delete('/logs', (_req, res) => {
    serverLogger.clear();
    res.json({ success: true });
  });


  router.use(createChatRouter(orchestrator, sandboxFS, aiQuota, userSandboxManager, db, subscriptionService));

  router.use(createEditorAgentRouter(aiQuota));


  return router;
}
