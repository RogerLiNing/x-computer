import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { callLLMWithToolsStream } from './chatService.js';
import { sendTelegramMessage } from '../telegram/telegramService.js';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { AuditLogger } from '../observability/AuditLogger.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { ChatRunService } from './ChatRunService.js';

vi.mock('./chatService.js', () => ({
  callLLMWithToolsStream: vi.fn(), callLLMWithTools: vi.fn(), callLLM: vi.fn(), callLLMGenerateImage: vi.fn(),
}));
vi.mock('../telegram/telegramService.js', async importOriginal => ({
  ...await importOriginal<typeof import('../telegram/telegramService.js')>(), sendTelegramMessage: vi.fn(),
  getTelegramConnection: () => ({ getSendIdentity: () => ({ accountId: 'fixture-bot', label: '合成账号', binding: 'fixture-session:fixture-bot' }) }),
}));

async function fixture() {
  vi.resetAllMocks();
  vi.mocked(sendTelegramMessage).mockResolvedValue({ ok: true });
  vi.mocked(callLLMWithToolsStream).mockImplementation(async ({ messages }) => messages.some(item => item.role === 'tool')
    ? { content: '已查看回执', toolCalls: [] }
    : { content: '', toolCalls: [{ id: 'send-call', name: 'x.send_telegram',
      arguments: { chatId: 'acceptance-target', message: '完整正文', approvedSendHash: 'fake', confirmed: true } }] });
  const root = await mkdtemp(path.join(os.tmpdir(), 'send-approval-'));
  const native = new SqliteAppDatabase(root);
  const db = new SqliteDatabaseAdapter(native);
  await db.ensureUser('owner');
  await db.setConfig('owner', 'telegram_config', JSON.stringify({ enabled: true, botToken: 'fixture-token' }));
  const sandbox = new SandboxFS(root);
  const make = (database = db) => new ChatRunService({
    db: database, orchestrator: new AgentOrchestrator(new AuditLogger(), sandbox, undefined, database),
    getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'test', modelId: 'test' }),
  });
  const runs = make();
  const session = await db.createSession('owner');
  const run = await runs.accept({
    userId: 'owner', sessionId: session.id, requestId: 'send', providerId: 'test', modelId: 'test',
    messages: [{ role: 'user', content: '帮我发送一条消息' }], systemPrompt: '', allowedToolNames: ['x.send_telegram'],
  });
  await runs.launch('owner', run.id);
  const pending = await runs.get('owner', run.id);
  const decision = (snapshot = pending) => ({
    approvalId: snapshot.sendApproval!.id, hash: snapshot.sendApproval!.hash, expectedUpdatedAt: snapshot.updatedAt, decision: 'approve',
  });
  return { root, native, db, make, runs, pending, decision, id: run.id };
}

describe('outbound channel approval through the real tool dispatcher', () => {
  it('persists exact parameters, rejects forged and competing decisions, and sends once', async () => {
    const f = await fixture();
    const second = new SqliteAppDatabase(f.root);
    try {
      expect(f.pending).toMatchObject({ status: 'blocked', canResume: false, sendApproval: {
        status: 'pending', input: { chatId: 'acceptance-target', message: '完整正文' },
      } });
      expect(JSON.stringify(f.pending)).not.toContain('fixture-token');
      expect(sendTelegramMessage).not.toHaveBeenCalled();
      await expect(f.runs.resume('owner', f.id)).rejects.toThrow('不能恢复');
      await expect(f.runs.decideSend('other', f.id, f.decision())).rejects.toThrow();
      await expect(f.runs.decideSend('owner', f.id, { ...f.decision(), hash: 'fake' })).rejects.toThrow('已变化');

      const other = f.make(new SqliteDatabaseAdapter(second));
      const injected = { ...f.decision(), input: { chatId: 'injected', message: 'wrong' } };
      const decisions = await Promise.allSettled([
        f.runs.decideSend('owner', f.id, injected), other.decideSend('owner', f.id, injected),
      ]);
      expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      await Promise.all([f.runs.wait(f.id), other.wait(f.id)]);
      expect(sendTelegramMessage).toHaveBeenCalledOnce();
      expect(sendTelegramMessage).toHaveBeenCalledWith(expect.any(Function), 'owner', 'acceptance-target', '完整正文', 'fixture-session:fixture-bot');
      expect((await f.make().get('owner', f.id)).sendApproval?.status).toBe('completed');
    } finally { second.close(); f.native.close(); }
  });

  it('requires new confirmation when the channel config changes after the proposal', async () => {
    const f = await fixture();
    try {
      await f.db.setConfig('owner', 'telegram_config', JSON.stringify({ enabled: true, botToken: 'new-fixture-token' }));
      await f.runs.decideSend('owner', f.id, f.decision());
      await f.runs.wait(f.id);
      const newProposal = await f.runs.get('owner', f.id);
      expect(newProposal.sendApproval?.status).toBe('pending');
      expect(newProposal.sendApproval?.hash).not.toBe(f.pending.sendApproval?.hash);
      expect(sendTelegramMessage).not.toHaveBeenCalled();
      const rejected = await f.runs.decideSend('owner', f.id, { ...f.decision(newProposal), decision: 'reject' });
      expect(rejected.sendApproval?.status).toBe('rejected');
      expect(sendTelegramMessage).not.toHaveBeenCalled();
    } finally { f.native.close(); }
  });

  it('revokes an unstarted send when its owner stops the task', async () => {
    const f = await fixture();
    try {
      const stopped = await f.runs.stop('owner', f.id);
      expect(stopped.sendApproval?.status).toBe('rejected');
      await expect(f.runs.decideSend('owner', f.id, f.decision())).rejects.toThrow('已变化');
      expect(sendTelegramMessage).not.toHaveBeenCalled();
    } finally { f.native.close(); }
  });

  it('blocks replay when a send returns without a successful transport receipt', async () => {
    const f = await fixture();
    try {
      vi.mocked(sendTelegramMessage).mockResolvedValueOnce({ ok: false, error: 'lost' });
      await f.runs.decideSend('owner', f.id, f.decision());
      await f.runs.wait(f.id);
      const restored = f.make();
      expect((await restored.get('owner', f.id)).canResume).toBe(false);
      await expect(restored.resume('owner', f.id)).rejects.toThrow('结果未知');
      expect(sendTelegramMessage).toHaveBeenCalledOnce();
    } finally { f.native.close(); }
  });
});
