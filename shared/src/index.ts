// ============================================================
// X-Computer Shared Types
// Unified task, execution, governance, and interaction models
// ============================================================

// ── Task Domain ────────────────────────────────────────────

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
  artifacts?: Artifact[];
}

export interface Artifact {
  type: 'file' | 'url' | 'text' | 'image' | 'data';
  name: string;
  content: string;
  mimeType?: string;
}

// ── Execution Model ────────────────────────────────────────

export type ExecutionMode = 'auto' | 'approval';

export interface ExecutionContext {
  taskId: string;
  mode: ExecutionMode;
  runtimeType: RuntimeType;
  sessionId: string;
  workingDirectory: string;
  env: Record<string, string>;
}

export type RuntimeType = 'container' | 'vm';

export interface RuntimeSession {
  id: string;
  type: RuntimeType;
  status: 'creating' | 'running' | 'paused' | 'terminated';
  containerId?: string;
  vmId?: string;
  createdAt: number;
  resourceLimits: ResourceLimits;
}

export interface ResourceLimits {
  cpuCores: number;
  memoryMB: number;
  diskMB: number;
  networkWhitelist: string[];
  maxExecutionSeconds: number;
}

// ── Governance Model ───────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type DataClassification = 'public' | 'internal' | 'sensitive' | 'regulated';

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  toolPattern: string;
  minRiskLevel: RiskLevel;
  requiresApproval: boolean;
  allowedRuntimes: RuntimeType[];
  dataClassification: DataClassification;
}

export interface ApprovalRequest {
  id: string;
  stepId: string;
  taskId: string;
  action: string;
  riskLevel: RiskLevel;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  taskId: string;
  stepId?: string;
  type: 'intent' | 'action' | 'result' | 'approval' | 'error' | 'system';
  intent?: string;
  action?: string;
  result?: string;
  riskLevel?: RiskLevel;
  metadata?: Record<string, unknown>;
}

// ── Tool System ────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  /** 用于界面展示的简短名称，如「生成图片」「编辑图片」；未设置时使用 name */
  displayName?: string;
  description: string;
  domain: TaskDomain[];
  riskLevel: RiskLevel;
  parameters: ToolParameter[];
  requiredPermissions: string[];
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  runtimeType: RuntimeType;
}

// ── Desktop & App Model ────────────────────────────────────

/** 内置应用 ID（系统预装，不可卸载） */
export type BuiltinAppId =
  | 'file-manager'
  | 'text-editor'
  | 'terminal'
  | 'browser'
  | 'chat'
  | 'x'
  | 'code-editor'
  | 'spreadsheet'
  | 'email'
  | 'calendar'
  | 'settings'
  | 'task-timeline'
  | 'image-viewer'
  | 'office-viewer'
  | 'media-viewer'
  | 'agent-manager'
  | 'x-board'
  | 'subscription'
  | 'admin'
;

/** 兼容旧用法：AppId 与 BuiltinAppId 同义 */
export type AppId = BuiltinAppId;

/** 任意应用标识：内置 ID 或安装应用的唯一 id（如 com.example.myapp） */
export type AppIdentifier = BuiltinAppId | string;

/** 应用类型：builtin = 内置，installed = 用户安装，miniapp = X 制作的小程序（有界面） */
export type AppSource = 'builtin' | 'installed' | 'miniapp';

/** X 制作的小程序定义：存于用户配置 x_mini_apps，对应沙箱内 apps/<id>/ 目录 */
export interface MiniAppDefinition {
  id: string;
  name: string;
  /** 相对沙箱根的路径，如 apps/calc */
  path: string;
}

/** 可用性：available = 真实可用，demo = 演示/占位（UI 可标注「演示」或「即将推出」） */
export type AppAvailability = 'available' | 'demo';

/**
 * 应用清单 — 符合开发规范的应用元数据，内置与安装应用均使用此结构。
 * 第三方开发者按此规范编写 manifest 即可被 X-Computer 识别并安装。
 */
export interface AppManifest {
  /** 唯一标识。内置应用使用如 file-manager；安装应用建议使用反向域名 com.xxx.appname */
  id: string;
  /** 显示名称 */
  name: string;
  /** 简短描述 */
  description?: string;
  /** 可用性：不填视为 available；demo 时 UI 可弱化或标注「演示」 */
  availability?: AppAvailability;
  /** 版本，语义化版本如 1.0.0 */
  version?: string;
  /** 作者或组织 */
  author?: string;
  /** 来源：builtin | installed */
  source: AppSource;
  /**
   * 图标：lucide-react 图标名（如 FolderOpen）或 URL。
   * 内置应用使用 lucide 名，安装应用可填 URL 或 lucide 名。
   */
  icon: string;
  /**
   * 仅当 source=installed 时有效。
   * aliasBuiltin：作为某内置应用的快捷方式，打开时使用该内置应用的界面与能力。
   * entry：未来支持，指向应用模块 URL，用于加载第三方实现的界面。
   */
  aliasBuiltin?: BuiltinAppId;
  entry?: string;
  /** 建议默认窗口宽高 */
  defaultSize?: { width: number; height: number };
}

export interface AppWindow {
  id: string;
  appId: AppIdentifier;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isMaximized: boolean;
  isFocused: boolean;
  zIndex: number;
  metadata?: Record<string, unknown>;
}

export interface DesktopState {
  windows: AppWindow[];
  activeWindowId: string | null;
  executionMode: ExecutionMode;
  taskbarPinned: AppIdentifier[];
  notifications: Notification[];
}

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'approval';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  actionRequired?: boolean;
  relatedTaskId?: string;
}

