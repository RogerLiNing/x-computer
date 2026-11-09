import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, callLLMWithToolsStream } from './chatService.js';

afterEach(() => vi.unstubAllGlobals());

describe('provider protocol and endpoint compatibility', () => {
  it.each(['https://api.deepseek.com/anthropic', 'https://api.deepseek.com/anthropic/v1'])('routes legacy OpenAI metadata to the actual Anthropic endpoint at %s', async baseUrl => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '真实回复' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const request = { providerId: 'deepseek', modelId: 'deepseek-flash', baseUrl, apiType: 'openai' as const,
      apiKey: 'fixture-key', messages: [{ role: 'user' as const, content: 'reply' }] };
    expect(await callLLM(request)).toBe('真实回复');
    const chunks: string[] = [];
    expect((await callLLMWithToolsStream(request, [{ name: 'test', description: '', parameters: {} }], chunk => chunks.push(chunk))).content).toBe('真实回复');
    expect(chunks).toEqual(['真实回复']);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe('https://api.deepseek.com/anthropic/v1/messages');
      expect(options.headers['x-api-key']).toBe('fixture-key');
      expect(options.headers['anthropic-version']).toBeDefined();
      expect(JSON.parse(options.body).messages[0].content).toBeDefined();
    }
  });

  it('preserves a custom gateway protocol and avoids repeated /v1 segments', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await callLLM({ providerId: 'gateway', modelId: 'model', baseUrl: 'https://gateway.example/v1/',
      apiKey: 'fixture', apiType: 'anthropic', messages: [{ role: 'user', content: 'reply' }] })).toBe('ok');
    expect(fetch.mock.calls[0][0]).toBe('https://gateway.example/v1/messages');
  });
});
