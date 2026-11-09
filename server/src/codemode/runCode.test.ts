import { describe, expect, it, vi } from 'vitest';
import { runCode } from './runCode.js';

describe('codemode runCode', () => {
  it('runs a script that calls tools through the bridge and returns its output', async () => {
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => (name === 'file.read' ? { content: `内容:${String(args.path)}` } : { ok: true }));
    const result = await runCode(`
      const files = ['a.md', 'b.md'];
      const reads = await Promise.all(files.map((path) => tools['file.read']({ path })));
      console.log('读取了', reads.length, '个文件');
      await tools.file_write({ path: 'out.md', content: reads.map((r) => r.content).join('\\n') });
      return reads.map((r) => r.content).join(' | ');
    `, { toolNames: ['file.read', 'file.write'], callTool, timeoutMs: 20_000 });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('内容:a.md | 内容:b.md');
    expect(result.console).toEqual(['读取了 2 个文件']);
    expect(result.toolCalls).toBe(3);
    expect(callTool).toHaveBeenCalledWith('file.write', expect.objectContaining({ path: 'out.md' }));
  }, 30_000);

  it('refuses tools outside the allow list, surfaces script errors and denies host access', async () => {
    const callTool = vi.fn(async () => 'never');
    const denied = await runCode(`try { await tools['shell.run']({ command: 'ls' }); } catch (e) { text('denied: ' + e.message); } return 'done';`, { toolNames: ['file.read'], callTool, timeoutMs: 20_000 });
    expect(denied.ok).toBe(true);
    expect(denied.output).toContain('denied:');
    expect(callTool).not.toHaveBeenCalled();

    const thrown = await runCode(`throw new Error('boom');`, { toolNames: [], callTool, timeoutMs: 20_000 });
    expect(thrown).toMatchObject({ ok: false, error: 'boom' });

    const hostAccess = await runCode(`const fs = require('node:fs'); try { fs.readFileSync('/etc/hosts'); return 'read'; } catch (e) { return 'blocked:' + e.code; }`, { toolNames: [], callTool, timeoutMs: 20_000 });
    expect(hostAccess.output).toMatch(/blocked:ERR_ACCESS_DENIED|^$/);
    expect(hostAccess.output).not.toBe('read');
  }, 60_000);

  it('terminates a script that never finishes', async () => {
    const result = await runCode(`await new Promise(() => {});`, { toolNames: [], callTool: async () => null, timeoutMs: 1_500 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未完成');
  }, 20_000);
});
