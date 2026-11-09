import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localToolHandlers, resolveInWorkspace, runShell } from './localTools.js';

describe('local tools', () => {
  it('keeps every path inside the workspace', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'x-node-tools-'));
    expect(resolveInWorkspace(workspace, 'a/b.txt')).toBe(path.join(workspace, 'a/b.txt'));
    expect(resolveInWorkspace(workspace, '/abs/looks/relative.txt')).toBe(path.join(workspace, 'abs/looks/relative.txt'));
    expect(() => resolveInWorkspace(workspace, '../outside')).toThrow();
    await expect(localToolHandlers.file_read!({ path: '../../etc/passwd' }, { workspace })).rejects.toThrow();
  });

  it('writes, lists, reads and runs commands in the workspace', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'x-node-tools-'));
    const ctx = { workspace };
    expect(await localToolHandlers.file_write!({ path: 'notes/a.txt', content: 'line1\nline2\nline3' }, ctx)).toMatchObject({ ok: true });
    expect(await localToolHandlers.file_read!({ path: 'notes/a.txt', from_line: 2, lines: 1 }, ctx)).toMatchObject({ totalLines: 3, content: 'line2' });
    expect(((await localToolHandlers.file_list!({ path: 'notes' }, ctx)) as { entries: Array<{ name: string }> }).entries.map((entry) => entry.name)).toEqual(['a.txt']);
    const run = await localToolHandlers.shell_run!({ command: 'echo $X_NODE && pwd' }, ctx) as { exitCode: number; stdout: string };
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('1');
    const timedOut = await runShell('sleep 5', { cwd: workspace, timeoutMs: 300 });
    expect(timedOut.timedOut).toBe(true);
  });
});
