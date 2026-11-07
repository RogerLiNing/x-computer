import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDefaultConfig } from '../config/defaultConfig.js';
import { resolveLLMCredentials } from './credentialResolver.js';
vi.mock('../config/defaultConfig.js', () => ({ loadDefaultConfig: vi.fn() }));
const platform = { providers: [{ id: 'platform', name: 'platform', apiKey: 'private-key' }], defaultByModality: { chat: { providerId: 'platform', modelId: 'default-model' } } };
describe('server-side default model resolution', () => {
  beforeEach(() => { vi.stubEnv('OPENROUTER_API_KEY', ''); vi.stubEnv('LLM_API_KEY', ''); vi.mocked(loadDefaultConfig).mockReturnValue({ llm_config: platform }); });
  afterEach(() => vi.unstubAllEnvs());
  it('uses the configured platform default when the caller does not specify a model', async () => {
    expect(await resolveLLMCredentials('owner', undefined, undefined)).toMatchObject({ providerId: 'platform', modelId: 'default-model', apiKey: 'private-key' });
    expect(await resolveLLMCredentials('owner', undefined, undefined, { providerId: 'platform' })).toMatchObject({ modelId: 'default-model' });
  });
  it('preserves explicit model selection and does not silently change an unknown provider', async () => {
    expect(await resolveLLMCredentials('owner', undefined, undefined, { providerId: 'platform', modelId: 'chosen' })).toMatchObject({ modelId: 'chosen' });
    vi.stubEnv('OPENROUTER_API_KEY', 'environment-key');
    expect(await resolveLLMCredentials('owner', undefined, undefined, { providerId: 'unknown' })).toBeNull();
  });
  it('reads an existing DeepSeek Anthropic address with its matching protocol', async () => {
    const custom = { providers: [{ id: 'deepseek', apiKey: 'private-key', baseUrl: 'https://api.deepseek.com/anthropic', apiType: 'openai' }] };
    const db = { getConfig: async () => JSON.stringify(custom) } as never;
    expect(await resolveLLMCredentials('owner', db, undefined, { providerId: 'deepseek', modelId: 'deepseek-flash' }))
      .toMatchObject({ apiType: 'anthropic', baseUrl: custom.providers[0].baseUrl, modelId: 'deepseek-flash' });
  });
  it('respects the existing eligibility for user-supplied configuration', async () => {
    const custom = { providers: [{ id: 'custom', apiKey: 'user-key', apiType: 'anthropic' }], defaultByModality: { chat: { providerId: 'custom', modelId: 'user-model' } } };
    const db = { getConfig: async () => JSON.stringify(custom) } as never;
    expect(await resolveLLMCredentials('owner', db, undefined)).toMatchObject({ providerId: 'custom', modelId: 'user-model', apiType: 'anthropic' });
    const subscription = { getUserSubscription: async () => ({ planId: 'free' }) } as never;
    // 默认策略：任何已登录用户都使用自己的配置
    expect(await resolveLLMCredentials('owner', db, subscription)).toMatchObject({ providerId: 'custom', modelId: 'user-model' });
    // paid 策略：免费用户回落到平台默认
    vi.stubEnv('X_COMPUTER_USER_LLM_POLICY', 'paid');
    expect(await resolveLLMCredentials('owner', db, subscription)).toMatchObject({ providerId: 'platform', modelId: 'default-model' });
  });
});
