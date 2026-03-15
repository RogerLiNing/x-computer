/**
 * MCP 客户端：HTTP 或 Stdio 传输，统一 listTools / callTool 入口
 */

import type { McpServerConfig, McpToolSchema, McpCallResult } from './types.js';
import { isMcpHttpTransport } from './types.js';
import { listToolsStdio, callToolStdio } from './clientStdio.js';
import { serverLogger } from '../observability/ServerLogger.js';

const RPC_TIMEOUT_MS = 20000;

/** 解析 SSE 响应体，提取与 requestId 匹配的 JSON-RPC 响应 */
function parseSSEResponse<T>(
  body: string,
  requestId: number,
): { id?: number; result?: T; error?: { code: number; message: string } } | null {
  let lastMatch: { id?: number; result?: T; error?: { code: number; message: string } } | null = null;
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const dataLine = line.startsWith('data:') ? line.slice(5).trim() : null;
    if (!dataLine || dataLine === '[DONE]') continue;
    try {
      const obj = JSON.parse(dataLine) as { id?: number; result?: T; error?: { code: number; message: string } };
      if (obj && (obj.result !== undefined || obj.error !== undefined)) {
        if (obj.id === requestId) return obj;
        lastMatch = obj;
      }
    } catch {
      // skip non-JSON lines
    }
  }
  return lastMatch;
}

const AUTH_HEADER_KEYS = ['Authorization', 'authorization', 'api-key', 'Api-Key', 'apikey'];

/** 将字符串中的 ${VAR} 替换为 env[VAR] ?? process.env[VAR] ?? ''（Cursor 兼容：用 env 或环境变量填 API Key） */
function substituteEnv(str: string, env?: Record<string, string> | null): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const key = name.trim();
    if (env && typeof env[key] === 'string') return env[key]!;
    if (typeof process.env[key] === 'string') return process.env[key]!;
    return '';
  });
}

/** 对 URL 和 headers 做 env 替换，返回用于本次请求的 url 与 headers（不修改 server 原对象） */
function resolveUrlAndHeaders(server: McpServerConfig): { url: string; headers: Record<string, string> } {
  const env = server.env ?? null;
  const url = server.url ? substituteEnv(server.url, env) : '';
  const headers: Record<string, string> = {};
  if (server.headers) {
    for (const [k, v] of Object.entries(server.headers)) {
      headers[k] = typeof v === 'string' ? substituteEnv(v, env) : String(v ?? '');
    }
  }
  return { url, headers };
}

/** 从 URL 解析 Authorization 等查询参数并补充到请求头（不修改 URL，保留所有原始参数） */
function headersFromUrl(url: string): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const u = new URL(url);
    const auth =
      u.searchParams.get('Authorization') ??
      u.searchParams.get('authorization') ??
      u.searchParams.get('api_key') ??
      u.searchParams.get('api-key') ??
      u.searchParams.get('apikey');
    if (auth) {
      headers.Authorization = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;
      headers['api-key'] = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
      headers['Api-Key'] = headers['api-key'];
      headers['apikey'] = headers['api-key'];
    }
  } catch {
    // ignore
  }
  return headers;
}

/** 合并请求头：鉴权类 header 优先用 urlHeaders（从 URL 解析），避免被 server.headers 空值覆盖导致间歇 401 */
function mergeHeaders(
  urlHeaders: Record<string, string>,
  serverHeaders?: Record<string, string> | null,
): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...serverHeaders,
    ...urlHeaders,
  };
  for (const k of AUTH_HEADER_KEYS) {
    if (urlHeaders[k] && (!base[k] || !String(base[k]).trim())) base[k] = urlHeaders[k];
  }
  return base;
}

