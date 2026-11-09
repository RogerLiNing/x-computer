import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../chatService.js';
import { COMPACTION_PREFIX, collectFilePaths, compactMessages, estimateConversationTokens, shouldCompact, splitForCompaction } from './compaction.js';

const long = (label: string, chars = 800) => `${label} ${'字'.repeat(chars)}`;

function conversation(): ChatMessage[] {
  return [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: long('第一问') },
    { role: 'assistant', content: long('第一答') },
    { role: 'user', content: '把结果写到文件' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'file.write', arguments: { path: '文档/报告.md', content: 'x' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true,"path":"文档/报告.md"}' },
    { role: 'assistant', content: long('已写入') },
    { role: 'user', content: long('第三问') },
    { role: 'assistant', content: long('第三答') },
  ];
}

describe('compaction', () => {
  it('decides from estimated tokens against the window minus reserve', () => {
    const messages = conversation();
    const tokens = estimateConversationTokens(messages);
    expect(tokens).toBeGreaterThan(4000);
    expect(shouldCompact(messages, { contextWindow: tokens + 100, reserveTokens: 50 })).toBe(false);
    expect(shouldCompact(messages, { contextWindow: tokens + 100, reserveTokens: 500 })).toBe(true);
  });

  it('keeps system messages, never splits a tool call from its results, and keeps the adjacent user turn', () => {
    const split = splitForCompaction(conversation(), 1_000);
    expect(split.system).toHaveLength(1);
    expect(split.kept[0]).toMatchObject({ role: 'user', content: expect.stringContaining('第三问') });
    const cutAtTool = splitForCompaction(conversation(), 2_500);
    const firstKept = cutAtTool.kept[0]!;
    expect(firstKept.role).not.toBe('tool');
    if (cutAtTool.kept.some((message) => message.role === 'tool')) {
      expect(cutAtTool.kept.some((message) => message.tool_calls?.some((call) => call.id === 'c1'))).toBe(true);
    }
  });

  it('collects file paths from tool arguments and results', () => {
    expect(collectFilePaths(conversation())).toContain('文档/报告.md');
  });

  it('replaces the older part with a model-written summary that carries the file paths', async () => {
    const summarize = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('文档/报告.md');
      expect(prompt).toContain('第一问');
      return '1. 任务目标：整理报告。\n3. 涉及的文件：文档/报告.md';
    });
    const result = await compactMessages(conversation(), { keepRecentTokens: 1_000 }, summarize);
    expect(result).toBeDefined();
    expect(result!.messages[0].role).toBe('system');
    expect(result!.messages[1].content.startsWith(COMPACTION_PREFIX)).toBe(true);
    expect(result!.messages[1].content).toContain('文档/报告.md');
    expect(result!.tokensAfter).toBeLessThan(result!.tokensBefore);
    expect(result!.summarizedCount).toBeGreaterThan(0);
  });

  it('merges an earlier summary instead of nesting and falls back to excerpts when the model fails', async () => {
    const first = await compactMessages(conversation(), { keepRecentTokens: 1_000 }, async () => '早期摘要：文件 文档/报告.md');
    const grown: ChatMessage[] = [...first!.messages, { role: 'user', content: long('第四问') }, { role: 'assistant', content: long('第四答') }, { role: 'user', content: long('第五问') }, { role: 'assistant', content: long('第五答') }];
    const second = await compactMessages(grown, { keepRecentTokens: 1_000 }, async () => { throw new Error('model down'); });
    expect(second).toBeDefined();
    expect(second!.messages.filter((message) => message.content.startsWith(COMPACTION_PREFIX))).toHaveLength(1);
    expect(second!.messages[1].content).toContain('早期摘要');
    expect(second!.messages[1].content).toContain('原文摘录');
  });

  it('does nothing for a short conversation', async () => {
    const short: ChatMessage[] = [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
    expect(await compactMessages(short, { keepRecentTokens: 10 }, async () => 'x')).toBeUndefined();
  });
});
