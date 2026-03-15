/**
 * 记忆向量库：按 snippet 存储 (filePath, date, text, vector)，支持向量检索、简单 FTS、多 workspace。
 * 持久化到沙箱 memory/.vector_index.json（或 memory/.vector_index_<workspaceId>.json）。
 */

import type { SandboxFS } from '../tooling/SandboxFS.js';

export interface VectorEntry {
  id: string;
  filePath: string;
  date: string;
  text: string;
  vector: number[];
}

export interface ScoredEntry {
  entry: VectorEntry;
  score: number;
}

interface IndexFile {
  entries: VectorEntry[];
}

const DEFAULT_WORKSPACE = 'default';

function getIndexPath(workspaceId?: string): string {
  const w = workspaceId && workspaceId !== DEFAULT_WORKSPACE ? workspaceId : '';
  return w ? `memory/.vector_index_${w}.json` : 'memory/.vector_index.json';
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** 简单分词：中文字符单字、英文按空格/标点分 */
function tokenize(text: string): string[] {
  const t = (text ?? '').toLowerCase().replace(/\s+/g, ' ');
  const tokens: string[] = [];
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (/[\u4e00-\u9fff]/.test(c)) {
      tokens.push(c);
      i++;
    } else if (/[a-z0-9]/.test(c)) {
      let end = i;
      while (end < t.length && /[a-z0-9]/.test(t[end])) end++;
      tokens.push(t.slice(i, end));
      i = end;
    } else {
      i++;
    }
  }
  return tokens.filter((s) => s.length > 0);
}

/** 简单 BM25 风格分数：词频 / (1 + 词频) 的和对数 */
function textScore(queryTokens: string[], docText: string): number {
  if (queryTokens.length === 0) return 0;
  const docTokens = tokenize(docText);
  const docSet = new Set(docTokens);
  let score = 0;
  for (const q of queryTokens) {
    if (!docSet.has(q)) continue;
    const tf = docTokens.filter((t) => t === q).length;
    score += Math.log(1 + tf);
  }
  return score;
}

export class VectorStore {
  private entriesByWorkspace = new Map<string, VectorEntry[]>();
  private loadedWorkspaces = new Set<string>();

  constructor(private fs: SandboxFS) {}

  private getWorkspaceKey(workspaceId?: string): string {
    return workspaceId && workspaceId !== DEFAULT_WORKSPACE ? workspaceId : DEFAULT_WORKSPACE;
  }

  private async load(workspaceId?: string): Promise<VectorEntry[]> {
    const key = this.getWorkspaceKey(workspaceId);
    if (this.loadedWorkspaces.has(key)) {
      return this.entriesByWorkspace.get(key) ?? [];
    }
    const path = getIndexPath(workspaceId);
    try {
      const raw = await this.fs.read(path);
      const data = JSON.parse(raw) as IndexFile;
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      this.entriesByWorkspace.set(key, entries);
      this.loadedWorkspaces.add(key);
      return entries;
    } catch {
      this.entriesByWorkspace.set(key, []);
      this.loadedWorkspaces.add(key);
      return [];
    }
  }

  private async save(workspaceId?: string): Promise<void> {
    const key = this.getWorkspaceKey(workspaceId);
    const entries = this.entriesByWorkspace.get(key) ?? [];
    const path = getIndexPath(workspaceId);
    await this.fs.writeOverwrite(path, JSON.stringify({ entries }));
  }

  /** 添加一条记忆片段（写入文件后调用，用于向量索引） */
  async add(entry: Omit<VectorEntry, 'id'>, workspaceId?: string): Promise<void> {
    const entries = await this.load(workspaceId);
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    entries.push({ ...entry, id });
    this.entriesByWorkspace.set(this.getWorkspaceKey(workspaceId), entries);
    await this.save(workspaceId);
  }

  /**
   * 按 query 向量检索 topK 条最相关片段。
   */
  async search(queryVector: number[], topK: number = 5, workspaceId?: string): Promise<VectorEntry[]> {
    const scored = await this.searchWithScores(queryVector, topK, workspaceId);
    return scored.map((x) => x.entry);
  }

  /**
   * 向量检索并返回得分（用于混合检索合并）
   */
  async searchWithScores(
    queryVector: number[],
    topK: number = 5,
    workspaceId?: string,
  ): Promise<ScoredEntry[]> {
    const entries = await this.load(workspaceId);
    if (entries.length === 0) return [];
    const withScore = entries.map((e) => ({
      entry: e,
      score: cosineSimilarity(e.vector, queryVector),
    }));
    withScore.sort((a, b) => b.score - a.score);
    return withScore.slice(0, topK);
  }

  /**
   * 简单 FTS：关键词匹配，按词频得分排序（对齐 OpenClaw hybrid）
   */
  async searchKeyword(query: string, limit: number = 10, workspaceId?: string): Promise<ScoredEntry[]> {
    const entries = await this.load(workspaceId);
    if (entries.length === 0) return [];
    const tokens = tokenize(query).filter((s) => s.length > 1).slice(0, 20);
    if (tokens.length === 0) return [];
    const withScore = entries
      .map((e) => ({ entry: e, score: textScore(tokens, e.text) }))
      .filter((x) => x.score > 0);
    withScore.sort((a, b) => b.score - a.score);
    return withScore.slice(0, limit);
  }

  /** 返回当前条目数 */
  async count(workspaceId?: string): Promise<number> {
    const entries = await this.load(workspaceId);
    return entries.length;
  }

  /** 清空索引（重建前调用） */
  async clear(workspaceId?: string): Promise<void> {
    await this.load(workspaceId);
    this.entriesByWorkspace.set(this.getWorkspaceKey(workspaceId), []);
    await this.save(workspaceId);
  }

  /** 按 filePath 删除相关条目（支持前缀匹配，如 memory/2026-02-11.md） */
  async deleteByFilePath(filePath: string, workspaceId?: string): Promise<number> {
    const entries = await this.load(workspaceId);
    const key = this.getWorkspaceKey(workspaceId);
    const normalized = (filePath ?? '').trim().replace(/\\/g, '/');
    if (!normalized) return 0;
    const before = entries.length;
    const kept = entries.filter((e) => e.filePath !== normalized && !e.filePath.startsWith(normalized + '/'));
    const removed = before - kept.length;
    if (removed > 0) {
      this.entriesByWorkspace.set(key, kept);
      await this.save(workspaceId);
    }
    return removed;
  }
}
