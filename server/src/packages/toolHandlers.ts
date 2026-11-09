import type { XPackageRecord, XPackageTool } from '@x-computer/shared';
import type { AppDatabase } from '../db/database.js';
import { callTool as callMcpTool } from '../mcp/client.js';
import { normalizeMcpConfig } from '../mcp/loadAndRegister.js';
import type { McpServerConfig } from '../mcp/types.js';

/** What a package tool may reach: the database for kv, the user's MCP servers, and the host's python runner. */
export interface PackageToolDeps {
  db: Pick<AppDatabase, 'appBackendKvGet' | 'appBackendKvSet' | 'appBackendKvDelete' | 'appBackendKvList' | 'getConfig'>;
  /** Runs another registered tool on behalf of the same run (used for `script` implementations). */
  runTool: (name: string, input: Record<string, unknown>, context: PackageToolContext) => Promise<unknown>;
  fetchImpl?: typeof fetch;
}

export interface PackageToolContext { userId?: string; signal?: AbortSignal }

export type PackageToolHandler = (input: Record<string, unknown>, context?: PackageToolContext) => Promise<unknown>;

const HTTP_TIMEOUT_MS = 15_000;
const HTTP_MAX_BODY = 100 * 1024;
const KV_MAX_VALUE = 64 * 1024;

function requireUser(context: PackageToolContext | undefined): string {
  if (!context?.userId || context.userId === 'anonymous') throw new Error('需要已登录用户');
  return context.userId;
}

function kvHandler(record: XPackageRecord, deps: PackageToolDeps): PackageToolHandler {
  return async (input, context) => {
    const userId = requireUser(context);
    const pkg = record.manifest.id;
    const key = typeof input.key === 'string' ? input.key.slice(0, 256) : undefined;
    const op = typeof input.op === 'string' ? input.op : input.value !== undefined ? 'set' : key ? 'get' : 'list';
    switch (op) {
      case 'get': if (!key) throw new Error('key 必填'); return { key, value: await deps.db.appBackendKvGet(userId, pkg, key) ?? null };
      case 'set': {
        if (!key) throw new Error('key 必填');
        const value = typeof input.value === 'string' ? input.value : JSON.stringify(input.value ?? null);
        if (value.length > KV_MAX_VALUE) throw new Error('value 超过 64KB');
        await deps.db.appBackendKvSet(userId, pkg, key, value);
        return { ok: true, key };
      }
      case 'delete': if (!key) throw new Error('key 必填'); await deps.db.appBackendKvDelete(userId, pkg, key); return { ok: true, key };
      case 'list': return { keys: await deps.db.appBackendKvList(userId, pkg, typeof input.prefix === 'string' ? input.prefix : undefined) };
      default: throw new Error(`不支持的 op：${op}（允许 get/set/delete/list）`);
    }
  };
}

function httpHandler(tool: XPackageTool, deps: PackageToolDeps): PackageToolHandler {
  const impl = tool.impl as Extract<XPackageTool['impl'], { type: 'http' }>;
  const method = impl.method ?? 'GET';
  return async (input, context) => {
    const url = new URL(impl.url);
    const init: RequestInit = { method, signal: AbortSignal.any([AbortSignal.timeout(HTTP_TIMEOUT_MS), ...(context?.signal ? [context.signal] : [])]), redirect: 'manual' };
    if (method === 'GET') {
      for (const [key, value] of Object.entries(input)) if (value !== undefined) url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    } else {
      init.body = JSON.stringify(input);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const response = await (deps.fetchImpl ?? fetch)(url, init);
    const text = (await response.text()).slice(0, HTTP_MAX_BODY);
    return { status: response.status, ok: response.ok, body: text };
  };
}

async function userMcpServers(deps: PackageToolDeps, userId: string): Promise<McpServerConfig[]> {
  const raw = await deps.db.getConfig(userId, 'mcp_config');
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeMcpConfig(Array.isArray(parsed) ? { servers: parsed } : (typeof parsed === 'object' && parsed !== null ? parsed : {}));
  } catch {
    return [];
  }
}

function mcpHandler(tool: XPackageTool, deps: PackageToolDeps): PackageToolHandler {
  const impl = tool.impl as Extract<XPackageTool['impl'], { type: 'mcp' }>;
  return async (input, context) => {
    const userId = requireUser(context);
    const server = (await userMcpServers(deps, userId)).find((item) => item.id === impl.server || item.name === impl.server);
    if (!server) throw new Error(`未配置名为 ${impl.server} 的 MCP 服务器`);
    const result = await callMcpTool(server, impl.tool, input, { owner: userId, signal: context?.signal });
    if (result.isError) return { ok: false, error: result.text };
    return { ok: true, text: result.text };
  };
}

function scriptHandler(record: XPackageRecord, tool: XPackageTool, deps: PackageToolDeps): PackageToolHandler {
  const impl = tool.impl as Extract<XPackageTool['impl'], { type: 'script' }>;
  return async (input, context) => {
    requireUser(context);
    if (!record.path) throw new Error('该包没有文件目录，无法运行脚本');
    return deps.runTool('python.run', { scriptPath: `${record.path}/${impl.entry}`, args: [JSON.stringify(input)] }, context ?? {});
  };
}

export function createPackageToolHandler(record: XPackageRecord, tool: XPackageTool, deps: PackageToolDeps): PackageToolHandler {
  switch (tool.impl.type) {
    case 'kv': return kvHandler(record, deps);
    case 'http': return httpHandler(tool, deps);
    case 'mcp': return mcpHandler(tool, deps);
    case 'script': return scriptHandler(record, tool, deps);
  }
}
