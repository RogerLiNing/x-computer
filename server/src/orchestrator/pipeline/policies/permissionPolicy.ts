import type { PreExecutePolicy } from '../types.js';

/**
 * Denies a tool whose declared `requiredPermissions` are not all granted to the run.
 * Only applies when the run states its grants; built-in tools declare none, so this gate
 * starts to matter once package tools carry permissions.
 */
export function createPermissionPolicy(): PreExecutePolicy {
  return ({ toolName, definition, context }) => {
    const required = definition?.requiredPermissions ?? [];
    const granted = context.grantedPermissions;
    if (required.length === 0 || !granted) return undefined;
    const missing = required.filter((permission) => !granted.includes(permission));
    if (missing.length === 0) return undefined;
    return { action: 'deny', code: 'permission', reason: `工具 ${toolName} 需要未授予的权限：${missing.join('、')}` };
  };
}
