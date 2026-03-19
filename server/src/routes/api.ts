import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
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
import { fetchModelsFromProvider } from '../llm/fetchModels.js';

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
import { aiCallsQuota, tasksQuota } from '../subscription/quotaMiddleware.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import {
  getWhatsAppConnection,
  setWhatsAppMessageHandler,
  disconnectWhatsApp,
  parseWhatsAppConfig,
  reconnectWhatsAppForConfiguredUsers,
  sendWhatsAppMessage,
  CREDENTIALS_BASE,
} from '../whatsapp/whatsappService.js';
import { getSystemProxy } from '../utils/systemProxy.js';
import { handleWhatsAppMessage } from '../whatsapp/whatsappLoop.js';
import { setTelegramMessageHandler, getTelegramConnection, disconnectTelegram, parseTelegramConfig, reconnectTelegramForConfiguredUsers, sendTelegramMessage } from '../telegram/telegramService.js';
import { handleTelegramMessage } from '../telegram/telegramLoop.js';
import { setDiscordMessageHandler, getDiscordConnection, disconnectDiscord, parseDiscordConfig, reconnectDiscordForConfiguredUsers, sendDiscordMessage } from '../discord/discordService.js';
import { handleDiscordMessage } from '../discord/discordLoop.js';
import { setSlackMessageHandler, getSlackConnection, disconnectSlack, parseSlackConfig, reconnectSlackForConfiguredUsers, sendSlackMessage } from '../slack/slackService.js';
import { handleSlackMessage } from '../slack/slackLoop.js';
import { setQQMessageHandler, getQQConnection, disconnectQQ, reconnectQQ, parseQQConfig, reconnectQQForConfiguredUsers, sendQQMessage } from '../qq/qqService.js';
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

