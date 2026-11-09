import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionCard, extractActionCard } from './ActionCard';

describe('ActionCard', () => {
  it('extracts a card from a tool result and renders its actions and table', () => {
    const card = extractActionCard({ ok: true, __card: { kind: 'confirm', title: '发送？', actions: [{ label: '发送', message: '确认发送', primary: true }] } });
    expect(card?.kind).toBe('confirm');
    const html = renderToStaticMarkup(<ActionCard card={card!} onAction={() => {}} />);
    expect(html).toContain('发送？');
    expect(html).toContain('>发送</button>');
    const table = renderToStaticMarkup(<ActionCard card={{ kind: 'table', title: 't', columns: ['a'], rows: [['1']] }} />);
    expect(table).toContain('<table');
    expect(extractActionCard({ ok: true })).toBeUndefined();
    expect(extractActionCard('text')).toBeUndefined();
  });
});
