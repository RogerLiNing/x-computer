import { describe, it, expect } from 'vitest';
import { computeDiff } from './textDiff.js';

describe('textDiff', () => {
  it('detects added lines', () => {
    const result = computeDiff('line1\nline2', 'line1\nline2\nline3');
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(0);
  });

  it('detects removed lines', () => {
    const result = computeDiff('line1\nline2\nline3', 'line1\nline3');
    expect(result.stats.removed).toBe(1);
  });

  it('detects changed lines', () => {
    const result = computeDiff('line1\nold', 'line1\nnew');
    expect(result.stats.added).toBe(1);
    expect(result.stats.removed).toBe(1);
  });

  it('returns unchanged for identical texts', () => {
    const text = 'a\nb\nc';
    const result = computeDiff(text, text);
    expect(result.stats.unchanged).toBe(3);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
  });

  it('produces hunks with correct line info', () => {
    const result = computeDiff('a\nb\nc', 'a\nx\nc');
    expect(result.hunks.length).toBeGreaterThan(0);
    const hunk = result.hunks[0];
    expect(hunk.lines.some((l) => l.type === 'remove' && l.content === 'b')).toBe(true);
    expect(hunk.lines.some((l) => l.type === 'add' && l.content === 'x')).toBe(true);
  });
});
