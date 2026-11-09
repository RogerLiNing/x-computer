import { describe, expect, it, vi } from 'vitest';
import { JobRegistry } from './JobRegistry.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('JobRegistry', () => {
  it('runs work in the background, keeps a bounded output tail and reports completion once', async () => {
    const onFinished = vi.fn();
    const registry = new JobRegistry({ maxOutputChars: 20, onFinished });
    const job = registry.start('alice', 'echo', async (_signal, append) => { append('x'.repeat(30)); await tick(); return { exit: 0 }; });
    expect(registry.get('alice', job.id)?.status).toBe('running');
    expect(registry.get('bob', job.id)).toBeUndefined();
    await tick(); await tick();
    const done = registry.get('alice', job.id)!;
    expect(done.status).toBe('completed');
    expect(done.output.length).toBeLessThanOrEqual(20);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished.mock.calls[0][0]).toMatchObject({ id: job.id, status: 'completed' });
  });

  it('marks failures, honours kill and caps running jobs per user', async () => {
    const registry = new JobRegistry({ maxRunningPerUser: 1 });
    const failing = registry.start('alice', 'boom', async () => { await tick(); throw new Error('bad'); });
    expect(() => registry.start('alice', 'second', async () => {})).toThrow(/最多同时运行 1 个/);
    await tick(); await tick();
    expect(registry.get('alice', failing.id)).toMatchObject({ status: 'failed', error: 'bad' });

    const long = registry.start('alice', 'sleep', (signal) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason)); }));
    expect(registry.kill('alice', long.id)).toBe(true);
    await tick();
    expect(registry.get('alice', long.id)?.status).toBe('killed');
    expect(registry.kill('alice', long.id)).toBe(false);
    expect(registry.kill('bob', long.id)).toBe(false);
    expect(registry.list('alice').map((job) => job.status).sort()).toEqual(['failed', 'killed']);
  });
});
