import { expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { LivingAIKernel } from './LivingAIKernel.js';
import { RunOwnershipStore } from '../chat/RunOwnershipStore.js';

it('two service instances admit only one autonomous cycle for the same user', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'living-owner-'));
  const first = new SqliteAppDatabase(root), second = new SqliteAppDatabase(root);
  const a = new SqliteDatabaseAdapter(first), b = new SqliteDatabaseAdapter(second);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => entered = resolve), held = new Promise<void>(resolve => release = resolve);
  const run = vi.fn(async () => {
    if (run.mock.calls.length === 1) { entered(); await held; }
    return { content: JSON.stringify({ decision: 'idle', summary: 'checked', reviewAfterMinutes: 30 }) };
  });
  const kernel = (db: SqliteDatabaseAdapter) => new LivingAIKernel({ db, orchestrator: { getAllTasks: () => [], runIntentAsPersistedTask: run } as never, getLLMConfig: async () => ({ providerId: 'test', modelId: 'test' }), getSystemPrompt: async () => '', notify: () => {} });
  const worker = kernel(a), competitor = kernel(b);
  let cycle: Promise<unknown> | undefined;
  try {
    await worker.getStatus('owner');
    cycle = worker.runCycle('owner'); await started;
    await competitor.runCycle('owner');
    expect(run).toHaveBeenCalledTimes(1);
    release(); await cycle;
    expect((await competitor.getStatus('owner')).state.cycleCount).toBe(1);
    await competitor.runCycle('owner', 'timer');
    expect(run).toHaveBeenCalledTimes(1);
  } finally { release(); await cycle; first.close(); second.close(); }
});

it('fences a late response even when ownership changes after the last application check', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'living-fence-'));
  const first = new SqliteAppDatabase(root), second = new SqliteAppDatabase(root);
  const a = new SqliteDatabaseAdapter(first), b = new SqliteDatabaseAdapter(second), notify = vi.fn();
  const kernel = new LivingAIKernel({ db: a, orchestrator: { getAllTasks: () => [], runIntentAsPersistedTask: async () => ({ content: JSON.stringify({ decision: 'acted', summary: 'LATE_OWNER', messageToUser: 'LATE_NOTICE' }) }) } as never, getLLMConfig: async () => ({ providerId: 'test', modelId: 'test' }), getSystemPrompt: async () => '', notify });
  const run = a.run.bind(a); let replaced = false;
  vi.spyOn(a, 'run').mockImplementation(async (sql, params) => {
    if (!replaced && sql.startsWith('UPDATE user_config SET value=?,updated_at=?') && String(params?.[0]).includes('LATE_OWNER')) {
      replaced = true;
      await b.run('UPDATE chat_run_ownership SET owner_token=?,expires_at=0 WHERE user_id=?', ['replacement', 'owner']);
      const latest = JSON.parse((await b.getConfig('owner', 'living_ai_state_v1'))!);
      latest.lastAction = 'NEW_OWNER';
      await b.setConfig('owner', 'living_ai_state_v1', JSON.stringify(latest));
    }
    return run(sql, params);
  });
  try {
    await kernel.runCycle('owner');
    const state = (await kernel.getStatus('owner')).state;
    expect(replaced).toBe(true); expect(state.lastAction).toBe('NEW_OWNER');
    expect(state.episodes).toEqual([]); expect(notify).not.toHaveBeenCalled();
  } finally { first.close(); second.close(); }
});

it('concurrent first reads retain one identity and another user has a separate cycle scope', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'living-identity-'));
  const first = new SqliteAppDatabase(root), second = new SqliteAppDatabase(root);
  const a = new SqliteDatabaseAdapter(first), b = new SqliteDatabaseAdapter(second);
  const create = (db: SqliteDatabaseAdapter) => new LivingAIKernel({ db, orchestrator: { getAllTasks: () => [] } as never, getLLMConfig: async () => null, getSystemPrompt: async () => '' });
  const owner = create(a), other = create(b);
  try {
    const [one, two] = await Promise.all([owner.getStatus('owner'), other.getStatus('owner')]);
    expect(one.state.identity.continuityId).toBe(two.state.identity.continuityId);
    const gate = new RunOwnershipStore(a); await gate.init();
    expect(await gate.acquire('different-user', 'unrelated', 'unrelated', 'record')).toBe(true);
    await other.runCycle('owner');
    expect((await owner.getStatus('owner')).state.cycleCount).toBe(1);
    await gate.release('unrelated', 'record');
  } finally { first.close(); second.close(); }
});
