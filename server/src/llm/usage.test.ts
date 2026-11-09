import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { ModelUsageStore } from './ModelUsageStore.js';
import { parseProviderUsage, recordModelUsage, setModelUsageSink } from './usage.js';

describe('model usage recording', () => {
  afterEach(() => setModelUsageSink(undefined));

  it('parses OpenAI and Anthropic usage shapes and ignores garbage', () => {
    expect(parseProviderUsage({ prompt_tokens: 10, completion_tokens: 5 })).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(parseProviderUsage({ input_tokens: 3, output_tokens: 4 })).toEqual({ promptTokens: 3, completionTokens: 4 });
    expect(parseProviderUsage({ prompt_tokens: -1 })).toBeUndefined();
    expect(parseProviderUsage(null)).toBeUndefined();
  });

  it('attaches an estimated cost when the catalog prices the model and forwards to the sink', async () => {
    const sink = vi.fn();
    setModelUsageSink(sink);
    const priced = recordModelUsage({ userId: 'alice', providerId: 'openai', modelId: 'gpt-4o-mini', promptTokens: 1_000_000, completionTokens: 0 });
    expect(priced.costUsd).toBeCloseTo(0.15);
    const unpriced = recordModelUsage({ providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash', promptTokens: 1, completionTokens: 1 });
    expect(unpriced.costUsd).toBeUndefined();
    expect(unpriced.totalTokens).toBe(2);
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('never lets a failing sink reach the caller', async () => {
    setModelUsageSink(() => { throw new Error('db down'); });
    expect(() => recordModelUsage({ providerId: 'p', modelId: 'm', promptTokens: 1, completionTokens: 1 })).not.toThrow();
    await Promise.resolve();
  });
});

describe('ModelUsageStore', () => {
  let sqlite: SqliteAppDatabase; let db: SqliteDatabaseAdapter; let store: ModelUsageStore;
  beforeEach(async () => {
    sqlite = new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(), 'usage-'))); db = new SqliteDatabaseAdapter(sqlite); store = new ModelUsageStore(db);
  });
  afterEach(() => sqlite.close());

  it('aggregates totals, per model and per day for one user only', async () => {
    const now = Date.now();
    await store.insert({ id: '1', userId: 'alice', providerId: 'openai', modelId: 'gpt-4o-mini', promptTokens: 100, completionTokens: 50, totalTokens: 150, costUsd: 0.001, at: now });
    await store.insert({ id: '2', userId: 'alice', providerId: 'minimax', modelId: 'M3', promptTokens: 10, completionTokens: 5, totalTokens: 15, at: now - 2 * 24 * 60 * 60 * 1000 });
    await store.insert({ id: '3', userId: 'bob', providerId: 'openai', modelId: 'gpt-4o-mini', promptTokens: 999, completionTokens: 1, totalTokens: 1000, costUsd: 1, at: now });
    const summary = await store.summary('alice', { days: 7 });
    expect(summary.totals).toEqual({ calls: 2, promptTokens: 110, completionTokens: 55, costUsd: 0.001 });
    expect(summary.byModel.map((row) => row.modelId)).toEqual(['gpt-4o-mini', 'M3']);
    expect(summary.byModel[1].costUsd).toBeNull();
    expect(summary.byDay).toHaveLength(2);
    expect((await store.summary('alice', { days: 1 })).totals.calls).toBe(1);
    expect((await store.summary('carol')).totals).toEqual({ calls: 0, promptTokens: 0, completionTokens: 0, costUsd: null });
  });
});
