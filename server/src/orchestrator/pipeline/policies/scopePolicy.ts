import type { PreExecutePolicy } from '../types.js';

/** Enforces the per-run allow and block lists that callers used to check by hand. */
export function createScopePolicy(): PreExecutePolicy {
  return ({ toolName, context }) => {
    if (context.blockedToolNames?.includes(toolName)) {
      return { action: 'deny', code: 'blocked', reason: `本轮已禁止使用工具 ${toolName}` };
    }
    if (context.allowedToolNames && !context.allowedToolNames.includes(toolName)) {
      return { action: 'deny', code: 'not_allowed', reason: `本轮未授权工具 ${toolName}` };
    }
    return undefined;
  };
}
