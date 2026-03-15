import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';

export const fileTailDefinition: ToolDefinition = {
  name: 'file.tail',
  displayName: '读取文件末尾',
  description: '读取文件最后 N 行，适合查看日志、大文件尾部内容。默认 10 行。',
  domain: ['office', 'coding', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'path', type: 'string', description: '沙箱内相对路径', required: true },
    { name: 'lines', type: 'number', description: '读取最后几行，默认 10', required: false },
  ],
  requiredPermissions: ['fs.read'],
};

export function createFileTailHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (!fs) {
      await deps.simulateDelay(50, 100);
      return { path: String(input.path ?? ''), content: '[模拟]', lines: 0 };
    }
    const path = String(input.path ?? '').trim();
    if (!path || path.includes('..')) return { ok: false, error: 'path 必填且不能含 ..' };
    const n = typeof input.lines === 'number' ? Math.max(1, Math.min(1000, Math.floor(input.lines))) : 10;
    try {
      const content = await fs.read(path);
      const allLines = content.split(/\r?\n/);
      const tailLines = allLines.slice(-n);
      const result = tailLines.join('\n');
      return { path, content: result, lines: tailLines.length, totalLines: allLines.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `读取失败: ${msg}` };
    }
  };
}
