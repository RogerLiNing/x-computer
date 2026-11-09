import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { ChatRunService } from './ChatRunService.js';

const image = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from('sealed expert image')]);
const expectedImages = [{ mediaType: 'image/png', data: image.toString('base64') }];
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(action: 'dispatch' | 'team' | 'group' = 'dispatch') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'expert-images-'));
  const sqlite = new SqliteAppDatabase(root), db = new SqliteDatabaseAdapter(sqlite), spaces = new UserSandboxManager(root);
  await db.ensureUser('owner');
  const sandbox = (await spaces.getForUser('owner')).sandboxFS;
  await sandbox.writeBinaryNew('photo.bin', image);
  const agents = ['reader', 'checker'].map(id => ({ id, name: id, systemPrompt: '看原图', toolNames: ['file.read'] }));
  await db.setConfig('owner', 'x_agents', JSON.stringify(agents));
  for (const key of ['x_agent_teams', 'x_agent_groups']) await db.setConfig('owner', key, JSON.stringify([{ id: 'pair', name: '读图小组', agentIds: agents.map(agent => agent.id) }]));
  const entered = gate();
  const child = vi.fn(async (_params: any) => ({ content: '已核对图片', stopReason: 'completed' }));
  const make = (connection = db) => new ChatRunService({ db: connection,
    orchestrator: { runChatAgentLoop: async (params: any) => {
      if (params.agentRunId) return child(params);
      await params.onCheckpoint([...params.messages, { role: 'assistant', content: '', tool_calls: [{ id: 'handoff', name: action === 'dispatch' ? 'x.dispatch_agent' : `x.dispatch_${action}`, arguments: {} }] }]);
      entered.resolve();
      await new Promise((_, reject) => params.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
    } } as never,
    getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'test', modelId: 'test' }),
  });
  const runs = make(), session = await db.createSession('owner');
  const parent = await runs.accept({ userId: 'owner', sessionId: session.id, requestId: 'image-parent',
    providerId: 'test', modelId: 'test', systemPrompt: '', allowedToolNames: ['file.read', 'x.dispatch_agent', 'x.dispatch_team', 'x.dispatch_group'],
    messages: [{ role: 'user', content: '交给专家看原图' }], userMessage: { content: '交给专家看原图', images: ['photo.bin'] } });
  const execution = runs.launch('owner', parent.id); await entered.promise;
  const dispatch = (inputFiles?: string[]) => runs.expertDispatch({ action, userId: 'owner', parentRunId: parent.id, toolCallId: 'handoff', agentId: 'reader', teamId: 'pair', groupId: 'pair', goal: '核对原图', followUp: false, inputFiles });
  return { root, sqlite, db, spaces, sandbox, child, runs, parent, make, dispatch, async close() {
    for (const row of await db.getAllTasks()) await runs.stop('owner', row.id);
    await execution; for (const row of await db.getAllTasks()) await runs.wait(row.id);
    sqlite.close();
  } };
}

it.each([undefined, ['photo.bin']])('hands off captured pixels and resumes them across SQLite connections (%j)', async inputs => {
  const f = await fixture(); let second: SqliteAppDatabase | undefined;
  try {
    await f.sandbox.writeBinary('photo.bin', Buffer.from('changed original'));
    const entered = gate();
    f.child.mockImplementationOnce(async params => {
      entered.resolve(); await new Promise((_, reject) => params.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true }));
      return { content: '', stopReason: 'completed' };
    });
    const receipt = await f.dispatch(inputs); await entered.promise;
    expect(f.child.mock.calls[0][0].inputImages).toEqual(expectedImages);
    await f.runs.stop('owner', receipt.runId); await f.runs.wait(receipt.runId);
    expect((await f.runs.get('owner', receipt.runId)).status).toBe('paused');
    f.child.mockImplementation(async params => { expect(params.inputImages).toEqual(expectedImages); return { content: '恢复后看原图', stopReason: 'completed' }; });
    second = new SqliteAppDatabase(f.root); const restored = f.make(new SqliteDatabaseAdapter(second));
    await restored.resume('owner', receipt.runId); await restored.wait(receipt.runId);
    expect((await restored.get('owner', receipt.runId)).status).toBe('completed');
    const completed = await restored.get('owner', receipt.runId);
    await restored.reviewRun('owner', receipt.runId, { decision: 'changes_requested', feedback: '再核对一次', expectedUpdatedAt: completed.updatedAt });
    const revision = await restored.revise('owner', receipt.runId); await restored.wait(revision.id);
    expect((await restored.get('owner', revision.id)).status).toBe('completed');
    const revisedRow = (await f.db.getAllTasks()).find(row => row.id === revision.id)!;
    expect(JSON.parse(revisedRow.metadata_json!).chatRun.imageInputs[0].path).toContain(`/runs/${revision.id}/`);
    expect(f.child).toHaveBeenCalledTimes(3);
    for (const row of await f.db.getAllTasks()) expect(row.metadata_json).not.toContain(image.toString('base64'));
  } finally { second?.close(); await f.close(); }
});

it.each(['team', 'group'] as const)('keeps native images through every %s member', async action => {
  const f = await fixture(action);
  try {
    const receipt = await f.dispatch(); await f.runs.wait(receipt.runId);
    expect((await f.runs.get('owner', receipt.runId)).status).toBe('completed');
    expect(f.child).toHaveBeenCalledTimes(2);
    for (const [params] of f.child.mock.calls) expect(params.inputImages).toEqual(expectedImages);
  } finally { await f.close(); }
});

it('honors an explicit empty image selection', async () => {
  const f = await fixture();
  try {
    const receipt = await f.dispatch([]); await f.runs.wait(receipt.runId);
    expect((await f.runs.get('owner', receipt.runId)).status).toBe('completed');
    expect(f.child.mock.calls[0][0].inputImages).toBeUndefined();
  } finally { await f.close(); }
});

it('rejects a changed captured image before the expert model runs', async () => {
  const f = await fixture();
  try {
    const row = (await f.db.getAllTasks()).find(row => row.id === f.parent.id)!;
    const file = JSON.parse(row.metadata_json!).chatRun.imageInputs[0];
    await f.sandbox.writeBinary(file.path, Buffer.concat([image, Buffer.from('tampered')]));
    const receipt = await f.dispatch(); await f.runs.wait(receipt.runId);
    expect((await f.runs.get('owner', receipt.runId)).status).toBe('blocked');
    expect(f.child).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
