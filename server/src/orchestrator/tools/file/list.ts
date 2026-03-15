import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';

export const fileListDefinition: ToolDefinition = {
  name: 'file.list',
  displayName: '列出文件',
  description: '列出沙箱内目录下的文件和子目录（对齐 OpenCode list 工具）',
  domain: ['office', 'coding'],
  riskLevel: 'low',
  parameters: [{ name: 'path', type: 'string', description: '沙箱内相对路径，默认当前根', required: false }],
  requiredPermissions: ['fs.read'],
};

export function createFileListHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (fs) {
      const dirPath = String(input.path ?? '.').trim() || '.';
      const entries = await fs.list(dirPath);
      return {
        path: dirPath,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.type,
          size: e.size,
          modified: e.modified,
        })),
        count: entries.length,
      };
    }
    await deps.simulateDelay(50, 100);
    return { path: String(input.path ?? '.'), entries: [], count: 0 };
  };
}