/** 生成注入到小程序 HTML 的脚本：上报 window.onerror 与 console.error 到后端，供 x.get_app_logs 查看 */
function buildMiniAppLoggerScript(appId: string, userId: string): string {
  const a = appId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const u = userId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return (
    '<script>(function(){var appId="' +
    a +
    '",userId="' +
    u +
    '",api="/api";function send(lvl,msg,det){try{fetch(api+"/apps/sandbox-logs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({appId:appId,userId:userId,level:lvl,message:msg,detail:det||null})}).catch(function(){})}catch(e){}}window.onerror=function(m,s,l,c,e){send("error",m||"Unknown",e&&e.stack?e.stack:null);return false};if(typeof console!=="undefined"&&console.error){var o=console.error;console.error=function(){o.apply(console,arguments);var t=Array.prototype.slice.call(arguments);send("error",t.join(" "),null)}}})();<\/script>'
  );
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
  const vectorStore = new VectorStore(sandboxFS);
  const memoryService = new MemoryService(sandboxFS, vectorStore);
  
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

  // ── 主脑提示词自我进化（可对话中触发或定时任务调用 evolve_system_prompt） ──
  router.get('/prompt/evolved', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const content = await getEvolvedCorePromptForUser(userId);
      res.json({ evolvedCorePrompt: content });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  // ── 主脑 X 主动找用户：主动消息列表（供 X 主脑入口展示） ──
  router.get('/x/proactive-messages', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const list = getXProactiveMessages(userId);
      res.json({ messages: list });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  /** 标记 X 主动消息为已读：用户点击「已读」或 X 通过工具标记。Body: { id: string } 或 { ids: string[] } */
  router.post('/x/proactive-messages/read', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const body = req.body as { id?: string; ids?: string[] };
      const ids = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [];
      for (const id of ids) if (typeof id === 'string' && id) markXProactiveRead(userId, id);
      res.json({ success: true, marked: ids.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '标记失败' });
    }
  });

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

  /** 定时任务状态：是否在跑、任务数、下次运行时间，便于确认定时是否正常 */
  router.get('/x/scheduler-status', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const scheduler = getDefaultScheduler();
      if (!scheduler) {
        return res.json({ running: false, jobCount: 0, nextRunAt: null, nextRunAtISO: null, jobs: [] });
      }
      const stats = scheduler.getStats(userId ?? undefined);
      const list = scheduler.listJobs(userId ?? undefined);
      res.json({
        running: scheduler.isRunning(),
        jobCount: stats.jobCount,
        nextRunAt: stats.nextRunAt,
        nextRunAtISO: stats.nextRunAt != null ? new Date(stats.nextRunAt).toISOString() : null,
        jobs: list.map((j) => ({
          id: j.id,
          intent: j.intent.slice(0, 80),
          runAt: j.runAt,
          runAtISO: new Date(j.runAt).toISOString(),
          cron: j.cron,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.get('/x/scheduled-jobs', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const scheduler = getDefaultScheduler();
      const list = scheduler ? scheduler.listJobs(userId) : [];
      res.json({ jobs: list });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  // ── X 智能体管理（与 x.create_agent / x.list_agents 等工具共用 user_config.x_agents）────
  const X_AGENTS_CONFIG_KEY = 'x_agents';
  const X_AGENT_TEAMS_CONFIG_KEY = 'x_agent_teams';
  async function loadAgentsFromDb(uid: string): Promise<AgentDefinition[]> {
    if (!db) return [];
    const raw = await db.getConfig(uid, X_AGENTS_CONFIG_KEY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown[];
      return Array.isArray(arr)
        ? arr.filter((x): x is AgentDefinition => {
            if (!x || typeof x !== 'object') return false;
            const a = x as Record<string, unknown>;
            return typeof a.id === 'string' && typeof a.name === 'string';
          })
        : [];
    } catch {
      return [];
    }
  }
  async function saveAgentsToDb(uid: string, list: AgentDefinition[]): Promise<void> {
    if (!db) return;
    await db.ensureUser(uid);
    await db.setConfig(uid, X_AGENTS_CONFIG_KEY, JSON.stringify(list));
  }

  router.get('/agents', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const list = await loadAgentsFromDb(userId);
      res.json({ agents: list });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.post('/agents', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as {
        name?: string;
        system_prompt?: string;
        tool_names?: string[];
        role?: string;
        goal_template?: string;
        output_description?: string;
        llm_provider_id?: string;
        llm_model_id?: string;
      };
      const name = String(body?.name ?? '').trim();
      const systemPrompt = String(body?.system_prompt ?? '').trim();
      if (!name || !systemPrompt) {
        return res.status(400).json({ error: 'name 与 system_prompt 必填' });
      }
      const toolNames = Array.isArray(body?.tool_names) ? body.tool_names.map((t) => String(t).trim()).filter(Boolean) : [];
      const role = body?.role != null ? String(body.role).trim() || undefined : undefined;
      const goalTemplate = body?.goal_template != null ? String(body.goal_template).trim() || undefined : undefined;
      const outputDescription = body?.output_description != null ? String(body.output_description).trim() || undefined : undefined;
      const llmProviderId = body?.llm_provider_id != null ? String(body.llm_provider_id).trim() || undefined : undefined;
      const llmModelId = body?.llm_model_id != null ? String(body.llm_model_id).trim() || undefined : undefined;
      const list = await loadAgentsFromDb(userId);
      const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const agent: AgentDefinition = {
        id,
        name,
        systemPrompt,
        toolNames,
        role,
        goalTemplate,
        outputDescription,
        llmProviderId,
        llmModelId,
        createdAt: now,
        updatedAt: now,
      };
      list.push(agent);
      await saveAgentsToDb(userId, list);
      res.status(201).json({ agent, message: `已创建智能体「${name}」` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '创建失败' });
    }
  });

  router.put('/agents/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const body = req.body as {
        name?: string;
        system_prompt?: string;
        tool_names?: string[];
        role?: string;
        goal_template?: string;
        output_description?: string;
        llm_provider_id?: string;
        llm_model_id?: string;
      };
      const list = await loadAgentsFromDb(userId);
      const idx = list.findIndex((a) => a.id === id);
      if (idx < 0) return res.status(404).json({ error: '未找到该智能体' });
      const cur = list[idx]!;
      if (body?.name != null) cur.name = String(body.name).trim() || cur.name;
      if (body?.system_prompt != null) cur.systemPrompt = String(body.system_prompt).trim() || cur.systemPrompt;
      if (body?.tool_names !== undefined) {
        cur.toolNames = Array.isArray(body.tool_names) ? body.tool_names.map((t) => String(t).trim()).filter(Boolean) : cur.toolNames;
      }
      if (body?.role != null) cur.role = String(body.role).trim() || undefined;
      if (body?.goal_template != null) cur.goalTemplate = String(body.goal_template).trim() || undefined;
      if (body?.output_description != null) cur.outputDescription = String(body.output_description).trim() || undefined;
      if (body?.llm_provider_id !== undefined) cur.llmProviderId = String(body.llm_provider_id).trim() || undefined;
      if (body?.llm_model_id !== undefined) cur.llmModelId = String(body.llm_model_id).trim() || undefined;
      cur.updatedAt = Date.now();
      await saveAgentsToDb(userId, list);
      res.json({ agent: cur, message: '已更新智能体' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/agents/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const list = await loadAgentsFromDb(userId);
      const next = list.filter((a) => a.id !== id);
      if (next.length === list.length) return res.status(404).json({ error: '未找到该智能体' });
      await saveAgentsToDb(userId, next);
      res.json({ message: '已删除智能体' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '删除失败' });
    }
  });

  /** POST /api/llm/import-models - 由服务端请求提供商 /models 或 /v1/models，避免浏览器 CORS（如 NVIDIA） */
  router.post('/llm/import-models', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as { baseUrl?: string; apiKey?: string };
      const baseUrl = String(body?.baseUrl ?? '').trim();
      if (!baseUrl) {
        return res.status(400).json({ error: 'baseUrl 必填' });
      }
      const apiKey = body?.apiKey != null ? String(body.apiKey).trim() : undefined;
      const models = await fetchModelsFromProvider(baseUrl, apiKey);
      res.json({ models });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  async function loadTeamsFromDb(uid: string): Promise<AgentTeam[]> {
    if (!db) return [];
    const raw = await db.getConfig(uid, X_AGENT_TEAMS_CONFIG_KEY);
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
  async function saveTeamsToDb(uid: string, list: AgentTeam[]): Promise<void> {
    if (!db) return;
    await db.ensureUser(uid);
    await db.setConfig(uid, X_AGENT_TEAMS_CONFIG_KEY, JSON.stringify(list));
  }

  router.get('/teams', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      res.json({ teams: await loadTeamsFromDb(userId) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.post('/teams', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as { name?: string; agent_ids?: string[] };
      const name = String(body?.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'name 必填' });
      const agentIds = parseAgentIds(body?.agent_ids);
      if (agentIds.length === 0) return res.status(400).json({ error: 'agent_ids 至少包含一个智能体 id' });
      const list = await loadTeamsFromDb(userId);
      const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const team: AgentTeam = { id, name, agentIds, createdAt: now, updatedAt: now };
      list.push(team);
      await saveTeamsToDb(userId, list);
      res.status(201).json({ team, message: `已创建团队「${name}」` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '创建失败' });
    }
  });

  router.put('/teams/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const body = req.body as { name?: string; agent_ids?: string[] };
      const list = await loadTeamsFromDb(userId);
      const idx = list.findIndex((t) => t.id === id);
      if (idx < 0) return res.status(404).json({ error: '未找到该团队' });
      const cur = list[idx]!;
      if (body?.name != null) cur.name = String(body.name).trim() || cur.name;
      if (body?.agent_ids !== undefined) {
        cur.agentIds = parseAgentIds(body.agent_ids).length > 0 ? parseAgentIds(body.agent_ids) : cur.agentIds;
      }
      cur.updatedAt = Date.now();
      await saveTeamsToDb(userId, list);
      res.json({ team: cur, message: '已更新团队' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/teams/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const list = await loadTeamsFromDb(userId);
      const next = list.filter((t) => t.id !== id);
      if (next.length === list.length) return res.status(404).json({ error: '未找到该团队' });
      await saveTeamsToDb(userId, next);
      res.json({ message: '已删除团队' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '删除失败' });
    }
  });

  const X_AGENT_GROUPS_CONFIG_KEY = 'x_agent_groups';
  async function loadGroupsFromDb(uid: string): Promise<AgentGroup[]> {
    if (!db) return [];
    const raw = await db.getConfig(uid, X_AGENT_GROUPS_CONFIG_KEY);
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
  async function saveGroupsToDb(uid: string, list: AgentGroup[]): Promise<void> {
    if (!db) return;
    await db.ensureUser(uid);
    await db.setConfig(uid, X_AGENT_GROUPS_CONFIG_KEY, JSON.stringify(list));
  }

  router.get('/groups', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      res.json({ groups: await loadGroupsFromDb(userId) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.post('/groups', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as { name?: string; agent_ids?: string[] };
      const name = String(body?.name ?? '').trim();
      if (!name) return res.status(400).json({ error: 'name 必填' });
      const agentIds = parseAgentIds(body?.agent_ids);
      const list = await loadGroupsFromDb(userId);
      const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const group: AgentGroup = { id, name, agentIds, createdAt: now, updatedAt: now };
      list.push(group);
      await saveGroupsToDb(userId, list);
      res.status(201).json({ group, message: `已创建群组「${name}」` });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '创建失败' });
    }
  });

  router.put('/groups/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const body = req.body as { name?: string; agent_ids?: string[] };
      const list = await loadGroupsFromDb(userId);
      const idx = list.findIndex((g) => g.id === id);
      if (idx < 0) return res.status(404).json({ error: '未找到该群组' });
      const cur = list[idx]!;
      if (body?.name != null) cur.name = String(body.name).trim() || cur.name;
      if (body?.agent_ids !== undefined) {
        cur.agentIds = parseAgentIds(body.agent_ids).length > 0 ? parseAgentIds(body.agent_ids) : cur.agentIds;
      }
      cur.updatedAt = Date.now();
      await saveGroupsToDb(userId, list);
      res.json({ group: cur, message: '已更新群组' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/groups/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const id = String(req.params?.id ?? '').trim();
      if (!id) return res.status(400).json({ error: 'id 必填' });
      const list = await loadGroupsFromDb(userId);
      const next = list.filter((g) => g.id !== id);
      if (next.length === list.length) return res.status(404).json({ error: '未找到该群组' });
      await saveGroupsToDb(userId, next);
      res.json({ message: '已删除群组' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '删除失败' });
    }
  });

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

  /** 用户手动触发 X 立即执行一次（与定时任务同流程：以当前用户身份跑 Agent，可带工具），便于观察 X 如何操作。
   * 请求体可带 intent；若带 providerId/modelId（与前端「大模型配置」一致），优先使用，否则从 db 的 llm_config 读取。 */
  router.post('/x/run-now', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '请先登录后再触发 X 执行' });
        return;
      }
      const body = (req.body ?? {}) as {
        intent?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      const intent =
        body.intent?.trim() ||
        '用户手动触发：做一次自检，简要说明当前状态与待办；如有需要可联系用户。你可以使用任何工具（读对话、更新提示词、定下一个定时等）。';
      if (ensureUserMcpForScheduler) await ensureUserMcpForScheduler(userId);
      let llmConfig: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null = null;
      if (body.providerId && body.modelId) {
        llmConfig = {
          providerId: body.providerId,
          modelId: body.modelId,
          baseUrl: body.baseUrl || undefined,
          apiKey: body.apiKey || undefined,
        };
      }
      if (!llmConfig) {
        const fromDb = await getLLMConfigForScheduler(userId);
        if (fromDb?.providerId && fromDb?.modelId) {
          llmConfig = {
            providerId: fromDb.providerId,
            modelId: fromDb.modelId,
            baseUrl: fromDb.baseUrl,
            apiKey: fromDb.apiKey,
          };
        }
      }
      if (!llmConfig?.providerId || !llmConfig?.modelId) {
        res.status(400).json({
          error: '请先在「系统设置 → 大模型配置」中配置聊天模型，X 才能执行。',
          content: '',
        });
        return;
      }
      const systemPrompt = await getSystemPromptForScheduler(userId);
      serverLogger.info('x/run-now', `用户手动触发 X 执行`, `userId=${userId} intent=${intent.slice(0, 60)}`);
      const { content } = await runWithRetry(
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
            source: 'run_now',
            title: '手动执行',
          }),
        { logLabel: 'x/run-now' },
      );
      ensureDefaultScheduleForUser(userId);
      fireHook('x_chat_round_complete', {
        userId,
        lastUserMessage: intent,
        lastAssistantContent: content ?? '',
      });
      res.json({ content: content?.trim() || '（执行完成，无文本回复）' });
    } catch (err: any) {
      serverLogger.error('x/run-now', err?.message, err?.stack);
      res.status(500).json({
        error: err?.message ?? '执行失败',
        content: '',
      });
    }
  });

  /** 用户请求停止当前正在执行的群组任务（x.run_group 会在每名成员间检查此标志） */
  router.post('/x/cancel-group-run', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      orchestrator.setGroupRunCancel(userId, true);
      res.json({ success: true, message: '已请求停止群组执行' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '操作失败' });
    }
  });

  /** 群组执行记录：查看群组对话与工作过程（x.run_group 每次执行会写入） */
  const X_GROUP_RUN_HISTORY_KEY = 'x_group_run_history';
  router.get('/x/group-run-history', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const groupId = typeof req.query?.groupId === 'string' ? req.query.groupId.trim() || undefined : undefined;
      const limit = typeof req.query?.limit === 'string' ? Math.min(Math.max(1, parseInt(req.query.limit, 10) || 30), 50) : 30;
      if (!db) {
        return res.json({ runs: [] });
      }
      const raw = await db.getConfig(userId, X_GROUP_RUN_HISTORY_KEY);
      let list: Array<{ id: string; groupId: string; groupName: string; goal: string; results: Array<{ agentId: string; agentName: string; content: string }>; cancelled?: boolean; createdAt: number }>;
      try {
        const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
        const filtered = Array.isArray(arr) ? arr.filter((x): x is { id: string; groupId: string; groupName: string; goal: string; results: unknown[]; cancelled?: boolean; createdAt: number } => x != null && typeof x === 'object' && typeof (x as any).createdAt === 'number') : [];
        list = filtered.map((x) => ({
          ...x,
          results: Array.isArray(x.results) ? x.results.filter((r): r is { agentId: string; agentName: string; content: string } => r != null && typeof r === 'object' && typeof (r as any).content === 'string') : [],
        }));
      } catch {
        list = [];
      }
      let runs = list;
      if (groupId) runs = runs.filter((r) => r.groupId === groupId);
      runs = runs.slice(0, limit);
      res.json({ runs });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败', runs: [] });
    }
  });

  // ── R015：用户给 X 的待办/留言（X 通过 read_pending_requests 读取） ──
  if (db) {
    const PENDING_REQUESTS_KEY = 'x_pending_requests';
    type PendingItem = { id: string; content: string; createdAt: number };
    const getPendingList = async (uid: string): Promise<PendingItem[]> => {
      try {
        const raw = await db.getConfig(uid, PENDING_REQUESTS_KEY);
        return raw ? (JSON.parse(raw) as PendingItem[]) : [];
      } catch {
        return [];
      }
    };
    router.get('/x/pending-requests', async (req, res) => {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '请先登录' });
        return;
      }
      const list = await getPendingList(userId);
      res.json({ items: list, total: list.length });
    });
    router.post('/x/pending-requests', async (req, res) => {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '请先登录' });
        return;
      }
      const { content } = (req.body ?? {}) as { content?: string };
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text) {
        res.status(400).json({ error: 'content 必填' });
        return;
      }
      const list = await getPendingList(userId);
      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      list.push({ id, content: text, createdAt: Date.now() });
      await db.setConfig(userId, PENDING_REQUESTS_KEY, JSON.stringify(list));
      res.status(201).json({ id, content: text, createdAt: list[list.length - 1].createdAt, total: list.length });
    });
    router.delete('/x/pending-requests', async (req, res) => {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '请先登录' });
        return;
      }
      await db.setConfig(userId, PENDING_REQUESTS_KEY, JSON.stringify([]));
      res.json({ success: true, remaining: 0 });
    });
    router.delete('/x/pending-requests/:id', async (req, res) => {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '请先登录' });
        return;
      }
      const list = (await getPendingList(userId)).filter((x) => x.id !== req.params.id);
      await db.setConfig(userId, PENDING_REQUESTS_KEY, JSON.stringify(list));
      res.json({ success: true, remaining: list.length });
    });
  }

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

  // 脚本通过 HTTP 发送信号（如监控脚本判断条件满足后唤醒 agent，不每次跑 agent）
  router.post('/signals/emit', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录，请提供 X-User-Id 或先登录' });
        return;
      }
      if (!db || !signalFireDeps) {
        res.status(503).json({ error: '信号服务不可用' });
        return;
      }
      const body = req.body as { signal?: string; payload?: Record<string, unknown> };
      const signal = typeof body?.signal === 'string' ? body.signal.trim() : '';
      if (!signal) {
        res.status(400).json({ error: 'body.signal 必填' });
        return;
      }
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : undefined;
      const result = await fireSignal(userId, signal, payload, signalFireDeps);
      void notifyWorkflowOnSignal(userId, signal);
      res.json({ ok: true, fired: result.fired, skipped: result.skipped });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** R041：工作流引擎执行任务回调（script/ai 等），由工作流引擎 HTTP 调用 */
  router.post('/workflow/execute-task', async (req, res) => {
    try {
      const body = req.body as {
        userId?: string;
        instanceId?: string;
        nodeId?: string;
        taskType?: string;
        config?: Record<string, unknown>;
        variables?: Record<string, unknown>;
      };
      const { userId, instanceId, nodeId, taskType, config, variables } = body;
      if (!userId || !instanceId || !nodeId || !taskType) {
        res.status(400).json({ error: '需要 userId, instanceId, nodeId, taskType' });
        return;
      }
      const output = await executeWorkflowTask(
        { userId, instanceId, nodeId, taskType, config: config ?? {}, variables: variables ?? {} },
        {
          userSandboxManager,
          runIntent: triggerXRunForUser,
        },
      );
      res.json(output);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

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
  /** 最近一次向量/嵌入错误（重建索引或召回时），供 GET /memory/status 展示，对齐 OpenClaw status */
  let lastMemoryEmbedError: string | undefined;

  // ── Tasks ────────────────────────────────────────────────

  /** Create and run a task（带 llmConfig 时会走 Agent 循环，需先加载该用户 MCP 以便任务内可调用 MCP 且鉴权正确）。每次创建任务计 1 次 AI 调用。 */
  router.post('/tasks', taskQuota, aiQuota, async (req, res) => {
    try {
      const request = req.body as CreateTaskRequest;
      if (!request.domain || !request.title || !request.description) {
        res.status(400).json({ error: 'Missing required fields: domain, title, description' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      if (request.llmConfig && userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId,
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }
      const task = await orchestrator.createAndRun(request, userId);
      res.status(201).json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Get all tasks（按用户过滤：有 userId 时只返回该用户任务） */
  router.get('/tasks', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    const all = orchestrator.getAllTasks();
    const list =
      userId && userId !== 'anonymous'
        ? all.filter((t) => (t.metadata as { userId?: string } | undefined)?.userId === userId)
        : all;
    res.json(list);
  });

  /** Get current computer context (what the AI perceives) */
  router.get('/context', (_req, res) => {
    const ctx = orchestrator.getComputerContext();
    res.json(ctx ?? { timestamp: 0, message: 'No context yet' });
  });

  /** Get a specific task（运行用户只能查看自己的任务） */
  router.get('/tasks/:id', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    const task = orchestrator.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const taskUserId = (task.metadata as { userId?: string } | undefined)?.userId;
    if (userId && userId !== 'anonymous' && taskUserId && taskUserId !== userId) {
      res.status(403).json({ error: '无权查看该任务' });
      return;
    }
    res.json(task);
  });

  /** Pause a task */
  router.post('/tasks/:id/pause', (req, res) => {
    const ok = orchestrator.pauseTask(req.params.id);
    res.json({ success: ok });
  });

  /** Resume a task */
  router.post('/tasks/:id/resume', (req, res) => {
    const ok = orchestrator.resumeTask(req.params.id);
    res.json({ success: ok });
  });

  /** Approve a step */
  router.post('/tasks/:id/steps/:stepId/approve', (req, res) => {
    const ok = orchestrator.approveStep(req.params.id, req.params.stepId);
    res.json({ success: ok });
  });

  /** Reject a step */
  router.post('/tasks/:id/steps/:stepId/reject', (req, res) => {
    const ok = orchestrator.rejectStep(req.params.id, req.params.stepId);
    res.json({ success: ok });
  });

  /** 失败任务重试：body { mode: 'restart' | 'from_failure' }，默认 restart */
  router.post('/tasks/:id/retry', async (req, res) => {
    const mode = (req.body?.mode === 'from_failure' ? 'from_failure' : 'restart') as 'restart' | 'from_failure';
    const ok = await orchestrator.retryTask(req.params.id, mode);
    if (!ok) {
      res.status(400).json({ error: 'Task not found or not in failed state' });
      return;
    }
    res.json({ success: true, mode });
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

  /** X 制作的小程序列表（按用户隔离）。仅返回沙箱内仍存在应用目录的项，删除目录后桌面图标会同步消失；并写回清理后的 x_mini_apps。 */
  router.get('/apps', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') return res.json({ apps: [] });
      if (!db) return res.json({ apps: [] });
      const raw = await db.getConfig(userId, 'x_mini_apps');
      if (!raw) return res.json({ apps: [] });
      let apps: { id: string; name: string; path: string }[];
      try {
        const arr = JSON.parse(raw) as unknown[];
        apps = Array.isArray(arr)
          ? arr.filter((x): x is { id: string; name: string; path: string } => {
              if (!x || typeof x !== 'object') return false;
              const a = x as Record<string, unknown>;
              return typeof a.id === 'string' && typeof a.name === 'string' && typeof a.path === 'string';
            })
          : [];
      } catch {
        return res.json({ apps: [] });
      }
      if (apps.length === 0) return res.json({ apps: [] });
      if (!userSandboxManager) return res.json({ apps });
      try {
        const { sandboxFS } = await userSandboxManager.getForUser(userId);
        const existing: typeof apps = [];
        for (const app of apps) {
          const indexPath = app.path.replace(/\/?$/, '') + '/index.html';
          try {
            await sandboxFS.read(indexPath);
            existing.push(app);
          } catch (err: any) {
            const code = (err as NodeJS.ErrnoException)?.code ?? '';
            if (code !== 'ENOENT' && !err?.message?.includes('not found')) throw err;
          }
        }
        if (existing.length !== apps.length) {
          await db.setConfig(userId, 'x_mini_apps', JSON.stringify(existing));
        }
        return res.json({ apps: existing });
      } catch (err: any) {
        res.status(500).json({ error: err.message ?? '获取应用列表失败' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取应用列表失败' });
    }
  });

  /** 小程序运行时上报日志（iframe 内注入的脚本会 POST 控制台错误等），供 x.get_app_logs 与 GET sandbox-logs 查看 */
  router.post('/apps/sandbox-logs', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return;
    }
    if (!miniAppLogStore) {
      res.status(503).json({ error: '日志服务不可用' });
      return;
    }
    const { appId, level, message, detail } = req.body || {};
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (bodyUserId && bodyUserId !== userId) {
      res.status(403).json({ error: '用户不匹配' });
      return;
    }
    const aid = String(appId ?? '').trim();
    const msg = String(message ?? '').trim();
    if (!aid || !msg) {
      res.status(400).json({ error: 'appId 与 message 必填' });
      return;
    }
    const lvl = level === 'warn' || level === 'info' ? level : 'error';
    miniAppLogStore.append(userId, aid, { level: lvl, message: msg, detail: detail != null ? String(detail) : undefined });
    res.json({ ok: true });
  });

  /** 获取指定小程序的最近运行时日志（供前端或调试用；X 请用工具 x.get_app_logs） */
  router.get('/apps/sandbox-logs', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return;
    }
    if (!miniAppLogStore) return res.json({ logs: [] });
    const appId = String(req.query.appId ?? '').trim();
    if (!appId) {
      res.status(400).json({ error: 'appId 必填' });
      return;
    }
    const limit = Math.min(Math.max(0, Number(req.query.limit) || 30), 100);
    res.json({ logs: miniAppLogStore.getLogs(userId, appId, limit) });
  });

  /** 提供小程序静态资源（沙箱 apps/ 目录下文件，按用户隔离）。
   * 路径式（推荐）：/api/apps/sandbox/:userId/apps/calc/index.html
   * 这样 iframe 内相对引用 style.css、app.js 会请求同一路径下的文件，URL 中已带 userId，子资源可正确鉴权。
   * 对 .html 响应注入运行时错误上报脚本，便于 X 通过 x.get_app_logs 查看问题。 */
  router.get(/^\/apps\/sandbox\/([^/]+)\/(.+)$/, async (req, res) => {
    const pathForMatch = (req as { path?: string }).path ?? '';
    const match = pathForMatch.match(/^\/apps\/sandbox\/([^/]+)\/(.+)$/);
    const userIdFromPath = match ? decodeURIComponent(match[1]) : '';
    let pathParam = match ? match[2].replace(/^\/+/, '') : '';
    if (!pathParam.startsWith('apps/')) {
      res.status(400).json({ error: 'path 须以 apps/ 开头' });
      return;
    }
    // 兼容错误引用：若路径为 apps/<id>/apps/<id>/...（重复一段），规范为 apps/<id>/...
    const dupMatch = pathParam.match(/^apps\/([^/]+)\/apps\/\1\/(.*)$/);
    if (dupMatch) pathParam = `apps/${dupMatch[1]}/${dupMatch[2]}`;

    if (!userIdFromPath || userIdFromPath === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return;
    }
    if (!userSandboxManager) {
      res.status(503).json({ error: '用户沙箱不可用' });
      return;
    }
    try {
      const { sandboxFS } = await userSandboxManager.getForUser(userIdFromPath);
      const ext = pathParam.replace(/^.*\./, '').toLowerCase();
      const binaryExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'wav', 'mp3', 'ogg', 'm4a']);
      const mime: Record<string, string> = {
        html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript',
        json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', webp: 'image/webp', bmp: 'image/bmp',
        wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4',
      };
      res.set('Content-Type', mime[ext] || 'text/plain');

      if (binaryExts.has(ext)) {
        const buffer = await sandboxFS.readBinary(pathParam);
        res.send(buffer);
        return;
      }
      let content = await sandboxFS.read(pathParam);
      if ((ext === 'html' || ext === 'htm') && content.includes('</body>')) {
        const appIdMatch = pathParam.match(/^apps\/([^/]+)\//);
        const appId = appIdMatch ? appIdMatch[1] : '';
        const script = buildMiniAppLoggerScript(appId, userIdFromPath);
        content = content.replace('</body>', script + '</body>');
      }
      res.send(content);
    } catch (err: any) {
      if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }
      res.status(500).json({ error: err.message ?? '读取失败' });
    }
  });

  router.get('/apps/sandbox', async (req, res) => {
    try {
      const pathParam = (req.query.path as string)?.trim();
      if (!pathParam || !pathParam.startsWith('apps/')) {
        res.status(400).json({ error: 'path 必填且须以 apps/ 开头' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      if (!userSandboxManager) {
        res.status(503).json({ error: '用户沙箱不可用' });
        return;
      }
      const { sandboxFS } = await userSandboxManager.getForUser(userId);
      const ext = pathParam.replace(/^.*\./, '').toLowerCase();
      const binaryExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp']);
      const mime: Record<string, string> = {
        html: 'text/html',
        htm: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        webp: 'image/webp',
        bmp: 'image/bmp',
      };
      res.set('Content-Type', mime[ext] || 'text/plain');
      if (binaryExts.has(ext)) {
        const buffer = await sandboxFS.readBinary(pathParam);
        res.send(buffer);
      } else {
        const content = await sandboxFS.read(pathParam);
        res.send(content);
      }
    } catch (err: any) {
      if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }
      res.status(500).json({ error: err.message ?? '读取失败' });
    }
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

  /** 能力列表（内置 + 已注册 MCP/Skill），供主脑与前端使用 */
  router.get('/capabilities', (_req, res) => {
    res.json(listAllCapabilities(orchestrator.getTools()));
  });

  /** Skill 搜索：从 SkillHub 搜索技能，供前端市场与 X 工具使用 */
  router.get('/skills/search', async (req, res) => {
    try {
      const q = String(req.query?.q ?? '').trim();
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const result = await searchSkillHub(q, limit);
      if (result.ok) {
        res.json({ ok: true, skills: result.skills });
      } else {
        res.status(400).json({ ok: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message ?? 'Skill 搜索失败' });
    }
  });

  /** 精选 Skill 推荐：返回预设的推荐列表，供试用/个人版一键安装。已安装的会标记 installed。 */
  router.get('/skills/recommended', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const installed = getDiscoveredSkills(userId).map((s) => s.dirName ?? s.name);
      const list = RECOMMENDED_SKILLS.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        category: s.category,
        source: s.source || 'skillhub',
        installed: installed.includes(s.slug),
      }));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取推荐 Skills 失败' });
    }
  });

  /** 安装 Skill：source 格式 skillhub:<slug> 或 openclaw:<slug>，安装到用户工作区或默认 skills 目录 */
  router.post('/skills/install', async (req, res) => {
    try {
      const { source } = req.body as { source?: string };
      if (!source || typeof source !== 'string') {
        res.status(400).json({ error: '缺少 source，格式：skillhub:<slug> 或 openclaw:<slug>' });
        return;
      }
      const lower = source.trim().toLowerCase();
      if (!lower.startsWith('skillhub:') && !lower.startsWith('openclaw:')) {
        res.status(400).json({ error: 'source 须以 skillhub: 或 openclaw: 开头，如 skillhub:serpapi-search 或 openclaw:weather' });
        return;
      }
      const isOpenClaw = lower.startsWith('openclaw:');
      const slug = lower.slice(isOpenClaw ? 8 : 8).trim();
      if (!slug) {
        res.status(400).json({ error: `${isOpenClaw ? 'openclaw' : 'skillhub'}: 后需填写 slug` });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      const targetRoot =
        userId && userId !== 'anonymous' && userSandboxManager
          ? path.join(userSandboxManager.getUserWorkspaceRoot(userId), 'skills')
          : undefined;

      let result;
      if (isOpenClaw) {
        // 从 GitHub 下载 OpenClaw skill (直接下载 SKILL.md)
        const skillsRoot = targetRoot || path.join(process.cwd(), 'skills');
        const skillDir = path.join(skillsRoot, slug);

        try {
          const fs = await import('fs/promises');
          await fs.mkdir(skillDir, { recursive: true });

          // 下载 SKILL.md
          const skillMdUrl = `https://raw.githubusercontent.com/openclaw/openclaw/main/skills/${slug}/SKILL.md`;
          const response = await fetch(skillMdUrl);
          if (!response.ok) {
            res.status(404).json({ error: `未找到 OpenClaw Skill: ${slug}，请检查 slug 是否正确` });
            return;
          }
          const content = await response.text();
          await fs.writeFile(path.join(skillDir, 'SKILL.md'), content);

          result = { ok: true, message: `OpenClaw Skill "${slug}" 安装成功`, dirName: slug };
        } catch (e: any) {
          result = { ok: false, message: `安装 OpenClaw Skill 失败: ${e.message}` };
        }
      } else {
        result = await installFromSkillHub(slug, targetRoot);
      }
      if (result.ok) {
        res.json({ success: true, message: result.message, dirName: result.dirName });
      } else {
        res.status(400).json({ error: result.message });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '安装 Skill 失败' });
    }
  });

  /** 获取 OpenClaw Skill 详情：从 GitHub 获取 SKILL.md 内容 */
  router.get('/skills/openclaw/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) {
        res.status(400).json({ error: '缺少 slug' });
        return;
      }
      const url = `https://raw.githubusercontent.com/openclaw/openclaw/main/skills/${slug}/SKILL.md`;
      const response = await fetch(url);
      if (!response.ok) {
        res.status(404).json({ error: `未找到 Skill: ${slug}` });
        return;
      }
      const content = await response.text();
      res.json({ slug, content });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取 Skill 详情失败' });
    }
  });

  /** Skill 发现：扫描 skills 目录，返回可配置的 Skill 列表。?extract=llm 时对无 configFields 的 Skill 用大模型提取。 */
  router.get('/skills', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      let skills = getDiscoveredSkills(userId);
      const extract = (req.query.extract as string)?.toLowerCase();
      if (extract === 'llm') {
        const llmConfig = userId ? await getLLMConfigForScheduler(userId) : null;
        if (llmConfig?.providerId && llmConfig?.modelId) {
          skills = await enrichSkillsWithLLMExtraction(
            skills,
            llmConfig,
            (name) => getSkillContentByName(name, userId)?.content ?? null
          );
        }
      }
      res.json(skills);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取 Skills 列表失败' });
    }
  });

  /** 删除 Skill：移除 skills/<dirName> 目录 */
  router.delete('/skills/:dirName', (req, res) => {
    try {
      const dirName = (req.params.dirName ?? '').trim();
      const userId = (req as { userId?: string }).userId;
      const result = deleteSkill(dirName, userId);
      if (result.ok) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '删除 Skill 失败' });
    }
  });

  router.post('/capabilities/register', (req, res) => {
    try {
      const { name, description, source } = req.body as { name?: string; description?: string; source?: 'builtin' | 'mcp' | 'skill' };
      if (!name || typeof description !== 'string') {
        res.status(400).json({ error: '缺少 name 或 description' });
        return;
      }
      registerCapability({ name, description, source });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '注册失败' });
    }
  });

  /** MCP 状态：已加载的服务器与工具数（配置见文档 MCP 配置） */
  router.get('/mcp/status', (_req, res) => {
    const status = getMcpStatus();
    res.json(status ?? { servers: [], totalTools: 0 });
  });

  /** MCP 配置：获取当前配置（按用户隔离：有 userId 时优先用云端 db，与运行时一致，保证 headers 等不丢失） */
  router.get('/mcp/config', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const workspaceRoot =
        userSandboxManager && userId && userId !== 'anonymous'
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();
      let servers: Awaited<ReturnType<typeof loadMcpConfig>>;
      if (db && userId && userId !== 'anonymous') {
        const fromDb = await db.getConfig(userId, 'mcp_config');
        if (fromDb?.trim()) {
          try {
            const parsed = JSON.parse(fromDb) as unknown;
            servers = normalizeMcpConfig(
              Array.isArray(parsed) ? { servers: parsed } : typeof parsed === 'object' && parsed !== null ? parsed : {},
            );
            if (servers.length > 0) {
              const configPath = getMcpConfigPath(workspaceRoot);
              return res.json({ servers, configPath, fromEnv: false });
            }
          } catch (_) {
            /* 解析失败则回退到文件 */
          }
        }
      }
      servers = await loadMcpConfig(workspaceRoot);
      if (servers.length === 0) {
        const defaults = loadDefaultConfig()?.mcp_servers;
        if (defaults) {
          const raw = Array.isArray(defaults) ? { servers: defaults } : typeof defaults === 'object' && defaults !== null ? { mcpServers: defaults } : {};
          servers = normalizeMcpConfig(raw);
        }
      }
      const configPath = getMcpConfigPath(workspaceRoot);
      const fromEnv = !!process.env.X_COMPUTER_MCP_SERVERS?.trim();
      res.json({ servers, configPath, fromEnv });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取配置失败' });
    }
  });

  /** MCP 配置：保存并重载（按用户隔离：有 userId 时写入该用户工作区并同步到云端） */
  router.post('/mcp/config', async (req, res) => {
    try {
      const body = req.body as { servers?: unknown; mcpServers?: unknown };
      if (body.servers !== undefined && !Array.isArray(body.servers)) {
        res.status(400).json({ error: 'servers 需为数组' });
        return;
      }
      if (body.mcpServers !== undefined && (typeof body.mcpServers !== 'object' || body.mcpServers === null)) {
        res.status(400).json({ error: 'mcpServers 需为对象' });
        return;
      }
      const servers = normalizeMcpConfig(
        body as { mcpServers?: Record<string, Record<string, unknown>>; servers?: McpServerConfig[] },
      );
      if (servers.length === 0 && body.servers === undefined && body.mcpServers === undefined) {
        res.status(400).json({ error: 'Body 需包含 servers 数组或 mcpServers 对象' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      const workspaceRoot =
        userSandboxManager && userId && userId !== 'anonymous'
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();
      const configPath = await saveMcpConfig(workspaceRoot, servers);
      if (db && userId && userId !== 'anonymous') {
        await db.ensureUser(userId);
        await db.setConfig(userId, 'mcp_config', JSON.stringify(servers));
      }
      const result =
        userId && userId !== 'anonymous' && userSandboxManager
          ? await loadMcpAndRegisterForUser(
              orchestrator,
              userId,
              userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
              db?.getConfig.bind(db),
            )
          : await reloadMcpAndRegister(orchestrator, workspaceRoot);
      res.json({ success: true, configPath, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '保存并重载失败' });
    }
  });

  /** MCP Registry 搜索：从 registry.modelcontextprotocol.io 搜索 MCP 服务器，供前端市场与 X 工具使用 */
  router.get('/mcp/registry/search', async (req, res) => {
    try {
      const q = String(req.query?.q ?? '').trim();
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const result = await searchMcpRegistry(q, limit);
      if (result.ok) {
        res.json({ ok: true, servers: result.servers });
      } else {
        res.status(500).json({ ok: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message ?? 'MCP Registry 搜索失败' });
    }
  });

  /** MCP 测试：测试单个服务器连接，返回完整工具列表（含名称、描述、参数 schema）或错误 */
  router.post('/mcp/test', async (req, res) => {
    try {
      const server = req.body as McpServerConfig;
      const hasHttp = server?.id && server?.url;
      const hasStdio = server?.id && server?.command;
      if (!hasHttp && !hasStdio) {
        res.status(400).json({ error: 'Body 需包含 id，以及 url（HTTP）或 command（Stdio）' });
        return;
      }
      const tools = await listTools(server);
      res.json({
        ok: true,
        toolsCount: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
        })),
      });
    } catch (err: any) {
      res.status(200).json({ ok: false, error: err.message ?? String(err) });
    }
  });

  /** 近期已完成清单（含一次性与定时/周期），供前端展示 */
  router.get('/x/done-log', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const raw = await db.getConfig(userId, X_DONE_LOG_KEY);
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 30));
      let oneTime: { at: number; summary: string; schedule?: string; title?: string; action?: string }[] = [];
      let scheduled: { at: number; summary: string; schedule?: string; title?: string; action?: string }[] = [];
      if (raw) {
        try {
          const arr = JSON.parse(raw) as { at: number; summary: string; scheduled?: boolean; schedule?: string; title?: string; action?: string }[];
          if (Array.isArray(arr)) {
            const recent = arr.slice(-limit).reverse();
            const toEntry = (e: typeof arr[0]) => ({
              at: e.at,
              summary: e.summary,
              ...(e.schedule && { schedule: e.schedule }),
              ...(e.title && { title: e.title }),
              ...(e.action && { action: e.action }),
            });
            oneTime = recent.filter((e) => !e.scheduled).map(toEntry);
            scheduled = recent.filter((e) => e.scheduled).map(toEntry);
          }
        } catch { /* ignore */ }
      }
      res.json({ ok: true, oneTime, scheduled });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败' });
    }
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

  /** 收件箱：从数据库读取已同步的邮件。邮件由定时任务从 IMAP 同步到 DB，不直接调 IMAP。需登录。 */
  router.get('/email/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getEmailsByUser(userId, limit);
      const emails = rows.map((r: { uid: number; messageId?: string; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean }) => ({
        uid: r.uid,
        messageId: r.messageId,
        from: r.from,
        to: r.to,
        subject: r.subject,
        date: r.date,
        text: r.text,
        unseen: r.unseen,
      }));
      res.json({ ok: true, emails });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败', emails: [] });
    }
  });

  /** 手动触发邮件同步（IMAP → DB），供测试或立即拉取新邮件。新邮件会发出 email_received 信号。需登录。 */
  router.post('/email/sync', async (req, res) => {
    try {
      if (!db || !signalFireDeps) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      await runEmailCheck({
        db,
        getConfig: db.getConfig.bind(db),
        setConfig: db.setConfig.bind(db),
        runIntent: signalFireDeps.runIntent,
        runAgent: signalFireDeps.runAgent,
      });
      res.json({ ok: true, message: '同步完成' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '同步失败' });
    }
  });

  // ── WhatsApp（R052）────────────────────────────────────────

  /** WhatsApp 系统代理检测（macOS）：返回当前系统代理 URL，供前端预填。 */
  router.get('/whatsapp/system-proxy', (_req, res) => {
    try {
      const url = getSystemProxy();
      res.json({ ok: true, proxy: url ?? '' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '检测失败' });
    }
  });

  /** WhatsApp 连接状态。需登录。 */
  router.get('/whatsapp/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const config = parseWhatsAppConfig(await db.getConfig(userId, 'whatsapp_config'));
      const conn = getWhatsAppConnection(userId, db.getConfig.bind(db));
      const status = conn.getStatus();
      res.json({
        ok: true,
        enabled: config?.enabled ?? false,
        status,
        allowFrom: config?.allowFrom ?? [],
        allowSelfChat: config?.allowSelfChat ?? false,
        proxy: config?.proxy ?? '',
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '获取失败' });
    }
  });

  /** WhatsApp 登录：连接并返回 QR 码（data URL），或已连接则返回 alreadyConnected。需登录。 */
  router.post('/whatsapp/login', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const proxyFromBody = (req.body as { proxy?: string })?.proxy?.trim();
      disconnectWhatsApp(userId);
      const conn = getWhatsAppConnection(userId, db.getConfig.bind(db));
      type WhatsAppLoginResult = { qr?: string; alreadyConnected?: boolean; error?: string };
      const resultPromise = new Promise<WhatsAppLoginResult>((resolve) => {
        conn.setQrCallback((qr) => resolve({ qr }));
        conn.setConnectedCallback(() => resolve({ alreadyConnected: true }));
        conn.setDisconnectCallback((reason, detail) => {
          const msg = reason === 'logged_out' ? '已登出' : (detail ? `连接断开：${detail}` : '连接断开，请重试');
          resolve({ error: msg });
        });
        conn.connect(proxyFromBody).then((r) => {
          if (!r.ok && r.error) resolve({ error: r.error });
        });
      });
      const result = await Promise.race([
        resultPromise,
        new Promise<WhatsAppLoginResult>((_, reject) => setTimeout(() => reject(new Error('QR 超时（60秒），请检查网络后重试')), 60000)),
      ]);
      if (result.error) res.status(408).json({ ok: false, error: result.error });
      else if (result.alreadyConnected) res.json({ ok: true, alreadyConnected: true });
      else if (result.qr) res.json({ ok: true, qr: result.qr });
      else res.status(408).json({ ok: false, error: '未获取到 QR 码，请重试' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '登录失败' });
    }
  });

  /** WhatsApp 登出：断开连接并清除本地凭证。需登录。 */
  router.post('/whatsapp/logout', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      disconnectWhatsApp(userId);
      const credsPath = path.join(CREDENTIALS_BASE, userId);
      if (fs.existsSync(credsPath)) {
        fs.rmSync(credsPath, { recursive: true });
      }
      res.json({ ok: true, message: '已登出' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '登出失败' });
    }
  });

  /** WhatsApp 收件箱：从数据库读取已收到的消息。需登录。 */
  router.get('/whatsapp/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getWhatsAppMessagesByUser(userId, limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] });
    }
  });

  // ── Telegram 渠道路由 ──────────────────────────────────────

  router.get('/telegram/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseTelegramConfig(await db.getConfig(userId, 'telegram_config'));
      const conn = getTelegramConnection(userId, db.getConfig.bind(db));
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), botInfo: conn.getBotInfo(), allowFrom: config?.allowFrom ?? [], dmPolicy: config?.dmPolicy ?? 'allowlist' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  router.post('/telegram/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseTelegramConfig(await db.getConfig(userId, 'telegram_config'));
      if (!config?.enabled || !config.botToken) { res.status(400).json({ ok: false, error: '请先启用并填写 Bot Token' }); return; }
      disconnectTelegram(userId);
      const conn = getTelegramConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.botToken);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  router.post('/telegram/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectTelegram(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  router.get('/telegram/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'telegram', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
  });

  // ── Discord 渠道路由 ──────────────────────────────────────

  router.get('/discord/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseDiscordConfig(await db.getConfig(userId, 'discord_config'));
      const conn = getDiscordConnection(userId, db.getConfig.bind(db));
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), botInfo: conn.getBotInfo(), allowFrom: config?.allowFrom ?? [], dmPolicy: config?.dmPolicy ?? 'allowlist' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  router.post('/discord/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseDiscordConfig(await db.getConfig(userId, 'discord_config'));
      if (!config?.enabled || !config.botToken) { res.status(400).json({ ok: false, error: '请先启用并填写 Bot Token' }); return; }
      disconnectDiscord(userId);
      const conn = getDiscordConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.botToken);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  router.post('/discord/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectDiscord(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  router.get('/discord/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'discord', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
  });

  // ── Slack 渠道路由 ────────────────────────────────────────

  router.get('/slack/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseSlackConfig(await db.getConfig(userId, 'slack_config'));
      const conn = getSlackConnection(userId, db.getConfig.bind(db));
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), allowFrom: config?.allowFrom ?? [], dmPolicy: config?.dmPolicy ?? 'allowlist' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  router.post('/slack/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseSlackConfig(await db.getConfig(userId, 'slack_config'));
      if (!config?.enabled || !config.botToken || !config.appToken) { res.status(400).json({ ok: false, error: '请先启用并填写 Bot Token 和 App Token' }); return; }
      disconnectSlack(userId);
      const conn = getSlackConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.botToken, config.appToken);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  router.post('/slack/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectSlack(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  router.get('/slack/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'slack', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
  });

  // ── QQ 渠道路由 ────────────────────────────────────────────

  router.get('/qq/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseQQConfig(await db.getConfig(userId, 'qq_config'));
      const conn = getQQConnection(userId, db.getConfig.bind(db));
      const selfOpenid = await db.getConfig(userId, 'qq_self_openid');
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), botInfo: conn.getBotInfo(), dmPolicy: config?.dmPolicy ?? 'open', groupPolicy: config?.groupPolicy ?? 'open', selfOpenid: selfOpenid ?? null });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  router.post('/qq/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseQQConfig(await db.getConfig(userId, 'qq_config'));
      if (!config?.enabled || !config.appId || !config.secret) { res.status(400).json({ ok: false, error: '请先启用并填写 AppID 和 Secret' }); return; }
      disconnectQQ(userId);
      const conn = getQQConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.appId, config.secret, config.sandbox);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  router.post('/qq/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectQQ(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  /** 手动重连 QQ Bot（清除自动重连计数并重新连接） */
  router.post('/qq/reconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const result = await reconnectQQ(userId, db.getConfig.bind(db));
      if (result.ok) res.json({ ok: true, message: '重连成功' });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '重连失败' }); }
  });

  router.get('/qq/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'qq', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
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

  // ── Prompts (主脑提示词) ────────────────────────────────────

  router.get('/prompts/welcome', async (req, res) => {
    let lang: 'en' | 'zh-CN' = 'zh-CN';
    const queryLang = String(req.query?.lang ?? '').trim().toLowerCase();
    if (queryLang === 'en' || queryLang === 'zh-cn') {
      lang = queryLang === 'en' ? 'en' : 'zh-CN';
    } else if (db) {
      const userId = (req as { userId?: string }).userId;
      if (userId && userId !== 'anonymous') {
        lang = await getUserLanguage(db, userId);
      } else {
        const accept = (req.headers['accept-language'] as string) ?? '';
        lang = accept.includes('en') && !accept.startsWith('zh') ? 'en' : 'zh-CN';
      }
    }
    res.json({ content: getWelcomeMessage(lang) });
  });

  // ── Memory (主脑记忆：召回与捕获，OpenClaw 式向量检索) ─────────

  /** GET：记忆状态（对齐 OpenClaw MemorySearchManager.status），供设置页/调试展示。按用户隔离：已登录用户返回其工作区路径 */
  router.get('/memory/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const effectiveWorkspaceId = userId && userId !== 'anonymous' ? userId : undefined;
      const memSvc =
        effectiveWorkspaceId && userSandboxManager
          ? await getMemoryServiceForUser(userId)
          : memoryService;
      const status = await (memSvc ?? memoryService).getStatus(effectiveWorkspaceId);
      const workspaceRoot =
        userId && userId !== 'anonymous' && userSandboxManager
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();
      res.json({
        ...status,
        workspaceRoot,
        lastEmbedError: status.lastEmbedError ?? lastMemoryEmbedError ?? undefined,
      });
    } catch (err: any) {
      serverLogger.error('memory/status', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '获取状态失败' });
    }
  });

  /** GET：按路径读记忆文件全文或片段（对齐 OpenClaw readFile）。Query: path（必填）, from?, lines? */
  router.get('/memory/read', async (req, res) => {
    try {
      const pathParam = String(req.query?.path ?? '').trim();
      if (!pathParam) {
        res.status(400).json({ error: '缺少 path，例如 path=memory/2026-02-11.md' });
        return;
      }
      const from = req.query?.from != null ? parseInt(String(req.query.from), 10) : undefined;
      const lines = req.query?.lines != null ? parseInt(String(req.query.lines), 10) : undefined;
      const result = await memoryService.readFile(pathParam, {
        from: Number.isFinite(from) ? from : undefined,
        lines: Number.isFinite(lines) ? lines : undefined,
      });
      res.json(result);
    } catch (err: any) {
      serverLogger.error('memory/read', err.message, err.stack);
      res.status(400).json({ error: err.message ?? '读取失败' });
    }
  });

  /** GET：关键词召回（兼容旧版，无向量配置时前端也可用） */
  router.get('/memory/recall', async (req, res) => {
    try {
      const q = String(req.query?.q ?? '').trim();
      const days = Math.min(5, Math.max(1, parseInt(String(req.query?.days), 10) || 2));
      const content = await memoryService.recall(q, { days });
      res.json({ content });
    } catch (err: any) {
      serverLogger.error('memory/recall', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '召回失败' });
    }
  });

  /** POST：支持向量召回、混合检索、多 workspace。body: query, days, topK, useHybrid, vectorWeight, textWeight, workspaceId；若带 providerId/modelId 则用向量/混合 */
  router.post('/memory/recall', async (req, res) => {
    try {
      const {
        query,
        days,
        topK,
        useHybrid,
        vectorWeight,
        textWeight,
        workspaceId: bodyWorkspaceId,
        providerId,
        modelId,
        baseUrl,
        apiKey,
      } = req.body as {
        query?: string;
        days?: number;
        topK?: number;
        useHybrid?: boolean;
        vectorWeight?: number;
        textWeight?: number;
        workspaceId?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      const q = (query ?? '').trim();
      const daysVal = Math.min(5, Math.max(1, parseInt(String(days), 10) || 2));
      const topKVal = Math.min(10, Math.max(1, parseInt(String(topK), 10) || 5));
      const workspaceId = typeof bodyWorkspaceId === 'string' ? bodyWorkspaceId.trim() || undefined : undefined;

      if (providerId && modelId && q) {
        try {
          const queryVector = await callEmbedding(q, { providerId, modelId, baseUrl, apiKey });
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'hybrid',
              provider: {
                configured: true,
                available: true,
                providerId,
                modelId,
              },
              lastEmbedError: undefined,
              fallback: { active: false },
            },
            workspaceId,
          );
          const content = await memoryService.recall(q, {
            queryVector,
            topK: topKVal,
            useHybrid: Boolean(useHybrid),
            vectorWeight: typeof vectorWeight === 'number' ? vectorWeight : undefined,
            textWeight: typeof textWeight === 'number' ? textWeight : undefined,
            workspaceId,
          });
          res.json({ content });
          return;
        } catch (embedErr: any) {
          const embedError = embedErr?.message ?? String(embedErr);
          lastMemoryEmbedError = embedError;
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'keyword_fallback',
              lastEmbedError: embedError,
              fallback: { active: true, reason: 'embedding_failed' },
            },
            workspaceId,
          );
          serverLogger.error('memory/recall (embed)', embedError);
          const content = await memoryService.recall(q, { days: daysVal, workspaceId });
          res.json({ content, vectorUsed: false, embedError });
          return;
        }
      }
      const content = await memoryService.recall(q, { days: daysVal, workspaceId });
      res.json({ content });
    } catch (err: any) {
      serverLogger.error('memory/recall', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '召回失败' });
    }
  });

  router.post('/memory/capture', async (req, res) => {
    try {
      const {
        content: rawContent,
        type,
        providerId,
        modelId,
        baseUrl,
        apiKey,
        workspaceId: bodyWorkspaceId,
      } = req.body as {
        content?: string;
        type?: 'preference' | 'decision' | 'fact';
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        workspaceId?: string;
      };
      if (!rawContent || typeof rawContent !== 'string') {
        res.status(400).json({ error: '缺少 content' });
        return;
      }
      const content = rawContent.trim();
      await memoryService.capture(content, type);

      const workspaceId = typeof bodyWorkspaceId === 'string' ? bodyWorkspaceId.trim() || undefined : undefined;
      if (providerId && modelId) {
        try {
          const vector = await callEmbedding(content, { providerId, modelId, baseUrl, apiKey });
          const date = new Date().toISOString().slice(0, 10);
          await memoryService.addToIndex(
            { filePath: dailyPath(date), date, text: content, vector },
            workspaceId,
          );
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'hybrid',
              provider: {
                configured: true,
                available: true,
                providerId,
                modelId,
              },
              lastEmbedError: undefined,
              fallback: { active: false },
            },
            workspaceId,
          );
        } catch (embedErr: any) {
          serverLogger.error('memory/capture (index)', embedErr.message);
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'keyword_fallback',
              provider: {
                configured: true,
                available: false,
                providerId,
                modelId,
              },
              lastEmbedError: embedErr?.message ?? String(embedErr),
              fallback: { active: true, reason: 'embedding_failed' },
            },
            workspaceId,
          );
        }
      }
      res.json({ success: true });
    } catch (err: any) {
      serverLogger.error('memory/capture', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '写入失败' });
    }
  });

  /** 测试向量嵌入连接（用于校验 Base URL、模型、API Key） */
  router.post('/memory/test-embedding', async (req, res) => {
    try {
      const { providerId, modelId, baseUrl, apiKey } = req.body as {
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      if (!providerId || !modelId) {
        res.status(400).json({ ok: false, error: '缺少 providerId 或 modelId' });
        return;
      }
      const vector = await callEmbedding('测试文本', { providerId, modelId, baseUrl, apiKey });
      await memoryService.updateStatusMeta(
        {
          retrievalMode: 'hybrid',
          provider: {
            configured: true,
            available: true,
            providerId,
            modelId,
          },
          lastEmbedError: undefined,
          fallback: { active: false },
        },
        undefined,
      );
      res.json({ ok: true, dimensions: vector?.length ?? 0 });
    } catch (err: any) {
      await memoryService.updateStatusMeta(
        {
          retrievalMode: 'keyword_fallback',
          provider: { configured: true, available: false },
          lastEmbedError: err?.message ?? String(err),
          fallback: { active: true, reason: 'embedding_probe_failed' },
        },
        undefined,
      );
      res.json({ ok: false, error: err?.message ?? '请求失败' });
    }
  });

  /** 从已有记忆文件重建向量索引。按用户隔离：已登录用户从其工作区 memory/ 读取并索引 */
  router.post('/memory/rebuild-index', async (req, res) => {
    try {
      const { providerId, modelId, baseUrl, apiKey, workspaceId: bodyWorkspaceId } = req.body as {
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        workspaceId?: string;
      };
      if (!providerId || !modelId) {
        res.status(400).json({ error: '缺少 providerId 或 modelId（向量嵌入）' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      const effectiveWorkspaceId = userId && userId !== 'anonymous' ? userId : undefined;
      let fsToUse = sandboxFS;
      if (effectiveWorkspaceId && userSandboxManager && userId) {
        const { sandboxFS: userFS } = await userSandboxManager.getForUser(userId);
        fsToUse = userFS;
      }
      const workspaceRoot =
        userId && userId !== 'anonymous' && userSandboxManager
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();

      await vectorStore.clear(effectiveWorkspaceId);
      try {
        await fsToUse.mkdir(MEMORY_DIR);
      } catch {
        /* 目录已存在或创建失败均继续 */
      }
      let list: { name: string; type: string }[] = [];
      try {
        list = await fsToUse.list(MEMORY_DIR);
      } catch (listErr: any) {
        serverLogger.error('memory/rebuild-index (list)', listErr?.message);
        res.json({
          indexed: 0,
          filesFound: 0,
          fileNames: [],
          workspaceRoot,
          error: `无法读取 memory 目录: ${listErr?.message ?? ''}`,
        });
        return;
      }
      const mdFiles = list.filter(
        (e) => e.type !== 'directory' && e.name.toLowerCase().endsWith('.md'),
      );
      serverLogger.info('memory/rebuild-index', `list 返回 ${list.length} 项，.md 文件 ${mdFiles.length} 个: ${mdFiles.map((f) => f.name).join(', ') || '(无)'}`);
      const blocks: { filePath: string; date: string; text: string }[] = [];
      for (const e of mdFiles) {
        const filePath = `${MEMORY_DIR}/${e.name}`;
        let raw = '';
        try {
          raw = await fsToUse.read(filePath);
        } catch (readErr: any) {
          serverLogger.error('memory/rebuild-index (read)', filePath, readErr?.message);
          continue;
        }
        const dateFromFile = e.name.replace(/\.md$/i, '');
        const date = /^\d{4}-\d{2}-\d{2}$/.test(dateFromFile) ? dateFromFile : new Date().toISOString().slice(0, 10);
        const parts = raw.split(/\n---\n/).map((b) => b.trim()).filter(Boolean);
        for (const block of parts) {
          const text = block.replace(/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?\n?/, '').trim();
          if (!text || text.length < 2) continue;
          blocks.push({ filePath, date, text: text.slice(0, 8000) });
        }
      }
      const embedConfig = { providerId, modelId, baseUrl, apiKey };
      let indexed = 0;
      let lastEmbedError: string | undefined;
      for (let i = 0; i < blocks.length; i += EMBED_BATCH_SIZE) {
        const chunk = blocks.slice(i, i + EMBED_BATCH_SIZE);
        const texts = chunk.map((b) => b.text);
        try {
          const vectors = await callEmbeddingBatch(texts, embedConfig);
          for (let j = 0; j < chunk.length; j++) {
            await memoryService.addToIndex(
              { filePath: chunk[j].filePath, date: chunk[j].date, text: chunk[j].text, vector: vectors[j] },
              effectiveWorkspaceId,
            );
            indexed++;
          }
        } catch (embedErr: any) {
          lastEmbedError = embedErr?.message ?? String(embedErr);
          lastMemoryEmbedError = lastEmbedError;
          serverLogger.error('memory/rebuild-index (embed)', lastEmbedError ?? 'unknown');
          for (const b of chunk) {
            try {
              const vector = await callEmbedding(b.text, embedConfig);
              await memoryService.addToIndex({ filePath: b.filePath, date: b.date, text: b.text, vector }, effectiveWorkspaceId);
              indexed++;
            } catch (e2: any) {
              lastMemoryEmbedError = e2?.message ?? String(e2);
            }
          }
        }
      }
      const body: { indexed: number; filesFound: number; fileNames: string[]; workspaceRoot: string; embedError?: string } = {
        indexed,
        filesFound: mdFiles.length,
        fileNames: mdFiles.map((f) => f.name),
        workspaceRoot,
      };
      await memoryService.updateStatusMeta(
        {
          retrievalMode: lastEmbedError ? 'keyword_fallback' : 'hybrid',
          provider: {
            configured: true,
            available: !lastEmbedError,
            providerId,
            modelId,
          },
          lastEmbedError: lastEmbedError ?? undefined,
          fallback: lastEmbedError ? { active: true, reason: 'embedding_rebuild_partial_failure' } : { active: false },
        },
        effectiveWorkspaceId,
      );
      if (lastEmbedError !== undefined) body.embedError = lastEmbedError;
      res.json(body);
    } catch (err: any) {
      serverLogger.error('memory/rebuild-index', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '重建失败' });
    }
  });

  /** OpenClaw 式自动记忆：后台执行，不向前端返回 captured/content；客户端仅触发，不展示记忆结果 */
  router.post('/memory/consider-capture', async (req, res) => {
    try {
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
        workspaceId: bodyWorkspaceId,
      } = req.body as {
        userMessage?: string;
        assistantReply?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        vectorProviderId?: string;
        vectorModelId?: string;
        vectorBaseUrl?: string;
        vectorApiKey?: string;
        workspaceId?: string;
      };
      if (typeof userMessage !== 'string' || typeof assistantReply !== 'string' || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 userMessage、assistantReply、providerId 或 modelId' });
        return;
      }
      const workspaceId = typeof bodyWorkspaceId === 'string' ? bodyWorkspaceId.trim() || undefined : undefined;
      const userId = (req as { userId?: string }).userId;
      setImmediate(() => {
        (async () => {
          const memSvc = (await getMemoryServiceForUser(userId)) ?? memoryService;
          const wid = workspaceId ?? userId;
          await runConsiderCapture({
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
            memoryService: memSvc,
            workspaceId: wid,
          });
          await runLearnPromptExtract({
            userMessage,
            assistantReply,
            providerId,
            modelId,
            baseUrl,
            apiKey,
            memoryService: memSvc,
          });
        })().catch((err: any) => serverLogger.error('memory/consider-capture', err.message, err.stack));
      });
      res.json({ ok: true });
    } catch (err: any) {
      serverLogger.error('memory/consider-capture', err.message, err.stack);
      res.status(400).json({ error: err.message ?? '参数错误' });
    }
  });

  // ── Chat (P2: 普通对话走真实 LLM，支持 scene 注入主脑提示) ───

  router.post('/chat', aiQuota, async (req, res) => {
    try {
      const { messages, providerId, modelId, baseUrl, apiKey, stream, scene, capabilities, computerContext, taskSummary, memory, vectorConfig } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        stream?: boolean;
        scene?: string;
        capabilities?: string;
        computerContext?: string;
        taskSummary?: string;
        memory?: string;
        vectorConfig?: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string };
      };
      if (!Array.isArray(messages) || messages.length === 0 || !providerId || !modelId) {
        serverLogger.warn('chat', '请求参数不完整', `providerId=${providerId}, modelId=${modelId}, messages=${Array.isArray(messages) ? messages.length : 'missing'}`);
        res.status(400).json({ error: '缺少 messages、providerId 或 modelId' });
        return;
      }

      serverLogger.info('chat', `POST /chat [${providerId}/${modelId}] messages=${messages.length} stream=${!!stream} scene=${scene ?? 'none'}`);

      const userId = (req as { userId?: string }).userId;
      const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt] = await Promise.all([
        getLearnedPromptForUser(userId),
        getEvolvedCorePromptForUser(userId),
        getBasePromptForUser(userId),
        getAssistantPromptForUser(userId),
      ]);

      let chatMessages = messages.map((m) => ({
        role: (m.role === 'system' || m.role === 'assistant' ? m.role : 'user') as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }));
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages = truncateChatMessages(chatMessages);
        serverLogger.info('chat', `上下文截断为最近 ${chatMessages.length} 条`);
      }

      const sceneId = scene && ['normal_chat', 'write_to_editor', 'editor_agent', 'edit_current_document', 'intent_classify', 'extract_clean_content', 'x_direct', 'none'].includes(scene) ? scene : undefined;
      const hasContext = !!(sceneId || capabilities || computerContext || taskSummary || memory || learnedPrompt || evolvedCorePrompt || basePrompt || assistantPrompt);
      if (hasContext) {
        const tools = listAllCapabilities(orchestrator.getTools());
        const skills = getDiscoveredSkills(userId);
        const caps =
          capabilities ??
          (USE_CONDENSED_SYSTEM_PROMPT
            ? formatCapabilitiesSummaryCondensed(tools) + formatSkillsSummary(skills, true)
            : formatCapabilitiesSummary(tools) + formatSkillsSummary(skills));
        const isUtilityScene = sceneId === 'intent_classify' || sceneId === 'extract_clean_content' || sceneId === 'editor_agent' || sceneId === 'edit_current_document';
        const systemPrompt = getAssembledSystemPrompt({
          scene: (sceneId ?? 'none') as any,
          promptMode: isUtilityScene ? 'minimal' : 'full',
          basePrompt,
          capabilities: caps,
          computerContext,
          taskSummary,
          memory,
          learnedPrompt,
          evolvedCorePrompt,
          assistantPrompt: sceneId !== 'x_direct' ? assistantPrompt : '',
        });
        chatMessages = [{ role: 'system', content: systemPrompt }, ...chatMessages.filter((m) => m.role !== 'system')];
      }

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        try {
          for await (const chunk of callLLMStream({
            messages: chatMessages,
            providerId,
            modelId,
            baseUrl,
            apiKey,
          })) {
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            (res as any).flush?.();
          }
          res.write('data: [DONE]\n\n');
          serverLogger.info('chat', `流式聊天完成 [${providerId}/${modelId}]`);
        } catch (err: any) {
          serverLogger.error('chat', `流式聊天失败 [${providerId}/${modelId}]: ${err.message}`, err.stack);
          res.write(`data: ${JSON.stringify({ error: err.message || 'LLM 流式调用失败' })}\n\n`);
        }
        res.end();
        return;
      }

      const content = await callLLM({
        messages: chatMessages,
        providerId,
        modelId,
        baseUrl,
        apiKey,
      });
      serverLogger.info('chat', `聊天完成 [${providerId}/${modelId}] 回复长度=${content.length}`);
      const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
      if (lastUser?.content?.trim() && content?.trim()) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? memoryService;

            // 每次聊天都简单记录到每日记忆（OpenClaw 风格），确保每日文件被创建
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = content.trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录', `userId=${uid}`);

            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: content.trim(),
              providerId,
              modelId,
              baseUrl,
              apiKey,
              vectorProviderId: vectorConfig?.providerId,
              vectorModelId: vectorConfig?.modelId,
              vectorBaseUrl: vectorConfig?.baseUrl,
              vectorApiKey: vectorConfig?.apiKey,
              memoryService: memSvc,
              workspaceId: uid,
            });
            await runLearnPromptExtract({
              userMessage: lastUser!.content.trim(),
              assistantReply: content.trim(),
              providerId,
              modelId,
              baseUrl,
              apiKey,
              memoryService: memSvc,
            });
          })().catch((err: any) => serverLogger.error('chat (consider-capture / learn-prompt)', err.message));
        });
      }
      res.json({ content });
    } catch (err: any) {
      serverLogger.error('chat', `聊天失败: ${err.message}`, err.stack);
      res.status(400).json({ error: err.message || 'LLM 调用失败' });
    }
  });

  /** 带 tools 的聊天：用于由模型通过 function call 决定写入内容等；支持 scene 注入主脑提示。会合并当前用户 MCP 工具，服务端工具（如 MCP）在本轮执行，仅客户端工具（如 write_to_editor）返回给前端。 */
  router.post('/chat/with-tools', aiQuota, async (req, res) => {
    try {
      const { messages, providerId, modelId, baseUrl, apiKey, tools: toolsBody, scene, capabilities, computerContext, taskSummary, memory } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        tools?: LLMToolDef[];
        scene?: string;
        capabilities?: string;
        computerContext?: string;
        taskSummary?: string;
        memory?: string;
      };
      if (!Array.isArray(messages) || !providerId || !modelId || !Array.isArray(toolsBody) || !toolsBody.length) {
        serverLogger.warn('chat/with-tools', '请求参数不完整', JSON.stringify({ providerId, modelId, messagesCount: Array.isArray(messages) ? messages.length : 'missing', toolsCount: Array.isArray(toolsBody) ? toolsBody.length : 'missing' }));
        res.status(400).json({ error: '缺少 messages、providerId、modelId 或 tools' });
        return;
      }

      const userId = (req as { userId?: string }).userId;
      if (userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId,
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }

      const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt] = await Promise.all([
        getLearnedPromptForUser(userId),
        getEvolvedCorePromptForUser(userId),
        getBasePromptForUser(userId),
        getAssistantPromptForUser(userId),
      ]);
      const clientToolNames = new Set(toolsBody.map((t) => t.name));
      const allServerTools = await orchestrator.getLLMToolDefsFiltered(userId);
      const mcpDefs = allServerTools.filter((t) => !clientToolNames.has(t.name));
      const finalTools: LLMToolDef[] = [...toolsBody, ...mcpDefs];
      const toolNames = finalTools.map((t) => t.name).join(', ');
      serverLogger.info('chat/with-tools', `POST /chat/with-tools [${providerId}/${modelId}] messages=${messages.length} tools=[${toolNames}] scene=${scene ?? 'none'}`);

      let chatMessages: ChatMessage[] = messages.map((m) => ({
        role: (m.role === 'system' || m.role === 'assistant' ? m.role : 'user') as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }));
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages = truncateChatMessages(chatMessages) as ChatMessage[];
      }
      const sceneId = scene && ['normal_chat', 'write_to_editor', 'editor_agent', 'edit_current_document', 'intent_classify', 'extract_clean_content', 'x_direct', 'none'].includes(scene) ? scene : undefined;
      const hasContext = !!(sceneId || capabilities || computerContext || taskSummary || memory || learnedPrompt || evolvedCorePrompt || basePrompt || assistantPrompt);
      if (hasContext) {
        const tools = listAllCapabilities(orchestrator.getTools());
        const skills = getDiscoveredSkills(userId);
        const caps =
          capabilities ??
          (USE_CONDENSED_SYSTEM_PROMPT
            ? formatCapabilitiesSummaryCondensed(tools) + formatSkillsSummary(skills, true)
            : formatCapabilitiesSummary(tools) + formatSkillsSummary(skills));
        const isUtilityScene = sceneId === 'intent_classify' || sceneId === 'extract_clean_content' || sceneId === 'editor_agent' || sceneId === 'edit_current_document';
        const baseSystemPrompt = getAssembledSystemPrompt({
          scene: (sceneId ?? 'none') as any,
          promptMode: isUtilityScene ? 'minimal' : 'full',
          basePrompt,
          capabilities: caps,
          computerContext,
          taskSummary,
          memory,
          learnedPrompt,
          evolvedCorePrompt,
          assistantPrompt: sceneId !== 'x_direct' ? assistantPrompt : '',
        });
        const systemPrompt = isUtilityScene
          ? baseSystemPrompt
          : baseSystemPrompt + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE;
        chatMessages = [{ role: 'system', content: systemPrompt }, ...chatMessages.filter((m) => m.role !== 'system')];
      }

      const llmConfig = { providerId, modelId, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined };
      /** 本轮请求中所有工具调用记录（服务端执行的 + 最终返回给前端的），供前端展示调用过程 */
      const toolCallHistory: Array<{ id: string; name: string; input: Record<string, unknown>; output?: unknown; error?: string; duration?: number }> = [];

      let result = await callLLMWithTools(
        { messages: chatMessages, providerId, modelId, baseUrl, apiKey },
        finalTools,
      );
      const maxToolSteps = 5;
      let steps = 0;
      while (result.toolCalls.length > 0 && steps < maxToolSteps) {
        const serverCalls = result.toolCalls.filter((tc) => !clientToolNames.has(tc.name));
        if (serverCalls.length === 0) break;
        const toolResults = await orchestrator.executeToolCalls(serverCalls, { llmConfig, userId });
        for (let i = 0; i < serverCalls.length; i++) {
          const tc = serverCalls[i];
          const tr = toolResults[i];
          const startedAt = tr && 'startedAt' in tr ? (tr as { startedAt: number }).startedAt : undefined;
          const completedAt = tr && 'completedAt' in tr ? (tr as { completedAt: number }).completedAt : undefined;
          const duration = startedAt != null && completedAt != null ? completedAt - startedAt : undefined;
          toolCallHistory.push({
            id: tc.id,
            name: tc.name,
            input: (tc.arguments || {}) as Record<string, unknown>,
            output: tr?.output,
            error: tr?.error,
            duration,
          });
        }
        chatMessages.push({
          role: 'assistant',
          content: result.content ?? '',
          tool_calls: result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments || {} })),
        });
        for (let i = 0; i < serverCalls.length; i++) {
          const tr = toolResults[i];
          const content = tr?.error != null ? JSON.stringify({ error: tr.error }) : JSON.stringify(tr?.output ?? null);
          chatMessages.push({ role: 'tool', content, tool_call_id: serverCalls[i].id });
        }
        result = await callLLMWithTools({ messages: chatMessages, providerId, modelId, baseUrl, apiKey }, finalTools);
        steps++;
      }

      for (const tc of result.toolCalls) {
        toolCallHistory.push({
          id: tc.id,
          name: tc.name,
          input: (tc.arguments || {}) as Record<string, unknown>,
          output: undefined,
          error: undefined,
          duration: undefined,
        });
      }

      const tcSummary = result.toolCalls.length
        ? result.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`).join('; ')
        : '(无工具调用)';
      const contentPreview = (result.content || '').slice(0, 200);
      serverLogger.info('chat/with-tools', `完成 toolCalls=${result.toolCalls.length}: ${tcSummary}`, `content预览: ${contentPreview}`);

      if (result.toolCalls.length === 0 && result.content) {
        serverLogger.warn('chat/with-tools', `模型未调用任何工具，仅返回文本回复`, `完整回复: ${result.content}`);
      }

      const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
      if (lastUser?.content?.trim() && result.content?.trim()) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? memoryService;
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = result.content.trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录（with-tools）', `userId=${uid}`);
            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: result.content.trim(),
              providerId,
              modelId,
              baseUrl,
              apiKey,
              memoryService: memSvc,
              workspaceId: uid,
            });
          })().catch((err: any) => serverLogger.error('chat/with-tools (consider-capture)', err.message));
        });
      }

      res.json({ content: result.content, toolCalls: result.toolCalls, toolCallHistory });
    } catch (err: any) {
      serverLogger.error('chat/with-tools', `工具调用失败: ${err.message}`, err.stack);
      res.status(400).json({ error: err.message || 'LLM 调用失败' });
    }
  });

  /** 聊天 Agent 循环：带工具执行。可选 agentId：与指定智能体对话（用其 systemPrompt 与 toolNames）。 */
  router.post('/chat/agent', aiQuota, async (req, res) => {
    try {
      const { messages, providerId, modelId, baseUrl, apiKey, scene, computerContext, taskSummary, memory, agentId, referenceImagePaths, attachedFilePaths, loadedToolNames: reqLoadedTools } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
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
      };
      if (!Array.isArray(messages) || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 messages、providerId 或 modelId' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      if (userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId,
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }
      let systemPrompt: string;
      let allowedToolNames: string[] | undefined;
      if (agentId && userId && userId !== 'anonymous') {
        const list = await loadAgentsFromDb(userId);
        const agent = list.find((a) => a.id === agentId);
        if (!agent) {
          res.status(400).json({ error: '未找到该智能体' });
          return;
        }
        systemPrompt = agent.systemPrompt + '\n\n' + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE;
        allowedToolNames = agent.toolNames?.length ? agent.toolNames : undefined;
      } else {
        const toolLoadingMode = getToolLoadingMode();
        const onDemand = toolLoadingMode === 'on_demand';
        const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt] = await Promise.all([
          getLearnedPromptForUser(userId),
          getEvolvedCorePromptForUser(userId),
          getBasePromptForUser(userId),
          getAssistantPromptForUser(userId),
        ]);
        const sceneId = scene && ['normal_chat', 'none'].includes(scene) ? scene : 'normal_chat';
        const caps = onDemand
          ? ''
          : USE_CONDENSED_SYSTEM_PROMPT
            ? formatCapabilitiesSummaryCondensed(listAllCapabilities(orchestrator.getTools())) + formatSkillsSummary(getDiscoveredSkills(userId), true)
            : formatCapabilitiesSummary(listAllCapabilities(orchestrator.getTools())) + formatSkillsSummary(getDiscoveredSkills(userId));
        const baseSystemPrompt = getAssembledSystemPrompt({
          scene: sceneId as 'normal_chat' | 'none',
          promptMode: sceneId === 'none' ? 'minimal' : 'full',
          basePrompt,
          toolLoadingModeOnDemand: onDemand,
          capabilities: caps,
          computerContext,
          taskSummary,
          memory,
          learnedPrompt,
          evolvedCorePrompt,
          assistantPrompt,
        });
        systemPrompt = baseSystemPrompt + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE;
      }
      let chatMessages = messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }));
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages = truncateChatMessages(chatMessages);
      }
      chatMessages = chatMessages.filter((m) => m.role !== 'system');
      if (Array.isArray(referenceImagePaths) && referenceImagePaths.length > 0 && referenceImagePaths.length <= 3) {
        const lastUserIdx = [...chatMessages].reverse().findIndex((m) => m.role === 'user');
        if (lastUserIdx >= 0) {
          const idx = chatMessages.length - 1 - lastUserIdx;
          const pathsStr = referenceImagePaths.join('、');
          chatMessages[idx]!.content += `\n\n[用户附带了以下参考图（沙箱路径）。若需基于这些图修改、编辑、融合或生成，请使用 llm.edit_image 或 llm.generate_image 的 reference_images 参数传入：${pathsStr}]`;
        }
      }
      if (Array.isArray(attachedFilePaths) && attachedFilePaths.length > 0 && attachedFilePaths.length <= 10) {
        const lastUserIdx = [...chatMessages].reverse().findIndex((m) => m.role === 'user');
        if (lastUserIdx >= 0) {
          const idx = chatMessages.length - 1 - lastUserIdx;
          const pathsStr = attachedFilePaths.join('、');
          chatMessages[idx]!.content += `\n\n[用户附带了以下文件（沙箱路径），可直接使用 file.read 读取；若文件较大可先用 memory_embed_add 转向量再用 memory_search 检索相关内容：${pathsStr}]`;
        }
      }
      const llmConfig = {
        providerId,
        modelId,
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
      };
      const toolLoadingMode = !agentId ? getToolLoadingMode() : 'all';
      serverLogger.info('chat/agent', `POST /chat/agent [${providerId}/${modelId}] messages=${chatMessages.length}${agentId ? ` agentId=${agentId}` : ''} toolMode=${toolLoadingMode}`);
      const result = await orchestrator.runChatAgentLoop({
        messages: chatMessages,
        llmConfig,
        systemPrompt,
        maxSteps: 20,
        userId,
        allowedToolNames,
        toolLoadingMode: !agentId ? toolLoadingMode : undefined,
        initialLoadedToolNames: Array.isArray(reqLoadedTools) ? reqLoadedTools : undefined,
      });
      const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
      if (lastUser?.content?.trim() && result.content?.trim()) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? memoryService;
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = result.content.trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录（agent）', `userId=${uid}`);
            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: result.content.trim(),
              providerId,
              modelId,
              baseUrl,
              apiKey,
              memoryService: memSvc,
              workspaceId: uid,
            });
          })().catch((err: any) => serverLogger.error('chat/agent (consider-capture)', err.message));
        });
      }
      res.json({ content: result.content, ...(result.loadedToolNames?.length ? { loadedToolNames: result.loadedToolNames } : {}) });
    } catch (err: any) {
      serverLogger.error('chat/agent', err.message, err.stack);
      res.status(400).json({ error: err.message || 'LLM 调用失败' });
    }
  });

  /** 聊天 Agent 流式：SSE 推送工具调用进度及最终回复。可选 agentId：与指定智能体对话。 */
  router.post('/chat/agent/stream', aiQuota, async (req, res) => {
    try {
      const { messages, providerId, modelId, baseUrl, apiKey, scene, computerContext, taskSummary, memory, agentId, referenceImagePaths, attachedFilePaths, loadedToolNames: reqLoadedTools } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
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
      };
      if (!Array.isArray(messages) || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 messages、providerId 或 modelId' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      if (userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId,
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }
      let systemPrompt: string;
      let allowedToolNames: string[] | undefined;
      let sceneId: 'normal_chat' | 'x_direct' | 'none' = (scene && ['normal_chat', 'x_direct', 'none'].includes(scene) ? scene : 'normal_chat') as 'normal_chat' | 'x_direct' | 'none';
      if (agentId && userId && userId !== 'anonymous') {
        const list = await loadAgentsFromDb(userId);
        const agent = list.find((a) => a.id === agentId);
        if (!agent) {
          res.status(400).json({ error: '未找到该智能体' });
          return;
        }
        systemPrompt = agent.systemPrompt + '\n\n' + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE;
        allowedToolNames = agent.toolNames?.length ? agent.toolNames : undefined;
        sceneId = 'normal_chat';
      } else {
        const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt] = await Promise.all([
          getLearnedPromptForUser(userId),
          getEvolvedCorePromptForUser(userId),
          getBasePromptForUser(userId),
          getAssistantPromptForUser(userId),
        ]);
        const toolLoadingMode = getToolLoadingMode();
        const onDemand = toolLoadingMode === 'on_demand';
        const discoveredSkills = getDiscoveredSkills(userId);
        const tools = listAllCapabilities(orchestrator.getTools());
        const caps = onDemand
          ? ''
          : USE_CONDENSED_SYSTEM_PROMPT
            ? formatCapabilitiesSummaryCondensed(tools) + formatSkillsSummary(discoveredSkills, true)
            : formatCapabilitiesSummary(tools) + formatSkillsSummary(discoveredSkills);
        serverLogger.info(
          'chat/agent/stream',
          `注入系统提示: toolMode=${toolLoadingMode}${onDemand ? '' : ` capabilities + ${discoveredSkills.length} Skills`}`,
        );
        const baseSystemPrompt = getAssembledSystemPrompt({
          scene: sceneId,
          promptMode: sceneId === 'none' ? 'minimal' : 'full',
          basePrompt,
          toolLoadingModeOnDemand: onDemand,
          capabilities: caps,
          computerContext,
          taskSummary,
          memory,
          learnedPrompt,
          evolvedCorePrompt,
          assistantPrompt: sceneId !== 'x_direct' ? assistantPrompt : '',
        });
        systemPrompt = baseSystemPrompt + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE;
      }
      let chatMessages = messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }));
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages = truncateChatMessages(chatMessages);
      }
      chatMessages = chatMessages.filter((m) => m.role !== 'system');
      if (Array.isArray(referenceImagePaths) && referenceImagePaths.length > 0 && referenceImagePaths.length <= 3) {
        const lastUserIdx = [...chatMessages].reverse().findIndex((m) => m.role === 'user');
        if (lastUserIdx >= 0) {
          const idx = chatMessages.length - 1 - lastUserIdx;
          const pathsStr = referenceImagePaths.join('、');
          chatMessages[idx]!.content += `\n\n[用户附带了以下参考图（沙箱路径）。若需基于这些图修改、编辑、融合或生成，请使用 llm.edit_image 或 llm.generate_image 的 reference_images 参数传入：${pathsStr}]`;
        }
      }
      if (Array.isArray(attachedFilePaths) && attachedFilePaths.length > 0 && attachedFilePaths.length <= 10) {
        const lastUserIdx = [...chatMessages].reverse().findIndex((m) => m.role === 'user');
        if (lastUserIdx >= 0) {
          const idx = chatMessages.length - 1 - lastUserIdx;
          const pathsStr = attachedFilePaths.join('、');
          chatMessages[idx]!.content += `\n\n[用户附带了以下文件（沙箱路径），可直接使用 file.read 读取；若文件较大可先用 memory_embed_add 转向量再用 memory_search 检索相关内容：${pathsStr}]`;
        }
      }
      const llmConfig = {
        providerId,
        modelId,
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
      };
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      if (sceneId === 'x_direct') ensureDefaultScheduleForUser(userId ?? undefined);
      const write = (event: string, data: object) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        (res as any).flush?.();
      };
      const toolLoadingMode = !agentId ? getToolLoadingMode() : 'all';
      const result = await orchestrator.runChatAgentLoop({
        messages: chatMessages,
        llmConfig,
        systemPrompt,
        maxSteps: 50,
        userId,
        allowedToolNames,
        toolLoadingMode: !agentId ? toolLoadingMode : undefined,
        initialLoadedToolNames: Array.isArray(reqLoadedTools) ? reqLoadedTools : undefined,
        onToolEvent: (ev) => {
          if (ev.type === 'tool_start') {
            write('tool_start', ev);
          } else if (ev.type === 'tool_complete') {
            write('tool_complete', ev);
          }
        },
        onContentChunk: (chunk) => {
          write('content_chunk', { content: chunk });
        },
      });
      write('done', { content: result.content, ...(result.loadedToolNames?.length ? { loadedToolNames: result.loadedToolNames } : {}) });
      if (sceneId === 'x_direct' && userId && userId !== 'anonymous') {
        const lastUserMessage =
          [...chatMessages].reverse().find((m) => m.role === 'user')?.content?.trim() ?? '';
        fireHook('x_chat_round_complete', {
          userId,
          lastUserMessage,
          lastAssistantContent: result.content ?? '',
        });
      }
      const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
      if (lastUser?.content?.trim() && result.content?.trim()) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? memoryService;
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = (result.content ?? '').trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录（agent/stream）', `userId=${uid}`);
            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: (result.content ?? '').trim(),
              providerId,
              modelId,
              baseUrl,
              apiKey,
              memoryService: memSvc,
              workspaceId: uid,
            });
          })().catch((err: any) => serverLogger.error('chat/agent/stream (consider-capture)', err.message));
        });
      }
    } catch (err: any) {
      serverLogger.error('chat/agent/stream', err.message, err.stack);
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      } else {
        res.status(400).json({ error: err.message || 'LLM 调用失败' });
      }
    } finally {
      res.end();
    }
  });

  /** 写作意图分类：使用主脑 intent_classify 场景，返回 intent 与可选的 suggestedPath */
  router.post('/chat/classify-writing-intent', async (req, res) => {
    try {
      const { userMessage, hasOpenAiDocument, providerId, modelId, baseUrl, apiKey } = req.body as {
        userMessage?: string;
        hasOpenAiDocument?: boolean;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      if (typeof userMessage !== 'string' || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 userMessage、providerId 或 modelId' });
        return;
      }
      const systemPrompt = getAssembledSystemPrompt({ scene: 'intent_classify', promptMode: 'minimal' });
      const userContent = `用户消息：「${userMessage}」
