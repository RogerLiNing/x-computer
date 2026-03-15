import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { escapeRe } from '../utils.js';

export const fileReplaceDefinition: ToolDefinition = {
  name: 'file.replace',
  displayName: '替换文件内容',
  description:
    '修改文件中指定内容，无需读回整份再写回。支持两种方式：(1) 单段：path + old_string + new_string，可选 replace_all 全部替换；(2) 多段：path + replacements 数组 [{ old_string, new_string }, ...]，按顺序依次替换，一次调用可改多处。old_string 须与文件中内容完全一致（含换行与空格）；任一段未找到则返回错误。',
  domain: ['office', 'coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'path', type: 'string', description: '沙箱内相对路径', required: true },
    { name: 'old_string', type: 'string', description: '单段替换：要被替换的原文（与 replacements 二选一）', required: false },
    { name: 'new_string', type: 'string', description: '单段替换：替换后的内容（与 replacements 二选一）', required: false },
    { name: 'replace_all', type: 'boolean', description: '单段时是否替换全部出现；默认 false 仅首次', required: false },
    {
      name: 'replacements',
      type: 'string',
      description: '多段替换：JSON 数组字符串，如 [{"old_string":"a","new_string":"b"},...]，按顺序依次替换',
      required: false,
    },
  ],
  requiredPermissions: ['fs.read', 'fs.write'],
};

export function createFileReplaceHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用' };
    const path = String(input.path ?? '').trim();
    if (!path || path.includes('..')) return { ok: false, error: 'path 必填且不能含 ..' };

    const rawReplacements = input.replacements;
    if (rawReplacements != null && rawReplacements !== '') {
      let list: Array<{ old_string?: string; new_string?: string }>;
      try {
        const parsed = typeof rawReplacements === 'string' ? JSON.parse(rawReplacements) : rawReplacements;
        list = Array.isArray(parsed) ? parsed : [];
      } catch {
        return { ok: false, error: 'replacements 须为 JSON 数组，如 [{"old_string":"...","new_string":"..."}]' };
      }
      if (list.length === 0) return { ok: false, error: 'replacements 数组不能为空' };
      let content = await fs.read(path);
      let totalReplaced = 0;
      for (let i = 0; i < list.length; i++) {
        const oldStr = list[i]?.old_string != null ? String(list[i].old_string) : '';
        const newStr = list[i]?.new_string != null ? String(list[i].new_string) : '';
        if (oldStr === '') return { ok: false, error: `replacements[${i}].old_string 不能为空` };
        if (!content.includes(oldStr))
          return { ok: false, error: `replacements[${i}] 的 old_string 未在文件中找到，请核对原文是否一致` };
        const count = content.split(oldStr).length - 1;
        content = content.split(oldStr).join(newStr);
        totalReplaced += count;
      }
      await fs.writeOverwrite(path, content);
      return { ok: true, path, replaced: totalReplaced, segments: list.length };
    }

    const oldStr = input.old_string != null ? String(input.old_string) : '';
    const newStr = input.new_string != null ? String(input.new_string) : '';
    const replaceAll = input.replace_all === true;
    if (oldStr === '') return { ok: false, error: 'old_string 不能为空（或使用 replacements 传多段）' };
    const content = await fs.read(path);
    const count = replaceAll
      ? (content.match(new RegExp(escapeRe(oldStr), 'g'))?.length ?? 0)
      : content.includes(oldStr)
        ? 1
        : 0;
    if (count === 0)
      return { ok: false, error: 'old_string 未在文件中找到，请核对原文（含换行与空格）是否一致' };
    const newContent = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
    await fs.writeOverwrite(path, newContent);
    return { ok: true, path, replaced: count };
  };
}
