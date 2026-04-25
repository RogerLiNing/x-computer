// ============================================================
// X-Computer API Constants
// ============================================================

export const API_VERSION = 'v1';

/** Default base URL for the X-Computer server */
export const DEFAULT_BASE_URL = 'http://localhost:4000';

/** Request timeout in milliseconds */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Max upload size in bytes (e.g., file writes) */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Auth ───────────────────────────────────────────────────

export const ENDPOINT_AUTH_SETTINGS = '/api/auth/settings';
export const ENDPOINT_AUTH_CAPTCHA = '/api/auth/captcha';
export const ENDPOINT_AUTH_REGISTER = '/api/auth/register';
export const ENDPOINT_AUTH_LOGIN = '/api/auth/login';

// ── Chat ───────────────────────────────────────────────────

export const ENDPOINT_CHAT = '/api/chat';
export const ENDPOINT_CHAT_WITH_TOOLS = '/api/chat/with-tools';
export const ENDPOINT_CHAT_AGENT = '/api/chat/agent';
export const ENDPOINT_CHAT_AGENT_STREAM = '/api/chat/agent/stream';
export const ENDPOINT_CHAT_CLASSIFY_INTENT = '/api/chat/classify-writing-intent';
export const ENDPOINT_CHAT_SUGGEST_FOLLOW_UPS = '/api/chat/suggest-follow-ups';
export const ENDPOINT_CHAT_TASK_COMPLETION_REPLY = '/api/chat/task-completion-reply';
export const ENDPOINT_CHAT_GENERATE_IMAGE = '/api/chat/generate-image';

// ── Tasks ──────────────────────────────────────────────────

export const ENDPOINT_TASKS = '/api/tasks';
export const ENDPOINT_TASK_PAUSE = (id: string) => `/api/tasks/${id}/pause`;
export const ENDPOINT_TASK_RESUME = (id: string) => `/api/tasks/${id}/resume`;
export const ENDPOINT_TASK_APPROVE = (id: string, stepId: string) => `/api/tasks/${id}/steps/${stepId}/approve`;
export const ENDPOINT_TASK_REJECT = (id: string, stepId: string) => `/api/tasks/${id}/steps/${stepId}/reject`;
export const ENDPOINT_TASK_RETRY = (id: string) => `/api/tasks/${id}/retry`;

// ── Agents ────────────────────────────────────────────────

export const ENDPOINT_AGENTS = '/api/agents';
export const ENDPOINT_AGENT_UPDATE = (id: string) => `/api/agents/${id}`;
export const ENDPOINT_AGENTS_DELETE = (id: string) => `/api/agents/${id}`;

// ── Teams ─────────────────────────────────────────────────

export const ENDPOINT_TEAMS = '/api/teams';
export const ENDPOINT_TEAM_UPDATE = (id: string) => `/api/teams/${id}`;
export const ENDPOINT_TEAMS_DELETE = (id: string) => `/api/teams/${id}`;

// ── Groups ─────────────────────────────────────────────────

export const ENDPOINT_GROUPS = '/api/groups';
export const ENDPOINT_GROUP_UPDATE = (id: string) => `/api/groups/${id}`;
export const ENDPOINT_GROUPS_DELETE = (id: string) => `/api/groups/${id}`;

// ── Memory ────────────────────────────────────────────────

export const ENDPOINT_MEMORY_STATUS = '/api/memory/status';
export const ENDPOINT_MEMORY_READ = '/api/memory/read';
export const ENDPOINT_MEMORY_RECALL = '/api/memory/recall';
export const ENDPOINT_MEMORY_CAPTURE = '/api/memory/capture';
export const ENDPOINT_MEMORY_TEST_EMBEDDING = '/api/memory/test-embedding';
export const ENDPOINT_MEMORY_REBUILD_INDEX = '/api/memory/rebuild-index';
export const ENDPOINT_MEMORY_CONSIDER_CAPTURE = '/api/memory/consider-capture';

// ── LLM ────────────────────────────────────────────────────

export const ENDPOINT_LLM_CONFIG = '/api/llm/config';
export const ENDPOINT_LLM_IMPORT_MODELS = '/api/llm/import-models';

// ── X Board ───────────────────────────────────────────────

export const ENDPOINT_X_BOARD = '/api/x/board';
export const ENDPOINT_X_BOARD_ITEM = (id: string) => `/api/x/board/${id}`;

// ── Error Codes ───────────────────────────────────────────

export const ERROR_CODE_RATE_LIMITED = 'RATE_LIMITED';
export const ERROR_CODE_UNAUTHORIZED = 'UNAUTHORIZED';
export const ERROR_CODE_FORBIDDEN = 'FORBIDDEN';
export const ERROR_CODE_NOT_FOUND = 'NOT_FOUND';
export const ERROR_CODE_INVALID_INPUT = 'INVALID_INPUT';
export const ERROR_CODE_SERVER_ERROR = 'SERVER_ERROR';
export const ERROR_CODE_NETWORK_ERROR = 'NETWORK_ERROR';
