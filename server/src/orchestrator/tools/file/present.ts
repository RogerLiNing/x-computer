import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition, ToolExecutorDeps, ToolHandler } from '../types.js';

export const filePresentDefinition: ToolDefinition = {
  name: 'file.present', displayName: '交付文件', domain: ['office', 'coding', 'agent'], riskLevel: 'low',
  description: '交付已经生成的真实文件，包括Shell/Python生成的文件。校验后文件会出现在成果面板；不能用来宣称不存在的文件已完成。',
  parameters: [{ name: 'path', type: 'string', description: '用户沙箱内文件的相对路径', required: true }],
  requiredPermissions: ['fs.read'],
};

export function createFilePresentHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, context) => {
    const sandbox = await deps.resolveFS(context);
    if (!sandbox) throw new Error('用户工作区不可用');
    const file = typeof input.path === 'string' ? input.path : '';
    if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw new Error('交付路径必须在用户工作区内');
    const root = await fs.realpath(sandbox.getRoot());
    const absolute = await fs.realpath(path.resolve(root, file));
    if (!absolute.startsWith(root + path.sep)) throw new Error('交付路径超出用户工作区');
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error('只能交付已存在的文件');
    return { presented: true, path: file, name: path.basename(file), size: stat.size };
  };
}
