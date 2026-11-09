import type { AuditEntry, ToolDefinition } from '@x-computer/shared';

/** Who started the run a tool call belongs to. Recorded on every audit row. */
export type Initiator =
  | { kind: 'user'; userId: string }
  | { kind: 'agent'; userId: string; agentId: string }
  | { kind: 'channel'; userId: string; channel: string }
  | { kind: 'scheduled'; userId: string; jobId?: string }
  | { kind: 'system' };

/** The subset of the execution context the pipeline reads. Callers may pass more. */
export interface PipelineContext {
  userId?: string;
  runId?: string;
  toolCallId?: string;
  agentId?: string;
  agentRunId?: string;
  signal?: AbortSignal;
  allowedToolNames?: string[];
  blockedToolNames?: string[];
  /** Permissions the current run holds; when present, tools whose requiredPermissions exceed it are denied. */
  grantedPermissions?: string[];
  initiator?: Initiator;
  taskMetadata?: Record<string, unknown>;
}

export interface ToolInvocation {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  definition?: ToolDefinition;
  context: PipelineContext;
}

export type PipelineDecision = { action: 'allow' } | { action: 'deny'; code: string; reason: string };

/** Runs before execution; returning a deny decision stops the call. `undefined` means "no opinion". */
export type PreExecutePolicy = (invocation: ToolInvocation) => Promise<PipelineDecision | undefined> | PipelineDecision | undefined;

/** Wraps execution; must call `next()` to run the inner stage. */
export type ExecuteWrapper = (invocation: ToolInvocation, next: () => Promise<unknown>) => Promise<unknown>;

/** Runs after a successful execution and may replace the result. */
export type PostExecuteHook = (invocation: ToolInvocation, result: unknown) => Promise<unknown> | unknown;

export type AuditSink = (entry: AuditEntry) => void;

export interface ToolPipelineOptions {
  policies?: PreExecutePolicy[];
  wrappers?: ExecuteWrapper[];
  postHooks?: PostExecuteHook[];
  audit?: AuditSink;
}