// ── Computer Context (for AI awareness) ────────────────────

/** 任务摘要，供总 AI 感知当前任务状态 */
export interface TaskSummary {
  id: string;
  domain: TaskDomain;
  title: string;
  status: TaskStatus;
  stepsDone: number;
  stepsTotal: number;
}

/** 前端上报的整机状态，总 AI 可感知 */
export interface ComputerContext {
  timestamp: number;
  executionMode: ExecutionMode;
  activeWindowId: string | null;
  windows: Array<Pick<AppWindow, 'id' | 'appId' | 'title' | 'isMinimized' | 'isFocused' | 'metadata'>>;
  tasks: TaskSummary[];
  taskbarPinned: AppIdentifier[];
  notificationCount: number;
  /** 可选：当前焦点窗口打开的文件路径等 */
  activeContext?: { filePath?: string; appId?: AppIdentifier; [k: string]: unknown };
}

// ── API Messages ───────────────────────────────────────────

/** 任务执行时使用的 LLM 配置（如 llm.generate 工具）；由前端从设置带入，不落库到审计 */
export interface TaskLLMConfig {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

/** 近期对话记录，供任务 Agent 了解上下文 */
export interface ChatContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CreateTaskRequest {
  domain: TaskDomain;
  title: string;
  description: string;
  mode?: ExecutionMode;
  /** 可选：任务内 llm.generate 等工具使用的 LLM 配置 */
  llmConfig?: TaskLLMConfig;
  /** 为 true 且提供 llmConfig 时，用 LLM 根据描述生成步骤（否则用模板） */
  useLlmPlan?: boolean;
  /** 可选：助手对话中触发任务时传入近期对话，供 Agent 了解前文 */
  chatContext?: ChatContextMessage[];
}

export interface TaskEvent {
  type: 'status_change' | 'step_start' | 'step_complete' | 'step_error' | 'approval_needed' | 'task_complete';
  taskId: string;
  stepId?: string;
  data: unknown;
  timestamp: number;
}

// ── LLM / Model Provider Config ────────────────────────────

/** 能力模态：聊天、长文本、视频、文生图、图生图（图像编辑/参考图）、向量嵌入 */
export type LLMModality = 'chat' | 'text' | 'video' | 'image' | 'image_edit' | 'vector';

/** 单模态下选中的提供商与模型 */
export interface ModalityModelSelection {
  providerId: string;
  modelId: string;
}

/** 单个大模型提供商配置（API Key 由前端安全存储，不参与序列化到后端） */
export interface LLMProviderConfig {
  id: string;
  name: string;
  /** 可选，如 OpenAI 兼容端点或 Ollama 地址 */
  baseUrl?: string;
  /** 是否已配置 API Key（不传输实际密钥） */
  apiKeyConfigured?: boolean;
}

/** 系统级大模型配置：提供商列表 + 各模态默认模型 */
export interface LLMSystemConfig {
  providers: LLMProviderConfig[];
  /** 各模态默认使用的提供商与模型 */
  defaultByModality: Record<LLMModality, ModalityModelSelection>;
}

// ── Workflow Templates ─────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  domain: TaskDomain;
  steps: WorkflowStepTemplate[];
  tags: string[];
}

export interface WorkflowStepTemplate {
  name: string;
  toolName: string;
  inputTemplate: Record<string, unknown>;
  description: string;
}

// ── X 主脑创建的智能体定义（管理者创建，由智能体执行） ─────────────────────

/** X 创建的智能体：独立提示词、可用工具、目标/输出说明，X 派发任务给智能体执行 */
export interface AgentDefinition {
  id: string;
  name: string;
  /** 角色标签（如写手、审核、数据分析师），便于组队与派活 */
  role?: string;
  /** 该智能体的系统提示词（角色、能力、约束） */
  systemPrompt: string;
  /** 该智能体可调用的工具名列表（为空则使用全部可用工具） */
  toolNames: string[];
  /** 目标描述模板或说明（派发任务时可作为 goal 填入） */
  goalTemplate?: string;
  /** 期望输出内容说明（供 X 或用户理解该智能体产出什么） */
  outputDescription?: string;
  /** 可选：该智能体执行时使用的大模型提供商 ID（由 llm.* 工具管理） */
  llmProviderId?: string;
  /** 可选：该智能体执行时使用的大模型 ID（由 llm.* 工具管理） */
  llmModelId?: string;
  createdAt: number;
  updatedAt: number;
}

/** X 创建的智能体团队：有序的智能体 id 列表，用于流水线协作（如收集→撰写→审核） */
export interface AgentTeam {
  id: string;
  name: string;
  /** 按执行顺序排列的智能体 id */
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}

// ── X 近期已完成（x.record_done 写入，结构化便于解析展示）────────────────

export interface XDoneLogEntry {
  at: number;
  summary: string;
  scheduled?: boolean;
  /** 定时任务的时间/频率描述，如「每晚20点」「每周一」 */
  schedule?: string;
  /** 任务标题/类型，如「叶酸提醒」 */
  title?: string;
  /** 具体动作描述，如「发送邮件给用户」 */
  action?: string;
}

// ── X Board (任务看板) ────────────────────────────────────

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

/** X 创建的智能体群组：类似群聊，主脑可把多个智能体放进群组、主动派发任务、收集各成员产出 */
export interface AgentGroup {
  id: string;
  name: string;
  /** 群组成员（智能体 id 列表） */
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
}
