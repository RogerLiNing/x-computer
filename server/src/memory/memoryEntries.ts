/**
 * Dated memory entries, one per line:
 *   - 2026-11-09 · 预产期是 2027-03-20
 *   - 2026-11-09 · 孕 24 周 · until 2026-11-16
 *   - 2026-10-01 · ~~医院是 A 院~~ · superseded 2026-11-09
 * Lines without a date (written by hand) are kept as they are and never expire or move.
 */
export interface MemoryEntry {
  raw: string;
  date?: string;
  text: string;
  until?: string;
  superseded?: string;
  /** Health and safety facts stay loaded however old they are. */
  protected: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY = /^-\s+(\d{4}-\d{2}-\d{2})\s+·\s+(.*)$/;
const PROTECTED = /过敏|忌口|用药|服药|药物|哮喘|糖尿病|高血压|心脏|孕|怀孕|预产期|血型|医嘱|禁忌|allerg|medication|pregnan/i;

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function parseEntry(line: string): MemoryEntry {
  const match = ENTRY.exec(line.trim());
  if (!match) return { raw: line, text: line.replace(/^-\s*/, '').trim(), protected: PROTECTED.test(line) };
  const [, date, rest] = match;
  const parts = rest.split(/\s+·\s+/);
  let text = parts[0] ?? '';
  let until: string | undefined;
  let superseded: string | undefined;
  for (const part of parts.slice(1)) {
    const untilMatch = /^until\s+(\d{4}-\d{2}-\d{2})$/.exec(part);
    const supersededMatch = /^superseded\s+(\d{4}-\d{2}-\d{2})$/.exec(part);
    if (untilMatch) until = untilMatch[1];
    else if (supersededMatch) superseded = supersededMatch[1];
    else text += ` · ${part}`;
  }
  if (/^~~.*~~$/.test(text)) { text = text.slice(2, -2); superseded ??= date; }
  return { raw: line, date, text: text.trim(), ...(until ? { until } : {}), ...(superseded ? { superseded } : {}), protected: PROTECTED.test(text) };
}

export function formatEntry(entry: { text: string; date?: string; until?: string; superseded?: string }): string {
  const date = entry.date ?? today();
  const body = entry.superseded ? `~~${entry.text}~~` : entry.text;
  return `- ${date} · ${body}${entry.until ? ` · until ${entry.until}` : ''}${entry.superseded ? ` · superseded ${entry.superseded}` : ''}`;
}

export function isExpired(entry: MemoryEntry, asOf = today()): boolean {
  return !!entry.until && DATE.test(entry.until) && entry.until < asOf;
}

export function isLive(entry: MemoryEntry, asOf = today()): boolean {
  return !entry.superseded && !isExpired(entry, asOf);
}

/** Entries the model should see right now: live ones, in file order. Blank and heading lines are dropped. */
export function activeLines(text: string, asOf = today()): string[] {
  return text.split('\n').filter((line) => line.trim() && !line.startsWith('#')).map(parseEntry).filter((entry) => isLive(entry, asOf)).map((entry) => entry.raw.trim());
}

/** Marks the first live entry containing `needle` as superseded; returns the updated text or undefined when nothing matched. */
export function supersedeMatching(text: string, needle: string, asOf = today()): { text: string; entry: MemoryEntry } | undefined {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => { const entry = parseEntry(line); return !!entry.date && isLive(entry, asOf) && entry.text.includes(needle); });
  if (index < 0) return undefined;
  const entry = parseEntry(lines[index]!);
  const updated = formatEntry({ ...entry, superseded: asOf });
  return { text: [...lines.slice(0, index), updated, ...lines.slice(index + 1)].join('\n'), entry };
}

export interface OverflowSplit { kept: string; archived: string[] }

/**
 * Keeps the file inside `maxLines`/`maxChars` by moving dated entries to the archive: superseded first,
 * then expired, then the oldest live ones. Undated lines and protected facts never move.
 */
export function splitOverflow(text: string, limits: { maxLines: number; maxChars: number }, asOf = today()): OverflowSplit {
  const lines = text.split('\n');
  const within = () => lines.length <= limits.maxLines && lines.join('\n').length <= limits.maxChars;
  if (within()) return { kept: text, archived: [] };
  const archived: string[] = [];
  const candidates = () => lines.map((line, index) => ({ line, index, entry: parseEntry(line) })).filter(({ entry }) => entry.date && !entry.protected);
  const rank = (entry: MemoryEntry) => (entry.superseded ? 0 : isExpired(entry, asOf) ? 1 : 2);
  while (!within()) {
    const pool = candidates().sort((a, b) => rank(a.entry) - rank(b.entry) || (a.entry.date! < b.entry.date! ? -1 : a.entry.date! > b.entry.date! ? 1 : a.index - b.index));
    const victim = pool[0];
    if (!victim) break;
    archived.push(`${victim.line.trim()} · moved ${asOf}`);
    lines.splice(victim.index, 1);
  }
  return { kept: lines.join('\n'), archived };
}
