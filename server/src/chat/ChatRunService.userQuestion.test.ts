import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { callLLMWithToolsStream } from './chatService.js';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { AuditLogger } from '../observability/AuditLogger.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { ChatRunService } from './ChatRunService.js';

vi.mock('./chatService.js', () => ({
  callLLMWithToolsStream: vi.fn(), callLLMWithTools: vi.fn(), callLLM: vi.fn(), callLLMGenerateImage: vi.fn(),
}));

async function fixture(failNotice = false) {
  vi.resetAllMocks();
  vi.mocked(callLLMWithToolsStream).mockImplementation(async ({ messages }) => {
    const answer = messages.filter(message => message.role === 'tool').flatMap(message => {
      try { const result = JSON.parse(message.content); return typeof result.answer === 'string' ? [result.answer] : []; }
      catch { return []; }
    })[0];
    return answer ? { content: '故事采用' + answer + '结尾。', toolCalls: [] } : {
      content: '', toolCalls: [
        { id: 'question-call', name: 'x.ask_user', arguments: { question: '你想要哪种结尾？', options: ['开心', '神秘'], answer: 'forged' } },
        { id: 'unstarted-write', name: 'file.write', arguments: { path: 'must-not-exist.txt', content: 'not authorized yet' } },
      ],
    };
  });
  const root = await mkdtemp(path.join(os.tmpdir(), 'user-question-'));
  const native = new SqliteAppDatabase(root);
  const db = new SqliteDatabaseAdapter(native);
  const sandbox = new SandboxFS(root);
  await sandbox.init();
  await db.ensureUser('owner');
  const make = (database = db) => new ChatRunService({
    db: database, orchestrator: new AgentOrchestrator(new AuditLogger(), sandbox, undefined, database),
    getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'test', modelId: 'test' }),
  });
  const runs = make();
  const session = await db.createSession('owner');
  const initial = await runs.accept({
    userId: 'owner', sessionId: session.id, requestId: 'question', providerId: 'test', modelId: 'test',
    messages: [{ role: 'user', content: '先问我结尾，再写故事并保存为 文档/故事.md' }],
    systemPrompt: '', allowedToolNames: ['x.ask_user'], requestedTextArtifactPath: '文档/故事.md',
  });
  const originalRun = db.run.bind(db);
  const failedNotice = failNotice ? vi.spyOn(db, 'run').mockImplementation(async (sql, args) => {
    if (sql.startsWith('INSERT OR IGNORE INTO notifications')) throw new Error('notice temporarily unavailable');
    return originalRun(sql, args);
  }) : undefined;
  await runs.launch('owner', initial.id);
  failedNotice?.mockRestore();
  const pending = await runs.get('owner', initial.id);
  const answer = (value = '开心') => ({
    questionId: pending.userQuestion!.id, answer: value, expectedUpdatedAt: pending.updatedAt,
  });
  return { root, native, db, sandbox, make, runs, pending, answer, id: initial.id };
}

describe('durable questions in the original handoff', () => {
  it('restores a pending question, fences competing answers and continues one original run', async () => {
    const f = await fixture();
    const secondNative = new SqliteAppDatabase(f.root);
    try {
      const other = f.make(new SqliteDatabaseAdapter(secondNative));
      const restored = await other.get('owner', f.id);
      expect(restored).toMatchObject({
        status: 'blocked', canResume: false,
        userQuestion: { id: f.pending.userQuestion!.id, question: '你想要哪种结尾？', options: ['开心', '神秘'], status: 'pending' },
      });
      expect(await f.sandbox.exists('must-not-exist.txt')).toBe(false);
      expect(await f.sandbox.exists('文档/故事.md')).toBe(false);
      await expect(other.resume('owner', f.id)).rejects.toThrow('不能恢复');
      await expect(other.answerQuestion('foreign', f.id, f.answer())).rejects.toThrow();
      await expect(other.answerQuestion('owner', f.id, f.answer(' '))).rejects.toThrow('请填写');
      await expect(other.answerQuestion('owner', f.id, { ...f.answer(), expectedUpdatedAt: 0 })).rejects.toThrow('已变化');
      const decisions = await Promise.allSettled([
        f.runs.answerQuestion('owner', f.id, f.answer('开心')),
        other.answerQuestion('owner', f.id, f.answer('神秘')),
      ]);
      expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      await Promise.all([f.runs.wait(f.id), other.wait(f.id)]);
      const result = await f.make().get('owner', f.id);
      expect(result.id).toBe(f.id);
      expect(result.status).toBe('completed');
      expect(result.userQuestion?.status).toBe('answered');
      expect(await f.sandbox.read('文档/故事.md')).toBe('故事采用' + result.userQuestion!.answer + '结尾。');
      expect(callLLMWithToolsStream).toHaveBeenCalledTimes(2);
      await other.answerQuestion('owner', f.id, f.answer(result.userQuestion!.answer));
      expect(callLLMWithToolsStream).toHaveBeenCalledTimes(2);
      expect((await f.db.getAllTasks()).filter(task => task.domain === 'chat')).toHaveLength(1);
      const notice = (await f.db.getNotifications('owner', { includeRead: true })).find(item => item.id === 'user-question-' + restored.userQuestion!.id);
      expect(notice?.read).toBeTruthy();
    } finally { secondNative.close(); f.native.close(); }
  });

  it('recovers a failed question notification and keeps its acknowledged receipt across reloads', async () => {
    const f = await fixture(true);
    try {
      expect(await f.db.getNotifications('owner')).toEqual([]);
      const restored = f.make();
      await restored.deliverPendingQuestions();
      const [notice] = await f.db.getNotifications('owner');
      expect(notice.title).toBe('助手需要你补充信息');
      await f.db.markNotificationRead(notice.id, 'owner');
      await f.make().deliverPendingQuestions();
      expect(await f.db.getNotifications('owner', { includeRead: true })).toEqual([expect.objectContaining({ id: notice.id, read: 1 })]);
      expect(callLLMWithToolsStream).toHaveBeenCalledOnce();
    } finally { f.native.close(); }
  });

  it('cancels a pending question when the owner stops, rejecting a late answer', async () => {
    const f = await fixture();
    try {
      const stopped = await f.runs.stop('owner', f.id);
      expect(stopped.userQuestion?.status).toBe('cancelled');
      await expect(f.runs.answerQuestion('owner', f.id, f.answer())).rejects.toThrow('已变化');
      expect(callLLMWithToolsStream).toHaveBeenCalledOnce();
      expect(await f.sandbox.exists('文档/故事.md')).toBe(false);
    } finally { f.native.close(); }
  });

  it('preserves an answer across a failure before execution admission', async () => {
    const f = await fixture();
    try {
      vi.spyOn(f.runs, 'resume').mockRejectedValueOnce(new Error('admission unavailable'));
      await expect(f.runs.answerQuestion('owner', f.id, f.answer())).rejects.toThrow('admission unavailable');
      const restored = f.make();
      const pending = await restored.get('owner', f.id);
      expect(pending.userQuestion).toMatchObject({ status: 'answered', answer: '开心' });
      expect(pending.canResume).toBe(true);
      await restored.resume('owner', f.id);
      await restored.wait(f.id);
      expect((await restored.get('owner', f.id)).status).toBe('completed');
      expect(await f.sandbox.read('文档/故事.md')).toBe('故事采用开心结尾。');
      expect(callLLMWithToolsStream).toHaveBeenCalledTimes(2);
    } finally { f.native.close(); }
  });
});
