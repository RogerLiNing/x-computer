import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxFS } from './SandboxFS.js';

describe('exclusive version files', () => {
  it('allows one publisher and preserves existing regular files, symlinks and hard links', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(),'office-exclusive-')), sandbox = new SandboxFS(root);
    const results = await Promise.allSettled([sandbox.writeBinaryNew('copy.docx',Buffer.from('one')),sandbox.writeBinaryNew('copy.docx',Buffer.from('two'))]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const original=await readFile(path.join(root,'copy.docx'));
    await symlink('copy.docx',path.join(root,'symbolic.docx'));await link(path.join(root,'copy.docx'),path.join(root,'hard.docx'));
    for(const target of ['copy.docx','symbolic.docx','hard.docx'])await expect(sandbox.writeBinaryNew(target,Buffer.from('bad'))).rejects.toBeDefined();
    expect(await readFile(path.join(root,'copy.docx'))).toEqual(original);
  });
});
