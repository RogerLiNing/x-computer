import { expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ChatRunService } from './ChatRunService.js';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { AuditLogger } from '../observability/AuditLogger.js';
import { SendExecutionDeniedError, sendWithReceipt } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

it('resumes an unapproved send checkpoint in new gated runs while keeping legacy uncertainty', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gated-send-stop-')), native = new SqliteAppDatabase(root), db = new SqliteDatabaseAdapter(native);
  await db.ensureUser('owner'); const session = await db.createSession('owner'); let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const approved = vi.fn(async () => { throw new Error('must not send'); });
  const make = (loop: any) => new ChatRunService({ db, getSandboxFS: async () => new SandboxFS(root), getLLMConfig: async () => ({ providerId: 'test', modelId: 'test' }),
    orchestrator: { runApprovedSend: approved, runChatAgentLoop: loop } });
  const runs = make(async (params: any) => {
    await params.onCheckpoint([...params.messages, { role: 'assistant', content: '', tool_calls: [{ id: 'send', name: 'x.send_email', arguments: { to: 'recipient@example.test', subject: '合成', body: '正文' } }] }]);
    entered(); await new Promise((_, reject) => params.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
  });
  const run = await runs.accept({ userId: 'owner', sessionId: session.id, requestId: 'pending-send', providerId: 'test', modelId: 'test', systemPrompt: '', messages: [{ role: 'user', content: '合成发送任务' }] });
  try {
    const active = runs.launch('owner', run.id); await started; await runs.stop('owner', run.id); await active;
    expect((await runs.get('owner', run.id)).canResume).toBe(true); expect(approved).not.toHaveBeenCalled();
    const row = await db.queryOne<{ metadata_json: string }>('SELECT metadata_json FROM tasks WHERE id=?', [run.id]); const saved = JSON.parse(row!.metadata_json);
    delete saved.chatRun.gatedSends; await db.run('UPDATE tasks SET metadata_json=? WHERE id=?', [JSON.stringify(saved), run.id]);
    const fresh = make(vi.fn()); await expect(fresh.resume('owner', run.id)).rejects.toThrow('结果未知'); expect(approved).not.toHaveBeenCalled();
    saved.chatRun.gatedSends = true; saved.chatRun.unknownToolOutcome = false;
    await db.run('UPDATE tasks SET metadata_json=? WHERE id=?', [JSON.stringify(saved), run.id]);
    const resumed = make(async (params: any) => {
      expect(params.messages.some((message: any) => message.role === 'user' && message.content.startsWith('交办控制事件'))).toBe(true);
      const receipt = params.messages.find((message: any) => message.role === 'tool' && message.tool_call_id === 'send');
      expect(JSON.parse(receipt.content)).toMatchObject({ executed: false, cancelledBeforeDispatch: true });
      return { content: '继续准备，仍需发送前确认', stopReason: 'completed' };
    });
    await resumed.resume('owner', run.id); await resumed.wait(run.id);
    expect((await resumed.get('owner', run.id)).status).toBe('completed'); expect(approved).not.toHaveBeenCalled();
  } finally { native.close(); }
});
it('classifies approved execution aborted before the dispatcher as not sent', async () => {
  const orchestrator = new AgentOrchestrator(new AuditLogger());
  await expect(orchestrator.runApprovedSend({ userId: 'owner', runId: 'run', toolCallId: 'call', toolName: 'x.send_email', input: {}, approvedSendHash: 'hash', assertSendActive: async () => {}, signal: AbortSignal.abort() })).rejects.toBeInstanceOf(SendExecutionDeniedError);
});
it('does not confuse an aborted transport callback with a known unstarted send', async () => {
  await expect(sendWithReceipt(async () => { throw new DOMException('lost response', 'AbortError'); })).rejects.toBeInstanceOf(UncertainToolOutcomeError);
});
