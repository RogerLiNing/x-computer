import type { SandboxFS } from '../tooling/SandboxFS.js';
import { activeLines, formatEntry, splitOverflow, supersedeMatching, today } from './memoryEntries.js';

/** The file operations memory needs; SandboxFS satisfies it, so a remote or MCP-backed store can replace it later. */
export type MemoryStore = Pick<SandboxFS, 'read' | 'write' | 'writeOverwrite' | 'exists' | 'list' | 'delete' | 'mkdir'>;

export const TOPICS_DIR = 'memory/topics';
export const ARCHIVE_FILE = 'memory/archive.md';
export const JOURNAL_FILE = 'memory/.journal.ndjson';
export const MEMORY_MAIN_FILE = 'memory/MEMORY.md';

export const TOPIC_LIMITS = Object.freeze({ maxTopics: 100, maxTopicChars: 64 * 1024, mainMaxLines: 200, mainMaxChars: 24 * 1024, indexMaxTopics: 40, indexMaxChars: 2000, journalMaxLines: 500 });

const TOPIC_NAME = /^[a-z0-9一-鿿][a-z0-9一-鿿_-]{0,62}$/i;

export interface TopicSummary { name: string; title: string; aliases: string[]; updatedAt?: string }
export interface JournalEntry { at: number; file: string; before: string; after: string; reason: string }

export function parseTopicHeader(content: string): { title?: string; aliases: string[]; body: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (!match) {
    const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
    return { ...(heading ? { title: heading } : {}), aliases: [], body: content };
  }
  const header = match[1];
  const title = /^title:\s*(.+)$/m.exec(header)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  const aliasesRaw = /^aliases:\s*\[(.*)\]$/m.exec(header)?.[1] ?? '';
  const aliases = aliasesRaw.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return { ...(title ? { title } : {}), aliases, body: content.slice(match[0].length) };
}

export function isValidTopicName(name: string): boolean {
  return TOPIC_NAME.test(name) && name !== 'MEMORY' && name !== 'archive';
}

/**
 * Topic notes live beside MEMORY.md: one subject per file, listed by name in the prompt and read on demand.
 * Every write through here is journaled so the last change can be undone, and MEMORY.md stays within its
 * budget by moving old entries to the archive rather than silently overflowing.
 */
export class TopicNotes {
  constructor(private readonly store: MemoryStore) {}

  private topicPath(name: string): string {
    if (!isValidTopicName(name)) throw new Error('主题名只能用字母、数字、中文、短横线和下划线，最长 63 个字符');
    return `${TOPICS_DIR}/${name}.md`;
  }

