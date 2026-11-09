import { describe, expect, it } from 'vitest';
import { activeLines, formatEntry, isExpired, parseEntry, splitOverflow, supersedeMatching } from './memoryEntries.js';

const asOf = '2026-11-09';

describe('memory entries', () => {
  it('parses dates, until and superseded markers and recognises protected facts', () => {
    expect(parseEntry('- 2026-11-01 · 预产期是 2027-03-20')).toMatchObject({ date: '2026-11-01', text: '预产期是 2027-03-20', protected: true });
    expect(parseEntry('- 2026-11-01 · 孕 24 周 · until 2026-11-08')).toMatchObject({ until: '2026-11-08' });
    expect(parseEntry('- 2026-10-01 · ~~医院是 A 院~~ · superseded 2026-11-09')).toMatchObject({ text: '医院是 A 院', superseded: '2026-11-09' });
    expect(parseEntry('手写的一行').date).toBeUndefined(); expect(parseEntry('手写的一行').text).toBe('手写的一行');
    expect(formatEntry({ date: '2026-11-09', text: 'x', until: '2026-12-01' })).toBe('- 2026-11-09 · x · until 2026-12-01');
  });

  it('keeps only live entries for the prompt', () => {
    const text = ['# 长期记忆', '- 2026-11-01 · 预产期是 2027-03-20', '- 2026-11-01 · 孕 24 周 · until 2026-11-08', '- 2026-10-01 · ~~医院是 A 院~~ · superseded 2026-11-09', '- 2026-11-08 · 医院是 B 院', '手写的一行'].join('\n');
    expect(activeLines(text, asOf)).toEqual(['- 2026-11-01 · 预产期是 2027-03-20', '- 2026-11-08 · 医院是 B 院', '手写的一行']);
    expect(isExpired(parseEntry('- 2026-11-01 · x · until 2026-11-09'), asOf)).toBe(false);
  });

  it('supersedes a matching live entry in place', () => {
    const text = '- 2026-10-01 · 医院是 A 院\n- 2026-11-08 · 医院是 B 院';
    const result = supersedeMatching(text, 'A 院', asOf);
    expect(result?.text.split('\n')[0]).toBe('- 2026-10-01 · ~~医院是 A 院~~ · superseded 2026-11-09');
    expect(supersedeMatching(text, '不存在', asOf)).toBeUndefined();
  });

  it('archives superseded, then expired, then oldest entries, never protected or undated lines', () => {
    const text = ['手写不动', '- 2026-01-01 · 老事实', '- 2026-02-01 · ~~旧~~ · superseded 2026-03-01', '- 2026-03-01 · 过期 · until 2026-04-01', '- 2026-05-01 · 对花生过敏', '- 2026-06-01 · 新事实'].join('\n');
    const split = splitOverflow(text, { maxLines: 3, maxChars: 10_000 }, asOf);
    expect(split.archived.map((line) => line.split(' · moved')[0])).toEqual(['- 2026-02-01 · ~~旧~~ · superseded 2026-03-01', '- 2026-03-01 · 过期 · until 2026-04-01', '- 2026-01-01 · 老事实']);
    expect(split.kept.split('\n')).toEqual(['手写不动', '- 2026-05-01 · 对花生过敏', '- 2026-06-01 · 新事实']);
    expect(splitOverflow('- 2026-05-01 · 对花生过敏\n手写', { maxLines: 1, maxChars: 10 }, asOf).archived).toEqual([]);
  });
});
