import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SpaceStore, SpaceError, SPACE_LIMITS } from './SpaceStore.js';

const raw = new SqliteAppDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'x-spaces-')));
const db = new SqliteDatabaseAdapter(raw);
afterAll(() => raw.close());

let now = 1_000_000;
let store: SpaceStore;
beforeEach(async () => {
  now = 1_000_000;
  await db.run('DROP TABLE IF EXISTS space_invites');
  await db.run('DROP TABLE IF EXISTS space_members');
  await db.run('DROP TABLE IF EXISTS spaces');
  store = new SpaceStore(db, { now: () => now });
  await store.init();
});

describe('SpaceStore', () => {
  it('创建空间后创建者是 owner，并能列出成员', async () => {
    const space = await store.createSpace('roger', '家庭');
    const list = await store.listSpacesForUser('roger');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: space.id, name: '家庭', role: 'owner' });
    expect(list[0].members.map(m => [m.userId, m.role])).toEqual([['roger', 'owner']]);
  });

  it('空间名必须是 1 到 40 个字，且不能和自己已有空间重名', async () => {
    await expect(store.createSpace('roger', '  ')).rejects.toThrow(SpaceError);
    await expect(store.createSpace('roger', '长'.repeat(41))).rejects.toThrow('1 到 40');
    await store.createSpace('roger', '家庭');
    await expect(store.createSpace('roger', '家庭')).rejects.toThrow('已经有');
  });

  it('owner 生成邀请码，对方用邀请码加入；邀请码只能用一次', async () => {
    const space = await store.createSpace('roger', '家庭');
    const invite = await store.createInvite('roger', space.id);
    expect(invite.code).toMatch(/^[A-Z2-9]{8}$/);
    const joined = await store.joinByCode('wife', invite.code.toLowerCase());
    expect(joined.id).toBe(space.id);
    const members = (await store.listSpacesForUser('wife'))[0].members.map(m => m.userId).sort();
    expect(members).toEqual(['roger', 'wife']);
    await expect(store.joinByCode('friend', invite.code)).rejects.toThrow('已被使用');
  });

  it('非 owner 不能生成邀请码', async () => {
    const space = await store.createSpace('roger', '家庭');
    await store.joinByCode('wife', (await store.createInvite('roger', space.id)).code);
    await expect(store.createInvite('wife', space.id)).rejects.toThrow('只有空间创建者');
    await expect(store.createInvite('stranger', space.id)).rejects.toThrow('不在这个空间');
  });

  it('邀请码过期后不能使用', async () => {
    const space = await store.createSpace('roger', '家庭');
    const invite = await store.createInvite('roger', space.id);
    now += SPACE_LIMITS.inviteTtlMs + 1;
    await expect(store.joinByCode('wife', invite.code)).rejects.toThrow('已过期');
  });

  it('错误的邀请码和已在空间里的人给出明确提示', async () => {
    const space = await store.createSpace('roger', '家庭');
    await expect(store.joinByCode('wife', 'ZZZZZZZZ')).rejects.toThrow('邀请码不存在');
    const invite = await store.createInvite('roger', space.id);
    await expect(store.joinByCode('roger', invite.code)).rejects.toThrow('已经在');
    // 自己误用不会消耗邀请码
    await expect(store.joinByCode('wife', invite.code)).resolves.toMatchObject({ id: space.id });
  });

  it('空间满员后不能再加入', async () => {
    const space = await store.createSpace('owner', '大家庭');
    for (let i = 1; i < SPACE_LIMITS.maxMembers; i++) {
      await store.joinByCode(`m${i}`, (await store.createInvite('owner', space.id)).code);
    }
    const invite = await store.createInvite('owner', space.id);
    await expect(store.joinByCode('late', invite.code)).rejects.toThrow('已满');
  });

  it('成员退出；owner 退出时交给最早加入的成员；最后一人退出时删除空间', async () => {
    const space = await store.createSpace('roger', '家庭');
    await store.joinByCode('wife', (await store.createInvite('roger', space.id)).code);
    now += 10;
    await store.joinByCode('mom', (await store.createInvite('roger', space.id)).code);

    await store.leaveSpace('roger', space.id);
    const afterOwnerLeft = await store.listSpacesForUser('wife');
    expect(afterOwnerLeft[0].role).toBe('owner');
    expect(await store.listSpacesForUser('roger')).toEqual([]);

    await store.leaveSpace('mom', space.id);
    await store.leaveSpace('wife', space.id);
    expect(await db.queryOne('SELECT id FROM spaces WHERE id=?', [space.id])).toBeUndefined();
    await expect(store.leaveSpace('wife', space.id)).rejects.toThrow('不在这个空间');
  });

  it('owner 可以移除成员，普通成员不能移除别人', async () => {
    const space = await store.createSpace('roger', '家庭');
    await store.joinByCode('wife', (await store.createInvite('roger', space.id)).code);
    await store.joinByCode('kid', (await store.createInvite('roger', space.id)).code);
    await expect(store.removeMember('wife', space.id, 'kid')).rejects.toThrow('只有空间创建者');
    await expect(store.removeMember('roger', space.id, 'roger')).rejects.toThrow('退出');
    await store.removeMember('roger', space.id, 'kid');
    expect(await store.listSpacesForUser('kid')).toEqual([]);
    await expect(store.removeMember('roger', space.id, 'kid')).rejects.toThrow('不是这个空间的成员');
  });

  it('按 id 或名称找到自己的空间；同名时要求用 id', async () => {
    const a = await store.createSpace('roger', '家庭');
    expect((await store.resolveSpace('roger', '家庭')).id).toBe(a.id);
    expect((await store.resolveSpace('roger', a.id)).id).toBe(a.id);
    const b = await store.createSpace('mom', '家庭');
    await store.joinByCode('roger', (await store.createInvite('mom', b.id)).code);
    await expect(store.resolveSpace('roger', '家庭')).rejects.toThrow('同名');
    await expect(store.resolveSpace('stranger', a.id)).rejects.toThrow('找不到');
  });

  it('成员显示名优先用昵称', async () => {
    raw.ensureUser('roger');
    await db.run('UPDATE users SET display_name=? WHERE id=?', ['Roger', 'roger']);
    await store.createSpace('roger', '家庭');
    const [space] = await store.listSpacesForUser('roger');
    expect(space.members[0].displayName).toBe('Roger');
  });
});

describe('MySQL 排序规则', () => {
  it('建表不指定字符集，并把与 users 不一致的表改成相同排序规则', async () => {
    const sqls: string[] = [];
    const fake = {
      getDialect: () => 'mysql' as const,
      run: async (sql: string) => { sqls.push(sql); },
      query: async <T,>() => [
        { TABLE_NAME: 'users', COLLATION_NAME: 'utf8mb4_unicode_ci' },
        { TABLE_NAME: 'spaces', COLLATION_NAME: 'utf8mb4_0900_ai_ci' },
        { TABLE_NAME: 'space_members', COLLATION_NAME: 'utf8mb4_unicode_ci' },
      ] as T[],
      queryOne: async () => undefined,
    };
    await new SpaceStore(fake).init();
    expect(sqls.filter(s => s.startsWith('CREATE')).every(s => !s.includes('CHARSET'))).toBe(true);
    expect(sqls.filter(s => s.startsWith('ALTER'))).toEqual([
      'ALTER TABLE spaces CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    ]);
  });
});
