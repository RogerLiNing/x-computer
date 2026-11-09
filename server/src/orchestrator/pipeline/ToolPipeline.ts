import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '@x-computer/shared';
import { serverLogger } from '../../observability/ServerLogger.js';
import { ToolDeniedError } from './errors.js';
import { resolveInitiator } from './initiator.js';
import type { ExecuteWrapper, PipelineDecision, ToolInvocation, ToolPipelineOptions } from './types.js';

export type { ToolInvocation } from './types.js';

const RESULT_PREVIEW_CHARS = 400;

function preview(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return (text ?? 'null').slice(0, RESULT_PREVIEW_CHARS);
  } catch {
    return '[unserializable]';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every tool call passes through one ordered path:
 * pre-execute policies → audit "action" row → wrapped execution → post hooks → audit "result" row.
 * The action row is written before the handler runs, so no tool acts without a record existing first.
 */
export class ToolPipeline {
  private readonly policies;
  private readonly wrappers;
  private readonly postHooks;
  private readonly audit;

  constructor(options: ToolPipelineOptions = {}) {
    this.policies = options.policies ?? [];
    this.wrappers = options.wrappers ?? [];
    this.postHooks = options.postHooks ?? [];
    this.audit = options.audit;
  }

  async run(invocation: ToolInvocation, handler: () => Promise<unknown>): Promise<unknown> {
    const denial = await this.decide(invocation);
    if (denial) {
      this.record(invocation, 'approval', `denied:${denial.code} ${denial.reason}`);
      throw new ToolDeniedError(invocation.toolName, denial.code, denial.reason);
    }
    this.record(invocation, 'action', 'dispatch');
    const started = Date.now();
    try {
      const raw = await this.compose(invocation, handler)();
      const result = await this.applyPostHooks(invocation, raw);
      this.record(invocation, 'result', preview(result), { durationMs: Date.now() - started });
      return result;
    } catch (error: unknown) {
      this.record(invocation, 'error', errorMessage(error), { durationMs: Date.now() - started, errorName: error instanceof Error ? error.name : undefined });
      throw error;
    }
  }

  private async decide(invocation: ToolInvocation): Promise<Extract<PipelineDecision, { action: 'deny' }> | undefined> {
    for (const policy of this.policies) {
      const decision = await policy(invocation);
      if (decision?.action === 'deny') return decision;
    }
    return undefined;
  }

  private compose(invocation: ToolInvocation, handler: () => Promise<unknown>): () => Promise<unknown> {
    return this.wrappers.reduceRight<() => Promise<unknown>>(
      (next, wrapper: ExecuteWrapper) => () => wrapper(invocation, next),
      handler,
    );
  }

  private async applyPostHooks(invocation: ToolInvocation, result: unknown): Promise<unknown> {
    let current = result;
    for (const hook of this.postHooks) current = await hook(invocation, current);
    return current;
  }

  private record(invocation: ToolInvocation, type: AuditEntry['type'], result: string, extra: Record<string, unknown> = {}): void {
    if (!this.audit) return;
    const { context } = invocation;
    const entry: AuditEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      taskId: context.runId ?? context.agentRunId ?? '__tool__',
      stepId: invocation.id,
      type,
      action: invocation.toolName,
      result,
      riskLevel: invocation.definition?.riskLevel,
      metadata: {
        initiator: resolveInitiator(context),
        userId: context.userId,
        runId: context.runId,
        toolCallId: context.toolCallId ?? invocation.id,
        ...extra,
      },
    };
    try {
      this.audit(entry);
    } catch (error: unknown) {
      serverLogger.warn('tool', '审计写入失败', errorMessage(error));
    }
  }
}
