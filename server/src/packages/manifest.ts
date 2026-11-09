import type { RiskLevel, ToolParameter, XPackageManifest, XPackageTool } from '@x-computer/shared';
import { impliedPermission, isPackagePermission, permissionCovers } from './permissions.js';

export const MANIFEST_FILE = 'x-package.json';

const ID_PATTERN = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const KINDS = ['ui', 'tools', 'skill'] as const;
const PARAMETER_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
const STARTUP_POLICIES = ['eager', 'on-demand', 'manual'] as const;
/** Tool names reserved for the host; a package may not shadow them. */
const RESERVED_TOOL_PREFIXES = ['x.', 'file.', 'shell.', 'llm.', 'memory', 'capability.', 'skill.', 'docker.', 'server.', 'office.', 'backend.', 'workflow.', 'signal.', 'mcp.', 'video.', 'python.', 'http.'];

export type ManifestValidation = { ok: true; manifest: XPackageManifest } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRelativeEntry(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 256) return false;
  const normalized = value.replace(/\\/g, '/');
  return !normalized.startsWith('/') && !/^[a-zA-Z]:/.test(normalized) && !normalized.split('/').includes('..') && !normalized.includes('\0');
}

function validateParameters(value: unknown, where: string, errors: string[]): ToolParameter[] {
  if (!Array.isArray(value)) { errors.push(`${where}.parameters 必须是数组`); return []; }
  return value.flatMap((item, index) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name || typeof item.description !== 'string'
      || !(PARAMETER_TYPES as readonly string[]).includes(item.type as string)) {
      errors.push(`${where}.parameters[${index}] 缺少 name/description 或 type 非法`);
      return [];
    }
    return [{ name: item.name, type: item.type as ToolParameter['type'], description: item.description, required: item.required === true, ...(item.default !== undefined ? { default: item.default } : {}) }];
  });
}

function validateImpl(value: unknown, where: string, errors: string[]): XPackageTool['impl'] | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') { errors.push(`${where}.impl 缺失`); return undefined; }
  switch (value.type) {
    case 'kv': return { type: 'kv' };
    case 'http':
      if (typeof value.url !== 'string' || !/^https?:\/\//.test(value.url)) { errors.push(`${where}.impl.url 必须是 http(s) 地址`); return undefined; }
      if (value.method !== undefined && !['GET', 'POST', 'PUT', 'DELETE'].includes(value.method as string)) { errors.push(`${where}.impl.method 非法`); return undefined; }
      return { type: 'http', url: value.url, ...(value.method ? { method: value.method as 'GET' } : {}) };
    case 'mcp':
      if (typeof value.server !== 'string' || typeof value.tool !== 'string') { errors.push(`${where}.impl 需要 server 与 tool`); return undefined; }
      return { type: 'mcp', server: value.server, tool: value.tool };
    case 'script':
      if (!isRelativeEntry(value.entry) || value.runtime !== 'python') { errors.push(`${where}.impl 需要包内 entry 且 runtime 为 python`); return undefined; }
      return { type: 'script', entry: value.entry, runtime: 'python' };
    default:
      errors.push(`${where}.impl.type 不支持：${String(value.type)}（允许 kv/http/mcp/script）`);
      return undefined;
  }
}

function validateTools(value: unknown, errors: string[]): XPackageTool[] {
  if (!Array.isArray(value)) { errors.push('tools 必须是数组'); return []; }
  return value.flatMap((item, index) => {
    const where = `tools[${index}]`;
    if (!isRecord(item)) { errors.push(`${where} 必须是对象`); return []; }
    if (typeof item.name !== 'string' || !TOOL_NAME_PATTERN.test(item.name)) { errors.push(`${where}.name 须形如 domain.action`); return []; }
    if (RESERVED_TOOL_PREFIXES.some((prefix) => item.name!.toString().startsWith(prefix))) { errors.push(`${where}.name 使用了系统保留前缀`); return []; }
    if (typeof item.description !== 'string' || !item.description) errors.push(`${where}.description 必填`);
    const parameters = validateParameters(item.parameters, where, errors);
    const impl = validateImpl(item.impl, where, errors);
    const riskLevel = item.riskLevel ?? 'low';
    if (!(RISK_LEVELS as readonly string[]).includes(riskLevel as string)) errors.push(`${where}.riskLevel 非法`);
    if (!impl) return [];
    return [{ name: item.name, description: String(item.description ?? ''), parameters, impl, riskLevel: riskLevel as RiskLevel }];
  });
}