当前是否有打开的、由 AI 正在编辑的文档？${hasOpenAiDocument ? '是' : '否'}

请只输出上述 JSON，不要换行外的任何内容。`;
      let content: string;
      try {
        content = await callLLM({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
          providerId,
          modelId,
          baseUrl,
          apiKey,
        });
      } catch (llmErr: any) {
        const msg = llmErr?.message || '';
        const isConnectionError = /无法连接|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg);
        if (isConnectionError) {
          serverLogger.error('chat/classify-writing-intent', msg);
          res.json({ intent: 'normal_chat', fallback: true });
          return;
        }
        throw llmErr;
      }
      const raw = (content ?? '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      try {
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}') as { intent?: string; suggestedPath?: string | null };
        const intent =
          typeof parsed.intent === 'string' &&
          ['generate_image', 'generate_and_save_to_editor', 'save_to_editor', 'edit_current_document', 'normal_chat', 'create_task'].includes(parsed.intent)
            ? parsed.intent
            : 'normal_chat';
        let suggestedPath: string | null = parsed.suggestedPath ?? null;
        if (intent === 'generate_and_save_to_editor' && suggestedPath) {
          suggestedPath = String(suggestedPath).replace(/^\/+/, '').trim();
          if (!suggestedPath.startsWith('文档/')) suggestedPath = `文档/${suggestedPath}`;
        }
        res.json({
          intent,
          suggestedPath: intent === 'generate_and_save_to_editor' ? (suggestedPath || '文档/未命名.txt') : undefined,
        });
      } catch {
        res.json({ intent: 'normal_chat' });
      }
    } catch (err: any) {
      serverLogger.error('chat/classify-writing-intent', err.message, err.stack);
      res.status(400).json({ error: err.message || '分类失败' });
    }
  });

  /** 建议追问：根据最近一轮用户问题与 AI 回复，生成 2～4 个用户可能想问的追问。用于 AI 助手回复后展示可点击的追问建议。 */
  const FOLLOW_UP_SYSTEM_PROMPT = `你是一个助手。根据下面的「用户问题」和「AI 回复」，列出 2～4 个用户可能会追问的简短问题。
