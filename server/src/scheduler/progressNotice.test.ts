import { describe, expect, it, vi } from 'vitest';
import { scheduleProgressNotice } from './progressNotice.js';

describe('scheduleProgressNotice', () => {
  it('sends once when the work outlives the threshold and never when it finishes first', async () => {
    const send = vi.fn(async () => {});
    const slow = new Promise((resolve) => setTimeout(resolve, 60));
    expect(await scheduleProgressNotice(slow, { afterMs: 10, send })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    const fast = Promise.resolve('done');
    expect(await scheduleProgressNotice(fast, { afterMs: 10, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('swallows send failures and does not notify for work that fails quickly', async () => {
    const send = vi.fn(async () => { throw new Error('offline'); });
    const slow = new Promise((resolve) => setTimeout(resolve, 40));
    expect(await scheduleProgressNotice(slow, { afterMs: 5, send })).toBe(false);
    const failing = Promise.reject(new Error('boom'));
    expect(await scheduleProgressNotice(failing, { afterMs: 5, send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