/** Hand-rolled validation: the server has no schema library and manifests are small. Every problem is reported. */
export function validatePackageManifest(input: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['manifest 必须是 JSON 对象'] };
  if (input.format !== 1) errors.push('format 必须为 1');
  if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) errors.push('id 仅允许字母、数字、点、短横线、下划线，最长 128');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 255) errors.push('name 必填且不超过 255 字');
  if (typeof input.version !== 'string' || !SEMVER_PATTERN.test(input.version)) errors.push('version 必须是语义化版本，如 1.0.0');
  const kinds = Array.isArray(input.kinds) ? input.kinds.filter((kind): kind is XPackageManifest['kinds'][number] => (KINDS as readonly string[]).includes(kind as string)) : [];
  if (!Array.isArray(input.kinds) || kinds.length === 0 || kinds.length !== input.kinds.length) errors.push('kinds 至少包含 ui、tools、skill 之一');
  if (!Array.isArray(input.permissions)) errors.push('permissions 必须是数组');
  else input.permissions.forEach((permission, index) => { if (!isPackagePermission(permission)) errors.push(`permissions[${index}] 未知：${String(permission)}`); });
  for (const key of ['description', 'icon', 'author'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || (input[key] as string).length > 1024)) errors.push(`${key} 必须是字符串`);
  }
  let ui: XPackageManifest['ui'];
  if (kinds.includes('ui')) {
    if (!isRecord(input.ui) || !isRelativeEntry(input.ui.entry)) errors.push('ui.entry 必须是包内相对路径');
    else {
      const size = input.ui.defaultSize;
      const validSize = isRecord(size) && typeof size.width === 'number' && typeof size.height === 'number';
      ui = { entry: input.ui.entry, ...(validSize ? { defaultSize: { width: size.width as number, height: size.height as number } } : {}) };
    }
  }
  const tools = kinds.includes('tools') ? validateTools(input.tools, errors) : undefined;
  if (kinds.includes('tools') && tools && tools.length === 0 && errors.length === 0) errors.push('tools 至少声明一个工具');
  const declared = Array.isArray(input.permissions) ? input.permissions.filter(isPackagePermission) : [];
  for (const tool of tools ?? []) {
    const needed = impliedPermission(tool.impl);
    if (!permissionCovers(needed, declared)) errors.push(`工具 ${tool.name} 需要在 permissions 中声明 ${needed}`);
  }
  let skill: XPackageManifest['skill'];
  if (kinds.includes('skill')) {
    if (!isRecord(input.skill) || !isRelativeEntry(input.skill.entry)) errors.push('skill.entry 必须是包内相对路径');
    else skill = { entry: input.skill.entry };
  }
  if (input.engines !== undefined && (!isRecord(input.engines) || (input.engines['x-computer'] !== undefined && typeof input.engines['x-computer'] !== 'string'))) errors.push('engines.x-computer 必须是版本范围字符串');
  const startupPolicy = input.startupPolicy ?? 'on-demand';
  if (!(STARTUP_POLICIES as readonly string[]).includes(startupPolicy as string)) errors.push('startupPolicy 非法');
  if (errors.length > 0) return { ok: false, errors };
  const manifest: XPackageManifest = Object.freeze({
    format: 1, id: input.id as string, name: (input.name as string).trim(), version: input.version as string, kinds,
    ...(input.description ? { description: input.description as string } : {}),
    ...(input.icon ? { icon: input.icon as string } : {}),
    ...(input.author ? { author: input.author as string } : {}),
    ...(ui ? { ui } : {}), ...(tools ? { tools } : {}), ...(skill ? { skill } : {}),
    permissions: [...(input.permissions as string[])],
    ...(isRecord(input.engines) ? { engines: { ...(input.engines as { 'x-computer'?: string }) } } : {}),
    startupPolicy: startupPolicy as XPackageManifest['startupPolicy'],
  });
  return { ok: true, manifest };
}

/** The manifest a legacy mini app (id/name/path only) gets when migrated. */
export function manifestForMiniApp(app: { id: string; name: string; path: string }): XPackageManifest {
  return { format: 1, id: app.id, name: app.name, version: '0.1.0', kinds: ['ui'], ui: { entry: 'index.html' }, permissions: ['kv'], startupPolicy: 'on-demand' };
}
