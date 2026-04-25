import { describe, it, expect } from 'vitest';
import { webSearchDefinition, createWebSearchHandler } from './webSearch.js';

describe('webSearch tool', () => {
  const handler = createWebSearchHandler({} as any);

  it('has correct definition', () => {
    expect(webSearchDefinition.name).toBe('web_search');
    expect(webSearchDefinition.displayName).toBe('网络搜索');
    expect(webSearchDefinition.riskLevel).toBe('low');
    expect(webSearchDefinition.parameters).toHaveLength(2);
    expect(webSearchDefinition.parameters.find((p) => p.name === 'query')?.required).toBe(true);
    expect(webSearchDefinition.parameters.find((p) => p.name === 'numResults')?.required).toBe(false);
  });

  it('returns error when query is missing', async () => {
    await expect(handler({})).rejects.toThrow('web_search: query is required');
  });

  it('returns results for a valid query', async () => {
    const result = await handler({ query: 'Claude AI assistant', numResults: 3 });
    expect(result).toHaveProperty('query', 'Claude AI assistant');
    expect(result).toHaveProperty('results');
    expect(Array.isArray((result as any).results)).toBe(true);
    // At least check we got some structure back
    const r = result as any;
    if (r.results.length > 0) {
      expect(r.results[0]).toHaveProperty('title');
      expect(r.results[0]).toHaveProperty('url');
      expect(r.results[0]).toHaveProperty('snippet');
    }
  }, 15000);
});
