import { canConfigureUserLLM } from '../llm/userConfigAccess.js';
import { EventEmitter } from 'events';
import {withModelBudget,currentModelBudgetSignal} from '../subscription/modelBudget.js';
import type {
  Task,
  TaskStep,
  ToolCall,
  CreateTaskRequest,
  TaskEvent,
  RuntimeType,
  ComputerContext,
  TaskLLMConfig,
  AgentDefinition,
} from '../../../shared/src/index.js';
import { ToolExecutor } from './ToolExecutor.js';
import { AuditLogger } from '../observability/AuditLogger.js';
import { createDefaultToolPipeline } from './pipeline/index.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AsyncDatabase } from '../db/database.js';
import type { MiniAppLogStore } from '../miniAppLogStore.js';
import type { EvolvedPromptService, GetRecentAssistantChat } from './ToolExecutor.js';
import { v4 as uuid } from 'uuid';
import { callLLMWithTools, callLLMWithToolsStream } from '../chat/chatService.js';
import type { ChatMessage, LLMToolCall } from '../chat/chatService.js';
import { fire as fireHook } from '../hooks/HookRegistry.js';
import { getCurrentAwareness } from '../prompts/systemCore.js';
import { getSpaceStore } from '../spaces/SpaceStore.js';
import { buildSpaceContext } from '../spaces/spaceContext.js';
import { broadcastToAppChannel } from '../wsBroadcast.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { filterToolsByPlan } from '../subscription/planToolFilter.js';
import type { ModelImage } from '../chat/chatService.js';
import { SEND_TOOLS, SendExecutionDeniedError, type SendTool } from '../tooling/sendApproval.js';
import { ShellExecutionDeniedError } from '../tooling/shellApproval.js';
import { getToolLoadingMode } from '../config/defaultConfig.js';
import type {ExpertDispatchRunner} from './tools/agent.js';

export interface BackgroundIntentInput {
  signal?:AbortSignal;
  intent: string; llmConfig: TaskLLMConfig; systemPrompt: string; userId: string;
  source?: 'scheduled_job' | 'signal_trigger' | 'run_now' | 'event_driven';
  sourceId?: string; title?: string; actionFingerprint?: string; metadata?: Record<string, unknown>;
}

function modelSelection(value: unknown): TaskLLMConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const config = value as TaskLLMConfig;
  if (typeof config.providerId !== 'string' || typeof config.modelId !== 'string') return undefined;
  return { providerId: config.providerId, modelId: config.modelId, apiType: config.apiType };
}

