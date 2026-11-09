/**
 * Wire protocol between X and a node agent (`x-node`). One WebSocket per node, JSON text frames,
 * every frame is one `NodeMessage`. Requests carry an `id` and are answered by a message with the
 * same `id`; streams carry the id of the request they belong to.
 */

export const NODE_WS_PATH = '/api/nodes/ws';
export const NODE_PROTOCOL_VERSION = 1;

export type NodeLabel = string;

export interface NodeSpecs {
  hostname: string;
  platform: string;
  arch: string;
  cpus: number;
  memoryMb: number;
  agentVersion: string;
}

export interface NodeMetrics {
  load1: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskFreeMb?: number;
  runningTasks: number;
  uptimeSec: number;
}

/** Chat-shaped messages the node sends back for a model request; mirrors the server's ChatMessage. */
export interface NodeChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tool_call_id?: string;
}

export interface NodeToolDef { name: string; description: string; parameters: Record<string, unknown> }

export interface NodeTaskAssignment {
  taskId: string;
  userId: string;
  goal: string;
  /** Extra context the brain wants the node to know (file excerpts, constraints). */
  context?: string;
  /** Tool names the node may use; omitted = all local tools. */
  allowedTools?: string[];
  maxSteps?: number;
  timeoutMs?: number;
}

export type NodeProgressKind = 'thinking' | 'tool_start' | 'tool_result' | 'note';

export interface NodeTaskProgress {
  taskId: string;
  kind: NodeProgressKind;
  at: number;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  step?: number;
}

export interface NodeTaskResult {
  taskId: string;
  ok: boolean;
  content: string;
  /** Files the node produced, relative to its workspace, with sizes. */
  files?: Array<{ path: string; size: number }>;
  error?: string;
  steps: number;
  modelCalls: number;
}

// ── Node → X ───────────────────────────────────────────────────

export type NodeToServerMessage =
  | { type: 'hello'; version: number; specs: NodeSpecs; labels: NodeLabel[]; agentName?: string }
  | { type: 'heartbeat'; metrics: NodeMetrics }
  | { type: 'model/request'; id: string; taskId?: string; messages: NodeChatMessage[]; tools: NodeToolDef[] }
  | { type: 'task/progress'; progress: NodeTaskProgress }
  | { type: 'task/question'; taskId: string; questionId: string; question: string; options?: string[] }
  | { type: 'task/result'; result: NodeTaskResult }
  | { type: 'exec/output'; id: string; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'exec/exit'; id: string; exitCode: number | null; timedOut?: boolean }
  | { type: 'fs/result'; id: string; ok: boolean; data?: unknown; error?: string }
  | { type: 'error'; id?: string; message: string };

// ── X → Node ───────────────────────────────────────────────────

export type ServerToNodeMessage =
  | { type: 'welcome'; nodeId: string; serverTime: number; heartbeatIntervalMs: number }
  | { type: 'model/chunk'; id: string; delta: string }
  | { type: 'model/done'; id: string; content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { type: 'model/error'; id: string; message: string }
  | { type: 'task/assign'; task: NodeTaskAssignment }
  | { type: 'task/steer'; taskId: string; text: string }
  | { type: 'task/cancel'; taskId: string }
  | { type: 'task/answer'; taskId: string; questionId: string; answer: string }
  | { type: 'exec/run'; id: string; command: string; cwd?: string; timeoutMs?: number }
  | { type: 'exec/kill'; id: string }
  | { type: 'fs/read'; id: string; path: string }
  | { type: 'fs/write'; id: string; path: string; content: string }
  | { type: 'fs/list'; id: string; path: string }
  | { type: 'error'; id?: string; message: string };

export type NodeMessage = NodeToServerMessage | ServerToNodeMessage;

export function parseNodeMessage(raw: unknown): NodeMessage | undefined {
  try {
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw instanceof Uint8Array ? JSON.parse(Buffer.from(raw).toString('utf8')) : raw;
    if (!value || typeof value !== 'object' || typeof (value as { type?: unknown }).type !== 'string') return undefined;
    return value as NodeMessage;
  } catch {
    return undefined;
  }
}
