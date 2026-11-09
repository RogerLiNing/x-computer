import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeToolDef } from '../../shared/src/nodeProtocol.js';

export interface LocalToolContext { workspace: string; signal?: AbortSignal; onOutput?: (stream: 'stdout' | 'stderr', data: string) => void }
export type LocalToolHandler = (args: Record<string, unknown>, context: LocalToolContext) => Promise<unknown>;

const MAX_OUTPUT = 60_000;
const MAX_FILE = 2 * 1024 * 1024;

/** Resolves a user path inside the workspace; anything escaping it is refused. */
export function resolveInWorkspace(workspace: string, target: string): string {
  const resolved = path.resolve(workspace, String(target ?? '.').replace(/^\/+/, ''));
  const relative = path.relative(workspace, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`路径必须在工作区内：${target}`);
  return resolved;
}

export interface SpawnResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number }

/** Runs a shell command with a deadline, streaming output when a listener is given. */
export function runShell(command: string, options: { cwd: string; timeoutMs: number; signal?: AbortSignal; onOutput?: LocalToolContext['onOutput'] }): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/c', command] : ['-c', command], { cwd: options.cwd, env: { ...process.env, X_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const kill = (signal: NodeJS.Signals) => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 2_000).unref(); }, options.timeoutMs);
    const onAbort = () => kill('SIGTERM');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { const text = chunk.toString(); stdout = (stdout + text).slice(-MAX_OUTPUT); options.onOutput?.('stdout', text); });
    child.stderr.on('data', (chunk: Buffer) => { const text = chunk.toString(); stderr = (stderr + text).slice(-MAX_OUTPUT / 4); options.onOutput?.('stderr', text); });
    child.on('error', (error) => { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); resolve({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - started }); });
  });
}

export const localToolDefinitions: NodeToolDef[] = [
  { name: 'shell_run', description: '在本节点的工作区里运行一条 shell 命令，返回退出码与输出（输出超长会截断尾部）。', parameters: { type: 'object', properties: { command: { type: 'string', description: '命令' }, cwd: { type: 'string', description: '相对工作区的目录，默认工作区根' }, timeout_seconds: { type: 'number', description: '超时秒数，默认 120，最多 1800' } }, required: ['command'] } },
  { name: 'file_read', description: '读取工作区内的文本文件（最多 2MB）。', parameters: { type: 'object', properties: { path: { type: 'string' }, from_line: { type: 'number' }, lines: { type: 'number' } }, required: ['path'] } },
  { name: 'file_write', description: '写入（覆盖）工作区内的文本文件，自动创建目录。', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'file_list', description: '列出工作区内某目录的文件与子目录。', parameters: { type: 'object', properties: { path: { type: 'string', description: '默认工作区根' } } } },
  { name: 'python_run', description: '在工作区里用 python3 运行一段代码（写入临时脚本后执行）。', parameters: { type: 'object', properties: { code: { type: 'string' }, timeout_seconds: { type: 'number' } }, required: ['code'] } },
  { name: 'http_fetch', description: '从本节点发起 HTTP 请求（GET/POST），返回状态码与正文前 100KB。适合利用本节点的网络位置抓取。', parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'object' }, body: { type: 'string' }, timeout_seconds: { type: 'number' } }, required: ['url'] } },
  { name: 'ask_user', description: '需要用户决定或补充信息时提问并等待回答；只在确实无法继续时使用。', parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] } },
  { name: 'finish', description: '任务完成时调用，给出最终结论（和产出文件路径）。', parameters: { type: 'object', properties: { summary: { type: 'string', description: '给用户看的结论' }, files: { type: 'array', items: { type: 'string' }, description: '产出文件（相对工作区）' } }, required: ['summary'] } },
];

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const secs = (value: unknown, fallback: number, max: number) => Math.min(max, Math.max(1, Number(value) || fallback)) * 1000;

export const localToolHandlers: Record<string, LocalToolHandler> = {
  shell_run: async (args, context) => {
    const cwd = resolveInWorkspace(context.workspace, str(args.cwd, '.'));
    await fs.mkdir(cwd, { recursive: true });
    const result = await runShell(str(args.command), { cwd, timeoutMs: secs(args.timeout_seconds, 120, 1800), signal: context.signal, onOutput: context.onOutput });
    return { exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, stdout: result.stdout.slice(-20_000), stderr: result.stderr.slice(-5_000) };
  },
  file_read: async (args, context) => {
    const file = resolveInWorkspace(context.workspace, str(args.path));
    const stat = await fs.stat(file);
    if (stat.size > MAX_FILE) throw new Error('文件超过 2MB，请用 shell_run 配合 head/grep 读取片段');
    const lines = (await fs.readFile(file, 'utf8')).split('\n');
    const from = Math.max(1, Number(args.from_line) || 1);
    const count = Number(args.lines) > 0 ? Number(args.lines) : lines.length;
    return { path: str(args.path), totalLines: lines.length, content: lines.slice(from - 1, from - 1 + count).join('\n') };
  },
  file_write: async (args, context) => {
    const file = resolveInWorkspace(context.workspace, str(args.path));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, str(args.content), 'utf8');
    return { ok: true, path: str(args.path), bytes: Buffer.byteLength(str(args.content)) };
  },
  file_list: async (args, context) => {
    const dir = resolveInWorkspace(context.workspace, str(args.path, '.'));
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(entries.slice(0, 500).map(async (entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size: entry.isFile() ? (await fs.stat(path.join(dir, entry.name))).size : 0 })));
    return { path: str(args.path, '.'), entries: items };
  },
  python_run: async (args, context) => {
    const dir = path.join(context.workspace, '.x-node-tmp');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `run-${Date.now()}.py`);
    await fs.writeFile(file, str(args.code), 'utf8');
    try {
      const result = await runShell(`python3 ${JSON.stringify(file)}`, { cwd: context.workspace, timeoutMs: secs(args.timeout_seconds, 120, 1800), signal: context.signal, onOutput: context.onOutput });
      return { exitCode: result.exitCode, timedOut: result.timedOut, stdout: result.stdout.slice(-20_000), stderr: result.stderr.slice(-5_000) };
    } finally { await fs.rm(file, { force: true }); }
  },
  http_fetch: async (args, context) => {
    const url = str(args.url);
    if (!/^https?:\/\//i.test(url)) throw new Error('url 须以 http(s):// 开头');
    const method = str(args.method, 'GET').toUpperCase();
    const headers = args.headers && typeof args.headers === 'object' ? Object.fromEntries(Object.entries(args.headers as Record<string, unknown>).map(([key, value]) => [key, String(value)])) : {};
    const signals = [AbortSignal.timeout(secs(args.timeout_seconds, 30, 300)), ...(context.signal ? [context.signal] : [])];
    const response = await fetch(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : str(args.body), signal: AbortSignal.any(signals), redirect: 'follow' });
    const text = (await response.text()).slice(0, 100_000);
    return { status: response.status, ok: response.ok, contentType: response.headers.get('content-type'), body: text };
  },
};
