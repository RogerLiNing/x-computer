import { Router } from 'express';
import {randomUUID} from 'node:crypto';
import { callLLM, callLLMStream, callLLMWithTools, callLLMGenerateImage, type LLMToolDef, type ChatMessage } from '../chat/chatService.js';
import { chatRateLimit } from '../middleware/chatRateLimit.js';
import { getAssembledSystemPrompt, CORE_SYSTEM_PROMPT, formatCapabilitiesSummary, formatCapabilitiesSummaryCondensed, formatSkillsSummary, MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT, TOOL_USE_MANDATE, MEMORY_TOOL_MANDATE, buildTimelineContext } from '../prompts/systemCore.js';
import { listAllCapabilities } from '../capabilities/CapabilityRegistry.js';
import { getDiscoveredSkills } from '../skills/discovery.js';
import { loadAgentsFromDb } from './agents.js';
import { ensureUserMcpLoaded } from '../mcp/loadAndRegister.js';
import { loadDefaultConfig, getToolLoadingMode } from '../config/defaultConfig.js';
import { truncateChatMessages, MAX_CHAT_MESSAGES } from '../utils/chatContext.js';
import { callEmbedding } from '../memory/embeddingService.js';
import { fire as fireHook } from '../hooks/HookRegistry.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { aiCallsQuota } from '../subscription/quotaMiddleware.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { VectorStore } from '../memory/vectorStore.js';
import { MemoryService } from '../memory/MemoryService.js';
import { resolveLLMCredentials } from '../llm/credentialResolver.js';
import {
  buildTextArtifactDeliveryInstruction,
  isSchedulingTool,
  inspectTextArtifactCompletion,
  extractTextArtifactBody,
  resolveInitialLoadedTools,
  resolveRequestedTextArtifactPath,
} from '../chat/xDirectToolPolicy.js';
import { classifyAssistantIntentFast } from '../chat/assistantIntent.js';
import { ChatRunService, ChatRunBlockedError } from '../chat/ChatRunService.js';
import type { TaskLLMConfig } from '../../../shared/src/index.js';

// ── Constants and helpers also used in api.ts ─────────────────────────────────

const MEMORY_DIR = 'memory';

async function completeTextArtifact(params: { content: string; request: string; toolContext: string; llmConfig: TaskLLMConfig; signal?: AbortSignal }): Promise<string> {
  let content = extractTextArtifactBody(params.content);
  const check = inspectTextArtifactCompletion(params.request, content);
  if (!check.complete) {
    const correction = check.rewrite
      ? '请按原始要求重写一份完整正文，严格满足总字数与结构要求。只输出一次正文，不要输出文件名、字数统计、解释或保存说明，不编造事实或来源。'
      : '你是研究报告的交付完整性编辑器。只补充草稿缺失的尾部章节，不重复已有正文、不解释过程。补充内容控制在2200个中文字符以内，必须完整结束。来源链接使用[标题](https://...)，优先采用实际搜索结果。';
    const edited = extractTextArtifactBody(await callLLM({ ...params.llmConfig, signal: params.signal, messages: [
      { role: 'system', content: correction },
      { role: 'user', content: `原始请求：\n${params.request}\n当前缺失项：\n${check.missing.join('\n')}\n现有草稿：\n${content}\n实际工具检索结果：\n${params.toolContext || '无'}` },
    ] })).trim();
    if (edited) content = check.rewrite ? edited : `${content.trim()}\n\n${edited}`;
  }
  const final = inspectTextArtifactCompletion(params.request, content);
  if (!final.complete) throw new ChatRunBlockedError(`交付校验未通过：${final.missing.join('、')}`);
  return content;
}

/**
 * 内容质量预检：跳过太短、纯确认/寒暄的消息，避免无意义记忆浪费 LLM 调用。
 * 与 MemoryService.isWorthRemembering 互补：这里用于决定是否触发 runConsiderCapture。
 */
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

  // 质量门槛：内容必须有足够上下文，不能是孤零零的词
  // 至少需要 8 字符，且内容中应包含足够的描述性词语（如"用户"、"喜欢"、"决定"等）
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

// ── getLLMConfigForScheduler (also used in api.ts) ─────────────────────────────

const USE_CONDENSED_SYSTEM_PROMPT = process.env.X_COMPUTER_SYSTEM_PROMPT_CONDENSED !== 'false';

/** 统一凭证查找：委托给 credentialResolver，保留 getLLMConfigForScheduler 签名供其他模块使用 */
async function getLLMConfigForScheduler(
  uid: string,
  db: AppDatabase | undefined,
  subscriptionService: SubscriptionService | undefined,
  overrides?: { providerId?: string; modelId?: string },
) {
  return resolveLLMCredentials(uid, db as any, subscriptionService, overrides);
}

// ── Chat Router ────────────────────────────────────────────────────────────────

