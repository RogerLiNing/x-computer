import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireSignal, computeActionFingerprint } from './signalService.js';

describe('signalService', () => {
  const getConfig = vi.fn<() => string>();
  const runIntent = vi.fn<(userId: string, intent: string, meta?: object) => void>();
  const runAgent = vi.fn<(userId: string, agentId: string, goal: string, meta?: object) => Promise<void>>();

  beforeEach(() => {
    getConfig.mockReset();
    runIntent.mockReset();
    runAgent.mockReset();
  });

  it('computeActionFingerprint 相同 payload 生成相同 fingerprint', () => {
    const fp1 = computeActionFingerprint('u1', 'email_received', 't1', { uid: 123 });
    const fp2 = computeActionFingerprint('u1', 'email_received', 't1', { uid: 123 });
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('computeActionFingerprint 不同 uid 生成不同 fingerprint', () => {
    const fp1 = computeActionFingerprint('u1', 'email_received', 't1', { uid: 123 });
    const fp2 = computeActionFingerprint('u1', 'email_received', 't1', { uid: 124 });
    expect(fp1).not.toBe(fp2);
  });

  it('checkHandled 为 true 时跳过触发', async () => {
    getConfig.mockReturnValue(JSON.stringify([{ id: 't1', signal: 'email_received', intent: '处理邮件' }]));
    const checkHandled = vi.fn(() => true);

    const result = await fireSignal('u1', 'email_received', { uid: 100 }, {
      getConfig,
      runIntent,
      runAgent,
      checkHandled,
    });

    expect(result).toEqual({ fired: 0, skipped: 1 });
    expect(checkHandled).toHaveBeenCalledWith('u1', expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(runIntent).not.toHaveBeenCalled();
  });

  it('checkHandled 为 false 时正常触发', async () => {
    getConfig.mockReturnValue(JSON.stringify([{ id: 't1', signal: 'email_received', intent: '处理邮件' }]));
    const checkHandled = vi.fn(() => false);

    const result = await fireSignal('u1', 'email_received', { uid: 101, goal: '请处理' }, {
      getConfig,
      runIntent,
      runAgent,
      checkHandled,
    });

    expect(result).toEqual({ fired: 1, skipped: 0 });
    expect(runIntent).toHaveBeenCalledWith('u1', '请处理', { signal: 'email_received', actionFingerprint: expect.any(String) });
  });
});
