import type { AuditLogger } from '../../observability/AuditLogger.js';
import { createPermissionPolicy } from './policies/permissionPolicy.js';
import { createScopePolicy } from './policies/scopePolicy.js';
import { ToolPipeline } from './ToolPipeline.js';
import type { ToolPipelineOptions } from './types.js';
import { createTimeoutWrapper } from './wrappers/timeout.js';

export { ToolPipeline } from './ToolPipeline.js';
export { ToolDeniedError, ToolTimeoutError } from './errors.js';
export { resolveInitiator } from './initiator.js';
export type { Initiator, PipelineContext, PipelineDecision, PreExecutePolicy, ExecuteWrapper, PostExecuteHook, ToolInvocation, ToolPipelineOptions } from './types.js';

/** Ten minutes: generous for office/document generation, still a backstop against hung handlers. */
export const DEFAULT_TOOL_TIMEOUT_MS = 10 * 60 * 1000;

/** Tools that wait on purpose or are bounded by their own timeout parameters. */
export const LONG_RUNNING_TOOLS = ['sleep', 'docker.shell.interactive', 'x.run_agent', 'x.run_team', 'x.run_group', 'x.ask_user', 'video.text_to_video', 'video.image_to_video', 'video.reference_to_video', 'llm.generate_music'];

export function createDefaultToolPipeline(options: { audit?: AuditLogger; extra?: ToolPipelineOptions } = {}): ToolPipeline {
  const extra = options.extra ?? {};
  return new ToolPipeline({
    policies: [createScopePolicy(), createPermissionPolicy(), ...(extra.policies ?? [])],
    wrappers: [createTimeoutWrapper({ defaultMs: DEFAULT_TOOL_TIMEOUT_MS, exempt: LONG_RUNNING_TOOLS }), ...(extra.wrappers ?? [])],
    postHooks: extra.postHooks ?? [],
    audit: options.audit ? (entry) => options.audit!.log(entry) : extra.audit,
  });
}
