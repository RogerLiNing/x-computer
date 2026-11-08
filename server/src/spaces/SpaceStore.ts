import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 空间存储只依赖最小的数据库接口，SQLite 和 MySQL 共用。 */
export interface SpaceDb {
  getDialect(): 'sqlite' | 'mysql';
  run(sql: string, params?: unknown[]): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

export type SpaceRole = 'owner' | 'member';

export interface SpaceMember {
  readonly userId: string;
  readonly role: SpaceRole;
  readonly displayName: string;
  readonly joinedAt: number;
}

export interface SpaceSummary {
  readonly id: string;
  readonly name: string;
  readonly role: SpaceRole;
  readonly createdAt: number;
  readonly members: readonly SpaceMember[];
}

export interface SpaceInvite {
  readonly code: string;
  readonly spaceId: string;
  readonly expiresAt: number;
}

export const SPACE_LIMITS = Object.freeze({
  maxMembers: 20,
  maxSpacesPerUser: 20,
  maxNameLength: 40,
  inviteTtlMs: 24 * 60 * 60 * 1000,
  inviteCodeLength: 8,
});

/** 去掉容易看错的 0/O、1/I，方便在聊天里抄写。 */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 面向用户的业务错误，消息可以直接回给用户。 */
export class SpaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpaceError';
  }
}

interface SpaceRow { id: string; name: string; created_at: number; role: SpaceRole }
interface MemberRow { space_id: string; user_id: string; role: SpaceRole; joined_at: number; display_name: string | null; email: string | null }
interface InviteRow { space_id: string; expires_at: number; used_by: string | null }

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

