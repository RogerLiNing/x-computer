import fs from 'node:fs/promises';
import path from 'node:path';
import { SandboxFS, type FSEntry } from '../tooling/SandboxFS.js';
import { getSpaceStore, type SpaceDb, type SpaceStore, type SpaceSummary } from './SpaceStore.js';

/** 个人文件根目录下的虚拟文件夹，里面每个共享空间一个子文件夹。 */
export const SPACE_MOUNT_DIR = '共享空间';

const SPACE_ID_PATTERN = /^sp_[0-9a-f]{16}$/;

type SpaceLister = Pick<SpaceStore, 'listSpacesForUser'>;

type Target =
  | { kind: 'personal'; path: string }
  | { kind: 'mount' }
  | { kind: 'spaceRoot'; fs: SandboxFS; space: SpaceSummary }
  | { kind: 'space'; fs: SandboxFS; path: string };

/** 空间文件在宿主机上的目录。 */
export function spaceFilesRoot(basePath: string, spaceId: string): string {
  if (!SPACE_ID_PATTERN.test(spaceId)) throw new Error('无效的空间 id');
  return path.join(basePath, 'spaces', spaceId, 'workspace', 'files');
}

/** 空间被删除后清理它的全部数据。 */
export async function removeSpaceFiles(basePath: string, spaceId: string): Promise<void> {
  if (!SPACE_ID_PATTERN.test(spaceId)) throw new Error('无效的空间 id');
  await fs.rm(path.join(basePath, 'spaces', spaceId), { recursive: true, force: true });
}

/** 文件夹名就是空间名；同名时加上 id 尾号区分。名称里的斜杠换成全角，避免被当成路径。 */
export function spaceFolderNames(spaces: readonly SpaceSummary[]): Map<string, SpaceSummary> {
  const clean = (name: string) => name.replace(/[\\/]/g, '／').replace(/^\.+$/, '_');
  const counts = new Map<string, number>();
  for (const space of spaces) counts.set(clean(space.name), (counts.get(clean(space.name)) ?? 0) + 1);
  return new Map(spaces.map(space => {
    const name = clean(space.name);
    return [(counts.get(name) ?? 0) > 1 ? `${name}-${space.id.slice(-4)}` : name, space];
  }));
}

function splitPath(userPath: string): string[] {
  const normalized = path.posix.normalize(`/${String(userPath ?? '').replace(/\\/g, '/')}`);
  return normalized.split('/').filter(Boolean);
}

function virtualDir(name: string, modified: string): FSEntry {
  return { name, type: 'directory', size: 0, modified, created: modified, permissions: '755' };
}

const NOT_IN_SPACE = `请把文件放进具体的空间文件夹里，例如「${SPACE_MOUNT_DIR}/家庭/…」`;
const PROTECTED = '不能直接删除、移动或改名空间文件夹。要退出空间，请告诉助手“退出某某空间”';

/**
 * 在个人沙箱上叠加「共享空间」文件夹：路径以它开头时转到对应空间的目录，其他路径照常走个人沙箱。
 * 每次访问都重新校验成员身份，被移出空间后立即失去访问权限。
 */
export class SpaceAwareFS extends SandboxFS {
  private readonly personal: SandboxFS;
  private readonly memberId: string;
  private readonly store: SpaceLister;
  private readonly basePath: string;

  constructor(options: { personal: SandboxFS; userId: string; store: SpaceLister; basePath: string }) {
    super(options.personal.getRoot());
    this.personal = options.personal;
    this.memberId = options.userId;
    this.store = options.store;
    this.basePath = options.basePath;
  }

  private async spaceFS(space: SpaceSummary): Promise<SandboxFS> {
    const root = spaceFilesRoot(this.basePath, space.id);
    await fs.mkdir(root, { recursive: true });
    return new SandboxFS(root);
  }

  private async route(userPath: string): Promise<Target> {
    const parts = splitPath(userPath);
    if (parts[0] !== SPACE_MOUNT_DIR) return { kind: 'personal', path: parts.join('/') || '/' };
    if (parts.length === 1) return { kind: 'mount' };
    const space = spaceFolderNames(await this.store.listSpacesForUser(this.memberId)).get(parts[1]);
    if (!space) throw new Error(`找不到共享空间「${parts[1]}」，或你不是它的成员`);
    const spaceFs = await this.spaceFS(space);
    if (parts.length === 2) return { kind: 'spaceRoot', fs: spaceFs, space };
    return { kind: 'space', fs: spaceFs, path: parts.slice(2).join('/') };
  }

  /** 写入类操作只允许落在某个空间内部或个人目录。 */
  private async writable(userPath: string): Promise<{ fs: SandboxFS; path: string }> {
    const parts = splitPath(userPath);
    if (parts[0] === SPACE_MOUNT_DIR && parts.length <= 2) throw new Error(NOT_IN_SPACE);
    const target = await this.route(userPath);
    if (target.kind === 'personal') return { fs: this.personal, path: target.path };
    if (target.kind === 'space') return { fs: target.fs, path: target.path };
    throw new Error(NOT_IN_SPACE);
  }

