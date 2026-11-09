import { describe, it, expect } from 'vitest';
import { XScheduler, nextCronRun } from './XScheduler.js';

describe('XScheduler cron 步长语法 */n', () => {
  it('*/5 * * * * 应在数分钟内得到下次运行，而非 24 小时后', async () => {
    const scheduler = new XScheduler(async () => {});
    const now = Date.now();
    const job = await scheduler.addJob('user1', 'test intent', undefined, '*/5 * * * *');
    const list = scheduler.listJobs('user1');
    expect(list).toHaveLength(1);
    expect(list[0].runAt).toBe(job.runAt);
    // 每 5 分钟一次，下次运行应在 0～5 分钟之间（不会落到 24 小时后）
    const fiveMinutesMs = 5 * 60 * 1000;
    expect(job.runAt).toBeGreaterThan(now);
    expect(job.runAt).toBeLessThanOrEqual(now + fiveMinutesMs + 60_000);
  });
});

describe('schedule persistence and cron validation', () => {
  it('handles monthly runs, ranges and Sunday aliases, and rejects malformed values', () => {
    const now = new Date(2026, 9, 10, 12).getTime();
    expect(nextCronRun('0 9 1 * *', now)).toBe(new Date(2026, 10, 1, 9).getTime());
    expect(nextCronRun('5-15/5 9 * * 1-5', now)).toBe(new Date(2026, 9, 12, 9, 5).getTime());
    expect(nextCronRun('0 9 * * 7', now)).toBe(new Date(2026, 9, 11, 9).getTime());
    for (const cron of ['99 * * * *', '0no 9 * * *', '*/0 * * * *', '0 9 31 2 *', '0 24 * * *']) expect(nextCronRun(cron, now)).toBeNull();
  });
  it('does not move missed cron due times when loading and retries failed queue writes', async () => {
    const job = { id: 'plan', userId: 'owner', intent: 'test', runAt: 100, createdAt: 1, cron: '* * * * *' };
    let calls = 0; let dispatched = 0;
    const store = { loadAll: async () => [{ ...job }], save: async () => {}, remove: async () => {}, updateRunAt: async () => {},
      queue: async (value: typeof job) => { expect(value.runAt).toBe(100); if (++calls === 1) throw new Error('db offline'); dispatched++; } };
    const scheduler = new XScheduler(async () => { throw new Error('legacy engine must not run'); }, store);
    await scheduler.loadJobs(); expect(scheduler.listJobs()[0].runAt).toBe(100);
    await expect(scheduler.tick()).rejects.toThrow('db offline'); await scheduler.tick(); expect(dispatched).toBe(1);
  });
  it('reports failed persistence instead of claiming the job was accepted', async () => {
    const scheduler = new XScheduler(async () => {}, { loadAll: async () => [], save: async () => { throw new Error('db offline'); }, remove: async () => {}, updateRunAt: async () => {} });
    await expect(scheduler.addJob('owner', 'test', Date.now())).rejects.toThrow('db offline'); expect(scheduler.listJobs()).toEqual([]);
    await expect(scheduler.addJob('owner', 'test', 'invalid')).rejects.toThrow('时间无效');
  });
});

describe('scheduler reliability', () => {
  it('caps standing jobs per user and names the way out', async () => {
    process.env.X_SCHEDULER_MAX_JOBS_PER_USER = '2';
    try {
      const scheduler = new XScheduler(async () => {});
      await scheduler.addJob('alice', 'a', Date.now() + 60_000);
      await scheduler.addJob('alice', 'b', Date.now() + 60_000);
      await expect(scheduler.addJob('alice', 'c', Date.now() + 60_000)).rejects.toThrow(/最多同时保留 2 个/);
      await expect(scheduler.addJob('bob', 'c', Date.now() + 60_000)).resolves.toBeDefined();
    } finally { delete process.env.X_SCHEDULER_MAX_JOBS_PER_USER; }
  });

  it('reports a heartbeat and lists disabled jobs with their last outcome', async () => {
    const store = {
      loadAll: async () => [{ id: 'j1', userId: 'alice', intent: 'live', runAt: Date.now() + 60_000, createdAt: 1 }],
      save: async () => {}, updateRunAt: async () => {}, remove: async () => {},
      listAllForUser: async () => [
        { id: 'j1', userId: 'alice', intent: 'live', runAt: Date.now() + 60_000, createdAt: 1, enabled: true },
        { id: 'j2', userId: 'alice', intent: 'stopped', runAt: 0, createdAt: 1, enabled: false },
      ],
      lastOutcomes: async () => ({ j2: { status: 'needs_attention', error: '模型未配置', at: 5 } }),
    };
    const scheduler = new XScheduler(async () => {}, store);
    await scheduler.loadJobs();
    expect(scheduler.getStats()).toMatchObject({ running: false, lastTickAt: null, healthy: true, jobCount: 1 });
    await scheduler.tick();
    expect(scheduler.getStats().lastTickAt).not.toBeNull();
    const listed = await scheduler.listJobsWithOutcome('alice');
    expect(listed.map((job) => [job.id, job.enabled, job.lastRun?.status])).toEqual([['j1', true, undefined], ['j2', false, 'needs_attention']]);
    expect(scheduler.listJobs('alice')).toHaveLength(1);
  });
});
