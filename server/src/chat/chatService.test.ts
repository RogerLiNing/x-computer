import { describe, expect, it } from 'vitest';
import {
  createThinkStreamFilter,
  parseTextualToolCalls,
  resolveExplicitToolChoice,
  type ChatMessage,
  type LLMToolDef,
} from './chatService.js';

const tools: LLMToolDef[] = [
  {
    name: 'capability.search',
    description: 'Search capabilities',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'file.read',
    description: 'Read file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

describe('parseTextualToolCalls', () => {
  it('parses malformed MiniMax textual calls and removes the raw tags', () => {
    const result = parseTextualToolCalls(
      `先检查可用能力。
<minimax:tool_call>
capability.search("health check backend frontend")
<minimax:tool_call>
capability.search("system status monitor")
</minimax:tool_call>`,
      tools,
    );

    expect(result.toolCalls).toEqual([
      {
        id: 'text_call_0',
        name: 'capability.search',
        arguments: { query: 'health check backend frontend' },
      },
      {
        id: 'text_call_1',
        name: 'capability.search',
        arguments: { query: 'system status monitor' },
      },
    ]);
    expect(result.content).toBe('先检查可用能力。');
  });

  it('parses JSON object arguments for an advertised tool', () => {
    const result = parseTextualToolCalls(
      '<tool_call>file.read({"path":"文档/状态.md"})</tool_call>',
      tools,
    );

    expect(result.toolCalls[0]).toMatchObject({
      name: 'file.read',
      arguments: { path: '文档/状态.md' },
    });
    expect(result.content).toBe('');
  });

  it('does not parse ordinary text or unadvertised functions', () => {
    const ordinary = '示例：capability.search("health")';
    expect(parseTextualToolCalls(ordinary, tools)).toEqual({
      content: ordinary,
      toolCalls: [],
    });
    const unknown = '<minimax:tool_call>danger.run("now")</minimax:tool_call>';
    expect(parseTextualToolCalls(unknown, tools)).toEqual({
      content: unknown,
      toolCalls: [],
    });
  });
});

describe('resolveExplicitToolChoice', () => {
  const messages = (content: string): ChatMessage[] => [{ role: 'user', content }];

  it('forces a uniquely named tool when the user explicitly requests it', () => {
    expect(resolveExplicitToolChoice(
      messages('请调用 capability.search 查找健康检查能力'),
      tools,
    )).toEqual({
      type: 'function',
      function: { name: 'capability.search' },
    });
  });

  it('returns auto after a tool result or for non-execution discussion', () => {
    expect(resolveExplicitToolChoice(
      messages('capability.search 是什么？'),
      tools,
    )).toBe('auto');
    expect(resolveExplicitToolChoice(
      [
        ...messages('请调用 capability.search 查找能力'),
        { role: 'assistant', content: '', tool_calls: [{ id: '1', name: 'capability.search', arguments: {} }] },
        { role: 'tool', content: '{}', tool_call_id: '1' },
      ],
      tools,
    )).toBe('auto');
  });
});

describe('createThinkStreamFilter', () => {
  it('hides split think tags while preserving visible streamed text', () => {
    const chunks: string[] = [];
    const filter = createThinkStreamFilter((chunk) => chunks.push(chunk));
    for (const chunk of ['开头<th', 'ink>内部推理', '</thi', 'nk>最终', '答案']) {
      filter.push(chunk);
    }
    filter.finish();
    expect(chunks.join('')).toBe('开头最终答案');
  });
});
