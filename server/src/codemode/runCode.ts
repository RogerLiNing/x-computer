import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { CODEMODE_RUNNER_SOURCE } from './runnerSource.js';

export interface RunCodeOptions {
  /** Tool names the script may call. */
  toolNames: readonly string[];
  /** Executes one tool call on the host; the result is passed back to the script. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  timeoutMs?: number;
  maxToolCalls?: number;
  signal?: AbortSignal;
  nodeBinary?: string;
}

export interface RunCodeResult {
  ok: boolean;
  output: string;
  console: string[];
  toolCalls: number;
  durationMs: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOOL_CALLS = 50;
const MAX_OUTPUT_CHARS = 20_000;

type ChildMessage =
  | { type: 'call'; id: number; tool: string; args: Record<string, unknown> }
  | { type: 'output'; items: string[]; console: string[] }
  | { type: 'error'; message: string; items?: string[]; console?: string[] };

/**
 * Runs a model-written JavaScript snippet in a separate Node process started with the permission
 * model: the process may read only its own runner file and has no other file, network or child
 * process access. The script reaches the world solely through `tools.<name>(args)`, which the host
 * executes one at a time through the regular tool pipeline.
 */
export async function runCode(source: string, options: RunCodeOptions): Promise<RunCodeResult> {
  const started = Date.now();
  // The permission model compares real paths, so a symlinked temp dir (macOS /var → /private/var) must be resolved.
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'x-codemode-')));
  const runner = path.join(dir, 'runner.cjs');
  await writeFile(runner, CODEMODE_RUNNER_SOURCE, 'utf8');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  let toolCalls = 0;
  try {
    return await new Promise<RunCodeResult>((resolve) => {
      const child = spawn(options.nodeBinary ?? process.execPath, ['--permission', `--allow-fs-read=${runner}`, runner], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', CODEMODE_SCRIPT_B64: Buffer.from(source, 'utf8').toString('base64'), CODEMODE_TOOLS: JSON.stringify(options.toolNames), CODEMODE_MAX_OUTPUT: String(MAX_OUTPUT_CHARS) },
      });
      let settled = false;
      let stderr = '';
      const finish = (result: Omit<RunCodeResult, 'durationMs' | 'toolCalls'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve({ ...result, toolCalls, durationMs: Date.now() - started });
      };
      const onAbort = () => finish({ ok: false, output: '', console: [], error: '已停止' });
      const timer = setTimeout(() => finish({ ok: false, output: '', console: [], error: `脚本超过 ${Math.round(timeoutMs / 1000)} 秒未完成，已终止` }), timeoutMs);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.on('error', (error) => finish({ ok: false, output: '', console: [], error: `无法启动脚本进程：${error.message}` }));
      child.on('exit', (code) => { if (!settled) finish({ ok: false, output: '', console: [], error: `脚本进程退出（${code}）${stderr ? `：${stderr.trim().split('\n').slice(-3).join(' ')}` : ''}` }); });
      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        let message: ChildMessage;
        try { message = JSON.parse(line) as ChildMessage; } catch { return; }
        if (message.type === 'call') {
          void handleCall(message);
        } else if (message.type === 'output') {
          finish({ ok: true, output: message.items.join('\n').slice(0, MAX_OUTPUT_CHARS), console: message.console.slice(-200) });
        } else if (message.type === 'error') {
          finish({ ok: false, output: (message.items ?? []).join('\n').slice(0, MAX_OUTPUT_CHARS), console: (message.console ?? []).slice(-200), error: message.message });
        }
      });
      const reply = (id: number, body: { ok: true; value: unknown } | { ok: false; error: string }) => {
        if (child.exitCode === null) child.stdin.write(`${JSON.stringify({ type: 'result', id, ...body })}\n`);
      };
      const handleCall = async (message: Extract<ChildMessage, { type: 'call' }>) => {
        if (!options.toolNames.includes(message.tool)) return reply(message.id, { ok: false, error: `脚本不能调用工具 ${message.tool}` });
        if (++toolCalls > maxToolCalls) return reply(message.id, { ok: false, error: `脚本最多调用 ${maxToolCalls} 次工具` });
        try {
          const value = await options.callTool(message.tool, message.args && typeof message.args === 'object' ? message.args : {});
          reply(message.id, { ok: true, value });
        } catch (error: unknown) {
          reply(message.id, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      };
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
