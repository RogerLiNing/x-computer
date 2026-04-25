// ============================================================
// X-Computer Core Types
// Matches server/src/routes/* and shared/src/index.ts
// ============================================================

// ── Auth ───────────────────────────────────────────────────

export interface AuthSettings {
  allowRegister: boolean;
}

export interface CaptchaChallenge {
  id: string;
  question: string;
}

export interface AuthResponse {
  userId: string;
}

export interface AuthError {
  error: string;
  code?: string;
  retryAfterSeconds?: number;
}

// ── LLM Config ─────────────────────────────────────────────

export type LLMModality = 'chat' | 'text' | 'video' | 'image' | 'image_edit' | 'vector';

export interface ModalityModelSelection {
  providerId: string;
  modelId: string;
}

export interface LLMProviderConfig {
  id: string;
  name: string;
  baseUrl?: string;
  apiKeyConfigured?: boolean;
  apiType?: 'openai' | 'anthropic';
}

export interface LLMSystemConfig {
  providers: LLMProviderConfig[];
  defaultByModality: Record<LLMModality, ModalityModelSelection>;
}

// ── Chat ───────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  duration?: number;
}

export interface ChatResponse {
  content: string;
}

export interface ChatWithToolsResponse {
  content: string;
  toolCalls: ToolCallRequest[];
  toolCallHistory: ToolCallRecord[];
}

export interface ChatAgentResponse {
  content: string;
  loadedToolNames?: string[];
}

export type WritingIntent =
  | 'generate_image'
  | 'generate_and_save_to_editor'
  | 'save_to_editor'
  | 'edit_current_document'
  | 'normal_chat'
  | 'create_task';

export interface ClassifyWritingIntentResponse {
  intent: WritingIntent;
  suggestedPath?: string;
  fallback?: boolean;
}

export interface SuggestFollowUpsResponse {
  suggestions: string[];
}

export interface GenerateImageResponse {
  content: string;
  images: string[];
}

export interface VectorConfig {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

// ── Tasks ─────────────────────────────────────────────────

export type TaskDomain = 'chat' | 'coding' | 'agent' | 'office';

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TaskLLMConfig {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface ChatContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CreateTaskRequest {
  domain: TaskDomain;
  title: string;
  description: string;
  mode?: 'auto' | 'approval';
  llmConfig?: TaskLLMConfig;
  useLlmPlan?: boolean;
  chatContext?: ChatContextMessage[];
}

export interface Task {
  id: string;
  domain: TaskDomain;
  title: string;
  description: string;
  status: TaskStatus;
  steps: TaskStep[];
  parentId?: string;
  createdAt: number;
  updatedAt: number;
  result?: TaskResult;
  metadata?: Record<string, unknown>;
}

export interface TaskStep {
  id: string;
  taskId: string;
  action: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  status: TaskStatus;
  output?: unknown;
  error?: string;
  riskLevel: RiskLevel;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface TaskEvent {
  type: 'status_change' | 'step_start' | 'step_complete' | 'step_error' | 'approval_needed' | 'task_complete';
  taskId: string;
  stepId?: string;
  data: unknown;
  timestamp: number;
}

// ── Agents ────────────────────────────────────────────────

export interface AgentDefinition {
  id: string;
  name: string;
  role?: string;
  systemPrompt: string;
  toolNames: string[];
  goalTemplate?: string;
  outputDescription?: string;
  llmProviderId?: string;
  llmModelId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTeam {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentGroup {
  id: string;
  name: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentListResponse {
  agents: AgentDefinition[];
}

export interface TeamListResponse {
  teams: AgentTeam[];
}

export interface GroupListResponse {
  groups: AgentGroup[];
}

// ── Memory ────────────────────────────────────────────────

export type RetrievalMode = 'keyword' | 'hybrid' | 'keyword_fallback';

export interface MemoryProviderStatus {
  configured: boolean;
  available: boolean;
  providerId: string;
  modelId: string;
}

export interface MemoryFallbackStatus {
  active: boolean;
  reason?: string;
}

export interface MemoryStatus {
  retrievalMode: RetrievalMode;
  provider: MemoryProviderStatus;
  lastEmbedError?: string;
  fallback: MemoryFallbackStatus;
  workspaceRoot?: string;
}

export interface MemoryRecallRequest {
  query?: string;
  days?: number;
  topK?: number;
  useHybrid?: boolean;
  vectorWeight?: number;
  textWeight?: number;
  workspaceId?: string;
  providerId?: string;
  modelId?: string;
}

export interface MemoryRecallResponse {
  content: string;
  vectorUsed?: boolean;
  embedError?: string;
}

export interface MemoryCaptureRequest {
  content: string;
  type?: 'preference' | 'decision' | 'fact';
  providerId?: string;
  modelId?: string;
  workspaceId?: string;
}

export interface TestEmbeddingRequest {
  providerId: string;
  modelId: string;
}

export interface TestEmbeddingResponse {
  ok: boolean;
  dimensions?: number;
  error?: string;
}

export interface RebuildIndexRequest {
  providerId: string;
  modelId: string;
  workspaceId?: string;
}

export interface RebuildIndexResponse {
  indexed: number;
  filesFound: number;
  fileNames: string[];
  workspaceRoot: string;
  embedError?: string;
}

// ── LLM Routes ────────────────────────────────────────────

export interface ImportModelsRequest {
  baseUrl: string;
  apiKey?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface ImportModelsResponse {
  models: ModelInfo[];
}

// ── X Board ───────────────────────────────────────────────

export type XBoardItemStatus = 'todo' | 'in_progress' | 'pending' | 'done';
export type XBoardItemPriority = 'low' | 'medium' | 'high';

export interface XBoardItem {
  id: string;
  title: string;
  description?: string;
  status: XBoardItemStatus;
  priority: XBoardItemPriority;
  created_at: string;
  updated_at: string;
}

export interface XBoardListResponse {
  ok: boolean;
  items: XBoardItem[];
}

export interface XBoardCreateRequest {
  title: string;
  description?: string;
  status?: XBoardItemStatus;
  priority?: XBoardItemPriority;
}

export interface XBoardCreateResponse {
  ok: boolean;
  item: XBoardItem;
}

export interface XBoardUpdateRequest {
  title?: string;
  description?: string;
  status?: XBoardItemStatus;
  priority?: XBoardItemPriority;
  sort_order?: number;
}

export interface XBoardUpdateResponse {
  ok: boolean;
  item: XBoardItem;
}

// ── API Response envelope ─────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

// ── Error ─────────────────────────────────────────────────

export class XComputerError extends Error {
  constructor(
    message: string,
    public code: string = 'UNKNOWN',
    public statusCode?: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'XComputerError';
  }
}
