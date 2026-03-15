import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { ScriptAnalyzer } from '../../../security/ScriptAnalyzer.js';

export const fileWriteDefinition: ToolDefinition = {
  name: 'file.write',
  displayName: '写入文件',
  description:
    '将内容写入沙箱内指定路径。仅当用户明确要求保存/写文件，或执行计划需要持久化到沙箱时使用；用户只是在输入或讨论代码时不要调用。调用时必须传入 path。',
  domain: ['office', 'coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'path', type: 'string', description: '沙箱内相对路径，必填', required: true },
    { name: 'content', type: 'string', description: '文件内容', required: false },
    { name: 'description', type: 'string', description: '未指定 content 时用作内容', required: false },
  ],
  requiredPermissions: ['fs.write'],
};

export function createFileWriteHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (fs) {
      const path = input.path != null ? String(input.path).trim() : '';
      if (!path || path.includes('..')) return { ok: false, error: 'path 必填且不能含 ..' };
      const content = input.content != null ? String(input.content) : String(input.description ?? '').trim();
      
      // 安全检查：分析脚本内容
      const isScript = /\.(py|js|ts|mjs|sh|bash)$/i.test(path);
      if (isScript && content) {
        const analysis = ScriptAnalyzer.analyze(path, content);
        
        // 高风险脚本：拒绝写入
        if (analysis.riskLevel === 'high') {
          return {
            ok: false,
            error: `🔴 安全拦截：脚本包含高风险操作，已被拒绝\n\n` +
              `风险分析：\n${analysis.reasons.join('\n')}\n\n` +
              `${analysis.suggestions?.join('\n') || ''}`,
          };
        }
        
        // 中风险脚本：警告但允许
        if (analysis.riskLevel === 'medium') {
          const warning = `⚠️ 安全警告：检测到中等风险操作\n${analysis.reasons.join('\n')}`;
          console.warn('[SECURITY]', warning);
        }
      }
      
      await fs.writeOverwrite(path, content);
      return { written: true, path };
    }
    await deps.simulateDelay(100, 300);
    return { written: true, path: '文档/ai-output.txt' };
  };
}
