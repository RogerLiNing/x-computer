import { EventEmitter } from 'events';
import type {
  Task,
  TaskStep,
  ToolCall,
  CreateTaskRequest,
  ExecutionMode,
  TaskEvent,
  ApprovalRequest,
  RuntimeType,
  ComputerContext,
  TaskLLMConfig,
  AgentDefinition,
} from '../../../shared/src/index.js';
import { TaskPlanner } from './TaskPlanner.js';
import { ToolExecutor } from './ToolExecutor.js';
import { PolicyEngine } from '../policy/PolicyEngine.js';
import { AuditLogger } from '../observability/AuditLogger.js';
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
import { broadcastToAppChannel } from '../wsBroadcast.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { filterToolsByPlan } from '../subscription/planToolFilter.js';

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
  private planner = new TaskPlanner();
  private executor: ToolExecutor;
  private policy: PolicyEngine;
  private audit: AuditLogger;

  private tasks = new Map<string, Task>();
  private mode: ExecutionMode = 'approval';
  private abortControllers = new Map<string, AbortController>();
  private subscriptionService?: SubscriptionService;
  /** Latest computer context from frontend (windows, tasks summary, etc.) for AI awareness */
  private computerContext: ComputerContext | null = null;
  /** 供 X 派发智能体任务时获取用户 LLM 配置（由 createApiRouter 注入）。overrides 用于 agent 指定 provider/model。 */
  private getLLMConfigForAgent?: (
    userId: string,
    overrides?: { providerId?: string; modelId?: string }
  ) => Promise<{
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  } | null>;
  /** 用户请求取消当前群组执行时置 true，run_group 在每名成员间检查 */
  private groupRunCancelByUser = new Map<string, boolean>();

  constructor(
    policy: PolicyEngine,
    audit: AuditLogger,
    sandboxFS?: SandboxFS,
    userSandboxManager?: UserSandboxManager,
    private db?: AsyncDatabase,
    evolvedPromptService?: EvolvedPromptService,
    getRecentAssistantChat?: GetRecentAssistantChat,
    miniAppLogStore?: MiniAppLogStore,
    subscriptionService?: SubscriptionService,
  ) {
    super();
    this.policy = policy;
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
    this.executor.setCreateTaskHandler((req, uid) => this.createAndRun(req, uid));
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
    } | null>,
  ): void {
    this.getLLMConfigForAgent = fn;
  }

  /** 由 createApiRouter 注入，用于 MCP 配置变更后按用户重载 */
  setReloadMcpForUser(fn: (userId: string) => Promise<void>): void {
    this.reloadMcpForUser = fn;
  }

  /** 返回包装后的 getConfig/setConfig：非专业版用户对 llm_config 只读（get 返回 undefined 用默认值），set 抛错 */
  private getConfigAccessors(): {
    getConfig?: (uid: string, key: string) => string | undefined | Promise<string | undefined>;
    setConfig?: (uid: string, key: string, value: string) => void | Promise<void>;
  } {
    const db = this.db;
    const sub = this.subscriptionService;
    if (!db) return {};
    const canConfigureLLM = async (uid: string) => {
      if (!sub) return true;
      const s = await sub.getUserSubscription(uid);
      return s ? ['pro', 'enterprise'].includes(s.planId) : false;
    };
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
      metadata_json: task.metadata ? JSON.stringify(task.metadata) : undefined,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    });
  }

  // ── Public API ───────────────────────────────────────────

  setMode(mode: ExecutionMode) {
    this.mode = mode;
    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId: '__system__',
      type: 'system',
      action: `execution_mode_changed_to_${mode}`,
      intent: `用户将执行模式切换为 ${mode === 'auto' ? '自动' : '审批'}`,
    });
  }

  getMode(): ExecutionMode {
    return this.mode;
  }

  /** Update computer context from frontend so the AI can perceive desktop state */
  setComputerContext(ctx: ComputerContext | null): void {
    this.computerContext = ctx;
  }

  getComputerContext(): ComputerContext | null {
    return this.computerContext;
  }

  async createAndRun(request: CreateTaskRequest, userId?: string): Promise<Task> {
    const effectiveMode = request.mode || this.mode;

    // 1. 有 llmConfig 时走 Agent 循环（不间断执行直至完成，对齐 OpenClaw/OpenCode）；无 LLM 时由 Plan 单步兜底
    let task: Task;
    if (request.llmConfig) {
      task = this.createTaskForAgentLoop(request);
      task.metadata = { ...task.metadata, llmConfig: request.llmConfig, userId };
    } else {
      task = this.planner.plan(request, effectiveMode, this.computerContext);
      if (userId) task.metadata = { ...task.metadata, userId };
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
      metadata: { domain: task.domain, mode: effectiveMode },
    });

    this.emitEvent({
      type: 'status_change',
      taskId: task.id,
      data: { status: 'planning', task },
      timestamp: Date.now(),
    });

    // 2. Start execution
    task.status = 'running';
    task.updatedAt = Date.now();

    this.emitEvent({
      type: 'status_change',
      taskId: task.id,
      data: { status: 'running' },
      timestamp: Date.now(),
    });

    if (request.llmConfig) {
      this.scheduleRunAgentLoop(task);
    } else {
      this.scheduleRunSteps(task);
    }
    return task;
  }

  /** 创建用于 Agent 循环的任务（无预规划步骤，由 LLM 在循环中动态调用工具） */
  private createTaskForAgentLoop(request: CreateTaskRequest): Task {
    const taskId = uuid();
    const metadata: Record<string, unknown> = this.computerContext ? { computerContext: this.computerContext } : {};
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

  /** Interrupt a running task */
  pauseTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return false;

    const controller = this.abortControllers.get(taskId);
    if (controller) controller.abort();

    task.status = 'paused';
    task.updatedAt = Date.now();

    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId,
      type: 'system',
      action: 'task_paused',
      intent: '用户暂停任务',
    });

    this.emitEvent({
      type: 'status_change',
      taskId,
      data: { status: 'paused' },
      timestamp: Date.now(),
    });

    return true;
  }

  /** Resume a paused task */
  resumeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'paused') return false;

    task.status = 'running';
    task.updatedAt = Date.now();

    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId,
      type: 'system',
      action: 'task_resumed',
      intent: '用户恢复任务',
    });

    this.scheduleRunSteps(task);
    return true;
  }

  /** Approve a pending approval step — mark step as running so runSteps will execute it without re-asking approval */
  approveStep(taskId: string, stepId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const step = task.steps.find((s) => s.id === stepId);
    if (!step || step.status !== 'awaiting_approval') return false;

    step.status = 'running';
    task.status = 'running';
    task.updatedAt = Date.now();

    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId,
      stepId,
      type: 'approval',
      action: 'step_approved',
      intent: '用户批准步骤执行',
    });

    this.emitEvent({
      type: 'status_change',
      taskId,
      data: { status: 'running' },
      timestamp: Date.now(),
    });

    this.scheduleRunSteps(task);
    return true;
  }

  /** Reject a pending approval step */
  rejectStep(taskId: string, stepId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const step = task.steps.find((s) => s.id === stepId);
    if (!step || step.status !== 'awaiting_approval') return false;

    step.status = 'cancelled';
    task.status = 'cancelled';
    task.updatedAt = Date.now();

    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId,
      stepId,
      type: 'approval',
      action: 'step_rejected',
      intent: '用户拒绝步骤执行',
    });

    this.emitEvent({
      type: 'status_change',
      taskId,
      data: { status: 'cancelled' },
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * 失败任务重试。
   * - restart：从头重试（步骤任务重置所有步骤；Agent 任务清空步骤并重新跑循环）。
   * - from_failure：从失败处重试（仅步骤任务：将第一个失败步骤及之后置为 pending 再执行；Agent 任务不支持，会退化为 restart）。
   */
  async retryTask(taskId: string, mode: 'restart' | 'from_failure'): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'failed') return false;

    const meta = task.metadata as { llmConfig?: TaskLLMConfig; userId?: string } | undefined;
    const isAgentTask = !!(meta?.llmConfig);

    if (isAgentTask) {
      // Agent 循环任务：只支持从头重试
      task.status = 'running';
      task.result = undefined;
      task.steps = [];
      task.updatedAt = Date.now();
      await this.persistTask(task);
      this.emitEvent({ type: 'status_change', taskId, data: { status: 'running' }, timestamp: Date.now() });
      this.audit.log({
        id: uuid(),
        timestamp: Date.now(),
        taskId,
        type: 'system',
        action: 'task_retry',
        intent: '用户从头重试任务',
      });
      this.scheduleRunAgentLoop(task);
      return true;
    }

    // 步骤任务
    const failedIdx = task.steps.findIndex((s) => s.status === 'failed');
    const fromIdx = mode === 'from_failure' && failedIdx >= 0 ? failedIdx : 0;

    for (let i = fromIdx; i < task.steps.length; i++) {
      const step = task.steps[i]!;
      step.status = 'pending';
      step.output = undefined;
      step.error = undefined;
      step.startedAt = undefined;
      step.completedAt = undefined;
    }
    task.status = 'running';
    task.result = undefined;
    task.updatedAt = Date.now();
    await this.persistTask(task);
    this.emitEvent({ type: 'status_change', taskId, data: { status: 'running' }, timestamp: Date.now() });
    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId,
      type: 'system',
      action: 'task_retry',
      intent: mode === 'from_failure' && failedIdx >= 0 ? '用户从失败处重试任务' : '用户从头重试任务',
    });
    this.scheduleRunSteps(task);
    return true;
  }

  getTools(userId?: string) {
    return this.executor.listTools(userId);
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
    handler: (input: Record<string, unknown>) => Promise<unknown>,
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
    const accessors = this.getConfigAccessors();
    const execContext = {
      llmConfig,
      userId,
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

  /** 按需加载模式下的预置工具（搜索+加载），其余工具由 X 通过 capability.load 按需加载 */
  private static readonly ON_DEMAND_BASE_TOOLS = ['capability.search', 'capability.load'];

  /**
   * 聊天 Agent 循环：带工具的对话，后端执行工具并循环直至模型不再调用工具，返回最终回复。
   * 支持 allowedToolNames 限定该轮只使用指定工具（供 X 创建的智能体使用）。
   * 支持 toolLoadingMode='on_demand'：仅预置 capability.search/load，按需加载其他工具，减少 token。
   */
  async runChatAgentLoop(params: {
    messages: ChatMessage[];
    llmConfig: TaskLLMConfig;
    systemPrompt: string;
    maxSteps?: number;
    onToolEvent?: (event: ChatToolEvent) => void;
    /** 流式输出：每收到一段文本时调用 */
    onContentChunk?: (chunk: string) => void;
    /** 用于按用户隔离沙箱（文件/Shell 等工具） */
    userId?: string;
    /** 当为 X 创建的 agent 执行时传入，工具使用该 agent 的独立目录 */
    agentId?: string;
    /** 仅允许使用的工具名列表；不传则使用全部可用工具 */
    allowedToolNames?: string[];
    /** 工具加载模式：on_demand 时仅预置搜索/加载，按需加载其他工具 */
    toolLoadingMode?: 'all' | 'on_demand';
    /** 按需模式下，本对话已加载的工具名（跨请求持久化，由前端传入） */
    initialLoadedToolNames?: string[];
    /** 按需模式下，当加载工具变化时回调（供前端持久化） */
    onLoadedToolsChange?: (names: string[]) => void;
  }): Promise<{ content: string; loadedToolNames?: string[] }> {
    const {
      messages: initialMessages,
      llmConfig,
      systemPrompt,
      maxSteps = 20,
      onToolEvent,
      onContentChunk,
      userId,
      agentId,
      allowedToolNames,
      toolLoadingMode = 'all',
      initialLoadedToolNames = [],
      onLoadedToolsChange,
    } = params;
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      return { content: '当前未配置大模型，无法执行带工具的对话。' };
    }

    const onDemand = toolLoadingMode === 'on_demand';
    const loadedToolNames = new Set<string>(initialLoadedToolNames ?? []);
    const resolveToolNames = (): string[] =>
      onDemand ? [...AgentOrchestrator.ON_DEMAND_BASE_TOOLS, ...loadedToolNames] : (allowedToolNames ?? []);
    // 按需模式：始终只用 base + 已加载，忽略 allowedToolNames，避免误传全量列表
    let effectiveAllowed: string[] | undefined = onDemand ? resolveToolNames() : allowedToolNames;

    let tools = await this.getLLMToolDefsFiltered(userId);
    if (effectiveAllowed?.length) {
      const set = new Set(effectiveAllowed);
      tools = tools.filter((t) => set.has(t.name));
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...initialMessages.filter((m) => m.role !== 'system'),
    ];
    let lastContent = '';
    let steps = 0;
    while (steps < maxSteps) {
      const result = onContentChunk
        ? await callLLMWithToolsStream(
            {
              messages,
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
            },
            tools,
            onContentChunk,
          )
        : await callLLMWithTools(
            {
              messages,
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
            },
            tools,
          );
      lastContent = result.content ?? '';
      if (!result.toolCalls?.length) {
        return { content: lastContent.trim() || '（无文本回复）' };
      }
      messages.push({
        role: 'assistant',
        content: lastContent,
        tool_calls: result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      });
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
        userId,
        agentId,
        getConfig: accessors.getConfig,
        setConfig: accessors.setConfig,
        recentToolResults,
        reloadMcpForUser: this.reloadMcpForUser,
      };
      // 并发执行所有工具
      const toolResults = await Promise.all(
        result.toolCalls.map(async (tc) => {
          const step: TaskStep = {
            id: `chat-step-${steps}-${tc.id}`,
            taskId: '__chat__',
            action: tc.name,
            toolName: tc.name,
            toolInput: (tc.arguments || {}) as Record<string, unknown>,
            status: 'pending',
            riskLevel: 'low',
          };
          onToolEvent?.({ type: 'tool_start', id: tc.id, toolName: tc.name, input: step.toolInput });
          const start = Date.now();
          const call = await this.executor.execute(step, 'container', execContext);
          const duration = Date.now() - start;
          onToolEvent?.({
            type: 'tool_complete',
            id: tc.id,
            toolName: tc.name,
            output: call.output,
            error: call.error,
            duration,
          });
          return call;
        }),
      );
      for (let i = 0; i < result.toolCalls.length; i++) {
        const tc = result.toolCalls[i];
        const call = toolResults[i];
        if (onDemand && tc.name === 'capability.load' && tc.arguments?.names) {
          const raw = tc.arguments.names;
          const names = Array.isArray(raw)
            ? raw.filter((n): n is string => typeof n === 'string').map((n) => String(n).trim()).filter(Boolean)
            : [];
          for (const n of names) loadedToolNames.add(n);
          onLoadedToolsChange?.([...loadedToolNames]);
        }
        const toolOutput = call!.error ? { error: call!.error } : call!.output;
        messages.push({
          role: 'tool',
          content: JSON.stringify(toolOutput),
          tool_call_id: tc.id,
        });
      }
      // 每次工具执行后重新获取工具列表，确保新添加的 MCP 工具（如 x.add_mcp_server 后）能立即使用
      const allFiltered = await this.getLLMToolDefsFiltered(userId);
      if (effectiveAllowed?.length) {
        const set = new Set(effectiveAllowed);
        tools = allFiltered.filter((t) => set.has(t.name));
      } else {
        tools = allFiltered;
      }
      steps++;
    }
    const finalLoaded = onDemand ? [...loadedToolNames] : undefined;
    return {
      content: lastContent.trim() || `本轮已执行 ${maxSteps} 步，为保障响应已结束；您可继续发新消息说明需求，或将任务拆成更小步骤。`,
      ...(finalLoaded?.length ? { loadedToolNames: finalLoaded } : {}),
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
  }): Promise<{ content: string }> {
    const { agentDef, goal, userId } = params;
    if (!this.getLLMConfigForAgent) {
      return { content: '服务未配置智能体执行能力，无法派发任务。' };
    }
    const overrides =
      agentDef.llmProviderId && agentDef.llmModelId
        ? { providerId: agentDef.llmProviderId, modelId: agentDef.llmModelId }
        : undefined;
    const llmConfig = await this.getLLMConfigForAgent(userId, overrides);
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      return { content: '当前用户未配置大模型，智能体无法执行。请到系统设置中配置并保存到云端。' };
    }
    const messages = [{ role: 'user' as const, content: goal }];
    return this.runChatAgentLoop({
      messages,
      llmConfig: {
        providerId: llmConfig.providerId,
        modelId: llmConfig.modelId,
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
      },
      systemPrompt: agentDef.systemPrompt,
      maxSteps: 15,
      userId,
      agentId: agentDef.id,
      allowedToolNames: agentDef.toolNames?.length ? agentDef.toolNames : undefined,
    });
  }

  /**
   * R047：定时/触发执行 X 主脑意图，复用 tasks 表持久化运行日志。
   * 创建 Task、执行 runAgentLoop、返回内容；失败/成功均写入 task.result。
   */
  async runIntentAsPersistedTask(params: {
    intent: string;
    llmConfig: TaskLLMConfig;
    systemPrompt: string;
    userId: string;
    source?: 'scheduled_job' | 'signal_trigger' | 'run_now' | 'event_driven';
    sourceId?: string;
    title?: string;
    actionFingerprint?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ content: string }> {
    const { intent, llmConfig, systemPrompt, userId, source, sourceId, title, actionFingerprint, metadata: extraMetadata } = params;
    const taskId = uuid();
    const task: Task = {
      id: taskId,
      domain: 'chat',
      title: title ?? (source === 'scheduled_job' ? '定时任务' : source === 'signal_trigger' ? '信号触发' : source === 'run_now' ? '手动执行' : '事件触发'),
      description: intent,
      status: 'running',
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        llmConfig,
        userId,
        systemPromptOverride: systemPrompt,
        source,
        sourceId,
        ...(actionFingerprint ? { actionFingerprint } : {}),
        ...(extraMetadata || {}),
      },
    };
    this.tasks.set(task.id, task);
    await this.persistTask(task);
    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId: task.id,
      type: 'intent',
      intent: `创建任务: ${task.title}`,
      action: 'task_created',
      metadata: { source, sourceId },
    });
    try {
      await this.runAgentLoop(task);
      const content = (task.result as { output?: string } | undefined)?.output ?? (task.result as { error?: string } | undefined)?.error ?? '';
      return { content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.result = { success: false, error: msg };
      task.updatedAt = Date.now();
      await this.persistTask(task);
      return { content: msg };
    }
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
      return { content: '服务未配置智能体执行能力，无法派发任务。' };
    }
    const overrides =
      agentDef.llmProviderId && agentDef.llmModelId
        ? { providerId: agentDef.llmProviderId, modelId: agentDef.llmModelId }
        : undefined;
    const llmConfig = await this.getLLMConfigForAgent(userId, overrides);
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      return { content: '当前用户未配置大模型，智能体无法执行。请到系统设置中配置并保存到云端。' };
    }
    const taskId = uuid();
    const task: Task = {
      id: taskId,
      domain: 'agent',
      title: `信号触发: ${agentDef.name}`,
      description: goal,
      status: 'running',
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        llmConfig,
        userId,
        systemPromptOverride: agentDef.systemPrompt,
        allowedToolNames: agentDef.toolNames?.length ? agentDef.toolNames : undefined,
        agentId: agentDef.id,
        source: 'signal_trigger',
        sourceId,
        ...(actionFingerprint ? { actionFingerprint } : {}),
      },
    };
    this.tasks.set(task.id, task);
    await this.persistTask(task);
    this.audit.log({
      id: uuid(),
      timestamp: Date.now(),
      taskId: task.id,
      type: 'intent',
      intent: `创建任务: 信号触发 ${agentDef.name}`,
      action: 'task_created',
      metadata: { source: 'signal_trigger', sourceId },
    });
    try {
      await this.runAgentLoop(task);
      const content = (task.result as { output?: string } | undefined)?.output ?? (task.result as { error?: string } | undefined)?.error ?? '';
      return { content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.result = { success: false, error: msg };
      task.updatedAt = Date.now();
      await this.persistTask(task);
      return { content: msg };
    }
  }

  // ── Private: step execution loop ─────────────────────────

  private async runSteps(task: Task, mode: ExecutionMode) {
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);

    try {
      for (const step of task.steps) {
        // Check abort
        if (controller.signal.aborted) {
          break;
        }

        // Skip completed / cancelled steps
        if (step.status === 'completed' || step.status === 'cancelled') {
          continue;
        }

        // ── Policy check ─────────────────────────────────
        const riskAssessment = this.policy.assessRisk(step);
        const runtimeType: RuntimeType =
          riskAssessment.requiresVM ? 'vm' : 'container';

        // If approval mode & step needs approval (only when step is still pending — avoid re-asking after approval)
        if (mode === 'approval' && riskAssessment.requiresApproval && step.status === 'pending') {
          step.status = 'awaiting_approval';
          task.status = 'awaiting_approval';
          task.updatedAt = Date.now();

          const approval: ApprovalRequest = {
            id: uuid(),
            stepId: step.id,
            taskId: task.id,
            action: step.action,
            riskLevel: riskAssessment.riskLevel,
            reason: riskAssessment.reason,
            status: 'pending',
            createdAt: Date.now(),
          };

          this.audit.log({
            id: uuid(),
            timestamp: Date.now(),
            taskId: task.id,
            stepId: step.id,
            type: 'approval',
            intent: `步骤需要审批: ${step.action}`,
            action: 'approval_requested',
            riskLevel: riskAssessment.riskLevel,
          });

          this.emitEvent({
            type: 'approval_needed',
            taskId: task.id,
            stepId: step.id,
            data: approval,
            timestamp: Date.now(),
          });

          // Stop execution — will resume when approved
          return;
        }

        // ── Execute step ─────────────────────────────────
        step.status = 'running';
        step.startedAt = Date.now();
        task.updatedAt = Date.now();
        await this.persistTask(task);

        this.audit.log({
          id: uuid(),
          timestamp: Date.now(),
          taskId: task.id,
          stepId: step.id,
          type: 'action',
          intent: step.action,
          action: `tool:${step.toolName}`,
          riskLevel: step.riskLevel,
          metadata: { runtimeType },
        });

        this.emitEvent({
          type: 'step_start',
          taskId: task.id,
          stepId: step.id,
          data: { action: step.action, toolName: step.toolName, runtimeType },
          timestamp: Date.now(),
        });

        // Execute (pass task LLM config + userId for per-user sandbox)
        const meta = task.metadata as { llmConfig?: TaskLLMConfig; userId?: string } | undefined;
        const accessors = this.getConfigAccessors();
        const call = await this.executor.execute(step, runtimeType, {
          llmConfig: meta?.llmConfig,
          userId: meta?.userId,
          getConfig: accessors.getConfig,
          setConfig: accessors.setConfig,
          reloadMcpForUser: this.reloadMcpForUser,
        });

        if (call.error) {
          step.status = 'failed';
          step.error = call.error;
          step.completedAt = Date.now();
          task.updatedAt = Date.now();

          this.audit.log({
            id: uuid(),
            timestamp: Date.now(),
            taskId: task.id,
            stepId: step.id,
            type: 'error',
            action: `tool:${step.toolName}`,
            result: call.error,
            riskLevel: step.riskLevel,
          });

          this.emitEvent({
            type: 'step_error',
            taskId: task.id,
            stepId: step.id,
            data: { error: call.error },
            timestamp: Date.now(),
          });

          // For MVP: fail the task on first step failure
          task.status = 'failed';
          task.result = { success: false, error: call.error };
          task.updatedAt = Date.now();
          await this.persistTask(task);

          this.emitEvent({
            type: 'task_complete',
            taskId: task.id,
            data: { success: false, error: call.error },
            timestamp: Date.now(),
          });
          fireHook('task_complete', { taskId: task.id, data: { success: false, error: call.error } });

          return;
        }

        // Step succeeded
        step.status = 'completed';
        step.output = call.output;
        step.completedAt = Date.now();
        task.updatedAt = Date.now();
        await this.persistTask(task);

        this.audit.log({
          id: uuid(),
          timestamp: Date.now(),
          taskId: task.id,
          stepId: step.id,
          type: 'result',
          intent: step.action,
          action: `tool:${step.toolName}`,
          result: JSON.stringify(call.output).slice(0, 200),
          riskLevel: step.riskLevel,
        });

        this.emitEvent({
          type: 'step_complete',
          taskId: task.id,
          stepId: step.id,
          data: { output: call.output },
          timestamp: Date.now(),
        });
      }

      // All steps completed
      if (!controller.signal.aborted) {
        task.status = 'completed';
        task.result = { success: true, output: '所有步骤已完成' };
        task.updatedAt = Date.now();
        await this.persistTask(task);

        this.emitEvent({
          type: 'task_complete',
          taskId: task.id,
          data: { success: true },
          timestamp: Date.now(),
        });
        fireHook('task_complete', { taskId: task.id, data: { success: true } });
      }
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  /** Agent 循环：LLM 多轮调用工具直至无 tool_calls（对齐 OpenClaw/OpenCode 不间断执行） */
  private async runAgentLoop(task: Task): Promise<void> {
    const meta = task.metadata as {
      llmConfig?: TaskLLMConfig;
      userId?: string;
      systemPromptOverride?: string;
      allowedToolNames?: string[];
      agentId?: string;
      chatContext?: Array<{ role: string; content: string }>;
      sourceMessage?: { fromId?: string; chatId?: string; targetType?: string };
    } | undefined;
    const llmConfig = meta?.llmConfig;
    const taskUserId = meta?.userId;
    if (!llmConfig?.providerId || !llmConfig?.modelId) {
      task.status = 'failed';
      task.result = { success: false, error: '缺少 llmConfig' };
      task.updatedAt = Date.now();
      await this.persistTask(task);
      this.emitEvent({ type: 'task_complete', taskId: task.id, data: task.result, timestamp: Date.now() });
      fireHook('task_complete', { taskId: task.id, data: task.result });
      return;
    }

    let tools = await this.getLLMToolDefsFiltered(taskUserId);
    const allowedToolNames = meta?.allowedToolNames;
    if (allowedToolNames?.length) {
      const set = new Set(allowedToolNames);
      tools = tools.filter((t) => set.has(t.name));
    }
    const awareness = getCurrentAwareness();
    const systemPromptOverride = meta?.systemPromptOverride;
    const systemPrompt =
      systemPromptOverride ??
      '你是 X-Computer 主脑。请根据用户需求使用可用工具逐步完成，完成后再用纯文本回复、不要再次调用工具。\n\n# 当前感知\n' +
        awareness +
        '\n\n可用工具：' +
        tools.map((t) => t.name).join(', ') +
        '。';
    const chatContext = (meta?.chatContext ?? []).filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0,
    );
    const chatContextTruncated = chatContext.slice(-16).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }));
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(chatContextTruncated.length > 0
        ? [
            ...chatContextTruncated.map((m) => ({ role: m.role, content: m.content } as ChatMessage)),
            { role: 'user' as const, content: `【用户本次请求】\n${task.description}` },
          ]
        : [{ role: 'user' as const, content: task.description }]),
    ];

    const MAX_STEPS = 30;
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);

    try {
      let finalContent = '';
      while (task.steps.length < MAX_STEPS) {
        const result = await callLLMWithTools(
          {
            messages,
            providerId: llmConfig.providerId,
            modelId: llmConfig.modelId,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
          },
          tools,
        );

        finalContent = result.content || '';

        if (!result.toolCalls?.length) {
          break;
        }

        messages.push({
          role: 'assistant',
          content: result.content || '',
          tool_calls: result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
        });

        const toolMessages = messages.filter((m) => m.role === 'tool');
        const recentToolResults =
          toolMessages.length > 0
            ? toolMessages
                .slice(-12)
                .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
                .join('\n\n')
                .slice(0, 16000)
            : undefined;

        const accessors = this.getConfigAccessors();
        const execContext = {
          llmConfig,
          userId: taskUserId,
          agentId: meta?.agentId,
          getConfig: accessors.getConfig,
          setConfig: accessors.setConfig,
          recentToolResults,
          reloadMcpForUser: this.reloadMcpForUser,
          taskMetadata: meta, // 传递任务 metadata，包括 sourceMessage
        };
        const stepsCreated: TaskStep[] = [];
        for (const tc of result.toolCalls) {
          const stepId = `${task.id}-step-${task.steps.length}`;
          const step: TaskStep = {
            id: stepId,
            taskId: task.id,
            action: tc.name,
            toolName: tc.name,
            toolInput: tc.arguments as Record<string, unknown>,
            status: 'running',
            riskLevel: 'low',
          };
          task.steps.push(step);
          stepsCreated.push(step);
          this.audit.log({
            id: uuid(),
            timestamp: Date.now(),
            taskId: task.id,
            stepId: step.id,
            type: 'action',
            intent: step.action,
            action: `tool:${step.toolName}`,
            riskLevel: 'low',
          });
          this.emitEvent({
            type: 'step_start',
            taskId: task.id,
            stepId: step.id,
            data: { action: step.action, toolName: step.toolName, runtimeType: 'container' },
            timestamp: Date.now(),
          });
        }
        task.updatedAt = Date.now();
        await this.persistTask(task);

        const toolCallsArray = result.toolCalls;
        const calls = await Promise.all(
          stepsCreated.map((step) => this.executor.execute(step, 'container', execContext)),
        );

        for (let i = 0; i < toolCallsArray.length; i++) {
          const tc = toolCallsArray[i];
          const step = stepsCreated[i];
          const call = calls[i]!;
          const toolOutput = call.error ? { error: call.error } : call.output;

          step.status = call.error ? 'failed' : 'completed';
          step.output = call.output;
          step.error = call.error;
          step.startedAt = call.startedAt;
          step.completedAt = call.completedAt ?? Date.now();
          task.updatedAt = Date.now();

          messages.push({
            role: 'tool',
            content: JSON.stringify(toolOutput),
            tool_call_id: tc.id,
          });

          this.audit.log({
            id: uuid(),
            timestamp: Date.now(),
            taskId: task.id,
            stepId: step.id,
            type: call.error ? 'error' : 'result',
            intent: step.action,
            action: `tool:${step.toolName}`,
            result: call.error ?? JSON.stringify(call.output).slice(0, 200),
          });
          this.emitEvent({
            type: 'step_complete',
            taskId: task.id,
            stepId: step.id,
            data: { output: call.output, error: call.error, durationMs: step.startedAt != null && step.completedAt != null ? step.completedAt - step.startedAt : undefined },
            timestamp: Date.now(),
          });

          if (call.error) {
            task.status = 'failed';
            const prevSteps = task.steps.slice(0, task.steps.length - stepsCreated.length);
            const lastSameTool = prevSteps.filter((s) => s.toolName === step.toolName).pop();
            const isRepeatedSameToolFailure = lastSameTool?.error != null || (lastSameTool?.output != null && typeof lastSameTool.output === 'object' && 'error' in lastSameTool.output);
            const friendlyError =
              isRepeatedSameToolFailure || (call.error.includes('参数不完整') || call.error.includes('请勿再次用空参数'))
                ? `模型调用工具「${step.toolName}」时未传入有效参数或多次失败，已中止。请勿重复用空参数调用，直接以文字回复用户。`
                : call.error;
            task.result = { success: false, error: friendlyError };
            task.updatedAt = Date.now();
            await this.persistTask(task);
            this.emitEvent({ type: 'task_complete', taskId: task.id, data: task.result, timestamp: Date.now() });
            fireHook('task_complete', { taskId: task.id, data: task.result });
            return;
          }
        }
        await this.persistTask(task);
      }

      if (!finalContent || finalContent.trim().length === 0) {
        task.status = 'failed';
        task.result = { success: false, error: '模型未返回有效回复' };
        task.updatedAt = Date.now();
        await this.persistTask(task);
        this.emitEvent({ type: 'task_complete', taskId: task.id, data: task.result, timestamp: Date.now() });
        fireHook('task_complete', { taskId: task.id, data: task.result });
        return;
      }

      task.status = 'completed';
      task.result = { success: true, output: finalContent.trim() };
      task.updatedAt = Date.now();
      await this.persistTask(task);
      this.emitEvent({ type: 'task_complete', taskId: task.id, data: { success: true, output: finalContent.trim() }, timestamp: Date.now() });
      fireHook('task_complete', { taskId: task.id, data: { success: true, output: finalContent.trim() } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.result = { success: false, error: msg };
      task.updatedAt = Date.now();
      await this.persistTask(task);
      this.emitEvent({ type: 'task_complete', taskId: task.id, data: task.result, timestamp: Date.now() });
      fireHook('task_complete', { taskId: task.id, data: task.result });
    } finally {
      this.abortControllers.delete(task.id);
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

  /**
   * 调度任务步骤执行（异步，不阻塞）
   * 配额检查已在 API 层完成，这里直接运行
   */
  private scheduleRunSteps(task: Task) {
    setImmediate(() => {
      this.runSteps(task, this.mode)
        .catch((err) => console.error(`Task ${task.id} failed:`, err));
    });
  }

  private emitEvent(event: TaskEvent) {
    this.emit('task_event', event);
  }
}
