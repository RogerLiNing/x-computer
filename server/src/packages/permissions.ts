import type { XPackageToolImpl } from '@x-computer/shared';

/** Permission names a package may request; `network:` and `fs.read:` / `fs.write:` take a scope suffix. */
export const PACKAGE_PERMISSIONS = ['kv', 'queue', 'broadcast', 'notify', 'llm', 'scheduler', 'fs.read', 'fs.write', 'network', 'mcp', 'script'] as const;

export function isPackagePermission(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 256 || /\s/.test(value)) return false;
  const [head] = value.split(':', 1);
  return (PACKAGE_PERMISSIONS as readonly string[]).includes(head);
}

/** The permission a tool implementation needs at run time, derived from its declaration. */
export function impliedPermission(impl: XPackageToolImpl): string {
  switch (impl.type) {
    case 'kv': return 'kv';
    case 'mcp': return 'mcp';
    case 'script': return 'script';
    case 'http': {
      try { return `network:${new URL(impl.url).host}`; } catch { return 'network'; }
    }
  }
}

/**
 * `network:api.example.com` is covered by itself or by the bare `network`; a bare `network`
 * requirement is covered only by a bare grant. Scopes never widen.
 */
export function permissionCovers(required: string, granted: readonly string[]): boolean {
  if (granted.includes(required)) return true;
  const separator = required.indexOf(':');
  if (separator < 0) return false;
  return granted.includes(required.slice(0, separator));
}

export function missingPermissions(required: readonly string[], granted: readonly string[]): string[] {
  return required.filter((permission) => !permissionCovers(permission, granted));
}
