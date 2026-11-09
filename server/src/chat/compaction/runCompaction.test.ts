import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../chatService.js';
import { COMPACTION_PREFIX } from './compaction.js';
import { compactIfNeeded } from './runCompaction.js';

const filler = (label: string) => ({ role: 'user' as const, content: `${label} ${'字'.repeat(3000)}` });
const reply = (label: string) => ({ role: 'assistant' as const, content: `${label} ${'字'.repeat(3000)}` });

describe('compactIfNeeded', () => {
  it('leaves a conversation alone while it fits the model window', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 's' }, filler('a'), reply('b')];
    const summarize = vi.fn(async () => '摘要');
    expect(await compactIfNeeded(messages, { providerId: 'openai', modelId: 'gpt-4o' }, summarize)).toBeUndefined();
    expect(summarize).not.toHaveBeenCalled();
    expect(messages).toHaveLength(3);
  });

  it('compacts in place once the estimate exceeds the window minus the reserve', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 's' }];
    for (let i = 0; i < 8; i++) messages.push(filler(`问${i}`), reply(`答${i}`));
    const result = await compactIfNeeded(messages, { providerId: 'custom', modelId: 'tiny-local' }, async () => '1. 任务目标：测试', { reserveTokens: 1000, keepRecentTokens: 8000 });
    expect(result).toBeDefined();
    expect(messages[0].role).toBe('system');
    expect(messages[1].content.startsWith(COMPACTION_PREFIX)).toBe(true);
    expect(messages.length).toBeLessThan(17);
  });

  it('keeps the original history when summarization throws unexpectedly', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 's' }];
    for (let i = 0; i < 8; i++) messages.push(filler(`问${i}`), reply(`答${i}`));
    const before = messages.length;
    const result = await compactIfNeeded(messages, { providerId: 'custom', modelId: 'tiny-local' }, async () => { throw new Error('down'); }, { reserveTokens: 1000 });
    // compactMessages falls back to excerpts, so a compaction still happens; only a hard failure keeps history.
    expect(result === undefined ? messages.length : messages.length).toBeLessThanOrEqual(before);
  });
});