  async list(): Promise<TopicSummary[]> {
    if (!(await this.store.exists(TOPICS_DIR))) return [];
    const entries = await this.store.list(TOPICS_DIR);
    const topics: TopicSummary[] = [];
    for (const entry of entries) {
      if (entry.type !== 'file' || !entry.name.endsWith('.md')) continue;
      const name = entry.name.slice(0, -3);
      if (!isValidTopicName(name)) continue;
      const header = parseTopicHeader(await this.store.read(`${TOPICS_DIR}/${entry.name}`));
      topics.push({ name, title: header.title ?? name, aliases: header.aliases, updatedAt: entry.modified });
    }
    return topics.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(name: string): Promise<string | undefined> {
    const path = this.topicPath(name);
    return (await this.store.exists(path)) ? this.store.read(path) : undefined;
  }

  /** Replaces a topic's content (creating it when needed). */
  async write(name: string, content: string, reason = 'write'): Promise<void> {
    const path = this.topicPath(name);
    if (content.length > TOPIC_LIMITS.maxTopicChars) throw new Error('主题笔记超过 64KB');
    const before = (await this.store.exists(path)) ? await this.store.read(path) : '';
    if (!before && (await this.list()).length >= TOPIC_LIMITS.maxTopics) throw new Error(`主题笔记最多 ${TOPIC_LIMITS.maxTopics} 个`);
    await this.commit(path, before, content, reason);
  }

  /** Appends one dated entry to a topic, or to MEMORY.md when `name` is omitted; MEMORY.md overflow goes to the archive. */
  async appendEntry(target: string | undefined, text: string, options: { until?: string } = {}): Promise<string> {
    const line = formatEntry({ text: text.trim().replace(/\s+/g, ' '), ...(options.until ? { until: options.until } : {}) });
    const path = target ? this.topicPath(target) : MEMORY_MAIN_FILE;
    const before = (await this.store.exists(path)) ? await this.store.read(path) : '';
    if (before.includes(line.split(' · ').slice(1).join(' · '))) return line;
    let after = before ? `${before.replace(/\n*$/, '')}\n${line}` : line;
    if (!target) {
      const split = splitOverflow(after, { maxLines: TOPIC_LIMITS.mainMaxLines, maxChars: TOPIC_LIMITS.mainMaxChars });
      if (split.archived.length) {
        const archiveBefore = (await this.store.exists(ARCHIVE_FILE)) ? await this.store.read(ARCHIVE_FILE) : '';
        await this.commit(ARCHIVE_FILE, archiveBefore, `${archiveBefore.replace(/\n*$/, '')}\n${split.archived.join('\n')}`.trim(), 'archive');
        after = split.kept;
      }
    }
    await this.commit(path, before, after, 'append');
    return line;
  }

  /** Strikes through the first live entry containing `needle` in the topic (or MEMORY.md) and optionally appends the replacement. */
  async supersede(target: string | undefined, needle: string, replacement?: string): Promise<boolean> {
    const path = target ? this.topicPath(target) : MEMORY_MAIN_FILE;
    if (!(await this.store.exists(path))) return false;
    const before = await this.store.read(path);
    const result = supersedeMatching(before, needle);
    if (!result) return false;
    await this.commit(path, before, result.text, 'supersede');
    if (replacement) await this.appendEntry(target, replacement);
    return true;
  }

  /** Reverts the newest journaled write. Returns what was undone, or undefined when the journal is empty. */
  async undoLast(): Promise<JournalEntry | undefined> {
    const entries = await this.journal();
    const last = entries.at(-1);
    if (!last) return undefined;
    await this.store.writeOverwrite(last.file, last.before);
    await this.store.writeOverwrite(JOURNAL_FILE, entries.slice(0, -1).map((entry) => JSON.stringify(entry)).join('\n'));
    return last;
  }

  async journal(): Promise<JournalEntry[]> {
    if (!(await this.store.exists(JOURNAL_FILE))) return [];
    return (await this.store.read(JOURNAL_FILE)).split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as JournalEntry]; } catch { return []; } });
  }

  /** The compact index the system prompt carries: names, titles and aliases, never the bodies. */
  async promptIndex(): Promise<string> {
    const topics = await this.list();
    if (topics.length === 0) return '';
    const shown = topics.slice(0, TOPIC_LIMITS.indexMaxTopics);
    let text = shown.map((topic) => `- ${topic.name}${topic.title !== topic.name ? `（${topic.title}）` : ''}${topic.aliases.length ? `：${topic.aliases.join('、')}` : ''}`).join('\n');
    if (text.length > TOPIC_LIMITS.indexMaxChars) text = `${text.slice(0, TOPIC_LIMITS.indexMaxChars)}…`;
    const more = topics.length - shown.length;
    return `${text}${more > 0 ? `\n…另有 ${more} 个主题` : ''}`;
  }

  /** Live entries of MEMORY.md within the prompt budget. */
  async promptMain(): Promise<string> {
    if (!(await this.store.exists(MEMORY_MAIN_FILE))) return '';
    const lines = activeLines(await this.store.read(MEMORY_MAIN_FILE));
    return lines.slice(0, TOPIC_LIMITS.mainMaxLines).join('\n').slice(0, TOPIC_LIMITS.mainMaxChars);
  }

  /** Topics whose name, title, aliases or live body mention one of the words. */
  async recall(words: readonly string[], limit = 4): Promise<Array<{ name: string; excerpt: string }>> {
    const needles = words.map((word) => word.toLowerCase()).filter((word) => word.length >= 2);
    if (needles.length === 0) return [];
    const hits: Array<{ name: string; excerpt: string; score: number }> = [];
    for (const topic of await this.list()) {
      const content = await this.read(topic.name);
      if (!content) continue;
      const body = activeLines(parseTopicHeader(content).body, today()).join('\n');
      const haystack = `${topic.name} ${topic.title} ${topic.aliases.join(' ')} ${body}`.toLowerCase();
      const score = needles.filter((needle) => haystack.includes(needle)).length;
      if (score === 0) continue;
      const firstLine = body.split('\n').findIndex((line) => needles.some((needle) => line.toLowerCase().includes(needle)));
      hits.push({ name: topic.name, excerpt: body.split('\n').slice(Math.max(0, firstLine), Math.max(0, firstLine) + 8).join('\n').slice(0, 600), score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ name, excerpt }) => ({ name, excerpt }));
  }

  private async commit(file: string, before: string, after: string, reason: string): Promise<void> {
    if (before === after) return;
    const entries = await this.journal();
    const next = [...entries, { at: Date.now(), file, before, after, reason }].slice(-TOPIC_LIMITS.journalMaxLines);
    await this.store.writeOverwrite(JOURNAL_FILE, next.map((entry) => JSON.stringify(entry)).join('\n'));
    await this.store.writeOverwrite(file, after);
  }
}
