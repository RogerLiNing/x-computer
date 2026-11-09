import { describe, expect, it } from 'vitest';
import { isVirtualModel, parseAutoRoute, routeVirtualModel } from './virtualModel.js';

const config = { cheap: { providerId: 'minimax', modelId: 'MiniMax-M3.1-Flash' }, strong: { providerId: 'deepseek', modelId: 'deepseek-chat' } };
const base = { toolCount: 0, hasImages: false, promptText: '你好', lastUserMessage: '你好' };

describe('virtual model routing', () => {
  it('recognises the auto id and validates route config', () => {
    expect(isVirtualModel('auto')).toBe(true);
    expect(isVirtualModel(' Auto ')).toBe(true);
    expect(isVirtualModel('gpt-4o')).toBe(false);
    expect(parseAutoRoute(config)).toEqual(config);
    expect(parseAutoRoute({ cheap: config.cheap })).toBeUndefined();
    expect(parseAutoRoute({ cheap: config.cheap, strong: { providerId: 'x', modelId: 'auto' } })).toBeUndefined();
    expect(parseAutoRoute({ ...config, longInputTokens: 100 })?.longInputTokens).toBe(100);
  });

  it('sends short chat to the cheap model and demanding requests to the strong one', () => {
    expect(routeVirtualModel(base, config)).toMatchObject({ tier: 'cheap', model: config.cheap });
    expect(routeVirtualModel({ ...base, toolCount: 3 }, config).tier).toBe('strong');
    expect(routeVirtualModel({ ...base, hasImages: true }, config).tier).toBe('strong');
    expect(routeVirtualModel({ ...base, promptText: '字'.repeat(7000) }, config).tier).toBe('strong');
    expect(routeVirtualModel({ ...base, lastUserMessage: '帮我写一篇胎教文章' }, config).tier).toBe('strong');
    expect(routeVirtualModel({ ...base, promptText: '字'.repeat(7000) }, { ...config, longInputTokens: 10000 }).tier).toBe('cheap');
  });

  it('keeps follow-up rounds on the tier chosen earlier in the run', () => {
    expect(routeVirtualModel({ ...base, toolCount: 5, sticky: 'cheap' }, config)).toMatchObject({ tier: 'cheap' });
    expect(routeVirtualModel({ ...base, sticky: 'strong' }, config)).toMatchObject({ tier: 'strong' });
  });
});
