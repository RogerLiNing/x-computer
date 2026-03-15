import { describe, it, expect } from 'vitest';
import { XScheduler } from './XScheduler.js';

describe('XScheduler cron 步长语法 */n', () => {
  it('*/5 * * * * 应在数分钟内得到下次运行，而非 24 小时后', () => {
    const scheduler = new XScheduler(async () => {});
    const now = Date.now();
    const job = scheduler.addJob('user1', 'test intent', undefined, '*/5 * * * *');
    const list = scheduler.listJobs('user1');
    expect(list).toHaveLength(1);
    expect(list[0].runAt).toBe(job.runAt);
    // 每 5 分钟一次，下次运行应在 0～5 分钟之间（不会落到 24 小时后）
    const fiveMinutesMs = 5 * 60 * 1000;
    expect(job.runAt).toBeGreaterThan(now);
    expect(job.runAt).toBeLessThanOrEqual(now + fiveMinutesMs + 60_000);
  });
});
