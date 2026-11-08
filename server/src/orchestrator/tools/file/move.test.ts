import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SandboxFS } from '../../../tooling/SandboxFS.js';
import type { ToolExecutorDeps } from '../types.js';
import { createFileMoveHandler } from './move.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x-file-move-'));
  const sandbox = new SandboxFS(root);
  const move = createFileMoveHandler({ resolveFS: async () => sandbox } as unknown as ToolExecutorDeps);
  return { root, sandbox, move: (input: Record<string, unknown>) => move(input, {} as never) };
}

describe('file.move', () => {
  it('把二进制文件移到新的文件夹，目标文件夹不存在时自动创建', async () => {
    const { root, sandbox, move } = setup();
    await sandbox.writeBinary('QQ收到的文件/2026-11-08/记录.docx', Buffer.from('PK\u0003\u0004'));
    expect(await move({ from: 'QQ收到的文件/2026-11-08/记录.docx', to: '/文档/培训/记录.docx' }))
      .toEqual({ ok: true, from: 'QQ收到的文件/2026-11-08/记录.docx', to: '文档/培训/记录.docx' });
    expect(fs.readFileSync(path.join(root, '文档/培训/记录.docx')).subarray(0, 2).toString()).toBe('PK');
    expect(fs.existsSync(path.join(root, 'QQ收到的文件/2026-11-08/记录.docx'))).toBe(false);
  });

  it('不覆盖已有文件，也拒绝不存在的文件和 ..', async () => {
    const { sandbox, move } = setup();
    await sandbox.writeOverwrite('a.txt', 'a');
    await sandbox.writeOverwrite('b.txt', 'b');
    expect(await move({ from: 'a.txt', to: 'b.txt' })).toMatchObject({ ok: false, error: expect.stringContaining('已存在') });
    expect(await sandbox.read('b.txt')).toBe('b');
    expect(await move({ from: 'nope.txt', to: 'c.txt' })).toMatchObject({ ok: false, error: expect.stringContaining('找不到') });
    expect(await move({ from: '../x', to: 'c.txt' })).toMatchObject({ ok: false });
    expect(await move({ from: 'a.txt' })).toMatchObject({ ok: false });
  });
});