function normalizeCode(code: string): string {
  return String(code ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
}

function generateCode(): string {
  const bytes = randomBytes(SPACE_LIMITS.inviteCodeLength);
  return Array.from(bytes, b => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
}

function displayNameOf(row: MemberRow): string {
  const name = row.display_name?.trim();
  if (name) return name;
  const local = row.email?.split('@')[0]?.trim();
  if (local) return local;
  return `成员${row.user_id.slice(0, 6)}`;
}

function validateName(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || [...trimmed].length > SPACE_LIMITS.maxNameLength) {
    throw new SpaceError(`空间名须为 1 到 ${SPACE_LIMITS.maxNameLength} 个字`);
  }
  return trimmed;
}

export class SpaceStore {
  private readonly now: () => number;
  private ready?: Promise<void>;

  constructor(private readonly db: SpaceDb, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  init(): Promise<void> {
    this.ready ??= this.createTables();
    return this.ready;
  }

  private async createTables(): Promise<void> {
    const engine = this.db.getDialect() === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    await this.db.run(`CREATE TABLE IF NOT EXISTS spaces (
      id VARCHAR(64) PRIMARY KEY, name VARCHAR(160) NOT NULL,
      created_by VARCHAR(128) NOT NULL, created_at BIGINT NOT NULL)${engine}`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS space_members (
      space_id VARCHAR(64) NOT NULL, user_id VARCHAR(128) NOT NULL, role VARCHAR(16) NOT NULL,
      joined_at BIGINT NOT NULL, PRIMARY KEY (space_id, user_id))${engine}`);
    await this.db.run(`CREATE TABLE IF NOT EXISTS space_invites (
      code_hash VARCHAR(64) PRIMARY KEY, space_id VARCHAR(64) NOT NULL, created_by VARCHAR(128) NOT NULL,
      expires_at BIGINT NOT NULL, used_by VARCHAR(128), used_at BIGINT)${engine}`);
  }

  async createSpace(userId: string, name: string): Promise<SpaceSummary> {
    await this.init();
    const cleanName = validateName(name);
    const mine = await this.listSpacesForUser(userId);
    if (mine.length >= SPACE_LIMITS.maxSpacesPerUser) {
      throw new SpaceError(`每人最多加入 ${SPACE_LIMITS.maxSpacesPerUser} 个空间`);
    }
    if (mine.some(space => space.name === cleanName)) {
      throw new SpaceError(`你已经有一个叫「${cleanName}」的空间了`);
    }
    const id = `sp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const createdAt = this.now();
    await this.db.run('INSERT INTO spaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)', [id, cleanName, userId, createdAt]);
    await this.db.run('INSERT INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [id, userId, 'owner', createdAt]);
    return (await this.listSpacesForUser(userId)).find(space => space.id === id)!;
  }

  async listSpacesForUser(userId: string): Promise<SpaceSummary[]> {
    await this.init();
    const spaces = await this.db.query<SpaceRow>(
      `SELECT s.id, s.name, s.created_at, m.role FROM spaces s
       JOIN space_members m ON m.space_id = s.id WHERE m.user_id = ? ORDER BY s.created_at, s.id`, [userId]);
    if (spaces.length === 0) return [];
    const placeholders = spaces.map(() => '?').join(',');
    const members = await this.db.query<MemberRow>(
      `SELECT m.space_id, m.user_id, m.role, m.joined_at, u.display_name,
         (SELECT a.email FROM auth_accounts a WHERE a.user_id = m.user_id LIMIT 1) AS email
       FROM space_members m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.space_id IN (${placeholders}) ORDER BY m.joined_at, m.user_id`, spaces.map(s => s.id));
    return spaces.map(space => ({
      id: space.id,
      name: space.name,
      role: space.role,
      createdAt: Number(space.created_at),
      members: members.filter(m => m.space_id === space.id).map(m => ({
        userId: m.user_id, role: m.role, displayName: displayNameOf(m), joinedAt: Number(m.joined_at),
      })),
    }));
  }

  /** 按 id 或名称找到用户所在的空间。 */
  async resolveSpace(userId: string, idOrName: string): Promise<SpaceSummary> {
    const key = String(idOrName ?? '').trim();
    const mine = await this.listSpacesForUser(userId);
    const byId = mine.find(space => space.id === key);
    if (byId) return byId;
    const byName = mine.filter(space => space.name === key);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) throw new SpaceError(`你有多个同名空间「${key}」，请用空间 id 指定：${byName.map(s => s.id).join('、')}`);
    throw new SpaceError(`找不到空间「${key}」，或者你不在这个空间里`);
  }

  async createInvite(userId: string, spaceId: string): Promise<SpaceInvite> {
    await this.init();
    await this.requireOwner(userId, spaceId);
    const code = generateCode();
    const expiresAt = this.now() + SPACE_LIMITS.inviteTtlMs;
    await this.db.run('INSERT INTO space_invites (code_hash, space_id, created_by, expires_at) VALUES (?, ?, ?, ?)',
      [hashCode(code), spaceId, userId, expiresAt]);
    return { code, spaceId, expiresAt };
  }

  async joinByCode(userId: string, rawCode: string): Promise<SpaceSummary> {
    await this.init();
    const codeHash = hashCode(normalizeCode(rawCode));
    const invite = await this.db.queryOne<InviteRow>('SELECT space_id, expires_at, used_by FROM space_invites WHERE code_hash = ?', [codeHash]);
    if (!invite) throw new SpaceError('邀请码不存在，请检查是否抄错');
    if (invite.used_by) throw new SpaceError('这个邀请码已被使用，请让空间创建者重新生成');
    if (Number(invite.expires_at) < this.now()) throw new SpaceError('这个邀请码已过期，请让空间创建者重新生成');
    if (await this.memberRole(invite.space_id, userId)) throw new SpaceError('你已经在这个空间里了');
    const count = await this.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM space_members WHERE space_id = ?', [invite.space_id]);
    if (Number(count?.n ?? 0) >= SPACE_LIMITS.maxMembers) throw new SpaceError(`这个空间已满（最多 ${SPACE_LIMITS.maxMembers} 人）`);
    if ((await this.listSpacesForUser(userId)).length >= SPACE_LIMITS.maxSpacesPerUser) {
      throw new SpaceError(`每人最多加入 ${SPACE_LIMITS.maxSpacesPerUser} 个空间`);
    }
    const claimedAt = this.now();
    await this.db.run('UPDATE space_invites SET used_by = ?, used_at = ? WHERE code_hash = ? AND used_by IS NULL', [userId, claimedAt, codeHash]);
    const claimed = await this.db.queryOne<{ used_by: string | null }>('SELECT used_by FROM space_invites WHERE code_hash = ?', [codeHash]);
    if (claimed?.used_by !== userId) throw new SpaceError('这个邀请码已被使用，请让空间创建者重新生成');
    await this.db.run('INSERT INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [invite.space_id, userId, 'member', claimedAt]);
    return (await this.listSpacesForUser(userId)).find(space => space.id === invite.space_id)!;
  }

  async leaveSpace(userId: string, spaceId: string): Promise<{ deleted: boolean; newOwnerId?: string }> {
    await this.init();
    const role = await this.memberRole(spaceId, userId);
    if (!role) throw new SpaceError('你不在这个空间里');
    await this.db.run('DELETE FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId]);
    const next = await this.db.queryOne<{ user_id: string }>(
      'SELECT user_id FROM space_members WHERE space_id = ? ORDER BY joined_at, user_id LIMIT 1', [spaceId]);
    if (!next) {
      await this.db.run('DELETE FROM space_invites WHERE space_id = ?', [spaceId]);
      await this.db.run('DELETE FROM spaces WHERE id = ?', [spaceId]);
      return { deleted: true };
    }
    if (role !== 'owner') return { deleted: false };
    await this.db.run("UPDATE space_members SET role = 'owner' WHERE space_id = ? AND user_id = ?", [spaceId, next.user_id]);
    return { deleted: false, newOwnerId: next.user_id };
  }

  async removeMember(ownerId: string, spaceId: string, memberId: string): Promise<void> {
    await this.init();
    await this.requireOwner(ownerId, spaceId);
    if (memberId === ownerId) throw new SpaceError('不能移除自己；要离开空间请用退出');
    if (!(await this.memberRole(spaceId, memberId))) throw new SpaceError('对方不是这个空间的成员');
    await this.db.run('DELETE FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, memberId]);
  }

  private async memberRole(spaceId: string, userId: string): Promise<SpaceRole | undefined> {
    const row = await this.db.queryOne<{ role: SpaceRole }>('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?', [spaceId, userId]);
    return row?.role;
  }

  private async requireOwner(userId: string, spaceId: string): Promise<void> {
    const role = await this.memberRole(spaceId, userId);
    if (!role) throw new SpaceError('你不在这个空间里');
    if (role !== 'owner') throw new SpaceError('只有空间创建者可以做这件事');
  }
}

const stores = new WeakMap<object, SpaceStore>();

/** 同一个数据库实例共用一个 SpaceStore，避免重复建表。 */
export function getSpaceStore(db: SpaceDb): SpaceStore {
  let store = stores.get(db);
  if (!store) {
    store = new SpaceStore(db);
    stores.set(db, store);
  }
  return store;
}
