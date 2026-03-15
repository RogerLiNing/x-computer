/**
 * 主脑记忆：Daily Notes (memory/YYYY-MM-DD.md) + 长期 MEMORY.md
 * 支持：关键词召回（无向量时）、向量索引与检索（OpenClaw 式：先搜向量定位 snippet，再读文件/用 snippet 文本）
 */

import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { VectorStore, VectorEntry } from './vectorStore.js';

const MEMORY_DIR = 'memory';
const MEMORY_FILE = 'memory/MEMORY.md';
/** 从对话中学习到的规则与偏好，会注入到主脑系统提示中，随对话不断丰富 */
export const LEARNED_PROMPT_FILE = 'memory/LEARNED_PROMPT.md';
/** AI 自我进化的核心提示词片段：主脑可根据对话或反思追加/更新，系统组装时会注入到主提示之后 */
export const EVOLVED_CORE_PROMPT_FILE = 'memory/EVOLVED_CORE_PROMPT.md';
/** 主脑可完全替换的「基础系统提示词」（身份、使命、人设等）；若存在则替代代码中的默认 CORE_SYSTEM_PROMPT */
export const BASE_PROMPT_FILE = 'memory/BASE_PROMPT.md';
/** AI 助手专用说明：由 X 主脑根据用户与助手的对话优化，注入到 AI 助手系统提示中 */
export const ASSISTANT_PROMPT_FILE = 'memory/ASSISTANT_PROMPT.md';

function dailyPath(date: string): string {
  return `${MEMORY_DIR}/${date}.md`;
}

type RetrievalMode = 'keyword' | 'hybrid' | 'keyword_fallback';

interface MemoryRuntimeStatusMeta {
  retrievalMode?: RetrievalMode;
  provider?: {
    configured: boolean;
    available: boolean;
    providerId?: string;
    modelId?: string;
  };
  lastEmbedError?: string;
  fallback?: {
    active: boolean;
    reason?: string;
  };
  updatedAt: number;
}

function statusPath(workspaceId?: string): string {
  if (!workspaceId || workspaceId === 'default') return 'memory/.memory_status.json';
  return `memory/.memory_status_${workspaceId}.json`;
}

export class MemoryService {
  constructor(
    private fs: SandboxFS,
    private vectorStore?: VectorStore,
  ) {}

  private async readStatusMeta(workspaceId?: string): Promise<MemoryRuntimeStatusMeta> {
    try {
      const raw = await this.fs.read(statusPath(workspaceId));
      const parsed = JSON.parse(raw) as Partial<MemoryRuntimeStatusMeta>;
      return {
        retrievalMode: parsed.retrievalMode,
        provider: parsed.provider,
        lastEmbedError: parsed.lastEmbedError,
        fallback: parsed.fallback,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      };
    } catch {
      return { updatedAt: Date.now() };
    }
  }

  async updateStatusMeta(
    patch: Partial<Omit<MemoryRuntimeStatusMeta, 'updatedAt'>>,
    workspaceId?: string,
  ): Promise<void> {
    const current = await this.readStatusMeta(workspaceId);
    const next: MemoryRuntimeStatusMeta = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    await this.fs.writeOverwrite(statusPath(workspaceId), JSON.stringify(next));
  }

