import type {
  AuthSettings,
  CaptchaChallenge,
  AuthResponse,
  ChatMessage,
  ToolCallRequest,
  ToolCallRecord,
  ChatWithToolsResponse,
  ChatAgentResponse,
  ClassifyWritingIntentResponse,
  SuggestFollowUpsResponse,
  GenerateImageResponse,
  VectorConfig,
  CreateTaskRequest,
  Task,
  AgentDefinition,
  AgentTeam,
  AgentGroup,
  MemoryStatus,
  MemoryRecallRequest,
  MemoryRecallResponse,
  MemoryCaptureRequest,
  TestEmbeddingRequest,
  TestEmbeddingResponse,
  RebuildIndexRequest,
  RebuildIndexResponse,
  LLMSystemConfig,
  ImportModelsRequest,
  ImportModelsResponse,
  XBoardItem,
  XBoardCreateRequest,
  XBoardUpdateRequest,
} from '@x-computer/core';
import {
  ENDPOINT_AUTH_SETTINGS,
  ENDPOINT_AUTH_CAPTCHA,
  ENDPOINT_AUTH_REGISTER,
  ENDPOINT_AUTH_LOGIN,
  ENDPOINT_CHAT,
  ENDPOINT_CHAT_WITH_TOOLS,
  ENDPOINT_CHAT_AGENT,
  ENDPOINT_CHAT_AGENT_STREAM,
  ENDPOINT_CHAT_CLASSIFY_INTENT,
  ENDPOINT_CHAT_SUGGEST_FOLLOW_UPS,
  ENDPOINT_CHAT_TASK_COMPLETION_REPLY,
  ENDPOINT_CHAT_GENERATE_IMAGE,
  ENDPOINT_TASKS,
  ENDPOINT_TASK_PAUSE,
  ENDPOINT_TASK_RESUME,
  ENDPOINT_TASK_APPROVE,
  ENDPOINT_TASK_REJECT,
  ENDPOINT_TASK_RETRY,
  ENDPOINT_AGENTS,
  ENDPOINT_AGENT_UPDATE,
  ENDPOINT_TEAMS,
  ENDPOINT_TEAM_UPDATE,
  ENDPOINT_GROUPS,
  ENDPOINT_GROUP_UPDATE,
  ENDPOINT_MEMORY_STATUS,
  ENDPOINT_MEMORY_READ,
  ENDPOINT_MEMORY_RECALL,
  ENDPOINT_MEMORY_CAPTURE,
  ENDPOINT_MEMORY_TEST_EMBEDDING,
  ENDPOINT_MEMORY_REBUILD_INDEX,
  ENDPOINT_MEMORY_CONSIDER_CAPTURE,
  ENDPOINT_LLM_CONFIG,
  ENDPOINT_LLM_IMPORT_MODELS,
  ENDPOINT_X_BOARD,
  ENDPOINT_X_BOARD_ITEM,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  XComputerError,
} from '@x-computer/core';

// ── Internal HTTP Client ───────────────────────────────────

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  params?: Record<string, string | number | boolean | undefined>;
}

interface Identity { userId?: string; cookie?: string }