export function createChatRouter(
  orchestrator: AgentOrchestrator,
  sandboxFS: SandboxFS,
  aiQuota: (req: any, res: any, next: any) => void,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
  subscriptionService?: SubscriptionService,
  getLivingAIContext?: (userId: string) => Promise<string>,
  onRunsReady?: (runs: ChatRunService) => void,
): Router {
  const router = Router();

  router.use('/chat', (req, res, next) => req.path.startsWith('/runs') ? next() : chatRateLimit(req, res, next));

  const vectorStore = new VectorStore(sandboxFS);
  const defaultMemoryService = new MemoryService(sandboxFS, vectorStore);
  const runs = db ? new ChatRunService({
    db, orchestrator,modelBudget:subscriptionService,
    getSandboxFS: async (userId) => userSandboxManager ? (await userSandboxManager.getForUser(userId)).sandboxFS : sandboxFS,
    getLLMConfig: (userId, providerId, modelId) => getChatLLMConfig(userId, providerId, modelId),
    completeText: completeTextArtifact,
  }) : undefined;
  if (runs) onRunsReady?.(runs);
  if(runs)orchestrator.setExpertDispatchRunner?.(request=>runs.expertDispatch(request));
  async function runIdentity(body:{sessionId?:unknown;requestId?:unknown},userId:string,scene:unknown,title:string){
    if(body.sessionId!==undefined||body.requestId!==undefined){
      if(typeof body.sessionId!=='string'||!body.sessionId.trim()||typeof body.requestId!=='string'||!body.requestId||body.requestId.length>128)return null;
      return{sessionId:body.sessionId,requestId:body.requestId};
    }
    const session=await db!.createSession(userId,title.slice(0,80)||'助手交办',typeof scene==='string'?scene:'normal_chat');
    return{sessionId:session.id,requestId:randomUUID()};
  }

  router.get('/chat/runs', async (req, res) => {
    try {
      if (!runs || typeof req.query.sessionId !== 'string') { res.status(400).json({ error: '缺少有效会话' }); return; }
      res.json({ runs: await runs.list(req.userId, req.query.sessionId) });
    } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  router.post('/chat/runs/stop-request', async (req, res) => {
    try {
      if (!runs || typeof req.body?.sessionId !== 'string' || typeof req.body?.requestId !== 'string') {
        res.status(400).json({ error: '缺少会话和交办编号' }); return;
      }
      res.json(await runs.stopRequest(req.userId, req.body.sessionId, req.body.requestId));
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  router.get('/chat/runs/attention', async(req,res)=>{
    try {if(!runs) throw new Error('执行服务不可用');res.json({items:await runs.attention(req.userId)});}
    catch(error){res.status(503).json({error:error instanceof Error?error.message:String(error)});}
  });
  router.get('/chat/runs/workbench', async(req,res)=>{
    try {if(!runs) throw new Error('执行服务不可用');res.json(await runs.workbench(req.userId));}
    catch(error){res.status(503).json({error:error instanceof Error?error.message:String(error)});}
  });
  router.post('/chat/runs/:runId/review',async(req,res)=>{
    try {if(!runs) throw new Error('执行服务不可用');res.json(await runs.reviewRun(req.userId,req.params.runId,req.body));}
    catch(error){res.status(409).json({error:error instanceof Error?error.message:String(error)});}
  });
  router.post('/chat/runs/:runId/shell-decision',async(req,res)=>{
    try{if(!runs)throw new Error('执行服务不可用');if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new Error('确认参数无效');res.status(202).json(await runs.decideShell(req.userId,req.params.runId,req.body));}
    catch(error){res.status(409).json({error:error instanceof Error?error.message:'命令决定未保存，请刷新核查'});}
  });
  router.post('/chat/runs/:runId/answer', async (req, res) => {
    try {
      if (!runs) throw new Error('执行服务不可用');
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('回答参数无效');
      res.status(202).json(await runs.answerQuestion(req.userId, req.params.runId, req.body));
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : '回答未保存，请刷新核查' }); }
  });
  router.post('/chat/runs/:runId/send-decision', async (req, res) => {
    try {
      if (!runs) throw new Error('执行服务不可用');
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('确认参数无效');
      res.status(202).json(await runs.decideSend(req.userId, req.params.runId, req.body));
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : '发送决定未保存，请刷新核查' }); }
  });
  router.post('/chat/runs/:runId/revise',aiQuota,async(req,res)=>{
    try {if(!runs) throw new Error('执行服务不可用');res.status(202).json(await runs.revise(req.userId,req.params.runId));}
    catch(error){res.status(409).json({error:error instanceof Error?error.message:String(error)});}
  });
  router.get('/chat/runs/:runId', async (req, res) => {
    try {
      if (!runs) { res.status(503).json({ error: '执行记录服务不可用' }); return; }
      res.json(await runs.get(req.userId, req.params.runId));
    } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  router.post('/chat/runs/:runId/stop', async (req, res) => {
    try {
      if (!runs) { res.status(503).json({ error: '执行记录服务不可用' }); return; }
      res.json(await runs.stop(req.userId, req.params.runId));
    } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  router.post('/chat/runs/:runId/resume', aiQuota, async (req, res) => {
    try {
      if (!runs) { res.status(503).json({ error: '执行记录服务不可用' }); return; }
      res.status(202).json(await runs.resume(req.userId, req.params.runId));
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  });

  async function getLivingContext(userId: string | undefined, scene: unknown): Promise<string> {
    if (!getLivingAIContext || !userId || userId === 'anonymous' || (scene !== 'x_direct' && scene !== 'normal_chat')) return '';
    try {
      return await getLivingAIContext(userId);
    } catch (error) {
      serverLogger.warn(
        'chat/living-ai',
        '读取连续认知状态失败',
        error instanceof Error ? error.message : String(error),
      );
      return '';
    }
  }

  /**
   * 获取当前对话的 LLM 凭证（服务器端凭证查找，不从请求体取 apiKey）。
   * 优先级：pro 用户自定义配置 > 服务器默认配置 > 环境变量
   */
  async function getChatLLMConfig(userId: string, providerId: string, modelId: string) {
    const creds = await resolveLLMCredentials(userId, db, subscriptionService, { providerId, modelId });
    if (!creds) {
      throw new Error('未配置大模型，请联系管理员配置 .x-config.json 或设置 OPENROUTER_API_KEY 环境变量');
    }
    return creds;
  }

  /** 按用户取 MemoryService（多用户时用该用户沙箱，否则用默认） */
  async function getMemoryServiceForUser(userId: string | undefined): Promise<MemoryService | null> {
    if (!userId || userId === 'anonymous' || !userSandboxManager) return null;
    const { sandboxFS: userFs } = await userSandboxManager.getForUser(userId);
    return new MemoryService(userFs, vectorStore);
  }

  /** 取当前用户「从对话中学习到的规则与偏好」文本 */
  async function getLearnedPromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    const svc = mem ?? defaultMemoryService;
    return svc.readLearnedPrompt();
  }

  /** 取当前用户的长期记忆有效条目与主题目录 */
  async function getMemoryIndexForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    if (!mem) return '';
    try { return await mem.promptMemory(); } catch { return ''; }
  }

  /** 取当前用户「AI 自我进化的核心提示词」片段 */
  async function getEvolvedCorePromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    const svc = mem ?? defaultMemoryService;
    await svc.ensureEvolvedCorePromptExists();
    return svc.readEvolvedCorePrompt();
  }

  /** 取当前用户「可完全替换的基础系统提示词」 */
  async function getBasePromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    if (!mem) return '';
    await mem.ensureBasePromptExists(CORE_SYSTEM_PROMPT);
    return mem.readBasePrompt();
  }

  /** 取当前用户「AI 助手专用说明」 */
  async function getAssistantPromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    if (!mem) return '';
    await mem.ensureAssistantPromptExists();
    return mem.readAssistantPrompt();
  }

  // ── Chat (P2: 普通对话走真实 LLM，支持 scene 注入主脑提示) ───

  router.post('/chat', aiQuota, async (req, res) => {
    try {
      const { messages, providerId, modelId, stream, scene, capabilities, computerContext, taskSummary, memory, vectorConfig } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
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

      const userId = (req as { userId?: string }).userId ?? '';
      const llmConfig = await getChatLLMConfig(userId, providerId, modelId);
      serverLogger.info('chat', `POST /chat [${providerId}/${modelId}] messages=${messages.length} stream=${!!stream} scene=${scene ?? 'none'}`);

      const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt, timeline, livingContext, memoryIndex] = await Promise.all([
        getLearnedPromptForUser(userId),
        getEvolvedCorePromptForUser(userId),
        getBasePromptForUser(userId),
        getAssistantPromptForUser(userId),
        buildTimelineContext(db as any, userId),
        getLivingContext(userId, scene),
        getMemoryIndexForUser(userId),
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
          memoryIndex,
          evolvedCorePrompt,
          assistantPrompt: sceneId !== 'x_direct' ? assistantPrompt : '',
          timeline,
        });
        const continuousSystemPrompt = systemPrompt + (livingContext ? `\n\n${livingContext}` : '');
        chatMessages = [{ role: 'system', content: continuousSystemPrompt }, ...chatMessages.filter((m) => m.role !== 'system')];
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
            providerId: llmConfig.providerId,
            modelId: llmConfig.modelId,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
          })) {
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            (res as any).flush?.();
          }
          res.write('data: [DONE]\n\n');
          serverLogger.info('chat', `流式聊天完成 [${llmConfig.providerId}/${llmConfig.modelId}]`);
        } catch (err: any) {
          serverLogger.error('chat', `流式聊天失败 [${llmConfig.providerId}/${llmConfig.modelId}]: ${err.message}`, err.stack);
          res.write(`data: ${JSON.stringify({ error: err.message || 'LLM 流式调用失败' })}\n\n`);
        }
        res.end();
        return;
      }

      const content = await callLLM({
        messages: chatMessages,
        providerId: llmConfig.providerId,
        modelId: llmConfig.modelId,
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
      });
      serverLogger.info('chat', `聊天完成 [${llmConfig.providerId}/${llmConfig.modelId}] 回复长度=${content.length}`);
      const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
      if (shouldConsiderForMemory(lastUser?.content ?? '', content)) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? defaultMemoryService;

            // 每次聊天都简单记录到每日记忆（OpenClaw 风格），确保每日文件被创建
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = content.trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录', `userId=${uid}`);

            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: content.trim(),
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
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
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
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
      const { messages, providerId, modelId, tools: toolsBody, scene, capabilities, computerContext, taskSummary, memory } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
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
      let resolvedLLMConfig;
      try {
        resolvedLLMConfig = await getChatLLMConfig(userId ?? '', providerId, modelId);
      } catch (credsErr: any) {
        serverLogger.error('chat/with-tools', `获取 LLM 凭证失败: ${credsErr.message}`);
        res.status(500).json({ error: credsErr.message || 'LLM 凭证获取失败' });
        return;
      }
      if (userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId,
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }

      const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt, timeline, livingContext, memoryIndex] = await Promise.all([
        getLearnedPromptForUser(userId),
        getEvolvedCorePromptForUser(userId),
        getBasePromptForUser(userId),
        getAssistantPromptForUser(userId),
        buildTimelineContext(db as any, userId ?? ''),
        getLivingContext(userId, scene),
        getMemoryIndexForUser(userId),
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
          memoryIndex,
          evolvedCorePrompt,
          assistantPrompt: sceneId !== 'x_direct' ? assistantPrompt : '',
          timeline,
        });
        const systemPrompt = isUtilityScene
          ? baseSystemPrompt
          : baseSystemPrompt + (livingContext ? `\n\n${livingContext}` : '') + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE;
        chatMessages = [{ role: 'system', content: systemPrompt }, ...chatMessages.filter((m) => m.role !== 'system')];
      }

      const llmConfig = resolvedLLMConfig;
      /** 本轮请求中所有工具调用记录（服务端执行的 + 最终返回给前端的），供前端展示调用过程 */
      const toolCallHistory: Array<{ id: string; name: string; input: Record<string, unknown>; output?: unknown; error?: string; duration?: number }> = [];

      let result = await callLLMWithTools(
        { messages: chatMessages, providerId: llmConfig.providerId, modelId: llmConfig.modelId, baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey },
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
        result = await callLLMWithTools({ messages: chatMessages, providerId: llmConfig.providerId, modelId: llmConfig.modelId, baseUrl: llmConfig.baseUrl, apiKey: llmConfig.apiKey }, finalTools);
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
      if (shouldConsiderForMemory(lastUser?.content ?? '', result.content ?? '')) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? defaultMemoryService;
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = result.content.trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录（with-tools）', `userId=${uid}`);
            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: result.content.trim(),
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
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
      const { messages, providerId, modelId, scene, computerContext, taskSummary, memory, agentId, referenceImagePaths, attachedFilePaths, loadedToolNames: reqLoadedTools } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
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
      // 确保用户记录存在
      if (db && userId) {
        await db.ensureUser(userId);
      }
      if (userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId ?? 'anonymous',
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }
      let resolvedLLMConfig;
      try {
        resolvedLLMConfig = await getChatLLMConfig(userId ?? '', providerId, modelId);
      } catch (credsErr: any) {
        serverLogger.error('chat/agent', `获取 LLM 凭证失败: ${credsErr.message}`);
        res.status(500).json({ error: credsErr.message || 'LLM 凭证获取失败' });
        return;
      }
      let systemPrompt: string;
      let allowedToolNames: string[] | undefined;
      if (agentId && userId && userId !== 'anonymous') {
        const list = await loadAgentsFromDb(db, userId);
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
        const sceneId = scene && ['normal_chat', 'x_direct', 'none'].includes(scene) ? scene : 'normal_chat';
        const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt, timeline, livingContext, memoryIndex] = await Promise.all([
          getLearnedPromptForUser(userId),
          getEvolvedCorePromptForUser(userId),
          getBasePromptForUser(userId),
          getAssistantPromptForUser(userId),
          buildTimelineContext(db as any, userId),
          getLivingContext(userId, sceneId),
          getMemoryIndexForUser(userId),
        ]);
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
          memoryIndex,
          evolvedCorePrompt,
          assistantPrompt,
          timeline,
        });
        systemPrompt = baseSystemPrompt
          + (livingContext ? `\n\n${livingContext}` : '')
          + TOOL_USE_MANDATE
          + MEMORY_TOOL_MANDATE;
      }
      let chatMessages = messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }));
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages = truncateChatMessages(chatMessages);
      }
      chatMessages = chatMessages.filter((m) => m.role !== 'system');
      const lastUserMessage =
        [...chatMessages].reverse().find((m) => m.role === 'user')?.content?.trim() ?? '';
      const requestedTextArtifactPath = resolveRequestedTextArtifactPath(lastUserMessage);
      if (requestedTextArtifactPath) {
        systemPrompt += `\n\n${buildTextArtifactDeliveryInstruction(requestedTextArtifactPath)}`;
      }
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
      const llmConfig = resolvedLLMConfig;
      const toolLoadingMode = !agentId ? getToolLoadingMode() : 'all';
      serverLogger.info('chat/agent', `POST /chat/agent [${providerId}/${modelId}] messages=${chatMessages.length}${agentId ? ` agentId=${agentId}` : ''} toolMode=${toolLoadingMode}`);
      let persisted:Awaited<ReturnType<ChatRunService['get']>>|undefined,acceptedRequestId:string|undefined;
      if(runs&&userId&&userId!=='anonymous'){
        const identity=await runIdentity(req.body,userId,scene,lastUserMessage);
        if(!identity){res.status(400).json({error:'会话与请求编号需同时提供，或均省略以新建交办'});return;}
        acceptedRequestId=identity.requestId;
        const run=await runs.accept({userId,...identity,messages:chatMessages,providerId,modelId,systemPrompt,allowedToolNames,toolLoadingMode,
          initialLoadedToolNames:resolveInitialLoadedTools(scene,reqLoadedTools,lastUserMessage),requestedTextArtifactPath,
          userMessage:{content:lastUserMessage,images:referenceImagePaths,attachedFiles:Array.isArray(attachedFilePaths)?attachedFilePaths.filter((p):p is string=>typeof p==='string').map(p=>({name:p.split('/').pop()||p,path:p})):undefined}});
        await runs.launch(userId,run.id);persisted=await runs.get(userId,run.id);
      }
      const result = persisted??await orchestrator.runChatAgentLoop({
        messages: chatMessages,
        llmConfig,
        systemPrompt,
        maxSteps: 20,
        userId,
        allowedToolNames,
        toolLoadingMode: !agentId ? toolLoadingMode : undefined,
        initialLoadedToolNames: resolveInitialLoadedTools(scene, reqLoadedTools, lastUserMessage),
      });
      const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
      if ((!persisted||persisted.status==='completed')&&shouldConsiderForMemory(lastUser?.content ?? '', result.content ?? '')) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? defaultMemoryService;
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = result.content.trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录（agent）', `userId=${uid}`);
            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: result.content.trim(),
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
              memoryService: memSvc,
              workspaceId: uid,
            });
          })().catch((err: any) => serverLogger.error('chat/agent (consider-capture)', err.message));
        });
      }
      res.json({...(persisted?{...persisted,runId:persisted.id,requestId:acceptedRequestId,serverPersisted:true}:{}), content: persisted?.error?[result.content,persisted.error].filter(Boolean).join('\n\n'):result.content, ...(result.loadedToolNames?.length ? { loadedToolNames: result.loadedToolNames } : {}) });
    } catch (err: any) {
      serverLogger.error('chat/agent', err.message, err.stack);
      res.status(400).json({ error: err.message || 'LLM 调用失败' });
    }
  });

  /** 聊天 Agent 流式：SSE 推送工具调用进度及最终回复。可选 agentId：与指定智能体对话。 */
  router.post('/chat/agent/stream', aiQuota, async (req, res) => {
    try {
      const { messages, providerId, modelId, scene, computerContext, taskSummary, memory, agentId, referenceImagePaths, attachedFilePaths, loadedToolNames: reqLoadedTools, sessionId, requestId } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        providerId?: string;
        modelId?: string;
        scene?: string;
        computerContext?: string;
        taskSummary?: string;
        memory?: string;
        agentId?: string;
        referenceImagePaths?: string[];
        attachedFilePaths?: string[];
        loadedToolNames?: string[];
        sessionId?: string;
        requestId?: string;
      };
      if (!Array.isArray(messages) || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 messages、providerId 或 modelId' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      // 确保用户记录存在
      if (db && userId) {
        await db.ensureUser(userId);
      }
      if (userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId ?? 'anonymous',
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }
      let resolvedLLMConfig;
      try {
        resolvedLLMConfig = await getChatLLMConfig(userId ?? '', providerId, modelId);
      } catch (credsErr: any) {
        serverLogger.error('chat/agent/stream', `获取 LLM 凭证失败: ${credsErr.message}`);
        if (res.headersSent) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: credsErr.message })}\n\n`);
        } else {
          res.status(500).json({ error: credsErr.message || 'LLM 凭证获取失败' });
        }
        return;
      }
      let systemPrompt: string;
      let allowedToolNames: string[] | undefined;
      let sceneId: 'normal_chat' | 'x_direct' | 'none' = (scene && ['normal_chat', 'x_direct', 'none'].includes(scene) ? scene : 'normal_chat') as 'normal_chat' | 'x_direct' | 'none';
      if (agentId && userId && userId !== 'anonymous') {
        const list = await loadAgentsFromDb(db, userId);
        const agent = list.find((a) => a.id === agentId);
        if (!agent) {
          res.status(400).json({ error: '未找到该智能体' });
          return;
        }
        systemPrompt = agent.systemPrompt + '\n\n' + TOOL_USE_MANDATE + MEMORY_TOOL_MANDATE;
        allowedToolNames = agent.toolNames?.length ? agent.toolNames : undefined;
        sceneId = 'normal_chat';
      } else {
        const [learnedPrompt, evolvedCorePrompt, basePrompt, assistantPrompt, timeline, livingContext, memoryIndex] = await Promise.all([
          getLearnedPromptForUser(userId),
          getEvolvedCorePromptForUser(userId),
          getBasePromptForUser(userId),
          getAssistantPromptForUser(userId),
          buildTimelineContext(db as any, userId),
          getLivingContext(userId, sceneId),
          getMemoryIndexForUser(userId),
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
          memoryIndex,
          evolvedCorePrompt,
          assistantPrompt: sceneId !== 'x_direct' ? assistantPrompt : '',
          timeline,
        });
        systemPrompt = baseSystemPrompt
          + (livingContext ? `\n\n${livingContext}` : '')
          + TOOL_USE_MANDATE
          + MEMORY_TOOL_MANDATE;
      }
      let chatMessages = messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: String(m.content ?? ''),
      }));
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages = truncateChatMessages(chatMessages);
      }
      chatMessages = chatMessages.filter((m) => m.role !== 'system');
      const lastUserMessage =
        [...chatMessages].reverse().find((m) => m.role === 'user')?.content?.trim() ?? '';
      const requestedTextArtifactPath = resolveRequestedTextArtifactPath(lastUserMessage);
      if (requestedTextArtifactPath) {
        systemPrompt += `\n\n${buildTextArtifactDeliveryInstruction(requestedTextArtifactPath)}`;
      }
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
      const llmConfig = resolvedLLMConfig;
      if (sessionId||runs&&userId&&userId!=='anonymous') {
        if (!runs || !userId || userId === 'anonymous') {
          res.status(400).json({ error: '服务端交办需要有效的会话、用户和请求编号' }); return;
        }
        if (req.aborted || res.destroyed) return;
        const identity=await runIdentity({sessionId,requestId},userId,sceneId,lastUserMessage);
        if(!identity){res.status(400).json({error:'会话与请求编号需同时提供，或均省略以新建交办'});return;}
        const run = await runs.accept({ userId, ...identity, messages: chatMessages, providerId, modelId,
          systemPrompt: `${systemPrompt}\n\n# 成果交付\n生成文件后调用 file.present 交付已存在的文件，Shell/Python生成的文件同样需要交付。由服务器自动保存的文本产物直接输出正文即可。`,
          allowedToolNames, toolLoadingMode: !agentId ? getToolLoadingMode() : 'all',
          initialLoadedToolNames: [...new Set(['file.present', ...(resolveInitialLoadedTools(sceneId, reqLoadedTools, lastUserMessage) ?? [])])],
          requestedTextArtifactPath,
          userMessage: {
            content: typeof req.body.userMessage?.content === 'string' ? req.body.userMessage.content : [...messages].reverse().find((m) => m.role === 'user')?.content ?? lastUserMessage,
            images: Array.isArray(referenceImagePaths) ? referenceImagePaths.filter((p): p is string => typeof p === 'string') : undefined,
            attachedFiles: Array.isArray(req.body.userMessage?.attachedFiles)
              ? req.body.userMessage.attachedFiles.filter((f: { name?: unknown; path?: unknown }) => f && typeof f.name === 'string' && typeof f.path === 'string')
              : Array.isArray(attachedFilePaths) ? attachedFilePaths.filter((p): p is string => typeof p === 'string').map((p) => ({ name: p.split('/').pop() || p, path: p })) : undefined,
          } });
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        const send = (type: string, data: object) => {
          if (res.destroyed || res.writableEnded) return;
          res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
          (res as any).flush?.();
        };
        send('run_started', { ...run, runId: run.id,requestId:identity.requestId, serverPersisted: true });
        const unsubscribe = runs.subscribe(run.id, (event) => send(event.type, event.data));
        res.once('close', unsubscribe);
        try {
          const executed = await runs.launch(userId, run.id);
          const settled = await runs.get(userId, run.id);
          send('done', { ...settled, runId: run.id, serverPersisted: true });
          if (executed && settled.status === 'completed' && sceneId === 'x_direct') fireHook('x_chat_round_complete', {
            userId, lastUserMessage, lastAssistantContent: settled.content,
          });
          if (executed && settled.status === 'completed' && shouldConsiderForMemory(lastUserMessage, settled.content)) {
            setImmediate(() => {
              void (async () => {
                const memoryService = (await getMemoryServiceForUser(userId)) ?? defaultMemoryService;
                await memoryService.appendDaily(`[对话] 用户: ${lastUserMessage.slice(0, 100)}... | 助手: ${settled.content.slice(0, 200)}...`);
                await runConsiderCapture({ userMessage: lastUserMessage, assistantReply: settled.content,
                  providerId: llmConfig.providerId, modelId: llmConfig.modelId, baseUrl: llmConfig.baseUrl,
                  apiKey: llmConfig.apiKey, memoryService, workspaceId: userId });
              })().catch((error) => serverLogger.error('chat/run (consider-capture)', error instanceof Error ? error.message : String(error)));
            });
          }
        } finally { unsubscribe(); }
        return;
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      if (sceneId === 'x_direct') {
        // Fire hook for x_direct (ensureDefaultScheduleForUser is not available here;
        // the hook is fired after the agent loop if needed)
      }
      const write = (event: string, data: object) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        (res as any).flush?.();
      };
      const toolLoadingMode = !agentId ? getToolLoadingMode() : 'all';
      let attemptedSchedule = false;
      const result = await orchestrator.runChatAgentLoop({
        messages: chatMessages,
        llmConfig,
        systemPrompt,
        maxSteps: 50,
        userId,
        allowedToolNames,
        toolLoadingMode: !agentId ? toolLoadingMode : undefined,
        initialLoadedToolNames: resolveInitialLoadedTools(sceneId, reqLoadedTools, lastUserMessage),
        automaticTextDelivery: !!requestedTextArtifactPath,
        onToolEvent: (ev) => {
          if (ev.type === 'tool_start') {
            if (isSchedulingTool(ev.toolName)) attemptedSchedule = true;
            write('tool_start', ev);
          } else if (ev.type === 'tool_complete') {
            write('tool_complete', ev);
          }
        },
        onContentChunk: (chunk) => {
          write('content_chunk', { content: chunk });
        },
      });
      let deliveredContent = result.content;
      if (
        requestedTextArtifactPath
        && !attemptedSchedule
        && deliveredContent.trim()
        && userSandboxManager
        && userId
        && userId !== 'anonymous'
      ) {
        deliveredContent = await completeTextArtifact({ content: deliveredContent, request: lastUserMessage,
          toolContext: result.toolContext ?? '', llmConfig });
        const { sandboxFS: userFs } = await userSandboxManager.getForUser(userId);
        await userFs.writeOverwrite(requestedTextArtifactPath, deliveredContent.trim());
        deliveredContent = `${deliveredContent.trim()}\n\n---\n已保存到：${requestedTextArtifactPath}`;
        serverLogger.info(
          'chat/agent/stream',
          '已自动保存文本产物',
          `userId=${userId} path=${requestedTextArtifactPath} chars=${result.content.trim().length}`,
        );
      }
      write('done', { content: deliveredContent, ...(result.loadedToolNames?.length ? { loadedToolNames: result.loadedToolNames } : {}) });
      if (sceneId === 'x_direct' && userId && userId !== 'anonymous') {
        fireHook('x_chat_round_complete', {
          userId,
          lastUserMessage,
          lastAssistantContent: deliveredContent ?? '',
        });
      }
      const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
      if (shouldConsiderForMemory(lastUser?.content ?? '', deliveredContent ?? '')) {
        const uid = userId;
        setImmediate(() => {
          (async () => {
            const memSvc = (await getMemoryServiceForUser(uid)) ?? defaultMemoryService;
            const userMsgPreview = lastUser!.content.trim().slice(0, 100);
            const assistantPreview = (deliveredContent ?? '').trim().slice(0, 200);
            const dailyLogEntry = `[对话] 用户: ${userMsgPreview}... | 助手: ${assistantPreview}...`;
            await memSvc.appendDaily(dailyLogEntry);
            serverLogger.info('memory', '每日记忆已记录（agent/stream）', `userId=${uid}`);
            await runConsiderCapture({
              userMessage: lastUser!.content.trim(),
              assistantReply: (deliveredContent ?? '').trim(),
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
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

  /** 写作意图分类：高置信度规则走零模型快速路径，歧义请求才使用主脑分类。 */
  router.post('/chat/classify-writing-intent', async (req, res) => {
    try {
      const { userMessage, hasOpenAiDocument, providerId, modelId } = req.body as {
        userMessage?: string;
        hasOpenAiDocument?: boolean;
        providerId?: string;
        modelId?: string;
      };
      if (typeof userMessage !== 'string' || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 userMessage、providerId 或 modelId' });
        return;
      }
      const fastIntent = classifyAssistantIntentFast(userMessage, Boolean(hasOpenAiDocument));
      if (fastIntent) {
        res.json(fastIntent);
        return;
      }
      const userId = (req as { userId?: string }).userId ?? '';
      const creds = await getLLMConfigForScheduler(userId, db, subscriptionService, { providerId, modelId });
      if (!creds) {
        res.status(500).json({ error: '未配置大模型' });
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
          providerId: creds.providerId,
          modelId: creds.modelId,
          baseUrl: creds.baseUrl,
          apiKey: creds.apiKey,
          apiType: creds.apiType,
        });
      } catch (llmErr: any) {
        const msg = llmErr?.message || '';
        const isConnectionError = /无法连接|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg);
        if (isConnectionError) {
          serverLogger.error('chat/classify-writing-intent', msg);
          res.json({ intent: 'normal_chat', fallback: true, source: 'fallback' });
          return;
        }
        throw llmErr;
      }
      const raw = (content ?? '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      try {
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}') as { intent?: string; suggestedPath?: string | null };
        const parsedIntent =
          typeof parsed.intent === 'string' &&
          ['generate_image', 'generate_and_save_to_editor', 'save_to_editor', 'edit_current_document', 'normal_chat', 'create_task'].includes(parsed.intent)
            ? parsed.intent
            : 'normal_chat';
        const intent = parsedIntent === 'generate_and_save_to_editor' ? 'normal_chat' : parsedIntent;
        res.json({
          intent,
          source: 'model',
        });
      } catch {
        res.json({ intent: 'normal_chat', source: 'fallback' });
      }
    } catch (err: any) {
      serverLogger.error('chat/classify-writing-intent', err.message, err.stack);
      res.status(400).json({ error: err.message || '分类失败' });
    }
  });

  /** 建议追问：根据最近一轮用户问题与 AI 回复，生成 2～4 个用户可能想问的追问。用于 AI 助手回复后展示可点击的追问建议。 */
  const FOLLOW_UP_SYSTEM_PROMPT = `你是一个助手。根据下面的「用户问题」和「AI 回复」，列出 2～4 个用户可能会追问的简短问题。
要求：每行只输出一个问题，不要编号、不要引号、不要其他解释。问题要具体、可操作，长度尽量控制在一行内。`;
  router.post('/chat/suggest-follow-ups', aiQuota, async (req, res) => {
    try {
      const { userMessage, assistantReply, providerId, modelId } = req.body as {
        userMessage?: string;
        assistantReply?: string;
        providerId?: string;
        modelId?: string;
      };
      const userMsg = typeof userMessage === 'string' ? userMessage.trim() : '';
      const assistantMsg = typeof assistantReply === 'string' ? assistantReply.trim() : '';
      if (!userMsg || !assistantMsg) {
        return res.json({ suggestions: [] });
      }
      const userId = (req as { userId?: string }).userId ?? '';
      const creds = providerId && modelId
        ? await getLLMConfigForScheduler(userId, db, subscriptionService, { providerId, modelId })
        : await getLLMConfigForScheduler(userId, db, subscriptionService);
      if (!creds) {
        return res.json({ suggestions: [] });
      }
      const userContent = `用户问题：\n${userMsg}\n\nAI 回复：\n${assistantMsg.slice(0, 3000)}${assistantMsg.length > 3000 ? '…' : ''}`;
      const raw = await callLLM({
        messages: [
          { role: 'system', content: FOLLOW_UP_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        providerId: creds.providerId,
        modelId: creds.modelId,
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
        apiType: creds.apiType,
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
  router.post('/chat/task-completion-reply', aiQuota, async (req, res) => {
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
      const cfg = await getLLMConfigForScheduler(userId ?? '', db, subscriptionService);
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
      const { prompt, providerId, modelId } = req.body as {
        prompt?: string;
        providerId?: string;
        modelId?: string;
      };
      if (typeof prompt !== 'string' || !prompt.trim() || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 prompt、providerId 或 modelId' });
        return;
      }
      const userId = (req as { userId?: string }).userId ?? '';
      const creds = await getLLMConfigForScheduler(userId, db, subscriptionService, { providerId, modelId });
      if (!creds) {
        res.status(500).json({ error: '未配置大模型' });
        return;
      }
      const result = await callLLMGenerateImage({
        messages: [{ role: 'user', content: prompt.trim() }],
        providerId: creds.providerId,
        modelId: creds.modelId,
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
        apiType: creds.apiType,
      });
      res.json({ content: result.content, images: result.images });
    } catch (err: any) {
      serverLogger.error('chat/generate-image', err.message, err.stack);
      res.status(400).json({ error: err.message || '图片生成失败' });
    }
  });

  return router;
}
