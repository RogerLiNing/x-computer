import type { ToolDefinition } from '@x-computer/shared';
import { runCode } from '../../codemode/runCode.js';
import type { ToolHandler } from './types.js';

/** Tools a script may never call: they need the person's confirmation or would nest scripts. */
const NEVER_FROM_SCRIPT = /^(run_code|shell\.run|x\.send_|x\.ask_user|x\.package_|docker\.|server\.|llm\.(add|update|remove|set)_)/;
const MAX_SCRIPT_CHARS = 20_000;

export const runCodeDefinition: ToolDefinition = {
  name: 'run_code',
  displayName: '用脚本批量调用工具',
  description: '写一段 JavaScript 在隔离进程里运行，用 await tools["file.read"]({path}) 这样的方式调用其他工具，可并行、可循环、可在返回前筛选大结果；只有脚本的返回值、text() 输出和 console 输出会进入对话。脚本没有文件、网络和进程权限，只能通过 tools 调用。适合「读 10 个文件各取一段」这类多步、结果大的操作；一两次调用直接用工具即可。',
  domain: ['chat', 'agent', 'coding'],
  riskLevel: 'medium',
  requiredPermissions: [],
  parameters: [
    { name: 'script', type: 'string', description: 'async 函数体；可用 tools（工具名为 key，也可用下划线写法 tools.file_read）、text(value) 追加输出、console.log、ALL_TOOLS；return 的值作为结果', required: true },
    { name: 'tools', type: 'array', description: '脚本要用到的工具名列表；省略则放行当前对话里除危险工具外的全部工具', required: false },
    { name: 'timeout_seconds', type: 'number', description: '最长运行秒数，默认 60，最多 300', required: false },
  ],
};

export interface RunCodeToolDeps {
  /** Tools visible to this run, already filtered by the caller's scope. */
  listToolNames(context: unknown): string[];
  /** Executes a tool call on behalf of the run, through the normal pipeline. */
  callTool(name: string, args: Record<string, unknown>, context: unknown): Promise<unknown>;
}

export function createRunCodeHandler(deps: RunCodeToolDeps): ToolHandler {
  return async (input, context) => {
    const script = typeof input.script === 'string' ? input.script : '';
    if (!script.trim()) throw new Error('script 必填');
    if (script.length > MAX_SCRIPT_CHARS) throw new Error('脚本过长');
    const visible = deps.listToolNames(context).filter((name) => !NEVER_FROM_SCRIPT.test(name));
    const requested = Array.isArray(input.tools) ? input.tools.filter((item): item is string => typeof item === 'string') : undefined;
    const toolNames = requested ? requested.filter((name) => visible.includes(name)) : visible;
    const refused = requested?.filter((name) => !visible.includes(name)) ?? [];
    const timeoutMs = Math.min(300, Math.max(5, Number(input.timeout_seconds) || 60)) * 1000;
    const result = await runCode(script, {
      toolNames,
      callTool: (name, args) => deps.callTool(name, args, context),
      timeoutMs,
      signal: (context as { signal?: AbortSignal } | undefined)?.signal,
    });
    return { ok: result.ok, output: result.output, console: result.console, toolCalls: result.toolCalls, durationMs: result.durationMs, ...(result.error ? { error: result.error } : {}), ...(refused.length ? { refusedTools: refused } : {}) };
  };
}
