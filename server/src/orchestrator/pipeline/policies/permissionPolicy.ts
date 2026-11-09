import type { PreExecutePolicy } from '../types.js';
import { missingPermissions } from '../../../packages/permissions.js';

export const PACKAGE_TOOL_PREFIX = 'pkg.';

export interface PermissionPolicyOptions {
  /** Which tools the grant check covers. Built-in tools are the host's own and are gated elsewhere. */
  appliesTo?: (toolName: string) => boolean;
}

/**
 * Denies a package tool whose declared `requiredPermissions` are not all granted to the run.
 * Only applies when the run states its grants (the permissions of the user's enabled packages).
 */
export function createPermissionPolicy(options: PermissionPolicyOptions = {}): PreExecutePolicy {
  const appliesTo = options.appliesTo ?? ((toolName: string) => toolName.startsWith(PACKAGE_TOOL_PREFIX));
  return ({ toolName, definition, context }) => {
    if (!appliesTo(toolName)) return undefined;
    const required = definition?.requiredPermissions ?? [];
    const granted = context.grantedPermissions;
    if (required.length === 0 || !granted) return undefined;
    const missing = missingPermissions(required, granted);
    if (missing.length === 0) return undefined;
    return { action: 'deny', code: 'permission', reason: `工具 ${toolName} 需要未授予的权限：${missing.join('、')}` };
  };
}
