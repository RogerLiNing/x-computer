/** Isolated newline-delimited MCP transport. Host commands are never accepted. */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { McpServerConfig, McpToolSchema, McpCallResult, McpExecutionContext } from './types.js';
import { MCP_STDIO_RUNNER } from './stdioRunner.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
import { dockerHostArgs } from '../docker/dockerSocket.js';

const exec = promisify(execFile);
const MAX_BUFFER = 4 * 1024 * 1024;
const dockerEnv = () => ({ PATH: process.env.PATH, HOME: process.env.HOME });
const dockerArgs = dockerHostArgs();
interface Pending {
  resolve(value: unknown): void; reject(error: Error): void;
  cleanup(): void; method: string;
}
export function validateStdioServer(server: McpServerConfig): void {
  if (typeof server.id !== 'string' || !server.id || server.id.length > 128) throw new Error('扩展编号无效');
  if (typeof server.command !== 'string' || !server.command || server.command.includes('\0') || server.command.length > 4096) throw new Error('扩展启动命令无效');
  if (server.args !== undefined && (!Array.isArray(server.args) || server.args.length > 128 || server.args.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 16384))) throw new Error('扩展启动参数无效');
  if (server.env !== undefined && (!server.env || Array.isArray(server.env) || typeof server.env !== 'object' || Object.entries(server.env).some(([key,value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0') || value.length > 65536))) throw new Error('扩展环境变量无效');
}
class StdioConnection {
  private process?: ChildProcess;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private stderr = '';
  private pid?: number;
  private nextId = 1;
  private initialized?: Promise<void>;
  private closing?: Promise<void>;
  closed = false;
  constructor(private server: McpServerConfig, private context: McpExecutionContext) {}
  private start(): void {
    if (this.process) return;
    if (this.closed) throw new Error('扩展连接已关闭');
    this.process = spawn('docker', [...dockerArgs, 'exec', '-i', '--workdir', '/tmp', this.context.containerId!, 'node', '-e', MCP_STDIO_RUNNER], { shell: false, stdio: ['pipe','pipe','pipe'], env: dockerEnv() });
    this.process.stdin?.on('error', () => { void this.close(); });
    this.process.on('error', () => { void this.close(); });
    this.process.on('exit', () => { void this.close(); });
    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      if (Buffer.byteLength(this.buffer) > MAX_BUFFER) { void this.close(); return; }
      let index: number;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
        try {
          const data = JSON.parse(line); const pending = this.pending.get(data.id);
          if (!pending) continue;
          if (!Object.hasOwn(data,'result') && (!data.error || !Number.isInteger(data.error.code))) continue;
          this.pending.delete(data.id); pending.cleanup();
          if (data.error) pending.reject(new Error('扩展返回执行错误'));
          else pending.resolve(data.result);
        } catch { /* A non-protocol log line is not a response. */ }
      }
    });
    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8'); if (this.stderr.length > 65536) this.stderr = '';
      let index: number;
      while ((index = this.stderr.indexOf('\n')) >= 0) {
        const line = this.stderr.slice(0,index); this.stderr = this.stderr.slice(index + 1);
        try { const pid = JSON.parse(line).xMcpPid; if (!this.pid && Number.isSafeInteger(pid) && pid > 1) this.pid = pid; } catch { /* Never copy extension stderr, credentials or commands to host logs. */ }
      }
    });
    this.process.stdin?.write(JSON.stringify({ command: this.server.command, args: this.server.args ?? [], env: this.server.env ?? {} }) + '\n');
  }
  ensureInitialized(signal?: AbortSignal): Promise<void> {
    return this.initialized ??= this.request('initialize', { protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'x-computer',version:'0.1.0'} }, signal).then(() => {
      if (this.closed) throw new Error('扩展连接已关闭');
      this.process!.stdin?.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    });
  }
  request<T>(method: string, params?: Record<string, unknown>, signal?: AbortSignal, timeoutMs = this.context.timeoutMs ?? 25000): Promise<T> {
    signal?.throwIfAborted(); this.start();
    if (this.pending.size >= 16) throw new Error('扩展请求过多，请稍后重试');
    const id = this.nextId++;
    const body=JSON.stringify({jsonrpc:'2.0',id,method,params:params??{}});
    if(Buffer.byteLength(body)>1024*1024)throw new Error('扩展请求过大，请使用工作区文件');
    return new Promise<T>((resolve,reject) => {
      const abort = () => { void this.close(); };
      const timer = setTimeout(abort, timeoutMs);
      this.pending.set(id, { method, resolve: value => resolve(value as T), reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort',abort); } });
      signal?.addEventListener('abort',abort,{once:true});
      this.process!.stdin?.write(body+'\n');
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.cleanup(); pending.reject(pending.method === 'tools/call'
        ? new UncertainToolOutcomeError('扩展执行结果未知，请核实后重新交办，系统不会自动重试。') : new Error('扩展连接已关闭或超时'));
    }
    this.pending.clear(); this.process?.stdin?.end();
    this.closing = (async () => {
      if (this.pid) {
        const code = `try{process.kill(-${this.pid},'SIGKILL')}catch{}`;
        await exec('docker', [...dockerArgs,'exec',this.context.containerId!,'node','-e',code], {env:dockerEnv(),timeout:3000}).catch(()=>{});
      }
      this.process?.kill('SIGKILL'); this.process = undefined;
    })();
    return this.closing;
  }
}
const connections = new Map<string, { owner:string; fingerprint:string; connection:StdioConnection }>();
async function getConnection(server: McpServerConfig, context?: McpExecutionContext): Promise<StdioConnection> {
  validateStdioServer(server);
  if (!context || !/^[\w-]{1,128}$/.test(context.owner) || !/^[a-f0-9]{64}$/.test(context.containerId ?? '')) throw new Error('本地扩展必须通过已登录用户的隔离容器运行');
  const slot = JSON.stringify([context.owner,server.id]);
  const fingerprint = createHash('sha256').update(JSON.stringify([server.command,server.args,server.env,context.containerId])).digest('hex');
  const previous = connections.get(slot);
  if (previous && !previous.connection.closed && previous.fingerprint === fingerprint) return previous.connection;
  if (previous) {
    await previous.connection.close();
    const latest=connections.get(slot);
    if(latest!==previous&&latest?.fingerprint===fingerprint&&!latest.connection.closed)return latest.connection;
  }
  const connection = new StdioConnection(server,context); connections.set(slot,{owner:context.owner,fingerprint,connection}); return connection;
}
export async function listToolsStdio(server: McpServerConfig, context?: McpExecutionContext): Promise<McpToolSchema[]> {
  const connection = await getConnection(server,context); await connection.ensureInitialized();
  const tools: McpToolSchema[] = []; const cursors = new Set<string>(); let cursor: string | undefined;
  do {
    const result = await connection.request<{tools:McpToolSchema[];nextCursor?:string}>('tools/list',cursor ? {cursor}:{});
    if (!Array.isArray(result.tools)) throw new Error('扩展工具列表无效');
    tools.push(...result.tools); if (tools.length > 1000) throw new Error('扩展工具列表过大'); cursor=result.nextCursor;
    if (cursor && (cursors.has(cursor) || cursors.size >= 32)) throw new Error('扩展工具分页重复或过多'); if (cursor) cursors.add(cursor);
  } while (cursor);
  return tools;
}
export async function callToolStdio(server: McpServerConfig, toolName: string, args: Record<string,unknown>, context?: McpExecutionContext): Promise<{text:string;isError:boolean}> {
  context?.signal?.throwIfAborted();
  const connection = await getConnection(server,context); await connection.ensureInitialized(context?.signal);
  const result = await connection.request<McpCallResult>('tools/call',{name:toolName,arguments:args},context?.signal,context?.timeoutMs);
  if(!result||!Array.isArray(result.content))throw new UncertainToolOutcomeError('扩展没有返回有效执行回执，请核实后重新交办。');
  const text = (result?.content ?? []).filter(item=>item.type==='text'&&item.text!=null).map(item=>item.text).join('\n\n');
  return {text:text||'(无文本结果)',isError:result?.isError===true};
}
export async function closeStdioConnection(serverId: string, owner: string): Promise<void> {
  const slot=JSON.stringify([owner,serverId]); const current=connections.get(slot); if(current){connections.delete(slot);await current.connection.close();}
}
export async function closeAllStdioConnections(owner?: string): Promise<void> {
  const closing:Promise<void>[]=[];
  for (const [slot,current] of connections) if(owner===undefined||current.owner===owner){connections.delete(slot);closing.push(current.connection.close());}
  await Promise.all(closing);
}
