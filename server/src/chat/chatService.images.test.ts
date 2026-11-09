import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, callLLMWithTools, callLLMWithToolsStream } from './chatService.js';

afterEach(() => vi.unstubAllGlobals());
const inputImages = [{ mediaType: 'image/png' as const, data: 'fixture-base64' }];
const messages = [{ role: 'user' as const, content: 'earlier' }, { role: 'assistant' as const, content: 'ok' }, { role: 'user' as const, content: 'look at this image' }];
const tools = [{ name: 'file.present', description: 'present', parameters: {} }];

describe('native vision wire format', () => {
  it('sends OpenAI image content only on the latest user message and keeps text history intact', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'seen' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const before = structuredClone(messages);
    expect((await callLLMWithTools({ providerId: 'openai', modelId: 'vision', baseUrl: 'https://example.test/v1', apiKey: 'fixture', messages, inputImages }, tools)).content).toBe('seen');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toBe('earlier');
    expect(body.messages[2].content).toEqual([{ type: 'text', text: 'look at this image' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture-base64' } }]);
    expect(messages).toEqual(before);
  });

  it('keeps image content in OpenAI streaming requests too', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"seen"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetch);
    const chunks: string[] = [];
    const result = await callLLMWithToolsStream({
      providerId: 'openai', modelId: 'vision', baseUrl: 'https://example.test/v1', apiKey: 'fixture', messages, inputImages,
    }, tools, chunk => chunks.push(chunk));
    expect(result.content).toBe('seen');
    expect(chunks.join('')).toBe('seen');
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[2].content[1].image_url.url).toBe('data:image/png;base64,fixture-base64');
  });

  it('does not drop a user turn containing only an image', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'seen' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await callLLMWithTools({
      providerId: 'vision', modelId: 'vision', baseUrl: 'https://example.test', apiType: 'anthropic', apiKey: 'fixture',
      messages: [{ role: 'user', content: '' }], inputImages,
    }, tools);
    expect(result.content).toBe('seen');
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages).toEqual([{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture-base64' } },
    ] }]);
  });

  it.each([false, true])('sends Anthropic image blocks in plain and tool requests: %s', async withTools => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'seen' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const request = { providerId: 'vision', modelId: 'vision', baseUrl: 'https://example.test', apiType: 'anthropic' as const, apiKey: 'fixture', messages, inputImages };
    if (withTools) expect((await callLLMWithTools(request, tools)).content).toBe('seen');
    else expect(await callLLM(request)).toBe('seen');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toEqual(withTools ? [{ type: 'text', text: 'earlier' }] : 'earlier');
    expect(body.messages[2].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture-base64' } });
    expect(JSON.stringify(body).match(/fixture-base64/g)).toHaveLength(1);
  });
});
