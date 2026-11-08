import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { SpaceStore } from './SpaceStore.js';
import { SPACE_MOUNT_DIR, SpaceAwareFS, removeSpaceFiles, spaceFilesRoot } from './SpaceAwareFS.js';

const raw = new SqliteAppDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'x-space-fs-db-')));
const db = new SqliteDatabaseAdapter(raw);
afterAll(() => raw.close());

let base: string;
let store: SpaceStore;

function fsFor(userId: string): SpaceAwareFS {
  const personalRoot = path.join(base, 'users', userId, 'workspace');
  fs.mkdirSync(personalRoot, { recursive: true });
  return new SpaceAwareFS({ personal: new SandboxFS(personalRoot), userId, store, basePath: base });
}

async function familyWithTwoMembers(): Promise<string> {
  const space = await store.createSpace('roger', '家庭');
  await store.joinByCode('wife', (await store.createInvite('roger', space.id)).code);
  return space.id;
}

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'x-space-fs-'));
  store = new SpaceStore(db);
  await store.init();
  await db.run('DELETE FROM space_members');
  await db.run('DELETE FROM spaces');
});

describe('SpaceAwareFS', () => {
  it('个人根目录里多出一个共享空间文件夹，里面每个空间一个子文件夹', async () => {
    await familyWithTwoMembers();
    const root = await fsFor('roger').list('/');
    expect(root.find(e => e.name === SPACE_MOUNT_DIR)?.type).toBe('directory');
    const spaces = await fsFor('wife').list(SPACE_MOUNT_DIR);
    expect(spaces.map(e => [e.name, e.type])).toEqual([['家庭', 'directory']]);
    expect(await fsFor('stranger').list(`/${SPACE_MOUNT_DIR}`)).toEqual([]);
  });

  it('一人写入，另一位成员能读到；文件落在空间目录而不是个人目录', async () => {
    const spaceId = await familyWithTwoMembers();
    await fsFor('roger').writeOverwrite(`${SPACE_MOUNT_DIR}/家庭/宝宝/预产期.md`, '2027-03-01');
    expect(await fsFor('wife').read(`/${SPACE_MOUNT_DIR}/家庭/宝宝/预产期.md`)).toBe('2027-03-01');
    expect(fs.existsSync(path.join(spaceFilesRoot(base, spaceId), '宝宝', '预产期.md'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'users', 'roger', 'workspace', SPACE_MOUNT_DIR))).toBe(false);
    const listed = await fsFor('wife').list(`${SPACE_MOUNT_DIR}/家庭/宝宝`);
    expect(listed.map(e => e.name)).toEqual(['预产期.md']);
  });

  it('非成员和被移除的成员都访问不到', async () => {
    await familyWithTwoMembers();
    await fsFor('roger').writeOverwrite(`${SPACE_MOUNT_DIR}/家庭/a.txt`, 'x');
    await expect(fsFor('stranger').read(`${SPACE_MOUNT_DIR}/家庭/a.txt`)).rejects.toThrow('找不到共享空间');
    const [space] = await store.listSpacesForUser('roger');
    await store.removeMember('roger', space.id, 'wife');
    await expect(fsFor('wife').read(`${SPACE_MOUNT_DIR}/家庭/a.txt`)).rejects.toThrow('找不到共享空间');
  });

  it('不能把文件直接放在共享空间文件夹下，也不能删除或改名空间文件夹', async () => {
    await familyWithTwoMembers();
    const roger = fsFor('roger');
    await expect(roger.writeOverwrite(`${SPACE_MOUNT_DIR}/a.txt`, 'x')).rejects.toThrow('具体的空间');
    await expect(roger.delete(`${SPACE_MOUNT_DIR}/家庭`)).rejects.toThrow('不能直接删除');
    await expect(roger.delete(SPACE_MOUNT_DIR)).rejects.toThrow('不能直接删除');
    await expect(roger.rename(`${SPACE_MOUNT_DIR}/家庭`, '家')).rejects.toThrow('不能');
    await expect(roger.mkdir(`${SPACE_MOUNT_DIR}/新空间`)).rejects.toThrow('找不到共享空间');
  });

  it('个人文件可以移进空间，空间文件也可以移回个人目录', async () => {
    await familyWithTwoMembers();
    const roger = fsFor('roger');
    await roger.writeOverwrite('文档/检查单.txt', '血常规正常');
    await roger.rename('文档/检查单.txt', `${SPACE_MOUNT_DIR}/家庭/检查单.txt`);
    expect(await roger.exists('文档/检查单.txt')).toBe(false);
    expect(await fsFor('wife').read(`${SPACE_MOUNT_DIR}/家庭/检查单.txt`)).toBe('血常规正常');
    await roger.rename(`${SPACE_MOUNT_DIR}/家庭/检查单.txt`, '文档/检查单.txt');
    expect(await roger.read('文档/检查单.txt')).toBe('血常规正常');
  });

  it('路径穿越不能离开空间目录，也不能借 .. 绕进别的空间', async () => {
    await familyWithTwoMembers();
    const roger = fsFor('roger');
    await expect(roger.read(`${SPACE_MOUNT_DIR}/家庭/../../../users/wife/workspace/x`)).rejects.toThrow();
    await expect(roger.read(`${SPACE_MOUNT_DIR}/../memory/x`)).rejects.toThrow();
    await roger.writeOverwrite(`文档/../${SPACE_MOUNT_DIR}/家庭/b.txt`, 'y');
    expect(await fsFor('wife').read(`${SPACE_MOUNT_DIR}/家庭/b.txt`)).toBe('y');
  });

  it('同名空间用 id 尾号区分', async () => {
    const b = await store.createSpace('roger', '家庭');
    const a = await store.createSpace('mom', '家庭');
    await store.joinByCode('roger', (await store.createInvite('mom', a.id)).code);
    const names = (await fsFor('roger').list(SPACE_MOUNT_DIR)).map(e => e.name).sort();
    expect(names).toEqual([`家庭-${a.id.slice(-4)}`, `家庭-${b.id.slice(-4)}`].sort());
    await fsFor('roger').writeOverwrite(`${SPACE_MOUNT_DIR}/家庭-${b.id.slice(-4)}/x.txt`, 'b');
    expect(fs.existsSync(path.join(spaceFilesRoot(base, b.id), 'x.txt'))).toBe(true);
  });

  it('空间删除后可以清掉它的文件', async () => {
    const spaceId = await familyWithTwoMembers();
    await fsFor('roger').writeOverwrite(`${SPACE_MOUNT_DIR}/家庭/a.txt`, 'x');
    await removeSpaceFiles(base, spaceId);
    expect(fs.existsSync(path.join(base, 'spaces', spaceId))).toBe(false);
    await expect(removeSpaceFiles(base, '../users')).rejects.toThrow();
  });
});
