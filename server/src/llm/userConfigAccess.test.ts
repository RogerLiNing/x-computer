import { afterEach, describe, expect, it, vi } from 'vitest';
import { canConfigureUserLLM, USER_LLM_POLICY_ENV } from './userConfigAccess.js';

const subscriptionOf = (planId?: string) => ({
  getUserSubscription: vi.fn(async () => (planId ? { planId } : null)),
});
const db = { getEmailByUserId: vi.fn(async () => 'someone@example.com') };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('canConfigureUserLLM', () => {
  it('默认允许任何已登录用户使用自己的模型密钥', async () => {
    vi.stubEnv(USER_LLM_POLICY_ENV, '');
    expect(await canConfigureUserLLM('u1', db as never, subscriptionOf('trial') as never)).toBe(true);
    expect(await canConfigureUserLLM('u1', db as never, subscriptionOf() as never)).toBe(true);
  });

  it('匿名用户始终不能配置', async () => {
    expect(await canConfigureUserLLM('anonymous', db as never, subscriptionOf('pro') as never)).toBe(false);
    expect(await canConfigureUserLLM('', db as never, subscriptionOf('pro') as never)).toBe(false);
  });

  it('paid 策略下只有专业版、企业版和管理员可以配置', async () => {
    vi.stubEnv(USER_LLM_POLICY_ENV, 'paid');
    vi.stubEnv('X_COMPUTER_ADMIN_EMAILS', 'admin@example.com');
    expect(await canConfigureUserLLM('u1', db as never, subscriptionOf('trial') as never)).toBe(false);
    expect(await canConfigureUserLLM('u1', db as never, subscriptionOf('pro') as never)).toBe(true);
    expect(await canConfigureUserLLM('u1', db as never, subscriptionOf('enterprise') as never)).toBe(true);
    const adminDb = { getEmailByUserId: vi.fn(async () => 'Admin@Example.com') };
    expect(await canConfigureUserLLM('u1', adminDb as never, subscriptionOf('trial') as never)).toBe(true);
  });

  it('paid 策略下查询订阅出错时拒绝', async () => {
    vi.stubEnv(USER_LLM_POLICY_ENV, 'paid');
    const broken = { getUserSubscription: vi.fn(async () => { throw new Error('db down'); }) };
    expect(await canConfigureUserLLM('u1', db as never, broken as never)).toBe(false);
  });

  it('无法识别的策略值按 paid 处理，避免误放开', async () => {
    vi.stubEnv(USER_LLM_POLICY_ENV, 'evryone');
    expect(await canConfigureUserLLM('u1', db as never, subscriptionOf('trial') as never)).toBe(false);
  });
});
