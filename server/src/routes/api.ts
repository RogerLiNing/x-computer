import {backgroundAutostartEnabled} from '../config/backgroundRuntime.js';
import { createHash } from 'node:crypto';
import { resolveLLMCredentials } from '../llm/credentialResolver.js';
import { ScheduledOccurrenceService, type ChannelReplyAddress } from '../scheduler/ScheduledOccurrenceService.js';
import type { ChatRunService } from '../chat/ChatRunService.js';
import { Router } from 'express';
import { DoneLogService } from '../services/DoneLogService.js';
import { createSchedulerRouter } from './scheduler.js';
import { createLLMRouter } from './llm.js';
import { createSkillsRouter } from './skills.js';
import { createHealthRouter } from './health.js';
import { createMemoryRouter } from './memory.js';
import { createPromptRouter } from './prompt.js';
import { createXProactiveRouter } from './xProactive.js';
import { createXPendingRouter } from './xPending.js';
import { createXGroupRunRouter } from './xGroupRun.js';
import { createXAppsRouter } from './xApps.js';
import { createDiscordRouter } from './messaging/discord.js';
import { createTelegramRouter } from './messaging/telegram.js';
import { createQQRouter } from './messaging/qq.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { AuditLogger } from '../observability/AuditLogger.js';
import { createAdminRouter } from './adminUtils.js';
import { createContentManagementRoutes } from './contentManagement.js';
import type { AgentDefinition } from '../../../shared/src/index.js';
import { callLLM } from '../chat/chatService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { getAssembledSystemPrompt, CORE_SYSTEM_PROMPT, formatCapabilitiesSummary, formatCapabilitiesSummaryCondensed, formatSkillsSummary, MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT, TOOL_USE_MANDATE, MEMORY_TOOL_MANDATE, SCHEDULED_RUN_MANDATE, buildTimelineContext } from '../prompts/systemCore.js';
import { getUserLanguage } from '../prompts/systemCore/promptLoader.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { MiniAppLogStore } from '../miniAppLogStore.js';
import { MemoryService } from '../memory/MemoryService.js';
import { VectorStore } from '../memory/vectorStore.js';
import { callEmbedding } from '../memory/embeddingService.js';
import { createChatSessionRouter, createSharedSessionRouter } from './chatSessions.js';
import { createAgentsRouter } from './agents.js';
import { createMcpRouter } from './mcp.js';
import { createAppsRouter } from './apps.js';
import { createPackagesRouter } from './packages.js';
import { createUsageRouter } from './usage.js';
import { createCapabilitiesRouter } from './capabilities.js';
import { createEditorAgentRouter } from './editorAgent.js';
import { createChatRouter } from './chat.js';
import { createWhatsAppRouter } from './messaging/whatsapp.js';
import { getMessagesWithHistory, addMessage as addXProactiveMessage } from '../x/XProactiveMessages.js';
import {
  XScheduler,
  setDefaultScheduler,
  getDefaultScheduler,
  type ScheduledJobStore,
  type ScheduledJob,
} from '../scheduler/XScheduler.js';
import { runWithRetry } from '../scheduler/runScheduledIntent.js';
import { loadDefaultConfig, getToolLoadingMode } from '../config/defaultConfig.js';

