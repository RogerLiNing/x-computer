import type { SandboxFS } from '../tooling/SandboxFS.js';

const MAX_FILES = 2000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export interface CopyResult { files: number; bytes: number }

/**
 * Copies one directory tree to another path through the sandbox API, so space folders and
 * personal folders are handled alike and no path can leave the sandbox. Secrets are not a
 * concern here: a package directory is meant to be shared as-is.
 */
export async function copyDirectory(fs: SandboxFS, from: string, to: string): Promise<CopyResult> {
  const source = from.replace(/\/+$/, '');
  const target = to.replace(/\/+$/, '');
  if (!source || !target || target === source || target.startsWith(`${source}/`)) throw new Error('复制的目标不能是来源自身或其子目录');
  if (!(await fs.exists(source))) throw new Error(`目录不存在：${source}`);
  const totals = { files: 0, bytes: 0 };
  await copyTree(fs, source, target, totals);
  return totals;
}

async function copyTree(fs: SandboxFS, source: string, target: string, totals: CopyResult): Promise<void> {
  await fs.mkdir(target);
  for (const entry of await fs.list(source)) {
    const fromPath = `${source}/${entry.name}`;
    const toPath = `${target}/${entry.name}`;
    if (entry.type === 'directory') { await copyTree(fs, fromPath, toPath, totals); continue; }
    if (entry.type !== 'file') continue;
    totals.files += 1;
    totals.bytes += entry.size;
    if (totals.files > MAX_FILES || totals.bytes > MAX_TOTAL_BYTES) throw new Error('包太大，无法复制（上限 2000 个文件 / 200MB）');
    await fs.writeBinary(toPath, await fs.readBinary(fromPath));
  }
}
