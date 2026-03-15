/**
 * 加载 MCP 配置并向后端注册工具（ToolExecutor + CapabilityRegistry）
 */

import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';

import path from 'path';
import fs from 'fs/promises';
import type { ToolDefinition } from '../../../shared/src/index.js';
import type { McpServerConfig, McpToolSchema } from './types.js';
import { isMcpHttpTransport, isMcpStdioTransport } from './types.js';
import { listTools, callTool } from './client.js';
import { closeAllStdioConnections } from './clientStdio.js';
import { registerCapability } from '../capabilities/CapabilityRegistry.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { clearCapabilitiesBySource } from '../capabilities/CapabilityRegistry.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';

const MCP_TOOL_PREFIX = 'mcp.';

function schemaTypeToParamType(schemaType: string | undefined): 'string' | 'number' | 'boolean' | 'object' | 'array' {
  switch (schemaType) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

function mcpToolToDefinition(serverId: string, tool: McpToolSchema): ToolDefinition {
  const name = `${MCP_TOOL_PREFIX}${serverId}.${tool.name}`;
  const schema = tool.inputSchema ?? {};
  const properties = schema.properties ?? {};
  const requiredSet = new Set(schema.required ?? []);
  const parameters = Object.entries(properties).map(([pName, p]) => ({
    name: pName,
    type: schemaTypeToParamType(p.type),
    description: p.description ?? pName,
    required: requiredSet.has(pName),
  }));
  return {
    name,
    description: `[MCP] ${tool.description}`,
    domain: ['agent'],
    riskLevel: 'medium',
    parameters,
    requiredPermissions: ['network.outbound'],
  };
}

export interface McpLoadResult {
  servers: { id: string; name?: string; url?: string; transport: 'http' | 'stdio'; displayCommand?: string; toolsCount: number; error?: string }[];
  totalTools: number;
}

/** 将 mcpServers 对象或 servers 数组规范化为 McpServerConfig[] */
export function normalizeMcpConfig(
  config: { mcpServers?: Record<string, Record<string, unknown>>; servers?: McpServerConfig[] } | McpServerConfig[] | McpServerConfig,
): McpServerConfig[] {
  if (Array.isArray(config)) {
    return config.filter((s) => s && typeof s.id === 'string');
  }
  const obj = config as Record<string, unknown>;
  if (obj && typeof obj === 'object' && typeof obj.id === 'string' && (obj.url || obj.command)) {
    return [obj as unknown as McpServerConfig];
  }
  const mcpServers = obj?.mcpServers;
  if (mcpServers && typeof mcpServers === 'object') {
    return Object.entries(mcpServers).map(([id, cfg]) => {
      const c = cfg as Record<string, unknown>;
      const headers = normalizeHeadersRecord(c.headers);
      return {
        id,
        ...c,
        name: (c.name as string) ?? id,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      } as McpServerConfig;
    });
  }
  const servers = obj?.servers;
  if (Array.isArray(servers)) {
    return servers
      .filter((s) => s && typeof s.id === 'string')
      .map((s) => {
        const headers = normalizeHeadersRecord((s as Record<string, unknown>).headers);
        return { ...s, ...(headers && Object.keys(headers).length > 0 ? { headers } : {}), name: (s as McpServerConfig).name ?? s.id };
      });
  }
  return [];
}

/** 将 headers 规范化为 Record<string, string>，确保从 JSON/mcpServers 解析后鉴权等信息不丢失 */
function normalizeHeadersRecord(h: unknown): Record<string, string> | undefined {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (k && v != null && typeof v === 'string' && v.trim()) out[k] = v.trim();
    else if (k && v != null) out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 从文件或环境变量加载 MCP 配置。
 * 支持格式：{ servers: [...] } 或 { mcpServers: { id: { url/command, ... } } }
 * 文件路径：process.env.X_COMPUTER_MCP_CONFIG 或 工作区根/mcp-servers.json 或 cwd/mcp-servers.json
 */
export async function loadMcpConfig(workspaceRoot?: string): Promise<McpServerConfig[]> {
  const fromEnv = process.env.X_COMPUTER_MCP_SERVERS;
  if (fromEnv?.trim()) {
    try {
      const parsed = JSON.parse(fromEnv) as unknown;
      const servers = normalizeMcpConfig(
        Array.isArray(parsed) ? { servers: parsed } : (typeof parsed === 'object' && parsed !== null ? parsed : {}),
      );
      if (servers.length) return servers;
    } catch (e) {
      serverLogger.warn('mcp', 'X_COMPUTER_MCP_SERVERS JSON 解析失败', String(e));
      return [];
    }
  }
  const candidates = [
    process.env.X_COMPUTER_MCP_CONFIG,
    workspaceRoot ? path.join(workspaceRoot, 'mcp-servers.json') : null,
    path.join(process.cwd(), 'mcp-servers.json'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      const config = JSON.parse(raw) as unknown;
      const servers = normalizeMcpConfig(
        typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {},
      );
      if (servers.length) {
        serverLogger.info('mcp', `已从 ${p} 加载 ${servers.length} 个 MCP 服务器`);
        return servers;
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') serverLogger.warn('mcp', `读取 MCP 配置 ${p} 失败`, err?.message);
    }
  }
  return [];
}

/**
 * 加载 MCP 配置，发现各服务器工具并注册到 orchestrator 与能力列表
 */
export async function loadMcpAndRegister(
  orchestrator: AgentOrchestrator,
  workspaceRoot?: string,
): Promise<McpLoadResult> {
  const servers = await loadMcpConfig(workspaceRoot);
  const result: McpLoadResult = { servers: [], totalTools: 0 };
  lastLoadResult = result;

  for (const server of servers) {
    if (!isMcpHttpTransport(server) && !isMcpStdioTransport(server)) {
      serverLogger.warn('mcp', `跳过无效配置 ${server.id}：需 url（HTTP）或 command（Stdio）`);
      continue;
    }
    const transport = (isMcpHttpTransport(server) ? 'http' : 'stdio') as 'http' | 'stdio';
    const entry: { id: string; name?: string; url?: string; transport: 'http' | 'stdio'; displayCommand?: string; toolsCount: number; error?: string } = {
      id: server.id,
      name: server.name,
      url: server.url,
      transport,
      displayCommand: transport === 'stdio' && server.command ? [server.command, ...(server.args ?? [])].join(' ') : undefined,
      toolsCount: 0,
    };
    try {
      const tools = await listTools(server);
      for (const tool of tools) {
        const def = mcpToolToDefinition(server.id, tool);
        const handler = async (input: Record<string, unknown>) => {
          const out = await callTool(server, tool.name, input as Record<string, unknown>);
          if (out.isError) throw new Error(out.text);
          return { text: out.text };
        };
        orchestrator.registerDynamicTool(def, handler);
        registerCapability({ name: def.name, description: def.description, source: 'mcp' });
        result.totalTools++;
        entry.toolsCount++;
      }
      result.servers.push(entry);
    } catch (err: any) {
      entry.error = err?.message ?? String(err);
      result.servers.push(entry);
      serverLogger.warn('mcp', `MCP 服务器 ${server.id} 列举工具失败`, entry.error);
    }
  }

  if (result.totalTools > 0) {
    serverLogger.info('mcp', `MCP 已注册 ${result.totalTools} 个工具`, JSON.stringify(result.servers));
  }
  lastLoadResult = result;
  return result;
}

let lastLoadResult: McpLoadResult | null = null;

/** 供 GET /api/mcp/status 使用 */
export function getMcpStatus(): McpLoadResult | null {
  return lastLoadResult;
}

/** 获取 MCP 配置文件的写入路径（工作区根或 cwd） */
export function getMcpConfigPath(workspaceRoot?: string): string {
  const root = workspaceRoot || process.cwd();
  return path.join(root, 'mcp-servers.json');
}

/** 保存 MCP 配置到文件 */
export async function saveMcpConfig(workspaceRoot: string | undefined, servers: McpServerConfig[]): Promise<string> {
  const configPath = getMcpConfigPath(workspaceRoot);
  const config = { servers };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  serverLogger.info('mcp', `已保存 MCP 配置到 ${configPath}，共 ${servers.length} 个服务器`);
  return configPath;
}

/** 重载 MCP：关闭 stdio 连接、清除旧工具与能力，重新加载配置并注册 */
export async function reloadMcpAndRegister(
  orchestrator: AgentOrchestrator,
  workspaceRoot?: string,
): Promise<McpLoadResult> {
  closeAllStdioConnections();
  orchestrator.clearMcpTools();
  clearCapabilitiesBySource('mcp');
  return loadMcpAndRegister(orchestrator, workspaceRoot);
}

const MCP_SCOPE_PREFIX = 'mcp:';

/**
 * 按用户加载 MCP 配置并注册到该用户 scope，供 chat/agent 使用。
 * 从 userWorkspaceRoot 的 mcp-servers.json 或 db.getConfig(userId, 'mcp_config') 读取。
 */
export async function loadMcpAndRegisterForUser(
  orchestrator: AgentOrchestrator,
  userId: string,
  getUserWorkspaceRoot: (uid: string) => string,
  getConfig?: (uid: string, key: string) => string | undefined | Promise<string | undefined>,
): Promise<McpLoadResult> {
  const scope = MCP_SCOPE_PREFIX + userId;
  orchestrator.clearMcpToolsByScope(scope);

  let servers: McpServerConfig[] = [];
  const fromDbRaw = getConfig?.(userId, 'mcp_config');
  const fromDb = fromDbRaw instanceof Promise ? await fromDbRaw : fromDbRaw;
  if (fromDb?.trim()) {
    try {
      const parsed = JSON.parse(fromDb) as unknown;
      servers = normalizeMcpConfig(
        Array.isArray(parsed) ? { servers: parsed } : (typeof parsed === 'object' && parsed !== null ? parsed : {}),
      );
    } catch (e) {
      serverLogger.warn('mcp', `用户 ${userId} mcp_config JSON 解析失败`, String(e));
    }
  }
  if (servers.length === 0) {
    const userRoot = getUserWorkspaceRoot(userId);
    const configPath = path.join(userRoot, 'mcp-servers.json');
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(raw) as unknown;
      servers = normalizeMcpConfig(
        typeof config === 'object' && config !== null ? (config as Record<string, unknown>) : {},
      );
    } catch (err: any) {
      if (err?.code !== 'ENOENT') serverLogger.warn('mcp', `读取用户 MCP 配置 ${configPath} 失败`, err?.message);
    }
  }
  if (servers.length === 0) {
    const defaults = loadDefaultConfig()?.mcp_servers;
    if (defaults) {
      const raw =
        Array.isArray(defaults)
          ? { servers: defaults }
          : typeof defaults === 'object' && defaults !== null
            ? { mcpServers: defaults }
            : {};
      servers = normalizeMcpConfig(raw);
      if (servers.length > 0) {
        serverLogger.info('mcp', `用户 ${userId} 使用 .x-config.json 默认 MCP 服务器 ${servers.length} 个`);
      }
    }
  }
  if (servers.length === 0) {
    return { servers: [], totalTools: 0 };
  }

  const result: McpLoadResult = { servers: [], totalTools: 0 };
  for (const server of servers) {
    if (!isMcpHttpTransport(server) && !isMcpStdioTransport(server)) continue;
    const entry: { id: string; name?: string; url?: string; transport: 'http' | 'stdio'; displayCommand?: string; toolsCount: number; error?: string } = {
      id: server.id,
      name: server.name,
      url: server.url,
      transport: isMcpHttpTransport(server) ? 'http' as const : 'stdio' as const,
      displayCommand: isMcpStdioTransport(server) && server.command ? [server.command, ...(server.args ?? [])].join(' ') : undefined,
      toolsCount: 0,
    };
    try {
      const tools = await listTools(server);
      for (const tool of tools) {
        const def = mcpToolToDefinition(server.id, tool);
        const handler = async (input: Record<string, unknown>) => {
          const out = await callTool(server, tool.name, input as Record<string, unknown>);
          if (out.isError) throw new Error(out.text);
          return { text: out.text };
        };
        orchestrator.registerDynamicTool(def, handler, scope);
        result.totalTools++;
        entry.toolsCount++;
      }
      result.servers.push(entry);
    } catch (err: any) {
      entry.error = err?.message ?? String(err);
      result.servers.push(entry);
    }
  }
  return result;
}

/** 在调用 chat/agent 前确保该用户的 MCP 已加载（若用户有配置则加载） */
export async function ensureUserMcpLoaded(
  orchestrator: AgentOrchestrator,
  userId: string | undefined,
  getUserWorkspaceRoot: (uid: string) => string,
  getConfig?: (uid: string, key: string) => string | undefined | Promise<string | undefined>,
): Promise<void> {
  if (!userId || userId === 'anonymous') return;
  await loadMcpAndRegisterForUser(orchestrator, userId, getUserWorkspaceRoot, getConfig);
}
