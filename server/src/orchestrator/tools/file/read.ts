import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { SensitiveFilter } from '../../../security/SensitiveFilter.js';

export const fileReadDefinition: ToolDefinition = {
  name: 'file.read',
  displayName: '读取文件',
  description: '从沙箱读取文件内容',
  domain: ['office', 'coding'],
  riskLevel: 'low',
  parameters: [{ name: 'path', type: 'string', description: '沙箱内相对路径', required: true }],
  requiredPermissions: ['fs.read'],
};

export function createFileReadHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (fs) {
      const path = String(input.path ?? '').trim();
      if (!path) throw new Error('file.read: path is required');
      let content = await fs.read(path);
      
      // 安全检查：过滤敏感信息（配置文件、环境文件等）
      const isSensitiveFile = /\.(env|config|json|yaml|yml|ini|conf)$/i.test(path);
      if (isSensitiveFile || SensitiveFilter.containsSensitive(content)) {
        const filterResult = SensitiveFilter.filter(content);
        if (filterResult.redactedCount > 0) {
          console.warn('[SECURITY] 文件包含敏感信息，已过滤:', path, 
            '- 过滤项:', filterResult.patterns.join(', '));
          content = filterResult.filtered;
        }
      }
      
      return { path, content, size: content.length };
    }
    await deps.simulateDelay(50, 150);
    return { path: String(input.path), content: '[模拟内容]', size: 0 };
  };
}