要求：每行只输出一个问题，不要编号、不要引号、不要其他解释。问题要具体、可操作，长度尽量控制在一行内。`;
  router.post('/chat/suggest-follow-ups', async (req, res) => {
    try {
      const { userMessage, assistantReply, providerId, modelId, baseUrl, apiKey } = req.body as {
        userMessage?: string;
        assistantReply?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      const userMsg = typeof userMessage === 'string' ? userMessage.trim() : '';
      const assistantMsg = typeof assistantReply === 'string' ? assistantReply.trim() : '';
      if (!userMsg || !assistantMsg) {
        return res.json({ suggestions: [] });
      }
      const userId = (req as { userId?: string }).userId;
      let llmProviderId = providerId;
      let llmModelId = modelId;
      let llmBaseUrl = baseUrl;
      let llmApiKey = apiKey;
      if (!llmProviderId || !llmModelId) {
        const cfg = await getLLMConfigForScheduler(userId ?? '');
        if (cfg) {
          llmProviderId = cfg.providerId;
          llmModelId = cfg.modelId;
          llmBaseUrl = cfg.baseUrl;
          llmApiKey = cfg.apiKey;
        }
      }
      if (!llmProviderId || !llmModelId) {
        return res.json({ suggestions: [] });
      }
      const userContent = `用户问题：\n${userMsg}\n\nAI 回复：\n${assistantMsg.slice(0, 3000)}${assistantMsg.length > 3000 ? '…' : ''}`;
      const raw = await callLLM({
        messages: [
          { role: 'system', content: FOLLOW_UP_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        providerId: llmProviderId,
        modelId: llmModelId,
        baseUrl: llmBaseUrl,
        apiKey: llmApiKey,
      });
      const lines = (raw ?? '')
        .split(/\n/)
        .map((s) => s.replace(/^[\d.)\-\*]\s*/, '').trim())
        .filter((s) => s.length > 0 && s.length <= 120);
      const suggestions = lines.slice(0, 4);
      res.json({ suggestions });
    } catch (err: any) {
      serverLogger.warn('chat/suggest-follow-ups', err?.message ?? '生成追问建议失败');
      res.json({ suggestions: [] });
    }
  });

  /** 任务完成后 AI 助手回复：根据任务结果生成「任务完成了，根据结果xxxx，我xxxx」风格摘要，供对话框追加消息 */
  const TASK_COMPLETION_REPLY_PROMPT = `你是 X-Computer AI 助手。用户之前在对话中请求了某项任务，任务已执行完毕。请根据以下信息，以第一人称用自然、简洁的中文回复用户。