/** 精简系统提示中的能力列表以节省 token；设 X_COMPUTER_SYSTEM_PROMPT_CONDENSED=false 可恢复完整格式 */
const USE_CONDENSED_SYSTEM_PROMPT = process.env.X_COMPUTER_SYSTEM_PROMPT_CONDENSED !== 'false';
import { listAllCapabilities } from '../capabilities/CapabilityRegistry.js';
import {
  loadMcpAndRegisterForUser,
  ensureUserMcpLoaded,
} from '../mcp/loadAndRegister.js';
import { getDiscoveredSkills, getModelVisibleSkills } from '../skills/discovery.js';
import { fire as fireHook, registerHook } from '../hooks/HookRegistry.js';
import { fireSignal } from '../signals/signalService.js';
import { workflowFireEvent } from '../workflow/workflowClient.js';
import { startEmailCheckLoop } from '../email/emailCheckLoop.js';
import { createEmailRouter } from './email.js';
import { createCalendarRouter } from './calendar.js';
import { createNotesRouter } from './notes.js';
import { createBookmarksRouter } from './bookmarks.js';
import { createDecisionsRouter } from './decisions.js';
import { createDelegationsRouter } from './delegations.js';
import { createWeeklyPlannerRouter } from './weeklyPlanner.js';
import { createChangelogRouter } from './changelog.js';
import { createReadingListRouter } from './readingList.js';
import { createSlackRouter } from './messaging/slack.js';
import { aiCallsQuota, tasksQuota } from '../subscription/quotaMiddleware.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import {
  setWhatsAppMessageHandler,
  reconnectWhatsAppForConfiguredUsers,
  sendWhatsAppMessage,
} from '../whatsapp/whatsappService.js';
import { handleWhatsAppMessage } from '../whatsapp/whatsappLoop.js';
import { setTelegramMessageHandler, reconnectTelegramForConfiguredUsers, sendTelegramMessage } from '../telegram/telegramService.js';
import { handleTelegramMessage } from '../telegram/telegramLoop.js';
import { setDiscordMessageHandler, reconnectDiscordForConfiguredUsers, sendDiscordMessage } from '../discord/discordService.js';
import { handleDiscordMessage } from '../discord/discordLoop.js';
import { setSlackMessageHandler, reconnectSlackForConfiguredUsers, sendSlackMessage } from '../slack/slackService.js';
import { handleSlackMessage } from '../slack/slackLoop.js';
import { setQQMessageHandler, reconnectQQForConfiguredUsers, sendQQMessage } from '../qq/qqService.js';
import { handleQQMessage } from '../qq/qqLoop.js';
import { saveQQAttachments, type QQAttachment } from '../qq/qqAttachments.js';
import { createChannelReplyTransport } from '../messaging/channelReply.js';
import type { ChannelOrigin } from '../messaging/channelIdentity.js';
import type { PluginRegistry } from '../plugins/PluginRegistry.js';
import { LivingAIKernel } from '../living-ai/LivingAIKernel.js';
import { createLivingAIRouter } from './livingAI.js';

const MEMORY_DIR = 'memory';

/** X 主脑「近期已完成」清单的 user_config key */
const X_DONE_LOG_KEY = 'x_done_log';
/** X 主脑「近期已完成」清单中显示在提示词里的条数 */
const X_DONE_LOG_SHOW_IN_PROMPT = 15;

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