  /** 追加到当日 Daily */
  async appendDaily(content: string): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const path = dailyPath(date);
    let existing = '';
    try {
      existing = await this.fs.read(path);
    } catch {
      /* 文件不存在 */
    }
    const sep = existing.endsWith('\n') ? '' : '\n';
    await this.fs.write(path, existing + sep + `\n---\n${new Date().toISOString()}\n${content}`);
  }

  /** 读取某日 Daily */
  async readDaily(date: string): Promise<string> {
    try {
      return await this.fs.read(dailyPath(date));
    } catch {
      return '';
    }
  }

  /** 读取长期记忆 MEMORY.md */
  async readMemory(): Promise<string> {
    try {
      return await this.fs.read(MEMORY_FILE);
    } catch {
      return '';
    }
  }

  /** 追加到长期记忆（新起一行） */
  async appendMemory(content: string): Promise<void> {
    let existing = '';
    try {
      existing = await this.fs.read(MEMORY_FILE);
    } catch {
      /* 文件不存在 */
    }
    const sep = existing.endsWith('\n') ? '' : '\n';
    await this.fs.write(MEMORY_FILE, existing + sep + content);
  }

  /** 读取「从对话中学习到的规则与偏好」（注入主脑提示，随对话丰富） */
  async readLearnedPrompt(): Promise<string> {
    try {
      return await this.fs.read(LEARNED_PROMPT_FILE);
    } catch {
      return '';
    }
  }

  /** 追加一条学习到的规则/偏好到 LEARNED_PROMPT，不重复则追加 */
  async appendLearnedPrompt(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) return;
    let existing = '';
    try {
      existing = await this.fs.read(LEARNED_PROMPT_FILE);
    } catch {
      /* 文件不存在 */
    }
    if (existing.includes(trimmed)) return;
    const sep = existing.endsWith('\n') ? '' : '\n';
    await this.fs.write(LEARNED_PROMPT_FILE, existing + sep + `- ${trimmed}`);
  }

  /** 读取「AI 自我进化的核心提示词」：主脑自己追加的规则/策略，组装时注入主提示之后 */
  async readEvolvedCorePrompt(): Promise<string> {
    try {
      return await this.fs.read(EVOLVED_CORE_PROMPT_FILE);
    } catch {
      return '';
    }
  }

  /** 追加一段自我进化的提示内容到 EVOLVED_CORE_PROMPT（主脑通过工具调用触发） */
  async appendEvolvedCorePrompt(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) return;
    let existing = '';
    try {
      existing = await this.fs.read(EVOLVED_CORE_PROMPT_FILE);
    } catch {
      /* 文件不存在 */
    }
    const sep = existing.endsWith('\n') ? '' : '\n';
    const block = sep + '\n---\n' + new Date().toISOString() + '\n' + trimmed;
    await this.fs.writeOverwrite(EVOLVED_CORE_PROMPT_FILE, existing + block);
  }

  /** 覆写整个 EVOLVED_CORE_PROMPT（慎用，一般用 append；可用于主脑「重置」自我约定） */
  async writeEvolvedCorePrompt(content: string): Promise<void> {
    await this.fs.writeOverwrite(EVOLVED_CORE_PROMPT_FILE, content.trim());
  }

  /** 读取「可完全替换的基础系统提示词」：主脑身份/使命/人设；无则返回空，组装时用代码默认 */
  async readBasePrompt(): Promise<string> {
    try {
      return await this.fs.read(BASE_PROMPT_FILE);
    } catch {
      return '';
    }
  }

  /** 覆写整个基础系统提示词：主脑可换人设、改身份与使命，不限制想象 */
  async writeBasePrompt(content: string): Promise<void> {
    await this.fs.writeOverwrite(BASE_PROMPT_FILE, content.trim());
  }

  /** 若 BASE_PROMPT 不存在或为空，则写入默认内容（由调用方传入，通常为 CORE_SYSTEM_PROMPT） */
  async ensureBasePromptExists(defaultContent: string): Promise<void> {
    let existing = '';
    try {
      existing = await this.fs.read(BASE_PROMPT_FILE);
    } catch {
      /* 文件不存在 */
    }
    if (!existing.trim()) {
      await this.fs.writeOverwrite(BASE_PROMPT_FILE, defaultContent.trim());
    }
  }

  /** AI 助手专用说明的默认初始内容（X 可后续通过 update_assistant_prompt 修改） */
  static readonly DEFAULT_ASSISTANT_PROMPT = `# AI 助手专用说明

此处由 X 主脑根据「用户与 AI 助手的对话」优化。初始为默认说明，X 可通过工具 **update_assistant_prompt** 更新，使助手在特定场景（如写作、编程）表现更好。
`;

  /** 若 ASSISTANT_PROMPT 不存在或为空，则写入默认内容 */
  async ensureAssistantPromptExists(): Promise<void> {
    let existing = '';
    try {
      existing = await this.fs.read(ASSISTANT_PROMPT_FILE);
    } catch {
      /* 文件不存在 */
    }
    if (!existing.trim()) {
      await this.fs.writeOverwrite(ASSISTANT_PROMPT_FILE, MemoryService.DEFAULT_ASSISTANT_PROMPT);
    }
  }

  /** 读取「AI 助手专用说明」（由 X 主脑优化，注入到 AI 助手系统提示） */
  async readAssistantPrompt(): Promise<string> {
    try {
      return await this.fs.read(ASSISTANT_PROMPT_FILE);
    } catch {
      return '';
    }
  }

  /** 覆写 AI 助手专用说明：X 主脑根据用户与助手对话质量更新，使助手更好服务用户 */
  async writeAssistantPrompt(content: string): Promise<void> {
    await this.fs.writeOverwrite(ASSISTANT_PROMPT_FILE, content.trim());
  }

  /** 若 EVOLVED_CORE_PROMPT 不存在，则创建空文件（主脑后续通过 evolve_system_prompt 追加） */
  async ensureEvolvedCorePromptExists(): Promise<void> {
    try {
      await this.fs.read(EVOLVED_CORE_PROMPT_FILE);
    } catch {
      await this.fs.writeOverwrite(EVOLVED_CORE_PROMPT_FILE, '');
    }
  }

  /**
   * 关键词召回（无向量时）：从 MEMORY.md 与最近 days 天的 Daily 中做简单关键词匹配
   */
  async recallKeyword(query: string, options: { days?: number } = {}): Promise<string> {
    const days = options.days ?? 2;
    const keywords = query
      .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .slice(0, 10);
    const parts: string[] = [];

    const mem = await this.readMemory();
    if (mem && (keywords.length === 0 || keywords.some((k) => mem.includes(k)))) {
      parts.push('[长期记忆]\n' + mem.slice(0, 2000));
    }

    const today = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const daily = await this.readDaily(dateStr);
      if (daily && (keywords.length === 0 || keywords.some((k) => daily.includes(k)))) {
        parts.push(`[${dateStr}]\n` + daily.slice(0, 1500));
      }
    }

    return parts.join('\n\n').trim() || '';
  }

  /**
   * 向量召回：用 queryVector 在向量库中检索 topK 条 snippet
   */
  async recallByVector(
    queryVector: number[],
    topK: number = 5,
    workspaceId?: string,
  ): Promise<VectorEntry[]> {
    if (!this.vectorStore) return [];
    return this.vectorStore.search(queryVector, topK, workspaceId);
  }

  /**
   * 按 filePath 从向量库删除相关条目（供 memory_delete 工具使用）
   */
  async deleteFromIndex(filePath: string, workspaceId?: string): Promise<number> {
    if (!this.vectorStore) return 0;
    return this.vectorStore.deleteByFilePath(filePath, workspaceId);
  }

  /**
   * 写入记忆后索引到向量库（需在调用方完成 embed 后传入 vector）
   */
  async addToIndex(
    entry: { filePath: string; date: string; text: string; vector: number[] },
    workspaceId?: string,
  ): Promise<void> {
    if (!this.vectorStore) return;
    await this.vectorStore.add(entry, workspaceId);
  }

  /**
   * 混合召回（FTS + 向量）：向量得分与关键词得分加权合并后取 topK（对齐 OpenClaw hybrid）
   */
  async recallHybrid(
    query: string,
    queryVector: number[],
    options: {
      topK?: number;
      vectorWeight?: number;
      textWeight?: number;
      candidateMultiplier?: number;
      workspaceId?: string;
    } = {},
  ): Promise<string> {
    if (!this.vectorStore) return '';
    const {
      topK = 5,
      vectorWeight = 0.7,
      textWeight = 0.3,
      candidateMultiplier = 4,
      workspaceId,
    } = options;
    const candidates = Math.min(100, Math.max(topK, topK * candidateMultiplier));
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorStore.searchWithScores(queryVector, candidates, workspaceId),
      this.vectorStore.searchKeyword(query, candidates, workspaceId),
    ]);
    const byId = new Map<string, { entry: VectorEntry; score: number }>();
    const norm = (s: number, max: number) => (max > 0 ? s / max : 0);
    const vMax = vectorResults.length > 0 ? Math.max(...vectorResults.map((r) => r.score)) : 1;
    const tMax = keywordResults.length > 0 ? Math.max(...keywordResults.map((r) => r.score)) : 1;
    for (const r of vectorResults) {
      byId.set(r.entry.id, { entry: r.entry, score: norm(r.score, vMax) * vectorWeight });
    }
    for (const r of keywordResults) {
      const cur = byId.get(r.entry.id);
      const add = norm(r.score, tMax) * textWeight;
      byId.set(r.entry.id, {
        entry: r.entry,
        score: (cur ? cur.score : 0) + add,
      });
    }
    const merged = [...byId.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.entry);
    if (merged.length === 0) return '';
    return merged
      .map((e) => `[${e.date}] ${e.filePath}\n${e.text}`)
      .join('\n\n')
      .trim();
  }

  /**
   * 召回：若提供 queryVector 则可选混合检索（useHybrid）；否则走关键词召回
   */
  async recall(
    query: string,
    options: {
      days?: number;
      queryVector?: number[];
      topK?: number;
      useHybrid?: boolean;
      vectorWeight?: number;
      textWeight?: number;
      workspaceId?: string;
    } = {},
  ): Promise<string> {
    const {
      days = 2,
      queryVector,
      topK = 5,
      useHybrid = false,
      vectorWeight = 0.7,
      textWeight = 0.3,
      workspaceId,
    } = options;
    if (queryVector && queryVector.length > 0 && this.vectorStore) {
      if (useHybrid) {
        return this.recallHybrid(query, queryVector, {
          topK,
          vectorWeight,
          textWeight,
          workspaceId,
        });
      }
      const entries = await this.recallByVector(queryVector, topK, workspaceId);
      if (entries.length === 0) return '';
      return entries
        .map((e) => `[${e.date}] ${e.filePath}\n${e.text}`)
        .join('\n\n')
        .trim();
    }
    return this.recallKeyword(query, { days });
  }

  /**
   * 显式捕获：写入当日 Daily；若 type 为 preference 或 decision 则同时追加到 MEMORY.md
   */
  async capture(content: string, type?: 'preference' | 'decision' | 'fact'): Promise<void> {
    await this.appendDaily(content);
    if (type === 'preference' || type === 'decision') {
      await this.appendMemory(`- [${type}] ${content}`);
    }
  }

  /**
   * 按路径读记忆文件全文或片段（对齐 OpenClaw readFile）。仅允许 memory/*.md。
   * @param relPath 相对路径，如 memory/2026-02-11.md
   * @param from 从第几行开始（1-based）
   * @param lines 读取行数，不传则全文
   */
  async readFile(
    relPath: string,
    options?: { from?: number; lines?: number },
  ): Promise<{ text: string; path: string }> {
    const raw = (relPath ?? '').trim().replace(/\\/g, '/');
    if (!raw) throw new Error('readFile: path 必填');
    const normalized = raw.startsWith('memory/') ? raw : `memory/${raw}`;
    if (!normalized.startsWith('memory/') || !/^memory\/[^/]+\.md$/i.test(normalized)) {
      throw new Error('readFile: 仅允许 memory 目录下的 .md 文件，如 memory/2026-02-11.md');
    }
    const content = await this.fs.read(normalized);
    if (options?.from == null && options?.lines == null) {
      return { text: content, path: normalized };
    }
    const lineList = content.split(/\n/);
    const from = Math.max(1, Math.min((options?.from ?? 1), lineList.length));
    const count = options?.lines != null ? Math.max(0, options.lines) : lineList.length - from + 1;
    const slice = lineList.slice(from - 1, from - 1 + count);
    return { text: slice.join('\n'), path: normalized };
  }

  /**
   * 记忆状态（对齐 OpenClaw MemoryProviderStatus）：索引条数、memory 目录文件数、向量是否启用
   */
  async getStatus(workspaceId?: string): Promise<{
    vectorEnabled: boolean;
    indexCount: number;
    filesInMemory: number;
    indexPath: string;
    retrievalMode: RetrievalMode;
    provider: {
      configured: boolean;
      available: boolean;
      providerId?: string;
      modelId?: string;
    };
    lastEmbedError?: string;
    fallback: {
      active: boolean;
      reason?: string;
    };
  }> {
    let filesInMemory = 0;
    try {
      const list = await this.fs.list(MEMORY_DIR);
      filesInMemory = list.filter(
        (e) => e.type !== 'directory' && e.name.toLowerCase().endsWith('.md'),
      ).length;
    } catch {
      /* 目录不存在或不可读 */
    }
    const indexCount = this.vectorStore ? await this.vectorStore.count(workspaceId) : 0;
    const indexPath =
      workspaceId && workspaceId !== 'default'
        ? `memory/.vector_index_${workspaceId}.json`
        : 'memory/.vector_index.json';
    const meta = await this.readStatusMeta(workspaceId);
    const retrievalMode: RetrievalMode =
      meta.retrievalMode ??
      (meta.provider?.configured ? 'hybrid' : 'keyword');
    const provider = meta.provider ?? {
      configured: false,
      available: false,
    };
    const fallback = meta.fallback ?? {
      active: false,
    };
    return {
      vectorEnabled: !!this.vectorStore,
      indexCount,
      filesInMemory,
      indexPath,
      retrievalMode,
      provider,
      lastEmbedError: meta.lastEmbedError,
      fallback,
    };
  }
}
