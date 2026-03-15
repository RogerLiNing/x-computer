import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from './types.js';
import { escapeRe } from './utils.js';

export const grepDefinition: ToolDefinition = {
  name: 'grep',
  displayName: '搜索文件内容',
  description: '在沙箱文件中按正则搜索内容（对齐 OpenCode grep 工具）',
  domain: ['coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'pattern', type: 'string', description: '正则或关键词', required: true },
    { name: 'path', type: 'string', description: '沙箱内目录，默认根', required: false },
    { name: 'include', type: 'string', description: '文件名匹配，如 *.ts 或 *.md', required: false },
  ],
  requiredPermissions: ['fs.read'],
};

const MAX_MATCHES = 100;
const MAX_LINE_LEN = 2000;

export function createGrepHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (!fs) {
      await deps.simulateDelay(100, 200);
      return { matches: 0, output: 'No sandbox' };
    }
    const pattern = String(input.pattern ?? '').trim();
    if (!pattern) throw new Error('grep: pattern is required');
    const basePath = String(input.path ?? '.').trim() || '.';
    const includeGlob = input.include != null ? String(input.include).trim() : '';
    const matches: { path: string; lineNum: number; lineText: string }[] = [];
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch {
      regex = new RegExp(escapeRe(pattern), 'gi');
    }
    const includeSuffixes = includeGlob
      ? includeGlob.split(',').map((g) => g.trim().replace(/^\*\./, '.'))
      : null;

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.list(dir);
      for (const e of entries) {
        if (matches.length >= MAX_MATCHES) return;
        const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
        if (e.type === 'directory') {
          if (!e.name.startsWith('.')) await walk(rel);
          continue;
        }
        if (includeSuffixes && !includeSuffixes.some((s) => e.name.endsWith(s))) continue;
        try {
          const content = await fs.read(rel);
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
            const line = lines[i];
            if (!regex.test(line)) continue;
            matches.push({
              path: rel,
              lineNum: i + 1,
              lineText: line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + '...' : line,
            });
          }
        } catch {
          // skip binary or unreadable
        }
      }
    };
    await walk(basePath);

    if (matches.length === 0) {
      return { matches: 0, output: 'No files found' };
    }
    const lines: string[] = [`Found ${matches.length} matches`];
    let currentFile = '';
    for (const m of matches) {
      if (currentFile !== m.path) {
        if (currentFile) lines.push('');
        currentFile = m.path;
        lines.push(`${m.path}:`);
      }
      lines.push(`  Line ${m.lineNum}: ${m.lineText}`);
    }
    return { matches: matches.length, output: lines.join('\n') };
  };
}