/** 工具事件类型，用于流式推送到前端展示 */
export type ChatToolEvent =
  | { type: 'tool_start'; id: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_complete'; id: string; toolName: string; output?: unknown; error?: string; duration: number }
  | { type: 'content'; content: string }
  | { type: 'done'; content: string };

/**
 * AgentOrchestrator — the central brain of the AI computer.
 *
 * Coordinates between planning, execution, policy enforcement, runtime isolation,
 * and audit logging. Supports interruption, resumption, and dual-mode execution.
 */

export class AgentOrchestrator extends EventEmitter {
  setExpertDispatchRunner(runner:ExpertDispatchRunner){this.executor.setExpertDispatchRunner(runner);}
  private executor: ToolExecutor;
  private audit: AuditLogger;

  private backgroundIntentRunner?: (input: BackgroundIntentInput) => Promise<{ content: string; runId?: string; sessionId?: string }>;
  setBackgroundIntentRunner(runner: (input: BackgroundIntentInput) => Promise<{ content: string; runId?: string; sessionId?: string }>): void { this.backgroundIntentRunner = runner; }

  private tasks = new Map<string, Task>();
  private abortControllers = new Map<string, AbortController>();
  private subscriptionService?: SubscriptionService;
  /** Latest computer context from frontend (windows, tasks summary, etc.) for AI awareness */
  private computerContexts = new Map<string, ComputerContext>();
  /** 供 X 派发智能体任务时获取用户 LLM 配置（由 createApiRouter 注入）。overrides 用于 agent 指定 provider/model。 */
  private getLLMConfigForAgent?: (
    userId: string,
    overrides?: { providerId?: string; modelId?: string }
  ) => Promise<{
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    apiType?: 'openai' | 'anthropic';
  } | null>;
  /** 用户请求取消当前群组执行时置 true，run_group 在每名成员间检查 */
  private groupRunCancelByUser = new Map<string, boolean>();

  constructor(
    audit: AuditLogger,
    sandboxFS?: SandboxFS,
    private userSandboxManager?: UserSandboxManager,
    private db?: AsyncDatabase,
    evolvedPromptService?: EvolvedPromptService,
    getRecentAssistantChat?: GetRecentAssistantChat,
    miniAppLogStore?: MiniAppLogStore,
    subscriptionService?: SubscriptionService,
  ) {
    super();
    this.audit = audit;
    this.subscriptionService = subscriptionService;
    this.executor = new ToolExecutor(
      sandboxFS,
      userSandboxManager,
      evolvedPromptService,
      getRecentAssistantChat,
      (params) => this.runCustomAgentLoop(params),
      miniAppLogStore,
      db,
    );
    this.executor.setPipeline(createDefaultToolPipeline({ audit }));
  }

  /** 启动后调用，从 DB 加载任务到内存。需在 createApp 中 await orchestrator.init() */
  async init(): Promise<void> {
    if (this.db) await this.loadTasksFromDb();
  }

  /** 由 createApiRouter 注入，用于 signal.emit 时触发用户配置的触发器 */
  setSignalFireHandler(handler: (userId: string, signal: string, payload?: object) => Promise<{ fired: number; skipped: number } | void>): void {
    this.executor.setSignalFireHandler(handler);
  }

  /** 由 createApiRouter 注入，用于 x.add/update/remove_mcp_server 后重载 MCP */
  private reloadMcpForUser?: (userId: string) => Promise<void>;

  /** 由 createApiRouter 注入，用于 x.run_agent 时获取用户 LLM 配置 */
  setGetLLMConfigForAgent(
    fn: (
      userId: string,
      overrides?: { providerId?: string; modelId?: string }
    ) => Promise<{
      providerId: string;
      modelId: string;
      baseUrl?: string;
      apiKey?: string;
      apiType?: 'openai' | 'anthropic';
    } | null>,
  ): void {
    this.getLLMConfigForAgent = fn;
  }

  /** 由 createApiRouter 注入，用于 MCP 配置变更后按用户重载 */
  setReloadMcpForUser(fn: (userId: string) => Promise<void>): void {
    this.reloadMcpForUser = fn;
  }

  async getMcpContainerId(userId: string, serverKey: string): Promise<string> {
    if (!this.userSandboxManager) throw new Error('本地扩展需要独立用户容器');
    return this.userSandboxManager.getMcpContainerId(userId, serverKey);
  }

  /** 返回包装后的 getConfig/setConfig：非专业版用户对 llm_config 只读（get 返回 undefined 用默认值），set 抛错 */
  private getConfigAccessors(): {
    getConfig?: (uid: string, key: string) => string | undefined | Promise<string | undefined>;
    setConfig?: (uid: string, key: string, value: string) => void | Promise<void>;
  } {
    const db = this.db;
    const sub = this.subscriptionService;
    if (!db) return {};
    const canConfigureLLM = (uid: string) => canConfigureUserLLM(uid, db, sub);
    return {
      getConfig: async (uid: string, key: string) => {
        if (key === 'llm_config' && !(await canConfigureLLM(uid))) return undefined;
        return db.getConfig(uid, key);
      },
      setConfig: async (uid: string, key: string, value: string) => {
        if (key === 'llm_config' && !(await canConfigureLLM(uid))) {
          throw new Error('仅专业版用户可配置大模型，请升级套餐');
        }
        return db.setConfig(uid, key, value);
      },
    };
  }

  /** 由 createApiRouter 注入，供 memory_search、memory_embed_add、memory_delete 使用 */
  setMemoryDeps(
    getMemory: (userId: string) => Promise<import('../memory/MemoryService.js').MemoryService | null>,
    getVectorConfig: (
      userId: string
    ) => Promise<{ providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null>,
  ): void {
    this.executor.setMemoryDeps(getMemory, getVectorConfig);
  }

  /** 启动时从 DB 加载任务到内存，避免刷新/重启后任务列表为空 */
  private async loadTasksFromDb(): Promise<void> {
    if (!this.db) return;
    try {
      const rows = await this.db.getAllTasks();
      for (const row of rows) {
        let steps: TaskStep[] = [];
        if (row.steps_json) {
          try {
            const parsed = JSON.parse(row.steps_json) as TaskStep[];
            steps = Array.isArray(parsed)
              ? parsed.map((s) => ({
                  ...s,
                  riskLevel: s.riskLevel ?? 'low',
                  toolInput: s.toolInput ?? {},
                }))
              : [];
          } catch {
            // ignore
          }
        }
        let result: Task['result'];
        if (row.result_json) {
          try {
            result = JSON.parse(row.result_json) as Task['result'];
          } catch {
            // ignore
          }
        }
        let metadata: Task['metadata'];
        if (row.metadata_json) {
          try {
            metadata = JSON.parse(row.metadata_json) as Task['metadata'];
          } catch {
            // ignore
          }
        }
        const task: Task = {
          id: row.id,
          domain: row.domain as Task['domain'],
          title: row.title,
          description: row.description ?? '',
          status: row.status as Task['status'],
          steps,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ...(result != null && { result }),
          ...(metadata != null && { metadata }),
        };
        if (metadata?.chatRun) continue;
        if (metadata?.llmConfig) { metadata = { ...metadata, llmConfig: modelSelection(metadata.llmConfig) }; task.metadata = metadata; }
        if (task.status === 'running' || task.status === 'planning') {
          task.status = 'paused';
          task.updatedAt = Date.now();
          task.metadata = { ...task.metadata, stopReason: 'restart_interrupted' };
          await this.persistTask(task);
        }
        this.tasks.set(task.id, task);
      }
    } catch (err) {
      console.error('[Orchestrator] loadTasksFromDb failed:', err);
    }
  }

  /** 持久化任务到 DB（C.4） */
  private async persistTask(task: Task): Promise<void> {
    if (!this.db) return;
    const userId = (task.metadata as { userId?: string } | undefined)?.userId ?? 'anonymous';
    await this.db.insertTask({
      id: task.id,
      user_id: userId,
      domain: task.domain,
      title: task.title,
      description: task.description,
      status: task.status,
      steps_json: JSON.stringify(task.steps),
      result_json: task.result ? JSON.stringify(task.result) : undefined,
      metadata_json: task.metadata ? JSON.stringify({ ...task.metadata, ...(task.metadata.llmConfig ? { llmConfig: modelSelection(task.metadata.llmConfig) } : {}) }) : undefined,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    });
  }

  private async persistTaskExecution(task: Task): Promise<void> {
    if (!this.db) return;
    await this.db.updateTaskExecution(task.id, {
      started_at: task.startedAt,
      completed_at: task.completedAt,
      duration_ms: task.durationMs,
      actual_cost: task.actualCost,
      tool_executions: task.toolExecutions ? JSON.stringify(task.toolExecutions) : undefined,
    });
  }

  // ── Public API ───────────────────────────────────────────

  /** Update computer context from frontend so the AI can perceive desktop state */
  setComputerContext(ctx: ComputerContext | null, userId = 'anonymous'): void {
    if(ctx)this.computerContexts.set(userId,ctx);else this.computerContexts.delete(userId);
  }

  getComputerContext(userId = 'anonymous'): ComputerContext | null {
    return this.computerContexts.get(userId) ?? null;
  }

  /**
   * 创建并运行一个任务（直接使用 Agent 循环，approval 系统已移除）。
   */
  async createAndRun(request: CreateTaskRequest, userId?: string): Promise<Task> {
    const task = this.createTaskForAgentLoop(request, userId);
    if (request.llmConfig) {
      task.metadata = { ...task.metadata, llmConfig: modelSelection(request.llmConfig), userId };
    } else if (userId) {
      task.metadata = { ...task.metadata, userId };
    }
    this.tasks.set(task.id, task);
    await this.persistTask(task);

    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId: task.id,
      type: 'intent',
      intent: `创建任务: ${task.title}`,
      action: 'task_created',
      metadata: { domain: task.domain },
    });

    this.emitEvent({
      type: 'status_change',
      taskId: task.id,
      data: { status: 'planning', task },
      timestamp: Date.now(),
    });

    task.status = 'running';
    task.startedAt = Date.now();
    task.updatedAt = Date.now();
    await this.persistTaskExecution(task);

    this.emitEvent({
      type: 'status_change',
      taskId: task.id,
      data: { status: 'running' },
      timestamp: Date.now(),
    });

    this.scheduleRunAgentLoop(task);
    return task;
  }

  /** 创建用于 Agent 循环的任务（无预规划步骤，由 LLM 在循环中动态调用工具） */
  private createTaskForAgentLoop(request: CreateTaskRequest, userId?: string): Task {
    const taskId = uuid();
    const context = this.getComputerContext(userId);
    const metadata: Record<string, unknown> = context ? { computerContext: context } : {};
    if (request.chatContext && request.chatContext.length > 0) {
      metadata.chatContext = request.chatContext;
    }
    return {
      id: taskId,
      domain: request.domain,
      title: request.title,
      description: request.description,
      status: 'planning',
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /** Request a stop; the task becomes paused only after its execution settles. */
  pauseTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running' || task.metadata?.stopRequested) return false;
    task.metadata = { ...task.metadata, stopRequested: true };
    this.abortControllers.get(taskId)?.abort();
    this.emitEvent({ type: 'status_change', taskId, data: { status: 'running', stopping: true }, timestamp: Date.now() });
    return true;
  }

  /** Continue from the last durable result, never replaying a tool with an unknown outcome. */
  async resumeTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || !['paused', 'failed'].includes(task.status) || this.abortControllers.has(taskId)) return false;
    if (!task.metadata?.llmConfig && !this.getLLMConfigForAgent) return false;
    const history = task.metadata?.executionMessages as ChatMessage[] | undefined;
    if (history?.some((message) => message.tool_calls?.some((call) => !history.some((result) => result.role === 'tool' && result.tool_call_id === call.id)))) return false;
    if (!history?.length && task.steps.some((step) => step.status === 'running' || step.status === 'completed')) return false;
    task.status = 'running';
    task.result = undefined;
    task.metadata = { ...task.metadata, stopRequested: false, stopReason: undefined };
    task.updatedAt = Date.now();
    await this.persistTask(task);
    this.emitEvent({ type: 'status_change', taskId, data: { status: 'running' }, timestamp: Date.now() });
    this.scheduleRunAgentLoop(task);
    return true;
  }

  async retryTask(taskId: string): Promise<boolean> {
    return this.resumeTask(taskId);
  }

  getTools(userId?: string) {
    return this.executor.listTools(userId);
  }

  async runApprovedShell(params: {userId:string;runId:string;toolCallId:string;agentId?:string;agentRunId?:string;signal:AbortSignal;approvedShellHash:string;input:Record<string,unknown>;allowedToolNames?:string[];blockedToolNames?:string[]}) {
    params.signal.throwIfAborted();
    if (params.blockedToolNames?.includes('shell.run') || params.allowedToolNames && !params.allowedToolNames.includes('shell.run') || !(await this.getLLMToolDefsFiltered(params.userId)).some(tool=>tool.name==='shell.run')) throw new ShellExecutionDeniedError('当前执行已无权运行 Shell 命令，尚未执行');
    return this.executor.execute({id:params.toolCallId,taskId:params.runId,toolName:'shell.run',toolInput:params.input,action:'shell.run',status:'pending',riskLevel:'high'},'container',params);
  }

  async runApprovedSend(params: {
    userId: string; runId: string; toolCallId: string; toolName: SendTool; signal: AbortSignal;
    approvedSendHash: string; assertSendActive: () => Promise<void>; input: Record<string, unknown>; allowedToolNames?: string[]; blockedToolNames?: string[];
  }) {
    const { toolName } = params;
    if (params.signal.aborted) throw new SendExecutionDeniedError('交办已停止，消息尚未发送');
    if (!SEND_TOOLS.includes(toolName) || params.blockedToolNames?.includes(toolName)
      || (params.allowedToolNames && !params.allowedToolNames.includes(toolName))
      || !(await this.getLLMToolDefsFiltered(params.userId)).some(tool => tool.name === toolName)) {
      throw new SendExecutionDeniedError('当前执行已无权发送这条消息，尚未发送');
    }
    const config = this.getConfigAccessors();
    if (params.signal.aborted) throw new SendExecutionDeniedError('交办已停止，消息尚未发送');
    try { return await this.executor.execute({ id: params.toolCallId, taskId: params.runId, toolName,
      toolInput: params.input, action: toolName, status: 'pending', riskLevel: 'high' },
    'container', { ...params, getConfig: config.getConfig });
    } catch (error) {
      // Channel transports wrap uncertain delivery failures; a bare abort is before dispatch.
      if (error instanceof Error && error.name === 'AbortError') throw new SendExecutionDeniedError('交办已停止，消息尚未发送');
      throw error;
    }
  }

  /** 请求或清除当前用户的群组执行取消标志；供 POST /api/x/cancel-group-run 调用 */
  setGroupRunCancel(userId: string, value: boolean): void {
    this.groupRunCancelByUser.set(userId, value);
  }


  /** 供聊天 Agent 循环使用：返回 LLM function calling 格式的工具定义；userId 存在时包含该用户 MCP 工具 */
  getLLMToolDefs(userId?: string) {
    return this.executor.getLLMToolDefs(userId);
  }

  /** 按套餐过滤后的工具列表（异步，用于 chat/task 执行） */
  async getLLMToolDefsFiltered(userId?: string): Promise<import('../chat/chatService.js').LLMToolDef[]> {
    const tools = this.executor.getLLMToolDefs(userId);
    if (!userId || !this.subscriptionService) return tools;
    const features = await this.subscriptionService.getPlanFeatures(userId);
    return filterToolsByPlan(tools, features);
  }

  /** 动态注册工具（供 MCP 等扩展使用）。scope 存在时按用户隔离（如 'mcp:'+userId） */
  registerDynamicTool(
    definition: import('../../../shared/src/index.js').ToolDefinition,
    handler: (input: Record<string, unknown>, context?: import('./ToolExecutor.js').ExecutionContext) => Promise<unknown>,
    scope?: string,
  ): void {
    this.executor.registerDynamicTool(definition, handler, scope);
  }

  /** 清除全局 MCP 工具（重载前调用） */
  clearMcpTools(): void {
    this.executor.clearDynamicTools('mcp.');
  }

  /** 清除某用户的 MCP 工具（按用户重载前调用） */
  clearMcpToolsByScope(scope: string): void {
    this.executor.clearDynamicToolsByScope(scope);
  }

  /**
   * 执行一批工具调用（供 /chat/with-tools 等服务端执行 MCP 等工具后继续对话）。
   * 多个工具调用并发执行，返回顺序与 toolCalls 一致；每条结果含 startedAt/completedAt（从执行开始到结束的时长）。
   */
  async executeToolCalls(
    toolCalls: LLMToolCall[],
    context: { llmConfig: TaskLLMConfig; userId?: string },
  ): Promise<ToolCall[]> {
    const { llmConfig, userId } = context;
    const scheduledToolNames = toolCalls.some(call => call.name === 'x.schedule_run')
      ? (await this.getLLMToolDefsFiltered(userId)).map(tool => tool.name)
      : undefined;
    const accessors = this.getConfigAccessors();
    const execContext = {
      llmConfig,
      userId,
      scheduledToolNames,
      getConfig: accessors.getConfig,
      setConfig: accessors.setConfig,
      clearGroupRunCancel: (uid: string) => this.groupRunCancelByUser.set(uid, false),
      isGroupRunCancelRequested: (uid: string) => this.groupRunCancelByUser.get(uid) === true,
      onGroupRunProgress: (uid: string, data: import('./ToolExecutor.js').GroupRunProgressPayload) =>
        broadcastToAppChannel(uid, 'x', { type: 'group_run_progress', ...data }),
      reloadMcpForUser: this.reloadMcpForUser,
    };
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const step: TaskStep = {
          id: `with-tools-${tc.id}`,
          taskId: '__chat_with_tools__',
          action: tc.name,
          toolName: tc.name,
          toolInput: (tc.arguments || {}) as Record<string, unknown>,
          status: 'pending',
          riskLevel: 'low',
        };
        return this.executor.execute(step, 'container', execContext);
      }),
    );
    return results;
  }

  /** 按需加载模式下的预置工具（搜索+联网搜索+HTTP请求+HTML/JSON解析+加载），其余工具由 X 通过 capability.load 按需加载 */
  private static readonly ON_DEMAND_BASE_TOOLS = ['x.ask_user', 'capability.search', 'web_search', 'http_request', 'html_parse', 'json_parse', 'capability.load'];

  /**
   * 聊天 Agent 循环：带工具的对话，后端执行工具并循环直至模型不再调用工具，返回最终回复。
   * 支持 allowedToolNames 限定该轮只使用指定工具（供 X 创建的智能体使用）。
   * 支持 toolLoadingMode='on_demand'：仅预置 capability.search/web_search/capability.load，按需加载其他工具，减少 token。
   */
  /** 主助手对话带上用户所在的共享空间；专家智能体在独立工作区，不带。 */
  private async spaceContextFor(userId: string | undefined, agentId: string | undefined, canManage: boolean, canUseFiles = canManage): Promise<string> {
    if (!this.db || !userId || userId === 'anonymous' || agentId) return '';
    return buildSpaceContext(getSpaceStore(this.db), userId, { canManage, canUseFiles });
  }

  async runChatAgentLoop(params: {
    inputImages?: ModelImage[];
    messages: ChatMessage[];
    llmConfig: TaskLLMConfig;
    systemPrompt: string;
    maxSteps?: number;
    returnAfterExpertDispatch?:boolean;
    signal?: AbortSignal;
    onCheckpoint?: (messages: ChatMessage[]) => Promise<void>;
    taskMetadata?: Record<string, unknown>;
    onToolEvent?: (event: ChatToolEvent) => void | Promise<void>;
    /** 流式输出：每收到一段文本时调用 */
    onContentChunk?: (chunk: string) => void;
    /** 用于按用户隔离沙箱（文件/Shell 等工具） */
    userId?: string;
    /** 当为 X 创建的 agent 执行时传入，工具使用该 agent 的独立目录 */
    agentId?: string;
    delegationDepth?: number;
    agentRunId?:string;
    runId?:string;
    /** 仅允许使用的工具名列表；不传则使用全部可用工具 */
    allowedToolNames?: string[];
    /** 工具加载模式：on_demand 时仅预置搜索/加载，按需加载其他工具 */
    toolLoadingMode?: 'all' | 'on_demand';
    /** 按需模式下，本对话已加载的工具名（跨请求持久化，由前端传入） */
    initialLoadedToolNames?: string[];
    /** 按需模式下，当加载工具变化时回调（供前端持久化） */
    onLoadedToolsChange?: (names: string[]) => void;
    /** 本轮禁止加载或执行的工具名 */
    blockedToolNames?: string[];
    automaticTextDelivery?: boolean;
  }): Promise<{ content: string; loadedToolNames?: string[]; toolContext?: string; stopReason: 'completed' | 'step_limit' }> {
    const inherited=currentModelBudgetSignal();
    const signal=params.signal&&inherited&&params.signal!==inherited?AbortSignal.any([params.signal,inherited]):params.signal??inherited;
    const execute=()=>this.executeChatAgentLoop({...params,signal});
    return this.subscriptionService
      ? withModelBudget({service:this.subscriptionService,userId:params.userId,runId:params.runId,signal},execute)
      : execute();
  }
  private async executeChatAgentLoop(params:Parameters<AgentOrchestrator['runChatAgentLoop']>[0]):Promise<{ content:string;loadedToolNames?:string[];toolContext?:string;stopReason:'completed'|'step_limit' }> {
    const {
      messages: initialMessages,
      llmConfig,
      systemPrompt,
      maxSteps = 20,
      signal,
      onCheckpoint,
      taskMetadata,
      onToolEvent,
      onContentChunk,
      userId,
      agentId,
      delegationDepth = 0,
      allowedToolNames,
      toolLoadingMode = 'all',
      initialLoadedToolNames = [],
      onLoadedToolsChange,
      blockedToolNames = [],
    } = params;
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      throw new Error('当前未配置大模型，无法执行带工具的对话。');
    }

    signal?.throwIfAborted();
    const onDemand = toolLoadingMode === 'on_demand';
    const blockedTools = new Set(blockedToolNames);
    if (params.automaticTextDelivery) blockedTools.add('file.write');
    const withinAllowed = (name: string) => allowedToolNames === undefined || allowedToolNames.includes(name);
    const withinScheduledScope = (name: string) => withinAllowed(name) && !blockedToolNames.includes(name);
    const withinScope = (name: string) => withinAllowed(name) && !blockedTools.has(name);
    const loadedToolNames = new Set<string>(
      (initialLoadedToolNames ?? []).filter(withinScope),
    );
    const resolveToolNames = (): string[] =>
      onDemand
        ? [...AgentOrchestrator.ON_DEMAND_BASE_TOOLS, ...loadedToolNames].filter(withinScope)
        : (allowedToolNames ?? []).filter(withinScope);
    let effectiveAllowed: string[] | undefined = onDemand ? resolveToolNames() : allowedToolNames;

    let scopedTools = (await this.getLLMToolDefsFiltered(userId)).filter(tool => withinScheduledScope(tool.name));
    let tools = scopedTools.filter(tool => withinScope(tool.name));
    if (effectiveAllowed !== undefined) {
      const set = new Set(effectiveAllowed);
      tools = tools.filter((t) => set.has(t.name));
    }
    const canManageSpaces = tools.some(t => t.name.startsWith('x.space_') || t.name === 'capability.load');
    const canUseSpaceFiles = tools.some(t => t.name === 'file.write' || t.name === 'file.read' || t.name === 'capability.load');
    const spaceContext = await this.spaceContextFor(userId, agentId, canManageSpaces, canUseSpaceFiles);
    const messages: ChatMessage[] = [
      { role: 'system', content: spaceContext ? `${systemPrompt}\n\n${spaceContext}` : systemPrompt },
      ...initialMessages.filter((m) => m.role !== 'system'),
    ];
    const checkpoint = async () => { await onCheckpoint?.(structuredClone(messages)); };
    await checkpoint();
    let lastContent = '';
    let steps = 0;
    const buildToolContext = () =>
      messages
        .filter((message) => message.role === 'tool')
        .slice(-12)
        .map((message) => message.content)
        .join('\n\n')
        .slice(-30000);
    while (steps < maxSteps) {
      signal?.throwIfAborted();
      let result = onContentChunk
        ? await callLLMWithToolsStream(
            {
              messages,
              inputImages: params.inputImages,
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
              apiType: llmConfig.apiType,
              signal,
            },
            tools,
            (chunk) => { signal?.throwIfAborted(); onContentChunk(chunk); },
          )
        : await callLLMWithTools(
            {
              messages,
              inputImages: params.inputImages,
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
              apiType: llmConfig.apiType,
              signal,
            },
            tools,
          );
      signal?.throwIfAborted();
      const usedCallIds = new Set(messages.flatMap((message) => [
        ...(message.tool_calls?.map((call) => call.id) ?? []),
        ...(message.tool_call_id ? [message.tool_call_id] : []),
      ]));
      result = { ...result, toolCalls: (result.toolCalls ?? []).map((call) => {
        const id = !call.id || usedCallIds.has(call.id) ? uuid() : call.id;
        usedCallIds.add(id);
        return { ...call, id };
      }) };
      lastContent = result.content ?? '';
      if (!result.toolCalls?.length) {
        messages.push({ role: 'assistant', content: lastContent });
        await checkpoint();
        signal?.throwIfAborted();
        const finalLoaded = onDemand ? [...loadedToolNames] : undefined;
        return {
          content: lastContent.trim() || '（无文本回复）',
          stopReason: 'completed',
          ...(finalLoaded?.length ? { loadedToolNames: finalLoaded } : {}),
          ...(buildToolContext() ? { toolContext: buildToolContext() } : {}),
        };
      }
      messages.push({
        role: 'assistant',
        content: lastContent,
        tool_calls: result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      });
      await checkpoint();
      const stopBeforeDispatch = async (fromIndex: number) => {
        if (!signal?.aborted) return;
        for (const unstarted of result.toolCalls.slice(fromIndex)) {
          messages.push({ role: 'tool', tool_call_id: unstarted.id, content: JSON.stringify({ error: '用户已停止，工具尚未执行', cancelledBeforeDispatch: true }) });
        }
        await checkpoint();
        signal.throwIfAborted();
      };
      const priorToolMessages = messages.filter((m) => m.role === 'tool');
      const recentToolResults =
        priorToolMessages.length > 0
          ? priorToolMessages
              .slice(-12)
              .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
              .join('\n\n')
              .slice(0, 16000)
          : undefined;
      const accessors = this.getConfigAccessors();
      const execContext = {
        llmConfig,
        signal,
        taskMetadata,
        userId,
        agentId,
        agentRunId:params.agentRunId,
        scheduledToolNames: scopedTools.map(tool => tool.name),
        scheduledBlockedToolNames: blockedToolNames,
        allowedToolNames,
        blockedToolNames: [...blockedTools],
        delegationDepth,
        runId:params.runId,
        getConfig: accessors.getConfig,
        setConfig: accessors.setConfig,
        recentToolResults,
        clearGroupRunCancel: (uid:string) => this.groupRunCancelByUser.set(uid,false),
        isGroupRunCancelRequested: (uid:string) => this.groupRunCancelByUser.get(uid)===true,
        onGroupRunProgress: (uid:string,data:import('./ToolExecutor.js').GroupRunProgressPayload) => broadcastToAppChannel(uid,'x',{type:'group_run_progress',...data}),
        reloadMcpForUser: this.reloadMcpForUser,
      };
      const handoffs:string[]=[];let batchFailed=false;
      // 顺序结算，确保停止或持久化失败后不再派发后续工具。
      for (let toolIndex = 0; toolIndex < result.toolCalls.length; toolIndex++) {
        const tc = result.toolCalls[toolIndex];
        await stopBeforeDispatch(toolIndex);
        const requestedLoadNames =
          tc.name === 'capability.load' && Array.isArray(tc.arguments?.names)
            ? tc.arguments.names.filter((name): name is string => typeof name === 'string')
            : [];
        const allowedLoadNames = requestedLoadNames.filter(withinScope);
        const toolInput =
          tc.name === 'capability.load' && requestedLoadNames.length > 0
            ? { ...tc.arguments, names: allowedLoadNames }
            : (tc.arguments || {});
        const step: TaskStep = {
          id: `chat-step-${steps}-${tc.id}`,
          taskId: '__chat__',
          action: tc.name,
          toolName: tc.name,
          toolInput: toolInput as Record<string, unknown>,
          status: 'pending',
          riskLevel: 'low',
        };
        await onToolEvent?.({ type: 'tool_start', id: tc.id, toolName: tc.name, input: step.toolInput });
        await stopBeforeDispatch(toolIndex);
        const start = Date.now();
        const call: ToolCall = tools.some((tool) => tool.name === tc.name)
          ? await this.executor.execute(step, 'container', {...execContext,toolCallId:tc.id})
          : { id: tc.id, toolName: tc.name, input: step.toolInput, startedAt: start, runtimeType: 'container', error: '本轮未授权此工具' };
        if (requestedLoadNames.some((name) => blockedTools.has(name))) {
          call.output = {
            loaded: allowedLoadNames,
            blocked: requestedLoadNames.filter((name) => blockedTools.has(name)),
            message: '本轮文本产物由服务器自动保存。请直接返回完整正文，不要调用 file.write。',
          };
        }
        const toolOutput = call.error ? { error: call.error } : call.output;
        const receipt=call.output as {ok?:boolean;runId?:string;agentName?:string}|undefined;
        if(call.error||receipt?.ok===false)batchFailed=true;
        if(!call.error&&receipt?.ok===true&&typeof receipt.runId==='string'&&['x.dispatch_agent','x.dispatch_team','x.dispatch_group'].includes(tc.name))handoffs.push(`${receipt.agentName??'专家'}（${receipt.runId}）`);
        messages.push({ role: 'tool', content: JSON.stringify(toolOutput) ?? 'null', tool_call_id: tc.id });
        await checkpoint();
        const duration = Date.now() - start;
        await onToolEvent?.({
          type: 'tool_complete',
          id: tc.id,
          toolName: tc.name,
          output: call.output,
          error: call.error,
          duration,
        });
        await stopBeforeDispatch(toolIndex + 1);
        if (onDemand && tc.name === 'capability.load' && tc.arguments?.names) {
          const raw = tc.arguments.names;
          const names = Array.isArray(raw)
            ? raw
                .filter((n): n is string => typeof n === 'string')
                .map((n) => String(n).trim())
                .filter((name) => Boolean(name) && withinScope(name))
            : [];
          for (const n of names) loadedToolNames.add(n);
          onLoadedToolsChange?.([...loadedToolNames]);
        }
      }
      if(params.returnAfterExpertDispatch&&handoffs.length&&!batchFailed){
        const content=`已交给${handoffs.join('、')}后台处理。这是接单回执，成果尚待核对和验收；完成后会带回原对话。`;
        messages.push({role:'assistant',content});await checkpoint();signal?.throwIfAborted();
        return {content,stopReason:'completed',loadedToolNames:onDemand?[...loadedToolNames]:undefined,toolContext:buildToolContext()};
      }
      // 每次工具执行后重新获取工具列表，确保新添加的 MCP 工具（如 x.add_mcp_server 后）能立即使用
      scopedTools = (await this.getLLMToolDefsFiltered(userId)).filter(tool => withinScheduledScope(tool.name));
      const runnableTools = scopedTools.filter(tool => withinScope(tool.name));
      if (onDemand) {
        const set = new Set(resolveToolNames());
        tools = runnableTools.filter((t) => set.has(t.name));
      } else if (effectiveAllowed !== undefined) {
        const set = new Set(effectiveAllowed);
        tools = runnableTools.filter((t) => set.has(t.name));
      } else {
        tools = runnableTools;
      }
      steps++;
    }
    const finalLoaded = onDemand ? [...loadedToolNames] : undefined;
    return {
      stopReason: 'step_limit',
      content: lastContent.trim() || `本轮已执行 ${maxSteps} 步，为保障响应已结束；您可继续发新消息说明需求，或将任务拆成更小步骤。`,
      ...(finalLoaded?.length ? { loadedToolNames: finalLoaded } : {}),
      ...(buildToolContext() ? { toolContext: buildToolContext() } : {}),
    };
  }

  /**
   * 使用 X 定义的智能体执行一次任务（X 为管理者，智能体为执行者）。
   * 由 x.run_agent 工具调用，使用智能体的 systemPrompt 与 toolNames。
   */
  async runCustomAgentLoop(params: {
    agentDef: AgentDefinition;
    goal: string;
    userId: string;
    signal?: AbortSignal;
    allowedToolNames?: string[];
    blockedToolNames?: string[];
    delegationDepth?: number;
  }): Promise<{ content: string }> {
    const { agentDef, goal, userId, signal } = params;
    signal?.throwIfAborted();
    const depth=params.delegationDepth??0;
    if(!Number.isInteger(depth)||depth<0||depth>=3)throw new Error('专家转交层级已达到上限，请由主助手重新安排。');
    if (!this.getLLMConfigForAgent) {
      throw new Error('服务未配置智能体执行能力，无法派发任务。');
    }
    const overrides =
      agentDef.llmProviderId && agentDef.llmModelId
        ? { providerId: agentDef.llmProviderId, modelId: agentDef.llmModelId }
        : undefined;
    const llmConfig = await this.getLLMConfigForAgent(userId, overrides);
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      throw new Error('当前用户未配置大模型，智能体无法执行。请到系统设置中配置并保存到云端。');
    }
    const messages = [{ role: 'user' as const, content: goal }];
    const parentTools=params.allowedToolNames;
    let allowed=agentDef.toolNames?.length?agentDef.toolNames:parentTools;
    if(parentTools!==undefined)allowed=allowed?.filter(name=>parentTools.includes(name));
    const result = await this.runChatAgentLoop({
      messages,
      llmConfig: {
        providerId: llmConfig.providerId,
        modelId: llmConfig.modelId,
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        apiType: llmConfig.apiType,
      },
      systemPrompt: agentDef.systemPrompt,
      maxSteps: 15,
      signal,
      userId,
      agentId: agentDef.id,
      delegationDepth: depth+1,
      allowedToolNames: allowed,
      blockedToolNames: params.blockedToolNames,
    });
    if (result.stopReason !== 'completed') throw new Error('子智能体达到执行步数上限，任务尚未完成。');
    return result;
  }

  /**
   * R047：定时/触发执行 X 主脑意图，复用 tasks 表持久化运行日志。
   * 全部交给共享后台记录与 ChatRun；没有持久化执行器时拒绝执行。
   */
  async runIntentAsPersistedTask(params: BackgroundIntentInput): Promise<{ content: string; runId?: string; sessionId?: string }> {
    if (!this.backgroundIntentRunner) throw new Error('持久化交办服务尚未就绪');
    return this.backgroundIntentRunner(params);
  }

  /**
   * R047：信号触发执行智能体，复用 tasks 表持久化运行日志。
   */
  async runAgentAsPersistedTask(params: {
    agentDef: AgentDefinition;
    goal: string;
    userId: string;
    sourceId?: string;
    actionFingerprint?: string;
  }): Promise<{ content: string }> {
    const { agentDef, goal, userId, sourceId, actionFingerprint } = params;
    if (!this.getLLMConfigForAgent) {
      throw new Error('服务未配置智能体执行能力，无法派发任务。');
    }
    const overrides =
      agentDef.llmProviderId && agentDef.llmModelId
        ? { providerId: agentDef.llmProviderId, modelId: agentDef.llmModelId }
        : undefined;
    const llmConfig = await this.getLLMConfigForAgent(userId, overrides);
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      throw new Error('当前用户未配置大模型，智能体无法执行。请到系统设置中配置并保存到云端。');
    }
    return this.runIntentAsPersistedTask({
      userId, intent: goal, llmConfig, systemPrompt: agentDef.systemPrompt,
      source: 'signal_trigger', sourceId, actionFingerprint, title: `信号触发: ${agentDef.name}`,
      metadata: { allowedToolNames: agentDef.toolNames?.length ? agentDef.toolNames : undefined },
    });
  }

  // runSteps and scheduleRunSteps removed - approval system deprecated

  /** Persisted tasks share the same cancellation, tool, and checkpoint lifecycle as chat. */
  private async runAgentLoop(task: Task): Promise<void> {
    if (this.abortControllers.has(task.id)) return;
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);
    const meta = (task.metadata ?? {}) as {
      llmConfig?: TaskLLMConfig; userId?: string; systemPromptOverride?: string; allowedToolNames?: string[];
      agentId?: string; chatContext?: Array<{ role: string; content: string }>;
      executionMessages?: ChatMessage[]; stopRequested?: boolean; loadedToolNames?: string[];
    };
    try {
      if (meta?.stopRequested || task.status === 'paused') controller.abort();
      controller.signal.throwIfAborted();
      const llmConfig = meta?.userId && this.getLLMConfigForAgent
        ? await this.getLLMConfigForAgent(meta.userId, modelSelection(meta.llmConfig))
        : modelSelection(meta?.llmConfig);
      if (!llmConfig?.providerId || !llmConfig.modelId) throw new Error('缺少服务端模型配置');
      task.metadata = { ...task.metadata, llmConfig: modelSelection(llmConfig) };
      await this.persistTask(task);
      let userProfileSection = '';
      if (meta.userId && this.db) {
        const profileRaw = await this.db.getConfig(meta.userId, 'user_profile');
        if (profileRaw) {
          try {
            const profile = JSON.parse(profileRaw) as Record<string, string>;
            userProfileSection = '\n\n# 用户信息\n' + ['displayName', 'bio', 'timezone', 'language']
              .filter((key) => profile[key]).map((key) => `${key}: ${profile[key]}`).join('\n');
          } catch { /* A malformed optional profile does not invalidate an existing task. */ }
        }
      }
      const systemPrompt = meta.systemPromptOverride
        ?? '你是 X-Computer 主脑。使用工具完成需求，完成后以文字交付。\n\n# 当前感知\n' + getCurrentAwareness() + userProfileSection;
      const chatContext = (meta.chatContext ?? []).filter((message): message is { role: 'user' | 'assistant'; content: string } =>
        (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string');
      const messages: ChatMessage[] = meta.executionMessages?.length ? meta.executionMessages : [
        ...chatContext.slice(-16).map((message) => ({ ...message, content: message.content.slice(0, 4000) })),
        { role: 'user', content: task.description },
      ];
      const pending = messages.some((message) => message.tool_calls?.some((call) => !messages.some((result) => result.role === 'tool' && result.tool_call_id === call.id)));
      if (pending) throw new Error('上次工具执行结果未知，请先核实，不能直接重放。');
      const allowedToolNames = meta.allowedToolNames;
      const result = await this.runChatAgentLoop({
        messages, llmConfig, systemPrompt, userId: meta?.userId, agentId: meta?.agentId,
        signal: controller.signal, maxSteps: 30, allowedToolNames,
        toolLoadingMode: allowedToolNames !== undefined ? 'all' : getToolLoadingMode(),
        initialLoadedToolNames: meta.loadedToolNames,
        taskMetadata: task.metadata,
        onLoadedToolsChange: (names) => { task.metadata = { ...task.metadata, loadedToolNames: names }; },
        onCheckpoint: async (history) => {
          for (const message of history) {
            if (message.role !== 'tool') continue;
            const step = task.steps.find((item) => item.id === `${task.id}-${message.tool_call_id}`);
            if (!step || step.status !== 'running') continue;
            let output: unknown;
            try { output = JSON.parse(message.content); } catch { output = message.content; }
            const error = output && typeof output === 'object' && 'error' in output ? String(output.error) : undefined;
            step.output = output;
            step.error = error;
            step.status = error ? 'failed' : 'completed';
            step.completedAt = Date.now();
          }
          task.metadata = { ...task.metadata, executionMessages: history };
          task.updatedAt = Date.now();
          await this.persistTask(task);
        },
        onToolEvent: async (event) => {
          if (event.type === 'tool_start') {
            const step: TaskStep = { id: `${task.id}-${event.id}`, taskId: task.id, action: event.toolName,
              toolName: event.toolName, toolInput: event.input, status: 'running', riskLevel: 'low', startedAt: Date.now() };
            task.steps.push(step);
            this.audit.log({ id: uuid(), timestamp: Date.now(), taskId: task.id, stepId: step.id,
              type: 'action', action: `tool:${event.toolName}`, intent: event.toolName, riskLevel: 'low' });
            await this.persistTask(task);
            this.emitEvent({ type: 'step_start', taskId: task.id, stepId: step.id,
              data: { action: event.toolName, toolName: event.toolName, runtimeType: 'container' }, timestamp: Date.now() });
          } else if (event.type === 'tool_complete') {
            const step = task.steps.find((item) => item.id === `${task.id}-${event.id}`);
            if (step) {
              step.status = event.error ? 'failed' : 'completed'; step.output = event.output;
              step.error = event.error; step.completedAt = Date.now();
            }
            this.audit.log({ id: uuid(), timestamp: Date.now(), taskId: task.id, stepId: step?.id,
              type: event.error ? 'error' : 'result', action: `tool:${event.toolName}`, result: event.error ?? JSON.stringify(event.output)?.slice(0, 200) });
            await this.persistTask(task);
            this.emitEvent({ type: 'step_complete', taskId: task.id, stepId: step?.id,
              data: { output: event.output, error: event.error, durationMs: event.duration }, timestamp: Date.now() });
            if (event.error) throw new Error(event.error);
          }
        },
      });
      controller.signal.throwIfAborted();
      task.metadata = { ...task.metadata, stopReason: result.stopReason };
      task.status = result.stopReason === 'completed' ? 'completed' : 'paused';
      task.result = result.stopReason === 'completed'
        ? { success: true, output: result.content }
        : { success: false, output: result.content, error: '本轮已达到执行步数上限，可从已保存结果继续。' };
    } catch (error) {
      const stopped = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      task.status = stopped ? 'paused' : 'failed';
      task.metadata = { ...task.metadata, stopReason: stopped ? 'user_stopped' : 'error' };
      task.result = { success: false, error: stopped ? '已停止执行，可从检查点恢复。' : error instanceof Error ? error.message : String(error) };
    } finally {
      task.updatedAt = Date.now();
      if (task.status === 'completed' || task.status === 'failed') task.completedAt = Date.now();
      try {
        await this.persistTask(task);
        await this.persistTaskExecution(task);
      } finally {
        this.abortControllers.delete(task.id);
      }
      this.emitEvent({ type: 'status_change', taskId: task.id, data: { status: task.status }, timestamp: Date.now() });
      if (task.status === 'completed' || task.status === 'failed') {
        this.emitEvent({ type: 'task_complete', taskId: task.id, data: task.result, timestamp: Date.now() });
        fireHook('task_complete', { taskId: task.id, data: task.result });
      }
    }
  }

  /**
   * 调度 Agent 循环执行（异步，不阻塞）
   * 配额检查已在 API 层完成，这里直接运行
   */
  private scheduleRunAgentLoop(task: Task): void {
    setImmediate(() => {
      this.runAgentLoop(task)
        .catch((err) => console.error(`Task ${task.id} agent loop failed:`, err));
    });
  }

  private emitEvent(event: TaskEvent) {
    this.emit('task_event', event);
  }
}