async function rpcHttp<T>(server: McpServerConfig, method: string, params?: Record<string, unknown>): Promise<T> {
  const id = Math.floor(Math.random() * 1e9);
  const body = { jsonrpc: '2.0', id, method, params: params ?? {} };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  const { url: resolvedUrl, headers: resolvedServerHeaders } = resolveUrlAndHeaders(server);
  const urlHeaders = resolvedUrl ? headersFromUrl(resolvedUrl) : {};
  const headers = mergeHeaders(urlHeaders, resolvedServerHeaders);
  // 智谱等要求 Authorization 为 "Bearer your_api_key"，若用户只填了 key 则自动补上前缀
  if (headers.Authorization && !headers.Authorization.startsWith('Bearer ')) {
    headers.Authorization = `Bearer ${headers.Authorization.trim()}`;
  }
  // 始终使用原始 URL（保留全部 query 参数）
  let requestUrl = resolvedUrl || server.url!;
  // 智谱等：tools/call 要求鉴权在 URL 上，若 URL 无鉴权参数但 headers 有，则追加到 URL
  try {
    const u = new URL(requestUrl);
    const hasAuthInUrl =
      u.searchParams.has('Authorization') ||
      u.searchParams.has('authorization') ||
      u.searchParams.has('apikey') ||
      u.searchParams.has('api-key') ||
      u.searchParams.has('api_key');
    if (!hasAuthInUrl && headers.Authorization) {
      const authValue = headers.Authorization.startsWith('Bearer ')
        ? headers.Authorization.slice(7).trim()
        : headers.Authorization;
      u.searchParams.set('Authorization', authValue);
      u.searchParams.set('apikey', authValue);
      requestUrl = u.toString();
      serverLogger.info('mcp', `[${server.id}] URL 无鉴权参数，已从 Header 追加 Authorization 与 apikey 到 URL`);
    }
  } catch {
    // ignore
  }

  // 打印实际请求：URL、方法、请求头（明文，便于排查鉴权问题）、参数
  const paramsJson = JSON.stringify(params ?? {}, null, 2);
  serverLogger.info(
    'mcp',
    `MCP 请求 [${server.id}] ${method}`,
    `URL: ${requestUrl}\nMethod: POST\nHeaders: ${JSON.stringify(headers, null, 2)}\nParams:\n${paramsJson}`,
  );

  try {
    let res = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let text = await res.text();
    clearTimeout(timeout);
    if (!res.ok) {
      serverLogger.warn('mcp', `MCP HTTP [${server.id}] ${method}`, `status=${res.status} body=${text.slice(0, 200)}`);
    }
    if (res.status === 401 && Object.keys(urlHeaders).length > 0) {
      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), RPC_TIMEOUT_MS);
      try {
        res = await fetch(requestUrl, {
          method: 'POST',
          headers: mergeHeaders(urlHeaders, {}),
          body: JSON.stringify(body),
          signal: retryController.signal,
        });
        text = await res.text();
      } finally {
        clearTimeout(retryTimeout);
      }
    }
    if (!res.ok) {
      throw new Error(`MCP ${server.id} ${method} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const isSSE = contentType.includes('text/event-stream') || (text.includes('data:') && !text.trim().startsWith('{'));
    let data: { id?: number; result?: T; error?: { code: number; message: string } };
    if (isSSE) {
      const parsed = parseSSEResponse<T>(text, id);
      if (!parsed) throw new Error(`MCP ${server.id} ${method}: 无法从 SSE 响应中解析 JSON-RPC`);
      data = parsed as { id?: number; result?: T; error?: { code: number; message: string } };
    } else {
      data = JSON.parse(text) as { id?: number; result?: T; error?: { code: number; message: string } };
    }
    if (data.error) {
      serverLogger.warn('mcp', `MCP 响应 [${server.id}] ${method}`, `JSON-RPC error: ${data.error.message}`);
      throw new Error(`MCP ${server.id} ${method}: ${data.error.message}`);
    }
    // tools/call 等可能返回 result.isError，记录便于排查
    const result = data.result as T;
    if (result && typeof result === 'object' && 'isError' in result && (result as { isError?: boolean }).isError === true) {
      const content = (result as { content?: { text?: string }[] }).content;
      const firstText = content?.[0]?.text ?? '';
      serverLogger.warn(
        'mcp',
        `MCP 响应 [${server.id}] ${method} 业务错误`,
        firstText.slice(0, 300),
      );
    }
    return result;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * 列出 MCP 服务器暴露的工具（自动选择 HTTP 或 Stdio）
 */
export async function listTools(server: McpServerConfig): Promise<McpToolSchema[]> {
  if (isMcpHttpTransport(server)) {
    const result = (await rpcHttp<{ tools: McpToolSchema[]; nextCursor?: string }>(server, 'tools/list')) ?? { tools: [] };
    const tools = result.tools ?? [];
    let cursor: string | undefined = result.nextCursor;
    while (cursor) {
      const next = (await rpcHttp<{ tools: McpToolSchema[]; nextCursor?: string }>(server, 'tools/list', { cursor })) ?? { tools: [] };
      tools.push(...(next.tools ?? []));
      cursor = next.nextCursor;
    }
    return tools;
  }
  return listToolsStdio(server);
}

/**
 * 调用 MCP 工具，返回文本结果（自动选择 HTTP 或 Stdio）
 */
export async function callTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  if (isMcpHttpTransport(server)) {
    const result = await rpcHttp<McpCallResult>(server, 'tools/call', { name: toolName, arguments: args });
    const content = result?.content ?? [];
    const text = content
      .filter((c) => c.type === 'text' && c.text != null)
      .map((c) => c.text!)
      .join('\n\n');
    return { text: text || '(无文本结果)', isError: result?.isError === true };
  }
  return callToolStdio(server, toolName, args);
}
