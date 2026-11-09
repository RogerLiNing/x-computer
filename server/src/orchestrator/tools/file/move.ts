import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';

export const fileMoveDefinition: ToolDefinition = {
  name: 'file.move',
  displayName: '移动文件',
  description:
    '移动或改名文件，适用于任何格式（Word、PDF、图片等）。例如把 QQ收到的文件/… 里的文件放进 共享空间/家庭/…。目标已存在时不会覆盖，会返回错误。文件夹暂时不能在个人目录和共享空间之间整体移动。',
  domain: ['office', 'coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'from', type: 'string', description: '原路径，沙箱内相对路径', required: true },
    { name: 'to', type: 'string', description: '新路径（含文件名），沙箱内相对路径', required: true },
  ],
  requiredPermissions: ['fs.read', 'fs.write'],
};

function cleanPath(value: unknown): string {
  return String(value ?? '').trim().replace(/^\/+/, '');
}

export function createFileMoveHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用' };
    const from = cleanPath(input.from);
    const to = cleanPath(input.to);
    if (!from || !to) return { ok: false, error: 'from 和 to 都必填' };
    if (from.split('/').includes('..') || to.split('/').includes('..')) return { ok: false, error: '路径不能含 ..' };
    if (from === to) return { ok: false, error: '原路径和新路径相同' };
    if (!(await fs.exists(from))) return { ok: false, error: `找不到 ${from}` };
    if (await fs.exists(to)) return { ok: false, error: `${to} 已存在，换个名字或先确认是否要替换` };
    const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
    if (parent) await fs.mkdir(parent);
    await fs.rename(from, to);
    return { ok: true, from, to };
  };
}
