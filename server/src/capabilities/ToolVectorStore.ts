/**
 * 工具描述专用向量库：与记忆向量库分离，仅存储工具 name + description 的向量。
 * 用于 capability.search 的向量检索；工具增删改时同步更新本集合。
 */

import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { serverLogger } from '../observability/ServerLogger.js';

export interface ToolVectorEntry {
  id: string;
  name: string;
  description: string;
  vector: number[];
}

interface PersistedIndex {
  contentHash: string;
  entries: ToolVectorEntry[];
}

const DEFAULT_INDEX_DIR = 'data';
const INDEX_FILENAME = 'tool_vector_index.json';

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

/** 根据能力列表生成内容哈希，用于判断是否需要重建索引 */
export function contentHash(capabilities: Array<{ name: string; description: string }>): string {
  const normalized = capabilities
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `${c.name}\n${c.description}`)
    .join('\n---\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export class ToolVectorStore {
  private indexPath: string;
  private cached: PersistedIndex | null = null;

  constructor(indexDir?: string) {
    const dir = indexDir ?? path.join(process.cwd(), DEFAULT_INDEX_DIR);
    this.indexPath = path.join(dir, INDEX_FILENAME);
  }

  private async ensureDir(): Promise<void> {
    const dir = path.dirname(this.indexPath);
    await mkdir(dir, { recursive: true });
  }

  private async load(): Promise<PersistedIndex> {
    if (this.cached) return this.cached;
    try {
      const raw = await readFile(this.indexPath, 'utf-8');
      const data = JSON.parse(raw) as PersistedIndex;
      if (data && typeof data.contentHash === 'string' && Array.isArray(data.entries)) {
        this.cached = { contentHash: data.contentHash, entries: data.entries };
        return this.cached;
      }
    } catch {
      // 文件不存在或格式错误
    }
    this.cached = { contentHash: '', entries: [] };
    return this.cached;
  }

  private async save(data: PersistedIndex): Promise<void> {
    await this.ensureDir();
    await writeFile(this.indexPath, JSON.stringify(data), 'utf-8');
    this.cached = data;
  }

  /** 返回当前存储的 contentHash（用于与当前能力列表对比） */
  async getStoredContentHash(): Promise<string> {
    const loaded = await this.load();
    return loaded.contentHash;
  }

  /**
   * 全量同步：用当前能力列表重建向量索引。
   * 若 contentHash 与当前一致则跳过；否则用 embedFn 为每条生成向量并写入。
   */
  async syncFull(
    capabilities: Array<{ name: string; description: string }>,
    embedFn: (texts: string[]) => Promise<number[][]>,
  ): Promise<void> {
    const newHash = contentHash(capabilities);
    const loaded = await this.load();
    if (loaded.contentHash === newHash && loaded.entries.length > 0) {
      serverLogger.info('tool-vector', '工具向量索引与当前能力一致，跳过同步');
      return;
    }
    if (capabilities.length === 0) {
      await this.save({ contentHash: newHash, entries: [] });
      serverLogger.info('tool-vector', '已清空工具向量索引');
      return;
    }
    const texts = capabilities.map((c) => `${c.name}\n${c.description}`.trim().slice(0, 6000));
    const vectors = await embedFn(texts);
    if (vectors.length !== capabilities.length) {
      throw new Error(`工具向量同步失败：期望 ${capabilities.length} 条向量，得到 ${vectors.length}`);
    }
    const entries: ToolVectorEntry[] = capabilities.map((c, i) => ({
      id: c.name,
      name: c.name,
      description: c.description,
      vector: vectors[i] ?? [],
    }));
    await this.save({ contentHash: newHash, entries });
    serverLogger.info('tool-vector', `已同步 ${entries.length} 个工具描述到向量库`);
  }

  /** 向量检索，返回 topK 个最相关工具 */
  async search(queryVector: number[], topK: number = 40): Promise<Array<{ name: string; description: string }>> {
    const loaded = await this.load();
    if (loaded.entries.length === 0) return [];
    const withScore = loaded.entries.map((e) => ({
      name: e.name,
      description: e.description,
      score: cosineSimilarity(e.vector, queryVector),
    }));
    withScore.sort((a, b) => b.score - a.score);
    return withScore.slice(0, topK).map(({ name, description }) => ({ name, description }));
  }
}

let defaultStore: ToolVectorStore | null = null;

/** 获取默认单例（使用 process.cwd()/data/tool_vector_index.json） */
export function getToolVectorStore(indexDir?: string): ToolVectorStore {
  if (indexDir) return new ToolVectorStore(indexDir);
  if (!defaultStore) defaultStore = new ToolVectorStore();
  return defaultStore;
}
