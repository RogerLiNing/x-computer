import { createHash } from 'node:crypto';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { prepareExpertInputs, type ExpertInputFile } from './ExpertInputStore.js';
import type { ModelImage } from './chatService.js';

function mediaType(bytes: Buffer): ModelImage['mediaType'] {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  throw new Error('请使用 PNG、JPEG、GIF 或 WEBP 图片');
}

export async function prepareRunImages(
  sandbox: SandboxFS, runId: string, sources: string[], saved: ExpertInputFile[] | undefined, guard: () => Promise<void>,
): Promise<{ files: ExpertInputFile[]; images: ModelImage[] }> {
  if (!Array.isArray(sources) || sources.length > 3 || (saved && saved.length > 3) || sources.some(source => typeof source !== 'string' || !source)) {
    throw new Error('每次最多提供3张工作区图片');
  }
  const limit = 5 * 1024 * 1024;
  if (!saved) {
    let total = 0;
    for (const source of sources) {
      await guard();
      const bytes = await sandbox.readBinaryBounded(source, limit);
      mediaType(bytes);
      total += bytes.length;
      if (total > 10 * 1024 * 1024) throw new Error('本轮图片合计不能超过10 MiB');
    }
  }
  const files = saved ?? await prepareExpertInputs(sandbox, 'images-' + runId, '.run-images/' + runId, sources, guard);
  const images: ModelImage[] = [];
  let total = 0;
  for (const file of files) {
    await guard();
    const bytes = await sandbox.readBinaryBounded(file.path, limit);
    total += bytes.length;
    if (total > 10 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error('图片快照已变化或过大，请核实后重新交办');
    }
    images.push({ mediaType: mediaType(bytes), data: bytes.toString('base64') });
  }
  return { files, images };
}
