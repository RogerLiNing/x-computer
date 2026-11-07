import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from './database.js';
import { MysqlDatabase } from './database-mysql.js';

const mysqlPool = vi.hoisted(() => ({ execute: vi.fn(), end: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: { createPool: () => mysqlPool } }));

describe('stable run messages in SQLite', () => {
  let db: SqliteAppDatabase;
  let adapter: SqliteDatabaseAdapter;
  beforeAll(() => {
    db = new SqliteAppDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'x-run-messages-')));
    adapter = new SqliteDatabaseAdapter(db);
  });
  afterAll(() => db.close());

  it('creates a delegation and synchronizes completion without losing its source', () => {
    db.ensureUser('delegation-acceptance');
    const item = db.createDelegation({userId:'delegation-acceptance',title:'验收委托',delegatedTo:'助手',source:'acceptance',tags:['browser']});
    expect(item.status).toBe('waiting');
    expect(item.source).toBe('acceptance');
    expect(db.updateDelegation(item.id,'delegation-acceptance',{status:'completed'})?.status).toBe('completed');
  });
  it('updates the same message without duplicating history or its creation time', async () => {
    const session = db.createSession('run-message-user');
    const first = await adapter.upsertRunMessage(session.id, 'stable-reply', 'assistant', '执行中');
    await db.run('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', ['2000-01-01', session.id]);
    const completed = await adapter.upsertRunMessage(session.id, 'stable-reply', 'assistant', '已完成', '[{"id":"tool-1"}]');
    expect(completed.id).toBe(first.id);
    expect(completed.created_at).toBe(first.created_at);
    expect(completed.content).toBe('已完成');
    expect(completed.tool_calls_json).toBe('[{"id":"tool-1"}]');
    expect(db.getMessages(session.id)).toHaveLength(1);
    expect(db.getSession(session.id)?.updated_at).not.toBe('2000-01-01');
  });

  it('rejects a message id owned by a different session without changing either history', async () => {
    const source = db.createSession('run-message-user-a');
    const target = db.createSession('run-message-user-b');
    await adapter.upsertRunMessage(source.id, 'owned-message', 'user', '原始交办');
    await expect(adapter.upsertRunMessage(target.id, 'owned-message', 'assistant', '覆盖尝试'))
      .rejects.toThrow('消息 ID 已属于其他会话或角色');
    expect(db.getMessages(source.id)[0]?.content).toBe('原始交办');
    expect(db.getMessages(target.id)).toEqual([]);
  });

  it('does not turn a user message into an assistant message', () => {
    const session = db.createSession('run-message-role-user');
    db.upsertRunMessage(session.id, 'stable-user', 'user', '交办');
    expect(() => db.upsertRunMessage(session.id, 'stable-user', 'assistant', '替换'))
      .toThrow('消息 ID 已属于其他会话或角色');
    expect(db.getMessages(session.id)[0]?.role).toBe('user');
  });
  it('retains attachments when updating the stable user message', async () => {
    const session = db.createSession('run-attachment-user');
    await adapter.upsertRunMessage(session.id, 'attachment-user', 'user', '分析文件', undefined,
      '["图片/上传.png"]', '[{"name":"报告.pdf","path":"文档/报告.pdf"}]');
    const updated = await adapter.upsertRunMessage(session.id, 'attachment-user', 'user', '分析文件');
    expect(updated.images_json).toBe('["图片/上传.png"]');
    expect(updated.attached_files_json).toContain('报告.pdf');
  });
});

describe('stable run messages in MySQL', () => {
  let db: MysqlDatabase;
  const stored = {
    id: 'stable-reply', session_id: 'session-a', role: 'assistant', content: '完成',
    tool_calls_json: null, images_json: null, attached_files_json: null,
    reactions: null, bookmarked: 0, created_at: '2026-10-30 00:00:00',
  };
  beforeAll(() => { db = new MysqlDatabase('', { skipInit: true }); });
  beforeEach(() => {
    mysqlPool.execute.mockReset();
    mysqlPool.execute.mockImplementation(async (sql: string) => [sql.startsWith('SELECT') ? [{ ...stored }] : {}, []]);
  });

  it('uses an atomic guarded upsert and returns the stored message', async () => {
    const row = await db.upsertRunMessage('session-a', 'stable-reply', 'assistant', '完成');
    expect(row).toEqual(stored);
    const [sql, params] = mysqlPool.execute.mock.calls[0];
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('IF(session_id = VALUES(session_id) AND role = VALUES(role)');
    expect(sql).not.toMatch(/UPDATE\s+session_id\s*=/i);
    expect(params.slice(0, 4)).toEqual(['stable-reply', 'session-a', 'assistant', '完成']);
    expect(mysqlPool.execute.mock.calls.at(-1)?.[0]).toContain('UPDATE chat_sessions');
  });

  it('rejects cross-session id conflicts before touching the requested session', async () => {
    await expect(db.upsertRunMessage('session-b', 'stable-reply', 'assistant', '覆盖尝试'))
      .rejects.toThrow('消息 ID 已属于其他会话或角色');
    expect(mysqlPool.execute.mock.calls.some(([sql]) => sql.includes('UPDATE chat_sessions'))).toBe(false);
  });

  it('rejects a conflicting role and a missing persisted result', async () => {
    await expect(db.upsertRunMessage('session-a', 'stable-reply', 'user', '替换'))
      .rejects.toThrow('消息 ID 已属于其他会话或角色');
    mysqlPool.execute.mockResolvedValue([[], []]);
    await expect(db.upsertRunMessage('session-a', 'missing', 'assistant', '完成'))
      .rejects.toThrow('运行消息保存失败');
  });
});