/** 内容质量预检：过滤太短、纯确认/寒暄的内容 */
function shouldConsiderForMemory(userMsg: string, assistantReply: string): boolean {
  const um = userMsg.trim();
  const ar = (assistantReply ?? '').trim();
  if (!um || um.length < 10) return false;
  if (!ar || ar.length < 10) return false;
  const ackPatterns = [
    '好的', '好的！', '好的。', '嗯', '嗯嗯', '明白', '明白了', '了解', '知道了',
    '好的，我明白了', '没问题', 'OK', 'ok', '好的收到', '好的，我来',
    '好的，请稍等', '好的，请稍候', '马上', '稍等', '好的，马上', '好的，立即',
  ];
  if (ackPatterns.includes(um)) return false;
  if (/^(hi|hello|嗨|你好|您好|hey|hallo)[!,。！]*$/i.test(um)) return false;
  return true;
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
  // 质量门槛：内容必须有足够上下文，至少 8 字符
  if (!content || content.length < 8) return;
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
  audit: AuditLogger,
  sandboxFS: SandboxFS,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
  miniAppLogStore?: MiniAppLogStore,
  subscriptionService?: SubscriptionService,
  plugins?: PluginRegistry,
): Router {
  const router = Router();
  const enabled = (id: Parameters<PluginRegistry['isEnabled']>[0]) => plugins?.isEnabled(id) ?? true;
  const backgroundAutostart=backgroundAutostartEnabled();
  const autonomyEnabled = enabled('autonomy');
  const automationEnabled = enabled('automation');
  const messagingEnabled = enabled('messaging');
  const productivityEnabled = enabled('productivity');
  const mcpEnabled = enabled('mcp');

  if (autonomyEnabled) router.use(createAgentsRouter(orchestrator, db));
  let sharedChatRuns: ChatRunService | undefined;
  let occurrences: ScheduledOccurrenceService | undefined;
  if (db) router.use(createSchedulerRouter(db, () => occurrences));
  router.use(createLLMRouter(db, subscriptionService));
  router.use(createXProactiveRouter(db));
  if (autonomyEnabled) {
    router.use(createXPendingRouter(db));
  }
  router.use(createXAppsRouter(db));
  if (db && messagingEnabled) {
    router.use(createDiscordRouter(db));
    router.use(createTelegramRouter(db));
    router.use(createWhatsAppRouter(db));
    router.use(createSlackRouter(db));
    router.use(createQQRouter(db));
  }
  if (db && productivityEnabled) {
    router.use(createContentManagementRoutes(db));
  }
  if (mcpEnabled) {
    router.use(createMcpRouter(orchestrator, sandboxFS, userSandboxManager, db));
  }
  router.use(createAppsRouter(orchestrator, userSandboxManager, db, miniAppLogStore));
  router.use(createPackagesRouter(db, userSandboxManager, plugins, orchestrator));
  router.use(createUsageRouter(db));
  router.use(createCapabilitiesRouter(orchestrator));
  router.use(createHealthRouter(orchestrator, audit));
  router.use(createAdminRouter(orchestrator, audit, sandboxFS, userSandboxManager, db));
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
    const toolLoadingMode = getToolLoadingMode();
    const onDemandTools = toolLoadingMode === 'on_demand';
    const [learnedPrompt, evolvedCorePrompt, basePrompt, timeline, memoryIndex] = await Promise.all([
      getLearnedPromptForUser(uid),
      getEvolvedCorePromptForUser(uid),
      getBasePromptForUser(uid),
      buildTimelineContext(db as any, uid),
      getMemoryServiceForUser(uid).then((mem) => (mem ? mem.promptMemory().catch(() => '') : '')),
    ]);
    const tools = listAllCapabilities(orchestrator.getTools());
    const skills = getModelVisibleSkills(uid);
    const caps = onDemandTools
      ? ''
      : USE_CONDENSED_SYSTEM_PROMPT
        ? formatCapabilitiesSummaryCondensed(tools) + formatSkillsSummary(skills, true)
        : formatCapabilitiesSummary(tools) + formatSkillsSummary(skills);
    const base = getAssembledSystemPrompt({
      scene: 'none',
      promptMode: 'minimal',
      basePrompt,
      toolLoadingModeOnDemand: onDemandTools,
      capabilities: caps,
      learnedPrompt,
      memoryIndex,
      evolvedCorePrompt,
      timeline,
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
    }
    return out;
  };
  const getLLMConfigForScheduler = (uid: string, overrides?: { providerId?: string; modelId?: string }) =>
    resolveLLMCredentials(uid, db, subscriptionService, overrides);

  const livingAIKernel = db && autonomyEnabled
    ? new LivingAIKernel({
        db,
        orchestrator,
        getLLMConfig: (userId) => getLLMConfigForScheduler(userId),
        getSystemPrompt: getSystemPromptForScheduler,
        cancelCycles:userId=>occurrences?.cancelLivingCycles(userId)??Promise.resolve(),
        resumeCycle:(userId,sourceId,revision,signal)=>{
          if(!occurrences)throw new Error('后台任务服务尚未就绪');
          return occurrences.resumeLivingCycle(userId,sourceId,revision,signal);
        },
      })
    : null;
  if (livingAIKernel) {
    router.use('/x/life', createLivingAIRouter(livingAIKernel));
    if (process.env.NODE_ENV !== 'test' && backgroundAutostart) {
      livingAIKernel.start();
    }
  }

  const ensureUserMcpForScheduler =
    mcpEnabled && userSandboxManager && db
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
  if (mcpEnabled && userSandboxManager && db) {
    orchestrator.setReloadMcpForUser((userId) =>
      loadMcpAndRegisterForUser(
        orchestrator,
        userId,
        userSandboxManager!.getUserWorkspaceRoot.bind(userSandboxManager),
        db!.getConfig.bind(db),
      ).then(() => {}),
    );
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

  if(backgroundAutostart&&autonomyEnabled)registerHook('x_chat_round_complete', async (payload) => {
    await Promise.all([
      considerEvolveAfterXChat(payload),
      livingAIKernel?.observeInteraction(
        payload.userId,
        `用户刚刚与 X 对话：${payload.lastUserMessage.slice(0, 500)}`,
      ),
    ]);
  });

  const channelTransport = db ? createChannelReplyTransport(db.getConfig.bind(db)) : undefined;
  occurrences = db ? new ScheduledOccurrenceService({
    db, getRuns: () => sharedChatRuns, getSystemPrompt: getSystemPromptForScheduler, sendChannelReply: channelTransport?.send, validateChannelReply: channelTransport?.validate,
    getLLMConfig: getLLMConfigForScheduler, ensureUserMcp: ensureUserMcpForScheduler,
    onCompleted: async job => { if (job.actionFingerprint) await db!.insertHandledEvent(job.userId, job.actionFingerprint); },
  }) : undefined;

  if (occurrences) {
    orchestrator.setBackgroundIntentRunner(input => occurrences!.run(input));
    if (process.env.NODE_ENV !== 'test' && backgroundAutostart) occurrences.start();
  }

  const scheduledJobStore: ScheduledJobStore | undefined = db
    ? {
        async loadAll(): Promise<ScheduledJob[]> {
          const rows = await db!.getAllScheduledJobs();
          return rows.filter(r => r.enabled === 1).map(r => ({
            id: r.id, userId: r.user_id, intent: r.intent, runAt: r.next_run ?? r.run_at,
            cron: r.cron ?? undefined, createdAt: r.created_at,
            sessionId: r.session_id ?? undefined, name: r.name ?? undefined, scopeJson: r.scope_json,
          }));
        },
        queue: (job, nextAt) => occurrences!.queue(job, nextAt),
        recover: () => occurrences!.recover(),
        lastOutcomes: (userId) => occurrences!.lastOutcomes(userId),
        async listAllForUser(userId: string) {
          const rows = await db!.listScheduledJobsByUser(userId);
          return rows.map(r => ({
            id: r.id, userId: r.user_id, intent: r.intent, runAt: r.next_run ?? r.run_at, cron: r.cron ?? undefined,
            createdAt: r.created_at, name: r.name ?? undefined, enabled: r.enabled === 1,
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
            session_id: job.sessionId ?? null,
            scope_json: job.scopeJson ?? null,
            name: job.name ?? null,
          });
        },
        async updateRunAt(id: string, runAt: number): Promise<void> {
          await db!.updateScheduledJobRunAt(id, runAt);
        },
        async remove(id: string): Promise<void> {
          await occurrences!.cancelJob(id);
        },
      }
    : undefined;

  const xScheduler = new XScheduler(async () => {
    throw new Error('持久化调度服务未就绪，未执行任务');
  }, scheduledJobStore);
  if (automationEnabled) {
    setDefaultScheduler(xScheduler);
    if (scheduledJobStore) {
      xScheduler
        .loadJobs()
        .then(() => {
          if(backgroundAutostart)xScheduler.start();
          const stats = xScheduler.getStats();
          serverLogger.info('x/scheduler', backgroundAutostart?'已从持久化加载定时任务并启动':'定时任务已加载，后台自动启动已暂停', `jobCount=${stats.jobCount} nextRunAt=${stats.nextRunAt ?? 'none'}`);
        })
        .catch((err) => {
          serverLogger.warn('x/scheduler', '加载定时任务失败，调度器未启动', err?.message ?? err);
        });
    } else if(backgroundAutostart) {
      xScheduler.start();
    }
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
    const proactive = await getMessagesWithHistory(db,uid);
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
        toolLoadingMode: getToolLoadingMode(),
      });
      const lang = db && userId ? await getUserLanguage(db, userId) : 'zh-CN';
      const defaultMsg = lang === 'en' ? "Hi, what would you like to say?" : '你好，有什么想和我说的？';
      res.json({ content: content?.trim() || defaultMsg });
    } catch (err: any) {
      serverLogger.warn('x/greet', err?.message);
      const lang = db ? await getUserLanguage(db, (req as { userId?: string }).userId ?? '') : 'zh-CN';
      res.json({ content: lang === 'en' ? "Hi, I'm X. What would you like to say?" : '你好，我是 X。有什么想和我说的？' });
    }
  });


  // ── Search API ────────────────────────────────────────────────────────────────
  const SEARCH_CONFIG_KEY = 'search_config';

  router.post('/search/test', async (req, res) => {
    try {
      const { provider, apiKey } = req.body as { provider?: string; apiKey?: string };
      const userId = (req as { userId?: string }).userId;

      // Load from userConfig if not provided
      let cfg: { provider?: string; apiKey?: string } = { provider, apiKey };
      if (userId && db && (!provider || !apiKey)) {
        const raw = await db.getConfig(userId, SEARCH_CONFIG_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { provider?: string; apiKey?: string };
          cfg = { provider: provider ?? saved.provider, apiKey: apiKey ?? saved.apiKey };
        }
      }

      const { webSearch } = await import('../orchestrator/tools/webSearch.js');

      if (cfg.provider === 'duckduckgo') {
        const result = await webSearch({ query: 'test', numResults: 1 }, { userId });
        res.json({ ok: !result.error, error: result.error });
      } else if (cfg.provider === 'serper' && cfg.apiKey) {
        const result = await webSearch({ query: 'test', numResults: 1, provider: 'serper', apiKey: cfg.apiKey }, { userId });
        res.json({ ok: !result.error, error: result.error });
      } else if (cfg.provider === 'perplexity' && cfg.apiKey) {
        const result = await webSearch({ query: 'test', numResults: 1, provider: 'perplexity', apiKey: cfg.apiKey }, { userId });
        res.json({ ok: !result.error, error: result.error });
      } else if (cfg.provider === 'minimax' && cfg.apiKey) {
        const result = await webSearch({ query: 'test', numResults: 1, provider: 'minimax', apiKey: cfg.apiKey }, { userId });
        res.json({ ok: !result.error, error: result.error });
      } else if (cfg.provider === 'brave' && cfg.apiKey) {
        const result = await webSearch({ query: 'test', numResults: 1, provider: 'brave', apiKey: cfg.apiKey }, { userId });
        res.json({ ok: !result.error, error: result.error });
      } else {
        res.json({ ok: false, error: '请先选择 Provider 并填写 API Key' });
      }
    } catch (err: any) {
      res.json({ ok: false, error: err.message });
    }
  });


  // ── R014：事件驱动 X 执行（用户发消息 / 任务完成后触发，节流 60s 每用户每来源） ──
  const EVENT_DRIVEN_THROTTLE_MS = 60_000;
  const lastEventRunByUser = new Map<string, number>();

  async function handleChannelMessageAsChat(
    userId: string,
    source: string,
    message: string,
    _fromName?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!db || !occurrences || !userId || userId === 'anonymous') throw new Error('渠道交办服务未就绪');
    const channel = source.toLowerCase();
    if (channel !== 'qq' && channel !== 'whatsapp' && channel !== 'telegram' && channel !== 'discord' && channel !== 'slack') {
      throw new Error('渠道不受支持');
    }
    const target = channel === 'qq' ? metadata?.targetId : channel === 'whatsapp' ? metadata?.to
      : channel === 'telegram' ? metadata?.chatId : metadata?.channelId;
    const messageId = metadata?.messageId;
    if (typeof target !== 'string' || typeof messageId !== 'string') throw new Error('渠道消息缺少地址或编号');
    const origin = metadata?.origin as ChannelOrigin | undefined;
    const targetType = metadata?.targetType;
    const thread = metadata?.threadTs;
    await occurrences.enqueueChannel(userId, messageId, message, {
      channel, target, accountId: typeof origin?.accountId === 'string' ? origin.accountId : undefined,
      sourceScope: typeof origin?.scopeId === 'string' ? origin.scopeId : undefined, configDigest: typeof origin?.configDigest === 'string' ? origin.configDigest : '',
      targetType: targetType === 'private' || targetType === 'group' || targetType === 'guild' ? targetType : undefined,
      thread: typeof thread === 'string' ? thread : undefined,
    }, typeof metadata?.inboxId === 'string' ? metadata.inboxId : undefined);
  }

  const triggerXRunForUser = (
    userId: string,
    intent: string,
    source: string = 'chat',
    actionFingerprint?: string,
    metadata?: Record<string, unknown>,
  ): void => {
    if (!backgroundAutostart || !userId || userId === 'anonymous' || !db) return;
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
      } catch (err: unknown) {
        serverLogger.warn('x/event-driven', err instanceof Error ? err.message : String(err));
      }
    });
  };
  if (db) {
    router.use(createXGroupRunRouter(
      orchestrator,
      db,
      subscriptionService,
      getSystemPromptForScheduler,
      ensureUserMcpForScheduler,
      ()=>sharedChatRuns,
    ));
  }
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

  if (messagingEnabled) {
    router.use(createEmailRouter(db, signalFireDeps));
  }
  if (productivityEnabled && db) {
    router.use('/calendar', createCalendarRouter(db));
    router.use('/notes', createNotesRouter(db));
    router.use('/bookmarks', createBookmarksRouter(db));
    router.use('/decisions', createDecisionsRouter(db));
    router.use('/delegations', createDelegationsRouter(db));
    router.use('/weekly-plans', createWeeklyPlannerRouter(db));
    router.use('/changelog', createChangelogRouter(db));
    router.use('/reading-list', createReadingListRouter(db));
  }

  if (db && signalFireDeps && (autonomyEnabled || automationEnabled || messagingEnabled)) {
    const doneLogService = new DoneLogService(db);

    registerHook('task_complete', async (payload) => {
      if(!backgroundAutostart)return;
      const task = orchestrator.getTask(payload.taskId);
      const meta = task?.metadata as { userId?: string; actionFingerprint?: string; source?: string; sourceId?: string; description?: string; livingAI?: boolean; llmConfig?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string } } | undefined;
      if (meta?.actionFingerprint && meta?.userId) {
        const ok = payload.data && typeof payload.data === 'object' && (payload.data as { success?: boolean }).success === true;
        if (ok) void Promise.resolve(signalFireDeps.recordHandled!(meta.userId, meta.actionFingerprint)).catch(() => {});
      }
      const userId = meta?.userId;
      if (!userId) return;
      if (meta.livingAI) return;

      // ── 记忆捕获：信号触发（QQ/WhatsApp/Telegram/Discord/Slack/Email）的任务 ──
      // 仅对信号触发的任务执行记忆捕获，避免和 HTTP /chat 接口重复
      const signalSources = ['event_driven', 'signal_trigger', 'scheduled_job'];
      const isSignalTask = meta?.source && signalSources.includes(meta.source);
      if (isSignalTask) {
        const userMessage = meta?.description ?? '';
        const assistantReply = (task?.result as { output?: string } | undefined)?.output ?? '';
        const llmConfig = meta?.llmConfig;
        if (shouldConsiderForMemory(userMessage.trim(), assistantReply.trim()) && llmConfig?.providerId && llmConfig?.modelId) {
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

      const title = task?.title ?? '未知任务';
      const result = task?.result as { success?: boolean; output?: string; error?: string } | undefined;
      const resultBrief =
        result?.output != null
          ? String(result.output).slice(0, 100)
          : result?.error != null
            ? `失败：${String(result.error).slice(0, 80)}`
            : '';
      const summary = resultBrief ? `任务【${title}】已完成，${resultBrief}` : `任务【${title}】已完成`;
      await doneLogService.append(userId, summary, {
        title,
        action: resultBrief || undefined,
      });
      const intent =
        `有一个任务刚完成：【${title}】。` +
        (resultBrief ? `结果摘要：${resultBrief}。` : '') +
        '该事项已记入你的「近期已完成」清单，请查看并酌情通知用户或做后续处理，勿重复执行该任务。';
      if (autonomyEnabled) {
        triggerXRunForUser(userId, intent, 'task');
      }
      if (automationEnabled) {
        void fireSignal(userId, 'task_completed', { taskId: payload.taskId }, signalFireDeps).then(() =>
          notifyWorkflowOnSignal(userId, 'task_completed'),
        );
      }
    });
    orchestrator.setSignalFireHandler(async (userId, signal, payload) => {
      const result = await fireSignal(userId, signal, payload as Record<string, unknown> | undefined, signalFireDeps);
      void notifyWorkflowOnSignal(userId, signal);
      return result;
    });
    if (messagingEnabled) {
      const emailCheckIntervalMs = parseInt(process.env.X_COMPUTER_EMAIL_CHECK_INTERVAL_MS ?? '60000', 10) || 60000;
      if(backgroundAutostart)startEmailCheckLoop(
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
      handleChannelMessageAsChat,
    };
    setWhatsAppMessageHandler((userId, msg) => {
      void handleWhatsAppMessage(whatsappLoopDeps, userId, msg).catch(() => console.warn('[channel] WhatsApp message not queued'));
    });
    // 启动时自动重连已配置且拥有凭证的用户，服务重启后无需重新扫码
    if(backgroundAutostart)void reconnectWhatsAppForConfiguredUsers(
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
      handleChannelMessageAsChat,
    };
    setTelegramMessageHandler((userId, msg) => { void handleTelegramMessage(telegramLoopDeps, userId, msg).catch(() => console.warn('[channel] Telegram message not queued')); });
    if(backgroundAutostart)void reconnectTelegramForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('telegram_config'));

    // Discord：注入消息处理器 + 启动自动重连
    const discordLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat,
    };
    setDiscordMessageHandler((userId, msg) => { void handleDiscordMessage(discordLoopDeps, userId, msg).catch(() => console.warn('[channel] Discord message not queued')); });
    if(backgroundAutostart)void reconnectDiscordForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('discord_config'));

    // Slack：注入消息处理器 + 启动自动重连
    const slackLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat,
    };
    setSlackMessageHandler((userId, msg) => { void handleSlackMessage(slackLoopDeps, userId, msg).catch(() => console.warn('[channel] Slack message not queued')); });
    if(backgroundAutostart)void reconnectSlackForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('slack_config'));

    // QQ：注入消息处理器 + 启动自动重连
    const qqLoopDeps = {
      db,
      getConfig: db.getConfig.bind(db),
      setConfig: db.setConfig.bind(db),
      runIntent: runIntentWithSource,
      runAgent: signalFireDeps.runAgent,
      handleChannelMessageAsChat,
      ...(userSandboxManager ? {
        saveAttachments: async (userId: string, attachments: readonly QQAttachment[]) =>
          saveQQAttachments((await userSandboxManager.getForUser(userId)).sandboxFS, attachments),
      } : {}),
    };
    setQQMessageHandler((userId, msg) => { void handleQQMessage(qqLoopDeps, userId, msg).catch(() => console.warn('[channel] QQ message not queued')); });
      if(backgroundAutostart)void reconnectQQForConfiguredUsers(db.getConfig.bind(db), () => db.getUserIdsWithConfigKey('qq_config'));
    }
  }

  // ── 聊天会话路由（云端持久化） ──
  if (db) {
    router.use(
      '/chat/sessions',
      createChatSessionRouter(db, {
        onMessageAdded: (userId) => {
          if (process.env.NODE_ENV === 'test' || !backgroundAutostart) return;
          if (!signalFireDeps) return;
          if (autonomyEnabled) {
            triggerXRunForUser(
              userId,
              '用户刚在对话中发了新消息。请读取近期助手对话（read_recent_assistant_chat），**作为待处理的聊天记录**审视：有无需记录、跟进、通知或加入看板的事项；不要当成「用户正在和助手聊天」而生成面向用户的回复，你的输出是后台处理结论，宜简短、操作化（如「已处理近期对话」「已记录/已加入看板」或「无新待办」）。',
              'chat',
            );
          }
          if (automationEnabled) {
            void fireSignal(userId, 'user_message_sent', undefined, signalFireDeps).then(() =>
              notifyWorkflowOnSignal(userId, 'user_message_sent'),
            );
          }
        },
      }),
    );
  }


  router.use(createChatRouter(
    orchestrator,
    sandboxFS,
    aiQuota,
    userSandboxManager,
    db,
    subscriptionService,
    livingAIKernel ? (userId) => livingAIKernel.getCognitiveContext(userId) : undefined,
    (runs) => { sharedChatRuns = runs; },
  ));

  if (autonomyEnabled) {
    router.use(createEditorAgentRouter(aiQuota));
  }

  // ── 公开分享路由（无需认证，在 auth guard 之后挂载） ──
  if (db) {
    router.use('/chat/shared', createSharedSessionRouter(db));
  }

  return router;
}
