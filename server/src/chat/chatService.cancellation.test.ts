import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callLLM, callLLMStream, callLLMWithTools, callLLMWithToolsStream } from './chatService.js';

afterEach(() => vi.unstubAllGlobals());

describe('model request cancellation', () => {
  it.each(['openai', 'anthropic'] as const)('passes cancellation through %s requests without wrapping AbortError', async (apiType) => {
    const controller = new AbortController();
    const aborted = new DOMException('cancelled', 'AbortError');
    const fetchMock = vi.fn(async (_url, init) => {
      expect(init.signal).toBe(controller.signal);
      throw aborted;
    });
    vi.stubGlobal('fetch', fetchMock);
    const request = { messages: [{ role: 'user' as const, content: 'hello' }], providerId: 'custom', modelId: 'model', apiKey: 'test', baseUrl: 'https://example.invalid', apiType, signal: controller.signal };
    await expect(callLLM(request)).rejects.toBe(aborted);
    await expect(callLLMWithTools(request, [{ name: 'test', description: '', parameters: {} }])).rejects.toBe(aborted);
    await expect(callLLMWithToolsStream(request, [{ name: 'test', description: '', parameters: {} }], vi.fn())).rejects.toBe(aborted);
    await expect((async () => { for await (const _chunk of callLLMStream(request)) { /* drain */ } })()).rejects.toBe(aborted);
  });

  it('round-trips Anthropic tool calls and paired results using content blocks', async () => {
    const apiName = `tool_${createHash('sha256').update('file.read').digest('hex').slice(0, 48)}`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: '查看文件' }, { type: 'tool_use', id: 'tool-1', name: apiName, input: { path: 'result.txt' } }],
      stop_reason: 'tool_use',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await callLLMWithTools({
      providerId: 'custom', modelId: 'claude', apiKey: 'test', apiType: 'anthropic',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: '读取文件' },
        { role: 'assistant', content: '查看文件', tool_calls: [{ id: 'previous', name: 'file.read', arguments: { path: 'before.txt' } }] },
        { role: 'tool', tool_call_id: 'previous', content: 'previous result' },
      ],
    }, [{ name: 'file.read', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
    expect(body.system).toBe('system');
    expect(body.tools[0]).toMatchObject({ name: apiName, input_schema: { type: 'object' } });
    expect(body.tools[0].name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [
      { type: 'text', text: '查看文件' }, { type: 'tool_use', id: 'previous', name: apiName, input: { path: 'before.txt' } },
    ] });
    expect(body.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'previous', content: 'previous result' }] });
    expect(result).toEqual({ content: '查看文件', toolCalls: [{ id: 'tool-1', name: 'file.read', arguments: { path: 'result.txt' } }] });
  });
});
