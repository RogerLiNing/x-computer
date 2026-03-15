/**
 * MCP 客户端：stdio 传输（command + args，newline-delimited JSON-RPC）
 * 用于本地进程型 MCP 服务器，如 bing-cn-mcp、npx bing-cn-mcp
 */

import { spawn, type ChildProcess } from 'child_process';
import type { McpServerConfig, McpToolSchema, McpCallResult } from './types.js';

const RPC_TIMEOUT_MS = 25000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** 单进程 stdio 连接：维护子进程与请求 id 映射 */
class StdioConnection {
  private process: ChildProcess | null = null;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private server: McpServerConfig;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(server: McpServerConfig) {
    this.server = server;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.request<unknown>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: { name: 'x-computer', version: '0.1.0' },
    }).then(() => {
      this.initialized = true;
      this.initPromise = null;
      this.sendNotification('notifications/initialized');
    });
    return this.initPromise;
  }

  private sendNotification(method: string): void {
    if (!this.process?.stdin) return;
    const body = { jsonrpc: '2.0', method };
    this.process.stdin.write(JSON.stringify(body) + '\n', 'utf-8');
  }

  start(): void {
    if (this.process) return;
    const command = this.server.command!;
    const args = this.server.args ?? [];
    this.process = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env },
    });
    this.process.on('error', (err) => {
      this.rejectAll(new Error(`MCP ${this.server.id} spawn: ${err.message}`));
    });
    this.process.on('exit', (code, signal) => {
      this.process = null;
      if (this.pending.size > 0) {
        this.rejectAll(new Error(`MCP ${this.server.id} 进程退出 code=${code} signal=${signal}`));
      }
    });
    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) this.onLine(line);
      }
    });
    this.process.stderr?.on('data', (chunk: Buffer) => {
      // 仅记录，不参与 RPC
      process.stderr.write(`[MCP ${this.server.id}] ${chunk}`);
    });
  }

  private rejectAll(err: Error): void {
    for (const [, req] of this.pending) {
      clearTimeout(req.timeout);
      req.reject(err);
    }
    this.pending.clear();
  }

  private onLine(line: string): void {
    let data: { id?: number; result?: unknown; error?: { message: string } };
    try {
      data = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
    } catch {
      return;
    }
    const id = data.id;
    if (id == null) return;
    const req = this.pending.get(id);
    if (!req) return;
    clearTimeout(req.timeout);
    this.pending.delete(id);
    if (data.error) {
      req.reject(new Error(`MCP ${this.server.id}: ${data.error.message}`));
    } else {
      req.resolve(data.result);
    }
  }

  request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.process) this.start();
    const id = Math.floor(Math.random() * 1e9);
    const body = { jsonrpc: '2.0', id, method, params: params ?? {} };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`MCP ${this.server.id} ${method} 超时`));
        }
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timeout,
      });
      try {
        this.process!.stdin?.write(JSON.stringify(body) + '\n', 'utf-8');
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  close(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.rejectAll(new Error('MCP 连接已关闭'));
  }
}

const connections = new Map<string, StdioConnection>();

function getConnection(server: McpServerConfig): StdioConnection {
  let conn = connections.get(server.id);
  if (!conn) {
    conn = new StdioConnection(server);
    connections.set(server.id, conn);
  }
  return conn;
}

/** Stdio 传输：列出工具 */
export async function listToolsStdio(server: McpServerConfig): Promise<McpToolSchema[]> {
  const conn = getConnection(server);
  await conn.ensureInitialized();
  const result = (await conn.request<{ tools: McpToolSchema[]; nextCursor?: string }>('tools/list')) ?? { tools: [] };
  const tools = result.tools ?? [];
  let cursor: string | undefined = result.nextCursor;
  while (cursor) {
    const next = (await conn.request<{ tools: McpToolSchema[]; nextCursor?: string }>('tools/list', { cursor })) ?? { tools: [] };
    tools.push(...(next.tools ?? []));
    cursor = next.nextCursor;
  }
  return tools;
}

/** Stdio 传输：调用工具 */
export async function callToolStdio(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const conn = getConnection(server);
  await conn.ensureInitialized();
  const result = await conn.request<McpCallResult>('tools/call', { name: toolName, arguments: args });
  const content = result?.content ?? [];
  const text = content
    .filter((c) => c.type === 'text' && c.text != null)
    .map((c) => c.text!)
    .join('\n\n');
  return { text: text || '(无文本结果)', isError: result?.isError === true };
}

/** 关闭指定服务器 stdio 连接（重载时可选调用） */
export function closeStdioConnection(serverId: string): void {
  const conn = connections.get(serverId);
  if (conn) {
    conn.close();
    connections.delete(serverId);
  }
}

/** 关闭所有 stdio 连接 */
export function closeAllStdioConnections(): void {
  for (const [id, conn] of connections) {
    conn.close();
  }
  connections.clear();
}
