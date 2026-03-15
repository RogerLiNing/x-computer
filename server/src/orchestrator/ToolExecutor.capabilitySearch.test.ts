import path from 'path';
import os from 'os';
import { describe, it, expect, beforeAll } from 'vitest';
import { ToolExecutor } from './ToolExecutor.js';
import { SandboxFS } from '../tooling/SandboxFS.js';

describe('ToolExecutor capability.search', () => {
  const workspaceRoot = path.join(os.tmpdir(), `x-computer-capability-search-${Date.now()}`);
  let sandboxFS: SandboxFS;
  let executor: ToolExecutor;

  beforeAll(async () => {
    sandboxFS = new SandboxFS(workspaceRoot);
    await sandboxFS.init();
    executor = new ToolExecutor(sandboxFS);
  });

  it('query 为空时返回空 matches', async () => {
    const step = {
      id: 's1',
      taskId: 't1',
      action: '搜索工具',
      toolName: 'capability.search',
      toolInput: { query: '' },
      status: 'pending' as const,
      riskLevel: 'low' as const,
    };
    const call = await executor.execute(step, 'container');
    expect(call.error).toBeUndefined();
    const out = call.output as { matches: unknown[]; message?: string };
    expect(Array.isArray(out.matches)).toBe(true);
    expect(out.matches).toHaveLength(0);
  });

  it('有关键词时返回 matches，每项含 name 与 description（可提取工具名）', async () => {
    const step = {
      id: 's2',
      taskId: 't1',
      action: '搜索文件相关工具',
      toolName: 'capability.search',
      toolInput: { query: 'file read 读取文件' },
      status: 'pending' as const,
      riskLevel: 'low' as const,
    };
    const call = await executor.execute(step, 'container');
    expect(call.error).toBeUndefined();
    const out = call.output as { matches: Array<{ name: string; description: string }>; total: number; hint?: string };
    expect(Array.isArray(out.matches)).toBe(true);
    expect(out.total).toBeGreaterThanOrEqual(0);
    for (const m of out.matches) {
      expect(m).toHaveProperty('name');
      expect(m).toHaveProperty('description');
      expect(typeof m.name).toBe('string');
      expect(typeof m.description).toBe('string');
    }
    const toolNames = out.matches.map((m) => m.name);
    expect(toolNames.length).toBe(out.matches.length);
    if (out.matches.length > 0) {
      expect(toolNames).toContain('file.read');
    }
  });

  it('关键词 grep 能匹配到 grep 工具', async () => {
    const step = {
      id: 's3',
      taskId: 't1',
      action: '搜索 grep',
      toolName: 'capability.search',
      toolInput: { query: 'grep 搜索' },
      status: 'pending' as const,
      riskLevel: 'low' as const,
    };
    const call = await executor.execute(step, 'container');
    expect(call.error).toBeUndefined();
    const out = call.output as { matches: Array<{ name: string }> };
    const names = out.matches.map((m) => m.name);
    expect(names).toContain('grep');
  });
});