interface HttpResponse<T> {
  cookie?: string;
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions,
  identity?: Identity,
): Promise<HttpResponse<T>> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, params } = options;

  let url = `${baseUrl}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (identity?.userId && identity.userId !== 'anonymous') {
    headers['X-User-Id'] = identity.userId;
  }

  if(identity?.cookie)headers.Cookie=identity.cookie;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new XComputerError(`Request timed out after ${timeoutMs}ms`, 'NETWORK_ERROR')), timeoutMs);
  });

  let res: Response;
  try {
    res = await Promise.race([
      fetch(url, {
        method,
        credentials: 'include',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      timeout,
    ]);
  } catch (err: unknown) {
    clearTimeout(timer!);
    const msg = err instanceof Error ? err.message : String(err);
    throw new XComputerError(msg, 'NETWORK_ERROR');
  }
  clearTimeout(timer!);

  const status = res.status;
  let data: T | undefined;
  let error: string | undefined;

  const text = await res.text();
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (status >= 200 && status < 300) {
        data = parsed as T;
      } else {
        error = parsed?.error ?? parsed?.message ?? `HTTP ${status}`;
      }
    } catch {
      error = text || `HTTP ${status}`;
    }
  } else if (status >= 400) {
    error = `HTTP ${status}`;
  }

  return { ok: status >= 200 && status < 300, status, data, error, cookie:res.headers.get('set-cookie')?.split(';')[0] };
}

async function get<T>(baseUrl: string, path: string, identity?: Identity, params?: Record<string, string | number | boolean | undefined>): Promise<HttpResponse<T>> {
  return request<T>(baseUrl, path, { method: 'GET', params }, identity);
}

async function post<T>(baseUrl: string, path: string, body: unknown, identity?: Identity, timeoutMs?: number): Promise<HttpResponse<T>> {
  return request<T>(baseUrl, path, { method: 'POST', body, timeoutMs }, identity);
}

async function put<T>(baseUrl: string, path: string, body: unknown, identity?: Identity): Promise<HttpResponse<T>> {
  return request<T>(baseUrl, path, { method: 'PUT', body }, identity);
}

async function patch<T>(baseUrl: string, path: string, body: unknown, identity?: Identity): Promise<HttpResponse<T>> {
  return request<T>(baseUrl, path, { method: 'PATCH', body }, identity);
}

async function del<T>(baseUrl: string, path: string, identity?: Identity): Promise<HttpResponse<T>> {
  return request<T>(baseUrl, path, { method: 'DELETE' }, identity);
}

function throwOnError<T>(res: HttpResponse<T>, context?: string): T {
  if (!res.ok || res.data === undefined) {
    const msg = res.error ?? `Request failed${context ? ` (${context})` : ''}`;
    throw new XComputerError(msg, 'SERVER_ERROR', res.status);
  }
  return res.data;
}

// ── XComputerClient ────────────────────────────────────────

export interface XComputerClientOptions {
  /** Base URL of the X-Computer server. Defaults to http://localhost:4000 */
  baseUrl?: string;
  /** User ID for authenticated requests. Set after login. */
  userId?: string;
  /** Request timeout in milliseconds. Defaults to 60000 */
  timeoutMs?: number;
}

/**
 * JavaScript/TypeScript SDK for X-Computer.
 *
 * @example
 * ```typescript
 * import { XComputerClient } from '@x-computer/sdk';
 *
 * const client = new XComputerClient({ baseUrl: 'http://localhost:4000' });
 *
 * // Authenticate
 * await client.login('user@example.com', 'password');
 *
 * // Chat
 * const reply = await client.chat({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   providerId: 'openai',
 *   modelId: 'gpt-4o',
 * });
 * console.log(reply.content);
 * ```
 */
export class XComputerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private _userId: string | undefined;
  private sessionCookie: string | undefined;
  private get identity(): Identity {return {userId:this._userId,cookie:this.sessionCookie};}

  constructor(options: XComputerClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._userId = options.userId;
  }

  // ── User / Auth ───────────────────────────────────────────

  /** Update the identity hint; authentication still requires login or register. */
  setUserId(userId: string): void {
    this._userId = userId;
  }

  /** Revoke the current server session before discarding its local credential. */
  async logout(): Promise<void> {
    const response=await post(this.baseUrl,'/api/auth/logout',{},this.identity);
    throwOnError(response);this._userId=undefined;this.sessionCookie=undefined;
  }

  /** Get the current user ID */
  getUserId(): string | undefined {
    return this._userId;
  }

  /** Get auth settings (allowRegister, etc.) — no auth required */
  async getAuthSettings(): Promise<AuthSettings> {
    const res = await get<AuthSettings>(this.baseUrl, ENDPOINT_AUTH_SETTINGS);
    return throwOnError(res);
  }

  /** Get a captcha challenge — no auth required */
  async getCaptcha(): Promise<CaptchaChallenge> {
    const res = await get<CaptchaChallenge>(this.baseUrl, ENDPOINT_AUTH_CAPTCHA);
    return throwOnError(res);
  }

  /** Register a new account */
  async register(
    email: string,
    password: string,
    captchaId: string,
    captchaAnswer: string,
  ): Promise<AuthResponse> {
    const res = await post<AuthResponse>(this.baseUrl, ENDPOINT_AUTH_REGISTER, {
      email,
      password,
      captchaId,
      captchaAnswer,
    });
    const data = throwOnError(res);
    if (data?.userId) {this._userId = data.userId;this.sessionCookie=res.cookie;}
    return data;
  }

  /** Login with email and password */
  async login(
    email: string,
    password: string,
    captchaId: string,
    captchaAnswer: string,
  ): Promise<AuthResponse> {
    const res = await post<AuthResponse>(this.baseUrl, ENDPOINT_AUTH_LOGIN, {
      email,
      password,
      captchaId,
      captchaAnswer,
    });
    const data = throwOnError(res);
    if (data?.userId) {this._userId = data.userId;this.sessionCookie=res.cookie;}
    return data;
  }

  // ── LLM Config ────────────────────────────────────────────

  /** Get the server's public LLM config (no apiKey values returned) */
  async getLLMConfig(): Promise<LLMSystemConfig> {
    const res = await get<LLMSystemConfig>(this.baseUrl, ENDPOINT_LLM_CONFIG);
    return throwOnError(res);
  }

  /** Import model list from a provider (avoids browser CORS) */
  async importModels(req: ImportModelsRequest): Promise<ImportModelsResponse> {
    const res = await post<ImportModelsResponse>(
      this.baseUrl,
      ENDPOINT_LLM_IMPORT_MODELS,
      req,
      this.identity,
    );
    return throwOnError(res);
  }

  // ── Chat ─────────────────────────────────────────────────

  /**
   * Simple chat with the LLM.
   * @param opts.messages Array of chat messages
   * @param opts.providerId LLM provider ID
   * @param opts.modelId LLM model ID
   * @param opts.stream Whether to stream the response (returns raw SSE stream if true)
   * @param opts.scene Chat scene (e.g., 'normal_chat', 'x_direct')
   */
  async chat(opts: {
    messages: ChatMessage[];
    providerId: string;
    modelId: string;
    stream?: boolean;
    scene?: string;
    vectorConfig?: VectorConfig;
  }): Promise<{ content: string }> {
    const { messages, providerId, modelId, stream, scene, vectorConfig } = opts;
    const res = await post<{ content: string }>(
      this.baseUrl,
      ENDPOINT_CHAT,
      { messages, providerId, modelId, stream, scene, vectorConfig },
      this.identity,
    );
    return throwOnError(res);
  }

  /**
   * Chat with tool-calling capability. The server executes server-side tools
   * and returns client-side tool calls in the response.
   */
  async chatWithTools(opts: {
    messages: ChatMessage[];
    providerId: string;
    modelId: string;
    tools: ToolCallRequest[];
    scene?: string;
  }): Promise<ChatWithToolsResponse> {
    const { messages, providerId, modelId, tools, scene } = opts;
    const res = await post<ChatWithToolsResponse>(
      this.baseUrl,
      ENDPOINT_CHAT_WITH_TOOLS,
      { messages, providerId, modelId, tools, scene },
      this.identity,
    );
    return throwOnError(res);
  }

  /**
   * Full AI assistant loop — executes tools server-side, supports image attachments.
   */
  async chatAgent(opts: {
    messages: ChatMessage[];
    providerId: string;
    modelId: string;
    scene?: string;
    agentId?: string;
    referenceImagePaths?: string[];
    attachedFilePaths?: string[];
    loadedToolNames?: string[];
  }): Promise<ChatAgentResponse> {
    const res = await post<ChatAgentResponse>(
      this.baseUrl,
      ENDPOINT_CHAT_AGENT,
      opts,
      this.identity,
      120_000,
    );
    return throwOnError(res);
  }

  /**
   * Streaming AI assistant loop via SSE.
   * Yields SSE event objects: { event: 'tool_start', data: ... }, { event: 'tool_complete', data: ... },
   * { event: 'content_chunk', data: { content: string } }, { event: 'done', data: { content, loadedToolNames } }
   */
  async *chatAgentStream(opts: {
    messages: ChatMessage[];
    providerId: string;
    modelId: string;
    scene?: string;
    agentId?: string;
    referenceImagePaths?: string[];
    attachedFilePaths?: string[];
    loadedToolNames?: string[];
  }): AsyncGenerator<{ event: string; data: Record<string, unknown> }> {
    const url = `${this.baseUrl}${ENDPOINT_CHAT_AGENT_STREAM}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this._userId && this._userId !== 'anonymous') {
      headers['X-User-Id'] = this._userId;
    }

    if(this.sessionCookie)headers.Cookie=this.sessionCookie;
    const res = await fetch(url, {
      credentials:'include',
      method: 'POST',
      headers,
      body: JSON.stringify(opts),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      try {
        const json = JSON.parse(text);
        throw new XComputerError(json?.error ?? `HTTP ${res.status}`, 'SERVER_ERROR', res.status);
      } catch (err) {
        if (err instanceof XComputerError) throw err;
        throw new XComputerError(`HTTP ${res.status}: ${text}`, 'SERVER_ERROR', res.status);
      }
    }

    const reader = res.body?.getReader();
    if (!reader) throw new XComputerError('No response body', 'NETWORK_ERROR');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]' || json === '') continue;
          try {
            const parsed = JSON.parse(json) as { error?: string; event?: string; data?: Record<string, unknown>; content?: string };
            if (parsed.error) throw new XComputerError(parsed.error, 'SERVER_ERROR');
            if (parsed.event && parsed.data) {
              yield { event: parsed.event, data: parsed.data };
            } else if (parsed.content !== undefined) {
              yield { event: 'content_chunk', data: { content: parsed.content } };
            }
          } catch (e) {
            if (e instanceof XComputerError) throw e;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Classify a writing intent from a user message */
  async classifyWritingIntent(opts: {
    userMessage: string;
    hasOpenAiDocument?: boolean;
    providerId: string;
    modelId: string;
  }): Promise<ClassifyWritingIntentResponse> {
    const res = await post<ClassifyWritingIntentResponse>(
      this.baseUrl,
      ENDPOINT_CHAT_CLASSIFY_INTENT,
      opts,
      this.identity,
    );
    return throwOnError(res);
  }

  /** Generate follow-up question suggestions based on a chat exchange */
  async suggestFollowUps(opts: {
    userMessage: string;
    assistantReply: string;
    providerId?: string;
    modelId?: string;
  }): Promise<SuggestFollowUpsResponse> {
    const res = await post<SuggestFollowUpsResponse>(
      this.baseUrl,
      ENDPOINT_CHAT_SUGGEST_FOLLOW_UPS,
      opts,
      this.identity,
    );
    return throwOnError(res);
  }

  /** Generate an AI completion message after a task completes */
  async taskCompletionReply(opts: {
    sessionId?: string;
    taskId: string;
    userMessage?: string;
    task: {
      title?: string;
      description?: string;
      status?: string;
      result?: { success?: boolean; output?: unknown; error?: string };
      steps?: Array<{ action?: string; output?: unknown; error?: string }>;
    };
  }): Promise<{ content: string }> {
    const res = await post<{ content: string }>(
      this.baseUrl,
      ENDPOINT_CHAT_TASK_COMPLETION_REPLY,
      opts,
      this.identity,
    );
    return throwOnError(res);
  }

  /** Generate an image using the configured image model */
  async generateImage(opts: {
    prompt: string;
    providerId: string;
    modelId: string;
  }): Promise<GenerateImageResponse> {
    const res = await post<GenerateImageResponse>(
      this.baseUrl,
      ENDPOINT_CHAT_GENERATE_IMAGE,
      opts,
      this.identity,
    );
    return throwOnError(res);
  }

  // ── Tasks ─────────────────────────────────────────────────

  /** Create and run a new task */
  async createTask(req: CreateTaskRequest): Promise<Task> {
    const res = await post<Task>(this.baseUrl, ENDPOINT_TASKS, req, this.identity);
    return throwOnError(res);
  }

  /** List all tasks (filtered to current user if authenticated) */
  async listTasks(): Promise<Task[]> {
    const res = await get<Task[]>(this.baseUrl, ENDPOINT_TASKS, this.identity);
    return throwOnError(res);
  }

  /** Get a specific task by ID */
  async getTask(id: string): Promise<Task> {
    const res = await get<Task>(this.baseUrl, `${ENDPOINT_TASKS}/${id}`, this.identity);
    return throwOnError(res);
  }

  /** Pause a running task */
  async pauseTask(id: string): Promise<boolean> {
    const res = await post<{ success: boolean }>(
      this.baseUrl,
      ENDPOINT_TASK_PAUSE(id),
      {},
      this.identity,
    );
    return throwOnError(res).success;
  }

  /** Resume a paused task */
  async resumeTask(id: string): Promise<boolean> {
    const res = await post<{ success: boolean }>(
      this.baseUrl,
      ENDPOINT_TASK_RESUME(id),
      {},
      this.identity,
    );
    return throwOnError(res).success;
  }

  /** Approve a pending step in a task */
  async approveStep(taskId: string, stepId: string): Promise<boolean> {
    const res = await post<{ success: boolean }>(
      this.baseUrl,
      ENDPOINT_TASK_APPROVE(taskId, stepId),
      {},
      this.identity,
    );
    return throwOnError(res).success;
  }

  /** Reject a pending step in a task */
  async rejectStep(taskId: string, stepId: string): Promise<boolean> {
    const res = await post<{ success: boolean }>(
      this.baseUrl,
      ENDPOINT_TASK_REJECT(taskId, stepId),
      {},
      this.identity,
    );
    return throwOnError(res).success;
  }

  /** Retry a failed task */
  async retryTask(id: string, mode: 'restart' | 'from_failure' = 'restart'): Promise<boolean> {
    const res = await post<{ success: boolean; mode: string }>(
      this.baseUrl,
      ENDPOINT_TASK_RETRY(id),
      { mode },
      this.identity,
    );
    return throwOnError(res).success;
  }

  // ── Agents ────────────────────────────────────────────────

  /** List all custom agents for the current user */
  async listAgents(): Promise<AgentDefinition[]> {
    const res = await get<{ agents: AgentDefinition[] }>(
      this.baseUrl,
      ENDPOINT_AGENTS,
      this.identity,
    );
    return throwOnError(res).agents;
  }

  /** Create a new custom agent */
  async createAgent(opts: {
    name: string;
    systemPrompt: string;
    toolNames?: string[];
    role?: string;
    goalTemplate?: string;
    outputDescription?: string;
    llmProviderId?: string;
    llmModelId?: string;
  }): Promise<{ agent: AgentDefinition; message: string }> {
    const res = await post<{ agent: AgentDefinition; message: string }>(
      this.baseUrl,
      ENDPOINT_AGENTS,
      opts,
      this.identity,
    );
    return throwOnError(res);
  }

  /** Update an existing agent */
  async updateAgent(
    id: string,
    opts: Partial<{
      name: string;
      systemPrompt: string;
      toolNames: string[];
      role: string;
      goalTemplate: string;
      outputDescription: string;
      llmProviderId: string;
      llmModelId: string;
    }>,
  ): Promise<{ agent: AgentDefinition; message: string }> {
    const res = await put<{ agent: AgentDefinition; message: string }>(
      this.baseUrl,
      ENDPOINT_AGENT_UPDATE(id),
      opts,
      this.identity,
    );
    return throwOnError(res);
  }

  /** Delete an agent */
  async deleteAgent(id: string): Promise<void> {
    const res = await del<{ message: string }>(
      this.baseUrl,
      ENDPOINT_AGENT_UPDATE(id),
      this.identity,
    );
    throwOnError(res);
  }

  // ── Teams ────────────────────────────────────────────────

  /** List all agent teams */
  async listTeams(): Promise<AgentTeam[]> {
    const res = await get<{ teams: AgentTeam[] }>(this.baseUrl, ENDPOINT_TEAMS, this.identity);
    return throwOnError(res).teams;
  }

  /** Create a new agent team */
  async createTeam(name: string, agentIds: string[]): Promise<{ team: AgentTeam; message: string }> {
    const res = await post<{ team: AgentTeam; message: string }>(
      this.baseUrl,
      ENDPOINT_TEAMS,
      { name, agent_ids: agentIds },
      this.identity,
    );
    return throwOnError(res);
  }

  /** Update a team */
  async updateTeam(id: string, opts: { name?: string; agentIds?: string[] }): Promise<{ team: AgentTeam; message: string }> {
    const res = await put<{ team: AgentTeam; message: string }>(
      this.baseUrl,
      ENDPOINT_TEAM_UPDATE(id),
      { name: opts.name, agent_ids: opts.agentIds },
      this.identity,
    );
    return throwOnError(res);
  }

  /** Delete a team */
  async deleteTeam(id: string): Promise<void> {
    const res = await del<{ message: string }>(
      this.baseUrl,
      ENDPOINT_TEAM_UPDATE(id),
      this.identity,
    );
    throwOnError(res);
  }

  // ── Groups ────────────────────────────────────────────────

  /** List all agent groups */
  async listGroups(): Promise<AgentGroup[]> {
    const res = await get<{ groups: AgentGroup[] }>(this.baseUrl, ENDPOINT_GROUPS, this.identity);
    return throwOnError(res).groups;
  }

  /** Create a new agent group */
  async createGroup(name: string, agentIds: string[]): Promise<{ group: AgentGroup; message: string }> {
    const res = await post<{ group: AgentGroup; message: string }>(
      this.baseUrl,
      ENDPOINT_GROUPS,
      { name, agent_ids: agentIds },
      this.identity,
    );
    return throwOnError(res);
  }

  /** Update a group */
  async updateGroup(id: string, opts: { name?: string; agentIds?: string[] }): Promise<{ group: AgentGroup; message: string }> {
    const res = await put<{ group: AgentGroup; message: string }>(
      this.baseUrl,
      ENDPOINT_GROUP_UPDATE(id),
      { name: opts.name, agent_ids: opts.agentIds },
      this.identity,
    );
    return throwOnError(res);
  }

  /** Delete a group */
  async deleteGroup(id: string): Promise<void> {
    const res = await del<{ message: string }>(
      this.baseUrl,
      ENDPOINT_GROUP_UPDATE(id),
      this.identity,
    );
    throwOnError(res);
  }

  // ── Memory ────────────────────────────────────────────────

  /** Get memory system status */
  async getMemoryStatus(): Promise<MemoryStatus> {
    const res = await get<MemoryStatus>(this.baseUrl, ENDPOINT_MEMORY_STATUS, this.identity);
    return throwOnError(res);
  }

  /**
   * Read a memory file by path.
   * @param path e.g. 'memory/2026-02-11.md'
   * @param opts.from Starting line number (0-indexed)
   * @param opts.lines Max number of lines to return
   */
  async readMemory(
    path: string,
    opts?: { from?: number; lines?: number },
  ): Promise<{ content: string; truncated?: boolean }> {
    const res = await get<{ content: string; truncated?: boolean }>(
      this.baseUrl,
      ENDPOINT_MEMORY_READ,
      this.identity,
      { path, from: opts?.from, lines: opts?.lines },
    );
    return throwOnError(res);
  }

  /** Recall memories matching a query (keyword or hybrid if vectorConfig provided) */
  async recallMemory(req: MemoryRecallRequest): Promise<MemoryRecallResponse> {
    const res = await post<MemoryRecallResponse>(
      this.baseUrl,
      ENDPOINT_MEMORY_RECALL,
      req,
      this.identity,
    );
    return throwOnError(res);
  }

  /** Capture a new memory entry */
  async captureMemory(req: MemoryCaptureRequest): Promise<void> {
    const res = await post<{ success: boolean }>(
      this.baseUrl,
      ENDPOINT_MEMORY_CAPTURE,
      req,
      this.identity,
    );
    throwOnError(res);
  }

  /** Test if an embedding provider/model is reachable */
  async testEmbedding(req: TestEmbeddingRequest): Promise<TestEmbeddingResponse> {
    const res = await post<TestEmbeddingResponse>(
      this.baseUrl,
      ENDPOINT_MEMORY_TEST_EMBEDDING,
      req,
      this.identity,
    );
    return throwOnError(res);
  }

  /** Rebuild the vector index from existing memory files */
  async rebuildMemoryIndex(req: RebuildIndexRequest): Promise<RebuildIndexResponse> {
    const res = await post<RebuildIndexResponse>(
      this.baseUrl,
      ENDPOINT_MEMORY_REBUILD_INDEX,
      req,
      this.identity,
      300_000,
    );
    return throwOnError(res);
  }

  // ── X Board ───────────────────────────────────────────────

  /** List all board items for the current user */
  async listBoardItems(): Promise<XBoardItem[]> {
    const res = await get<{ ok: boolean; items: XBoardItem[] }>(
      this.baseUrl,
      ENDPOINT_X_BOARD,
      this.identity,
    );
    return throwOnError(res).items;
  }

  /** Create a new board item */
  async createBoardItem(req: XBoardCreateRequest): Promise<XBoardItem> {
    const res = await post<{ ok: boolean; item: XBoardItem }>(
      this.baseUrl,
      ENDPOINT_X_BOARD,
      req,
      this.identity,
    );
    return throwOnError(res).item;
  }

  /** Update a board item */
  async updateBoardItem(id: string, req: XBoardUpdateRequest): Promise<XBoardItem> {
    const res = await patch<{ ok: boolean; item: XBoardItem }>(
      this.baseUrl,
      ENDPOINT_X_BOARD_ITEM(id),
      req,
      this.identity,
    );
    return throwOnError(res).item;
  }

  /** Delete a board item */
  async deleteBoardItem(id: string): Promise<void> {
    const res = await del<{ ok: boolean }>(
      this.baseUrl,
      ENDPOINT_X_BOARD_ITEM(id),
      this.identity,
    );
    throwOnError(res);
  }
}

// ── Factory helpers ────────────────────────────────────────

/** Create a client with a given base URL (convenience) */
export function createClient(baseUrl?: string): XComputerClient {
  return new XComputerClient({ baseUrl });
}
