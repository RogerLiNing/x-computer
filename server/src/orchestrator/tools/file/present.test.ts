import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SandboxFS } from '../../../tooling/SandboxFS.js';
import { createFilePresentHandler } from './present.js';
import type { ToolExecutorDeps } from '../types.js';

it('presents a real file and rejects missing files, directories and escaped symlinks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'present-file-'));
  await writeFile(path.join(root, 'report.md'), 'report');
  await symlink('/etc/hosts', path.join(root, 'escaped.md'));
  const handler = createFilePresentHandler({ resolveFS: async () => new SandboxFS(root) } as ToolExecutorDeps);
  await expect(handler({ path: 'report.md' })).resolves.toMatchObject({ presented: true, path: 'report.md', size: Buffer.byteLength('report') });
  await expect(handler({ path: 'missing.md' })).rejects.toThrow();
  await expect(handler({ path: '.' })).rejects.toThrow();
  await expect(handler({ path: 'escaped.md' })).rejects.toThrow(/超出/);
  await expect(handler({ path: '../report.md' })).rejects.toThrow(/工作区/);
});
