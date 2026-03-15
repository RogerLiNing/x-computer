import { describe, it, expect } from 'vitest';
import { truncateChatMessages, MAX_CHAT_MESSAGES } from './chatContext.js';

describe('chatContext', () => {
  describe('truncateChatMessages', () => {
    it('不超过 max 时原样返回', () => {
      const messages = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ];
      expect(truncateChatMessages(messages)).toHaveLength(2);
      expect(truncateChatMessages(messages)[0]).toMatchObject({ role: 'user', content: 'a' });
      expect(truncateChatMessages(messages)[1]).toMatchObject({ role: 'assistant', content: 'b' });
    });

    it('超过 MAX_CHAT_MESSAGES 时保留首条 system + 最近 50 条', () => {
      const system = { role: 'system', content: 'sys' };
      const rest = Array.from({ length: 55 }, (_, i) =>
        i % 2 === 0
          ? { role: 'user', content: `u${i}` }
          : { role: 'assistant', content: `a${i}` },
      );
      const messages = [system, ...rest];
      const out = truncateChatMessages(messages);
      expect(out).toHaveLength(MAX_CHAT_MESSAGES);
      expect(out[0]).toMatchObject({ role: 'system', content: 'sys' });
      expect(out.slice(1).map((m) => m.content)).toEqual(
        rest.slice(-50).map((m) => m.content),
      );
    });

    it('无 system 时只保留最近 max 条', () => {
      const messages = Array.from({ length: 60 }, (_, i) =>
        i % 2 === 0 ? { role: 'user', content: `u${i}` } : { role: 'assistant', content: `a${i}` },
      );
      const out = truncateChatMessages(messages, 10);
      expect(out).toHaveLength(10);
      expect(out[0].content).toBe('u50');
      expect(out[1].content).toBe('a51');
      expect(out[9].content).toBe('a59');
    });

    it('自定义 max 生效', () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `m${i}` }));
      expect(truncateChatMessages(messages, 5)).toHaveLength(5);
      expect(truncateChatMessages(messages, 5).map((m) => m.content)).toEqual([
        'm15', 'm16', 'm17', 'm18', 'm19',
      ]);
    });
  });
});