要求：
1. 开头说明任务已完成或失败
2. 简要总结根据结果做了什么（或失败原因）
3. 语气友好，控制在 2～4 句话内
4. 不要重复用户原话，直接给出结论`;
  router.post('/chat/task-completion-reply', async (req, res) => {
    try {
      const { sessionId, taskId, userMessage, task } = req.body as {
        sessionId?: string;
        taskId?: string;
        userMessage?: string;
        task?: { title?: string; description?: string; status?: string; result?: { success?: boolean; output?: unknown; error?: string }; steps?: Array<{ action?: string; output?: unknown; error?: string }> };
      };
      if (!taskId || !task) {
        res.status(400).json({ error: '缺少 taskId 或 task' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      let llmProviderId: string | undefined;
      let llmModelId: string | undefined;
      let llmBaseUrl: string | undefined;
      let llmApiKey: string | undefined;
      const cfg = await getLLMConfigForScheduler(userId ?? '');
      if (cfg) {
        llmProviderId = cfg.providerId;
        llmModelId = cfg.modelId;
        llmBaseUrl = cfg.baseUrl;
        llmApiKey = cfg.apiKey;
      }
      if (!llmProviderId || !llmModelId) {
        res.status(400).json({ error: '请先在系统设置中配置大模型' });
        return;
      }
      const success = task.result?.success ?? false;
      const output = task.result?.output;
      const errMsg = task.result?.error;
      const outputStr =
        output != null
          ? typeof output === 'string'
            ? output
            : JSON.stringify(output)
          : '';
      const stepsSummary =
        task.steps && task.steps.length > 0
          ? task.steps
              .slice(0, 8)
              .map((s, i) => {
                const action = s.action ?? `步骤${i + 1}`;
                const out = s.output != null ? (typeof s.output === 'string' ? s.output : JSON.stringify(s.output)).slice(0, 200) : '';
                return `- ${action}: ${out || (s.error ?? '未完成')}`;
              })
              .join('\n')
          : '';
      const userContent = [
        `用户请求：${userMessage ?? task.description ?? task.title ?? '（未记录）'}`,
        `任务：${task.title ?? task.description ?? '（无标题）'}`,
        success ? `结果：成功\n输出：\n${outputStr.slice(0, 2000)}` : `结果：失败\n原因：${errMsg ?? '未知'}`,
        stepsSummary ? `执行步骤摘要：\n${stepsSummary}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const content = await callLLM({
        messages: [
          { role: 'system', content: TASK_COMPLETION_REPLY_PROMPT },
          { role: 'user', content: userContent },
        ],
        providerId: llmProviderId,
        modelId: llmModelId,
        baseUrl: llmBaseUrl,
        apiKey: llmApiKey,
      });
      res.json({ content: content?.trim() ?? (success ? '任务已完成。' : '任务执行失败。') });
    } catch (err: any) {
      serverLogger.error('chat/task-completion-reply', err.message, err.stack);
      res.status(400).json({ error: err.message || '生成任务完成回复失败' });
    }
  });

  /** 图片生成：使用配置的 image 模态模型，根据用户描述生成图片（OpenRouter/OpenAI 兼容 modalities: ["image"]） */
  router.post('/chat/generate-image', aiQuota, async (req, res) => {
    try {
      const { prompt, providerId, modelId, baseUrl, apiKey } = req.body as {
        prompt?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      if (typeof prompt !== 'string' || !prompt.trim() || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 prompt、providerId 或 modelId' });
        return;
      }
      const result = await callLLMGenerateImage({
        messages: [{ role: 'user', content: prompt.trim() }],
        providerId,
        modelId,
        baseUrl,
        apiKey,
      });
      res.json({ content: result.content, images: result.images });
    } catch (err: any) {
      serverLogger.error('chat/generate-image', err.message, err.stack);
      res.status(400).json({ error: err.message || '图片生成失败' });
    }
  });

  /** 编辑器 Agent 流式写入：主 AI 对话驱动，由「编辑器 Agent」根据 instruction 生成内容并实时推送到指定编辑器窗口（WebSocket editor_stream） */
  router.post('/chat/editor-agent-stream', aiQuota, async (req, res) => {
    try {
      const { windowId, instruction, providerId, modelId, baseUrl, apiKey } = req.body as {
        windowId?: string;
        instruction?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      if (!windowId || typeof instruction !== 'string' || !providerId || !modelId) {
        serverLogger.warn('editor-agent-stream', '参数不完整', JSON.stringify({ windowId: !!windowId, instruction: typeof instruction, providerId: !!providerId, modelId: !!modelId }));
        res.status(400).json({ error: '缺少 windowId、instruction、providerId 或 modelId' });
        return;
      }

      serverLogger.info('editor-agent-stream', `开始 [${providerId}/${modelId}] windowId=${windowId}`, instruction.slice(0, 80));

      res.setHeader('Content-Type', 'application/json');
      res.status(202).json({ ok: true, windowId }); // 先返回接受，流通过 WS 推送
      res.end();

      const systemPrompt = getAssembledSystemPrompt({ scene: 'editor_agent', promptMode: 'minimal' });
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: instruction },
      ];
      try {
        for await (const chunk of callLLMStream({
          messages,
          providerId,
          modelId,
          baseUrl,
          apiKey,
        })) {
          broadcast({ type: 'editor_stream', data: { windowId, chunk } });
        }
      } catch (err: any) {
        serverLogger.error('editor-agent-stream', `流式生成失败: ${err.message}`, err.stack);
        broadcast({ type: 'editor_stream_error', data: { windowId, error: err.message || '生成失败' } });
      }
      broadcast({ type: 'editor_stream_end', data: { windowId } });
      serverLogger.info('editor-agent-stream', `结束 windowId=${windowId}`);
    } catch (err: any) {
      serverLogger.error('editor-agent-stream', `请求处理失败: ${err.message}`, err.stack);
      if (!res.headersSent) res.status(400).json({ error: err.message || '请求失败' });
    }
  });

  // ── Health ───────────────────────────────────────────────

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      tasks: orchestrator.getAllTasks().length,
      auditEntries: audit.count,
    });
  });

  return router;
}
