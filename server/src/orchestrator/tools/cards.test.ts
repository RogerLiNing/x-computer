import { describe, expect, it } from 'vitest';
import { createPresentCardHandler, validateActionCard } from './cards.js';

describe('action cards', () => {
  it('validates each kind and trims to limits', () => {
    expect(validateActionCard({ kind: 'confirm', title: '发送邮件？', actions: [{ label: '发送', message: '确认发送', primary: true }, { label: '取消', message: '先不发' }] }))
      .toEqual({ kind: 'confirm', title: '发送邮件？', actions: [{ label: '发送', message: '确认发送', primary: true }, { label: '取消', message: '先不发' }] });
    expect(validateActionCard({ kind: 'table', title: '产检安排', columns: ['日期', '项目'], rows: [['11-20', 'B 超'], ['12-05', '糖耐', '多余列被截掉'.repeat(1)]] }).rows?.[1]).toHaveLength(2);
    expect(validateActionCard({ kind: 'links', title: '参考', links: [{ label: 'ok', url: 'https://a.example' }, { label: 'bad', url: 'javascript:alert(1)' }] }).links).toHaveLength(1);
    expect(() => validateActionCard({ kind: 'choices', title: 'x', actions: [] })).toThrow();
    expect(() => validateActionCard({ kind: 'table', title: 'x', columns: [] })).toThrow();
    expect(() => validateActionCard({ kind: 'popup', title: 'x' })).toThrow();
  });

  it('returns the card under __card so the desktop can render it', async () => {
    const result = await createPresentCardHandler()({ kind: 'choices', title: '选一个', actions: [{ label: 'A', message: '选 A' }] }) as { __card: { kind: string } };
    expect(result.__card.kind).toBe('choices');
  });
});