  /** 读取类操作：空间文件夹本身按根目录处理。 */
  private async readable(userPath: string): Promise<{ fs: SandboxFS; path: string } | 'mount'> {
    const target = await this.route(userPath);
    if (target.kind === 'mount') return 'mount';
    if (target.kind === 'personal') return { fs: this.personal, path: target.path };
    if (target.kind === 'spaceRoot') return { fs: target.fs, path: '/' };
    return { fs: target.fs, path: target.path };
  }

  override getRoot(): string {
    return this.personal.getRoot();
  }

  override init(): Promise<void> {
    return this.personal.init();
  }

  override recordStorageChange(bytes: number): void {
    this.personal.recordStorageChange(bytes);
  }

  override async list(dirPath: string): Promise<FSEntry[]> {
    const target = await this.readable(dirPath);
    if (target === 'mount') {
      const spaces = spaceFolderNames(await this.store.listSpacesForUser(this.memberId));
      return [...spaces].map(([name, space]) => virtualDir(name, new Date(space.createdAt).toISOString()));
    }
    const entries = await target.fs.list(target.path);
    const atPersonalRoot = target.fs === this.personal && splitPath(target.path).length === 0;
    if (!atPersonalRoot) return entries;
    const rest = entries.filter(entry => entry.name !== SPACE_MOUNT_DIR);
    return [virtualDir(SPACE_MOUNT_DIR, new Date().toISOString()), ...rest];
  }

  override async read(filePath: string): Promise<string> {
    const target = await this.readable(filePath);
    if (target === 'mount') throw new Error(`${SPACE_MOUNT_DIR}是文件夹，不能当文件读取`);
    return target.fs.read(target.path);
  }

  override async readBinary(filePath: string): Promise<Buffer> {
    const target = await this.readable(filePath);
    if (target === 'mount') throw new Error(`${SPACE_MOUNT_DIR}是文件夹，不能当文件读取`);
    return target.fs.readBinary(target.path);
  }

  override async readBinaryBounded(filePath: string, maxBytes?: number): Promise<Buffer> {
    const target = await this.readable(filePath);
    if (target === 'mount') throw new Error(`${SPACE_MOUNT_DIR}是文件夹，不能当文件读取`);
    return target.fs.readBinaryBounded(target.path, maxBytes);
  }

  override async stat(filePath: string): Promise<{ size: number; modified: string; isDirectory: boolean }> {
    const target = await this.readable(filePath);
    if (target === 'mount') return { size: 0, modified: new Date().toISOString(), isDirectory: true };
    return target.fs.stat(target.path);
  }

  override async exists(filePath: string): Promise<boolean> {
    try {
      const target = await this.readable(filePath);
      return target === 'mount' ? true : await target.fs.exists(target.path);
    } catch {
      return false;
    }
  }

  override async write(filePath: string, content: string): Promise<void> {
    const target = await this.writable(filePath);
    return target.fs.write(target.path, content);
  }

  override async writeOverwrite(filePath: string, content: string): Promise<void> {
    const target = await this.writable(filePath);
    return target.fs.writeOverwrite(target.path, content);
  }

  override async writeBinary(filePath: string, data: Buffer): Promise<void> {
    const target = await this.writable(filePath);
    return target.fs.writeBinary(target.path, data);
  }

  override async writeBinaryNew(filePath: string, data: Buffer): Promise<void> {
    const target = await this.writable(filePath);
    return target.fs.writeBinaryNew(target.path, data);
  }

  override async mkdir(dirPath: string): Promise<void> {
    const target = await this.route(dirPath);
    if (target.kind === 'mount' || target.kind === 'spaceRoot') return;
    const fsTarget = target.kind === 'personal' ? this.personal : target.fs;
    return fsTarget.mkdir(target.path);
  }

  override async delete(targetPath: string): Promise<void> {
    const target = await this.route(targetPath);
    if (target.kind === 'mount' || target.kind === 'spaceRoot') throw new Error(PROTECTED);
    const fsTarget = target.kind === 'personal' ? this.personal : target.fs;
    return fsTarget.delete(target.path);
  }

  override async rename(oldPath: string, newPath: string): Promise<void> {
    const from = await this.route(oldPath);
    const to = await this.route(newPath);
    if (from.kind === 'mount' || from.kind === 'spaceRoot' || to.kind === 'mount' || to.kind === 'spaceRoot') {
      throw new Error(PROTECTED);
    }
    const source = from.kind === 'personal' ? this.personal : from.fs;
    const dest = to.kind === 'personal' ? this.personal : to.fs;
    if (source.getRoot() === dest.getRoot()) return source.rename(from.path, to.path);
    if ((await source.stat(from.path)).isDirectory) {
      throw new Error('文件夹暂时不能在个人和空间之间整体移动，请逐个移动里面的文件');
    }
    await dest.writeBinary(to.path, await source.readBinary(from.path));
    await source.delete(from.path);
  }
}

/** 给登录用户的个人沙箱加上「共享空间」文件夹；匿名用户原样返回。 */
export function withSpaceFolders(personal: SandboxFS, userId: string | undefined, db: SpaceDb | undefined, basePath: string): SandboxFS {
  if (!db || !userId || userId === 'anonymous' || personal instanceof SpaceAwareFS) return personal;
  return new SpaceAwareFS({ personal, userId, store: getSpaceStore(db), basePath });
}
