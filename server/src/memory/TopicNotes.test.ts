import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { ARCHIVE_FILE, MEMORY_MAIN_FILE, TopicNotes, parseTopicHeader } from './TopicNotes.js';

describe('TopicNotes', () => {
  let fs: SandboxFS; let notes: TopicNotes;
  beforeEach(async () => { fs = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'topics-'))); await fs.init(); notes = new TopicNotes(fs); });

  it('parses front matter titles and aliases', () => {
    expect(parseTopicHeader('---\ntitle: 产检\naliases: [孕检, 医院]\n---\n- 2026-11-01 · x')).toMatchObject({ title: '产检', aliases: ['孕检', '医院'], body: '- 2026-11-01 · x' });
    expect(parseTopicHeader('# 旅行\n正文')).toMatchObject({ title: '旅行', aliases: [] });
  });

  it('writes and lists topics, builds the prompt index and recalls by words', async () => {
    await notes.write('产检', '---\ntitle: 产检安排\naliases: [孕检]\n---\n- 2026-11-01 · 下次产检 11 月 20 日 妇幼医院\n- 2026-10-01 · ~~上次在 A 院~~ · superseded 2026-11-01');
    await notes.write('travel', '- 2026-09-01 · 偏好靠过道的座位');
    expect((await notes.list()).map((topic) => [topic.name, topic.title])).toEqual([['travel', 'travel'], ['产检', '产检安排']]);
    expect(await notes.promptIndex()).toContain('产检（产检安排）：孕检');
    const hits = await notes.recall(['孕检']);
    expect(hits[0]).toMatchObject({ name: '产检' });
    expect(hits[0].excerpt).toContain('妇幼医院');
    expect(hits[0].excerpt).not.toContain('A 院');
    expect(await notes.recall(['座位'])).toHaveLength(1);
    await expect(notes.write('../x', 'y')).rejects.toThrow();
  });

  it('appends dated entries, supersedes, archives MEMORY.md overflow and undoes the last write', async () => {
    const line = await notes.appendEntry(undefined, '预产期是 2027-03-20');
    expect(line).toMatch(/^- \d{4}-\d{2}-\d{2} · 预产期是 2027-03-20$/);
    expect(await notes.appendEntry(undefined, '预产期是 2027-03-20')).toBe(line);
    expect((await fs.read(MEMORY_MAIN_FILE)).split('\n')).toHaveLength(1);
    await notes.appendEntry(undefined, '医院是 A 院');
    expect(await notes.supersede(undefined, 'A 院', '医院是 B 院')).toBe(true);
    const main = await fs.read(MEMORY_MAIN_FILE);
    expect(main).toContain('~~医院是 A 院~~');
    expect(main).toContain('医院是 B 院');
    expect(await notes.promptMain()).not.toContain('A 院');
    const undone = await notes.undoLast();
    expect(undone?.reason).toBe('append');
    expect(await fs.read(MEMORY_MAIN_FILE)).not.toContain('B 院');
    expect(await notes.supersede(undefined, '不存在')).toBe(false);
  });

  it('moves old entries to the archive when MEMORY.md exceeds its budget', async () => {
    const lines = Array.from({ length: 205 }, (_, i) => `- 2026-01-${String((i % 28) + 1).padStart(2, '0')} · 事实 ${i}`);
    await fs.writeOverwrite(MEMORY_MAIN_FILE, lines.join('\n'));
    await notes.appendEntry(undefined, '最新的事实');
    const main = await fs.read(MEMORY_MAIN_FILE);
    expect(main.split('\n').length).toBeLessThanOrEqual(200);
    expect(main).toContain('最新的事实');
    expect(await fs.read(ARCHIVE_FILE)).toContain('· moved ');
  });
});
