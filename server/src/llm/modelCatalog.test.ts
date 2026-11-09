import { describe, expect, it } from 'vitest';
import { describeModel, estimateCostUsd, estimateTokens } from './modelCatalog.js';

describe('model catalog', () => {
  it('knows common model families and falls back to a conservative default', () => {
    expect(describeModel('deepseek', 'deepseek-chat', [])).toMatchObject({ contextWindow: 131072, supportsTools: true, supportsImages: false, source: 'catalog' });
    expect(describeModel('openai', 'gpt-4o-mini', [])).toMatchObject({ supportsImages: true, inputUsdPerMTok: 0.15 });
    expect(describeModel('anthropic', 'claude-sonnet-4-20250514', [])).toMatchObject({ contextWindow: 204800, supportsImages: true });
    expect(describeModel('minimax', 'MiniMax-M3.1-Flash', [])).toMatchObject({ contextWindow: 204800, source: 'catalog' });
    expect(describeModel('custom', 'my-local-model', [])).toMatchObject({ contextWindow: 32768, source: 'default' });
  });

  it('lets deployment overrides win, optionally scoped to a provider', () => {
    const overrides = [{ match: 'minimax', supportsImages: true, inputUsdPerMTok: 0.2, outputUsdPerMTok: 1.1 }, { match: 'volcengine:doubao', contextWindow: 256000 }];
    expect(describeModel('minimax', 'MiniMax-M3.1-Flash', overrides)).toMatchObject({ supportsImages: true, inputUsdPerMTok: 0.2, source: 'config' });
    expect(describeModel('volcengine', 'doubao-pro', overrides)).toMatchObject({ contextWindow: 256000, source: 'config' });
    expect(describeModel('other', 'doubao-pro', overrides)).toMatchObject({ source: 'catalog' });
  });

  it('estimates cost only when both prices are known', () => {
    expect(estimateCostUsd({ inputUsdPerMTok: 1, outputUsdPerMTok: 2 }, { promptTokens: 1_000_000, completionTokens: 500_000 })).toBe(2);
    expect(estimateCostUsd({}, { promptTokens: 10, completionTokens: 10 })).toBeUndefined();
  });

  it('estimates tokens for mixed Chinese and Latin text', () => {
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('你好 abcd')).toBe(4);
  });
});
