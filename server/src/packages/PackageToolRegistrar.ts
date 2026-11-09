import type { ToolDefinition, XPackageRecord, XPackageTool } from '@x-computer/shared';
import { serverLogger } from '../observability/ServerLogger.js';
import type { PackageRegistry } from './PackageRegistry.js';
import { impliedPermission } from './permissions.js';
import { createPackageToolHandler, type PackageToolDeps, type PackageToolHandler } from './toolHandlers.js';

export { PACKAGE_TOOL_PREFIX } from '../orchestrator/pipeline/policies/permissionPolicy.js';
import { PACKAGE_TOOL_PREFIX } from '../orchestrator/pipeline/policies/permissionPolicy.js';
export const PACKAGE_SCOPE_PREFIX = 'pkg:';

/** The executor surface the registrar needs; ToolExecutor and AgentOrchestrator both satisfy it. */
export interface DynamicToolHost {
  registerDynamicTool(definition: ToolDefinition, handler: PackageToolHandler, scope?: string): void;
  clearDynamicToolsByScope(scope: string): void;
}

export function packageToolName(tool: XPackageTool): string {
  return PACKAGE_TOOL_PREFIX + tool.name;
}

export function packageToolDefinition(record: XPackageRecord, tool: XPackageTool): ToolDefinition {
  return {
    name: packageToolName(tool),
    displayName: `${record.manifest.name} · ${tool.name}`,
    description: `[包 ${record.manifest.name}] ${tool.description}`,
    domain: ['chat', 'agent'],
    riskLevel: tool.riskLevel ?? 'low',
    parameters: tool.parameters,
    requiredPermissions: [impliedPermission(tool.impl)],
  };
}

function signatureOf(records: readonly XPackageRecord[]): string {
  return records.map((record) => `${record.manifest.id}@${record.updatedAt}:${record.enabled ? 1 : 0}`).join('|');
}

/**
 * Mirrors each user's enabled `tools` packages into the executor's per-user tool scope.
 * Loading is idempotent and cheap to call before every run: nothing is re-registered unless
 * the user's package rows changed.
 */
export class PackageToolRegistrar {
  private readonly loaded = new Map<string, string>();

  constructor(private readonly registry: PackageRegistry, private readonly host: DynamicToolHost, private readonly deps: PackageToolDeps) {}

  async ensureLoaded(userId: string | undefined): Promise<void> {
    if (!userId || userId === 'anonymous') return;
    const records = await this.registry.list(userId);
    const signature = signatureOf(records);
    if (this.loaded.get(userId) === signature) return;
    this.apply(userId, records);
    this.loaded.set(userId, signature);
  }

  async reload(userId: string): Promise<void> {
    this.loaded.delete(userId);
    await this.ensureLoaded(userId);
  }

  /** Every permission the user's enabled packages were installed with; undefined when the user has none. */
  async grantedPermissions(userId: string | undefined): Promise<string[] | undefined> {
    if (!userId || userId === 'anonymous') return undefined;
    const granted = new Set<string>();
    for (const record of await this.registry.list(userId)) {
      if (record.enabled) record.manifest.permissions.forEach((permission) => granted.add(permission));
    }
    return [...granted];
  }

  private apply(userId: string, records: readonly XPackageRecord[]): void {
    const scope = PACKAGE_SCOPE_PREFIX + userId;
    this.host.clearDynamicToolsByScope(scope);
    const seen = new Set<string>();
    for (const record of records) {
      if (!record.enabled || !record.manifest.tools) continue;
      for (const tool of record.manifest.tools) {
        const definition = packageToolDefinition(record, tool);
        if (seen.has(definition.name)) { serverLogger.warn('packages', `工具 ${definition.name} 在多个包中重复，保留先安装的包`); continue; }
        seen.add(definition.name);
        this.host.registerDynamicTool(definition, createPackageToolHandler(record, tool, this.deps), scope);
      }
    }
  }
}
