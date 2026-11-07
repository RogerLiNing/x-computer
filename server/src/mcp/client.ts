import { mcpHttpRequest } from './httpTransport.js';
/**
 * MCP 客户端：HTTP 或 Stdio 传输，统一 listTools / callTool 入口
 */

import type { McpServerConfig, McpToolSchema, McpCallResult, McpExecutionContext } from './types.js';
import { isMcpHttpTransport } from './types.js';
import { listToolsStdio, callToolStdio } from './clientStdio.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

const RPC_TIMEOUT_MS = 20000;

/** 解析 SSE 响应体，提取与 requestId 匹配的 JSON-RPC 响应 */
function parseSSEResponse<T>(
  body: string,
  requestId: number,
): { id?: number; result?: T; error?: { code: number; message: string } } | null {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const dataLine = line.startsWith('data:') ? line.slice(5).trim() : null;
    if (!dataLine || dataLine === '[DONE]') continue;
    try {
      const obj = JSON.parse(dataLine) as { id?: number; result?: T; error?: { code: number; message: string } };
      if (obj && (obj.result !== undefined || obj.error !== undefined)) {
        if (obj.id === requestId) return obj;

      }
    } catch {
      // skip non-JSON lines
    }
  }
  return null;
}

const AUTH_HEADER_KEYS = ['Authorization', 'authorization', 'api-key', 'Api-Key', 'apikey'];

/** User extensions can reference only their explicit variables; administrator presets may opt into host substitutions. */
function substituteEnv(str: string, env?: Record<string, string> | null, allowHostEnv = false): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const key = name.trim();
    if (env && typeof env[key] === 'string') return env[key]!;
    if (allowHostEnv && typeof process.env[key] === 'string') return process.env[key]!;
    throw new Error('扩展引用了未配置的环境变量');
  });
}

/** 对 URL 和 headers 做 env 替换，返回用于本次请求的 url 与 headers（不修改 server 原对象） */
function resolveUrlAndHeaders(server: McpServerConfig, context?: McpExecutionContext): { url: string; headers: Record<string, string> } {
  const env = server.env ?? null;
  const url = server.url ? substituteEnv(server.url, env, context?.trustedServer) : '';
  const headers: Record<string, string> = {};
  if (server.headers) {
    for (const [k, v] of Object.entries(server.headers)) {
      headers[k] = typeof v === 'string' ? substituteEnv(v, env, context?.trustedServer) : String(v ?? '');
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

async function rpcHttp<T>(server: McpServerConfig, method: string, params?: Record<string, unknown>, context?: McpExecutionContext): Promise<T> {
  context?.signal?.throwIfAborted();
  const id = Math.floor(Math.random() * 1e9);
  const {url,headers:configuredHeaders} = resolveUrlAndHeaders(server,context);
  const headers = mergeHeaders(headersFromUrl(url),configuredHeaders);
  if(headers.Authorization && !headers.Authorization.startsWith('Bearer ')) headers.Authorization=`Bearer ${headers.Authorization.trim()}`;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),context?.timeoutMs ?? RPC_TIMEOUT_MS);
  const abort=()=>controller.abort();context?.signal?.addEventListener('abort',abort,{once:true});
  let received=false;
  try{
    const response=await mcpHttpRequest(url,headers,JSON.stringify({jsonrpc:'2.0',id,method,params:params??{}}),{...context,owner:context?.owner??'platform',signal:controller.signal});
    const text=response.text;
    if(text.length>4*1024*1024)throw new Error('扩展响应过大');
    if(response.status<200||response.status>=300)throw new Error(`扩展请求失败（HTTP ${response.status}）`);
    const isSSE=response.contentType.includes('text/event-stream') || (text.includes('data:')&&!text.trim().startsWith('{'));
    const data=isSSE?parseSSEResponse<T>(text,id):JSON.parse(text);
    if(!data || data.id!==id || (!Object.hasOwn(data,'result')&&(!data.error||!Number.isInteger(data.error.code))))throw new Error('扩展没有返回匹配的执行回执');
    received=true;
    if(data.error)throw new Error('扩展返回执行错误');
    return data.result as T;
  }catch(error){
    if(method==='tools/call'&&!received)throw new UncertainToolOutcomeError('扩展执行结果未知，请核实后重新交办，系统不会自动重试。');
    throw error;
  }finally{clearTimeout(timeout);context?.signal?.removeEventListener('abort',abort);}
}

/**
 * 列出 MCP 服务器暴露的工具（自动选择 HTTP 或 Stdio）
 */
export async function listTools(server: McpServerConfig, context?: McpExecutionContext): Promise<McpToolSchema[]> {
  if (isMcpHttpTransport(server)) {
    const result = (await rpcHttp<{ tools: McpToolSchema[]; nextCursor?: string }>(server, 'tools/list',undefined,context)) ?? { tools: [] };
    const tools = result.tools ?? [];
    if (!Array.isArray(tools) || tools.length > 1000) throw new Error('扩展工具列表无效或过大');
    const cursors = new Set<string>();
    let cursor: string | undefined = result.nextCursor;
    while (cursor) {
      if (cursors.has(cursor) || cursors.size >= 32) throw new Error('扩展工具分页无效');
      cursors.add(cursor);
      const next = (await rpcHttp<{ tools: McpToolSchema[]; nextCursor?: string }>(server, 'tools/list', { cursor },context)) ?? { tools: [] };
      if (!Array.isArray(next.tools) || tools.length + next.tools.length > 1000) throw new Error('扩展工具列表无效或过大');
      tools.push(...(next.tools ?? []));
      cursor = next.nextCursor;
    }
    return tools;
  }
  return listToolsStdio(resolveStdioEnvironment(server,context),context);
}

/**
 * 调用 MCP 工具，返回文本结果（自动选择 HTTP 或 Stdio）
 */
export async function callTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  context?: McpExecutionContext,
): Promise<{ text: string; isError: boolean }> {
  context?.signal?.throwIfAborted();
  if (isMcpHttpTransport(server)) {
    const result = await rpcHttp<McpCallResult>(server, 'tools/call', { name: toolName, arguments: args },context);
    if(!result||!Array.isArray(result.content))throw new UncertainToolOutcomeError('扩展没有返回有效执行回执，请核实后重新交办。');
    const content = result.content;
    const text = content
      .filter((c) => c.type === 'text' && c.text != null)
      .map((c) => c.text!)
      .join('\n\n');
    return { text: text || '(无文本结果)', isError: result?.isError === true };
  }
  return callToolStdio(resolveStdioEnvironment(server,context), toolName, args,context);
}

function resolveStdioEnvironment(server: McpServerConfig, context?: McpExecutionContext): McpServerConfig {
  return {...server,env:Object.fromEntries(Object.entries(server.env??{}).map(([key,value])=>[key,substituteEnv(value,server.env,context?.trustedServer)]))};
}
