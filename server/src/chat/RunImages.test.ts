import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { prepareRunImages } from './RunImages.js';

const png = (content: string) => Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from(content)]);

describe('immutable native image inputs', () => {
  it('uses the captured bytes after source changes and rejects a changed working snapshot', async () => {
    const sandbox = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'run-images-')));
    const original = png('initial pixels');
    await sandbox.writeBinaryNew('input.png', original);
    const first = await prepareRunImages(sandbox, 'run', ['input.png'], undefined, async () => {});
    await sandbox.writeBinary('input.png', png('changed pixels'));
    const restored = await prepareRunImages(sandbox, 'run', ['input.png'], first.files, async () => {});
    expect(restored.images).toEqual([{ mediaType: 'image/png', data: original.toString('base64') }]);
    await sandbox.writeBinary(first.files[0].path, png('tampered snapshot'));
    await expect(prepareRunImages(sandbox, 'run', ['input.png'], first.files, async () => {})).rejects.toThrow('快照已变化');
  });

  it('rejects unknown data and oversized inputs before sending a request', async () => {
    const sandbox = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'run-images-invalid-')));
    await sandbox.writeBinaryNew('not-an-image.png', Buffer.from('private text'));
    await expect(prepareRunImages(sandbox, 'invalid', ['not-an-image.png'], undefined, async () => {})).rejects.toThrow('请使用');
    await expect(prepareRunImages(sandbox, 'many', ['a','b','c','d'], undefined, async () => {})).rejects.toThrow('最多');
    await sandbox.writeBinaryNew('large.png', png('x'.repeat(5 * 1024 * 1024)));
    await expect(prepareRunImages(sandbox, 'large', ['large.png'], undefined, async () => {})).rejects.toThrow();
  });
});
