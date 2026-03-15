/**
 * 能力注册表：内置工具 + 动态注册的 MCP/Skill
 * 主脑提示中的「当前可用能力」= getTools() + registry.getExtra()
 */

export type CapabilitySource = 'builtin' | 'mcp' | 'skill';

export interface RegisteredCapability {
  name: string;
  description: string;
  source: CapabilitySource;
}

const extra: RegisteredCapability[] = [];

export function registerCapability(cap: Omit<RegisteredCapability, 'source'> & { source?: CapabilitySource }): void {
  extra.push({
    name: cap.name,
    description: cap.description,
    source: cap.source ?? 'skill',
  });
}

export function getExtraCapabilities(): RegisteredCapability[] {
  return [...extra];
}

/** 按来源清除能力（如 MCP 重载前清除） */
export function clearCapabilitiesBySource(source: CapabilitySource): void {
  for (let i = extra.length - 1; i >= 0; i--) {
    if (extra[i].source === source) extra.splice(i, 1);
  }
}

export function listAllCapabilities(builtin: Array<{ name: string; description?: string }>): Array<{ name: string; description: string }> {
  const fromBuiltin = builtin.map((t) => ({ name: t.name, description: t.description ?? '' }));
  const fromExtra = extra.map((t) => ({ name: t.name, description: `[${t.source}] ${t.description}` }));
  return [...fromBuiltin, ...fromExtra];
}
