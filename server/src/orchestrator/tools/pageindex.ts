/**
 * PageIndex 工具：文档索引和推理式检索
 *
 * 提取自 ToolExecutor.ts，减少主文件体积。
 */

import type { ToolDefinition } from '@x-computer/shared';
import { resolveLLMCredentials } from '../../llm/credentialResolver.js';
import type { PageIndexOptions } from '../../pageindex/types.js';

// ── In-memory store：userId → documentId → tree ─────────────────────────────────

export const pageIndexStore = new Map<string, Map<string, any>>();

// ── Tool Definitions ────────────────────────────────────────────────────────────

export const pageIndexIndexDef: ToolDefinition = {
  name: 'pageindex_index',
  displayName: '文档索引生成',
  description: `为结构化文档生成树状索引，支持精确章节定位和推理式检索。

适用场景：
- 长文档（>10页）的结构化内容
- 需要精确定位章节的查询
- 财务报告、技术文档、法律文件等结构化内容

不适用：
- 短文本片段（<5页）
- 聊天记录、笔记等非结构化内容
- 仅需要简单关键词匹配的场景`,
  domain: ['chat', 'agent', 'office'],
  riskLevel: 'low',
  parameters: [
    { name: 'path', type: 'string', description: '沙箱内文件路径（如 报告/财务2025.pdf）', required: false },
    { name: 'content', type: 'string', description: '直接提供的文档内容（与 path 二选一）', required: false },
    { name: 'pages', type: 'array', description: '页面数组，每项包含 pageNumber 和 text', required: false },
    { name: 'documentId', type: 'string', description: '可选的文档ID，不提供则自动生成', required: false },
    { name: 'maxPagesPerNode', type: 'number', description: '每个节点最大页数，默认 10', required: false },
    { name: 'maxDepth', type: 'number', description: '索引树最大深度，默认 5', required: false },
  ],
  requiredPermissions: [],
};

export const pageIndexSearchDef: ToolDefinition = {
  name: 'pageindex_search',
  displayName: '文档索引搜索',
  description: '在已索引的文档中搜索相关内容，返回精确的章节定位和推理结果',
  domain: ['chat', 'agent', 'office'],
  riskLevel: 'low',
  parameters: [
    { name: 'documentId', type: 'string', description: '文档ID（由 pageindex_index 返回）', required: true },
    { name: 'query', type: 'string', description: '搜索查询（自然语言）', required: true },
    { name: 'topK', type: 'number', description: '返回结果数量，默认 5', required: false },
    { name: 'threshold', type: 'number', description: '最小相关性阈值（0-1），默认 0.5', required: false },
    { name: 'includeReasoning', type: 'boolean', description: '是否包含推理过程，默认 false', required: false },
  ],
  requiredPermissions: [],
};

export const pageIndexListDef: ToolDefinition = {
  name: 'pageindex_list',
  displayName: '列出文档索引',
  description: '列出当前用户的所有已索引文档',
  domain: ['chat', 'agent', 'office'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: [],
};

export const pageIndexDeleteDef: ToolDefinition = {
  name: 'pageindex_delete',
  displayName: '删除文档索引',
  description: '删除指定文档的索引',
  domain: ['chat', 'agent', 'office'],
  riskLevel: 'low',
  parameters: [
    { name: 'documentId', type: 'string', description: '要删除的文档ID', required: true },
  ],
  requiredPermissions: [],
};

// ── Shared LLM wrapper ─────────────────────────────────────────────────────────

async function callIndexLLM(
  userId: string,
  getConfig: any,
  prompt: string,
): Promise<string> {
  const { callLLM } = await import('../../chat/chatService.js');
  const creds = await resolveLLMCredentials(userId, getConfig ? undefined : undefined, undefined, {
    providerId: 'Minimax',
    modelId: 'MiniMax-M2.7-highspeed',
  });
  if (!creds) throw new Error('需要 LLM 配置');
  return callLLM({
    messages: [{ role: 'user', content: prompt }],
    providerId: creds.providerId,
    modelId: creds.modelId,
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
  });
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

export function createPageIndexHandlers(ctx: {
  resolveFS: (ctx: any) => Promise<any>;
}) {
  const { resolveFS } = ctx;

  // ── index ──────────────────────────────────────────────────────────────────

  const indexHandler = async (input: any, ctx: any): Promise<any> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', documentId: '' };

    const fs = await resolveFS(ctx);
    if (!fs) return { ok: false, error: '无法解析沙箱', documentId: '' };

    let document: any;

    if (input.pages && Array.isArray(input.pages)) {
      document = {
        pages: input.pages.map((p: any) => ({
          pageNumber: p.pageNumber ?? p.page ?? 0,
          text: p.text ?? p.content ?? '',
        })),
        metadata: {
          pageCount: input.pages.length,
          wordCount: input.pages.reduce((sum: number, p: any) => sum + (p.text?.length ?? 0), 0),
          language: 'auto',
        },
      };
    } else if (input.path) {
      const path = String(input.path).trim();
      if (path.includes('..')) return { ok: false, error: '路径不能包含 ..', documentId: '' };

      try {
        const content = await fs.read(path);
        const lines = content.split('\n');
        const pages = [];
        for (let i = 0; i < lines.length; i += 50) {
          pages.push({ pageNumber: Math.floor(i / 50), text: lines.slice(i, i + 50).join('\n') });
        }
        document = { pages, metadata: { pageCount: pages.length, wordCount: content.length, language: 'auto' } };
      } catch (e: any) {
        return { ok: false, error: `读取文件失败: ${e.message}`, documentId: '' };
      }
    } else if (input.content) {
      const text = String(input.content);
      const pages = [];
      for (let i = 0; i < text.length; i += 2000) {
        pages.push({ pageNumber: Math.floor(i / 2000), text: text.slice(i, i + 2000) });
      }
      document = { pages, metadata: { pageCount: pages.length, wordCount: text.length, language: 'auto' } };
    } else {
      return { ok: false, error: '请提供 path、content 或 pages', documentId: '' };
    }

    if (document.pages.length === 0) return { ok: false, error: '文档内容为空', documentId: '' };

    try {
      const { PageIndexGenerator } = await import('../../pageindex/PageIndexGenerator.js');
      const creds = await resolveLLMCredentials(userId, ctx?.getConfig ? undefined : undefined, undefined, {
        providerId: 'Minimax',
        modelId: 'MiniMax-M2.7-highspeed',
      });
      if (!creds) return { ok: false, error: '需要 LLM 配置', documentId: '' };

      const llm = {
        generate: async (prompt: string) => {
          const { callLLM } = await import('../../chat/chatService.js');
          return callLLM({
            messages: [{ role: 'user', content: prompt }],
            providerId: creds.providerId,
            modelId: creds.modelId,
            baseUrl: creds.baseUrl,
            apiKey: creds.apiKey,
          });
        },
        chat: async (messages: any) => {
          const { callLLM } = await import('../../chat/chatService.js');
          return callLLM({
            messages,
            providerId: creds.providerId,
            modelId: creds.modelId,
            baseUrl: creds.baseUrl,
            apiKey: creds.apiKey,
          });
        },
      };

      const generator = new PageIndexGenerator(llm);
      const options: PageIndexOptions = {
        maxPagesPerNode: input.maxPagesPerNode,
        maxDepth: input.maxDepth,
        addNodeSummary: true,
        addDocDescription: true,
      };

      const tree = await generator.generateIndex(document, options);
      if (input.documentId) tree.documentId = input.documentId;

      if (!pageIndexStore.has(userId)) pageIndexStore.set(userId, new Map());
      pageIndexStore.get(userId)!.set(tree.documentId, tree);

      const countNodes = (node: any): number => {
        let count = 1;
        if (node.nodes) for (const child of node.nodes) count += countNodes(child);
        return count;
      };

      return {
        ok: true,
        documentId: tree.documentId,
        pageCount: document.pages.length,
        nodeCount: countNodes(tree.root),
        message: `已为文档生成索引，共 ${document.pages.length} 页，${countNodes(tree.root)} 个节点`,
      };
    } catch (e: any) {
      return { ok: false, error: `索引生成失败: ${e.message}`, documentId: '' };
    }
  };

  // ── search ─────────────────────────────────────────────────────────────────

  const searchHandler = async (input: any, ctx: any): Promise<any> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', results: [] };

    const documentId = String(input.documentId ?? '').trim();
    if (!documentId) return { ok: false, error: 'documentId 必填', results: [] };

    const query = String(input.query ?? '').trim();
    if (!query) return { ok: false, error: 'query 必填', results: [] };

    const tree = pageIndexStore.get(userId)?.get(documentId);
    if (!tree) return { ok: false, error: `未找到文档索引: ${documentId}，请先调用 pageindex_index`, results: [] };

    try {
      const creds = await resolveLLMCredentials(userId, ctx?.getConfig ? undefined : undefined, undefined, {
        providerId: 'Minimax',
        modelId: 'MiniMax-M2.7-highspeed',
      });
      if (!creds) return { ok: false, error: '需要 LLM 配置', results: [] };

      const { PageIndexSearcher } = await import('../../pageindex/PageIndexSearcher.js');
      const searcher = new PageIndexSearcher({
        generate: async (prompt: string) => {
          const { callLLM } = await import('../../chat/chatService.js');
          return callLLM({
            messages: [{ role: 'user', content: prompt }],
            providerId: creds.providerId,
            modelId: creds.modelId,
            baseUrl: creds.baseUrl,
            apiKey: creds.apiKey,
          });
        },
        chat: async (messages: any) => {
          const { callLLM } = await import('../../chat/chatService.js');
          return callLLM({
            messages,
            providerId: creds.providerId,
            modelId: creds.modelId,
            baseUrl: creds.baseUrl,
            apiKey: creds.apiKey,
          });
        },
      });

      const results = await searcher.search(tree, query, {
        topK: input.topK ?? 5,
        threshold: input.threshold ?? 0.5,
        includeReasoning: input.includeReasoning ?? false,
      });

      return {
        ok: true,
        results: results.map((r) => ({
          relevance: r.relevance,
          title: r.node.title,
          summary: r.node.summary,
          pages: r.pages,
          path: r.path,
          reasoning: r.reasoning,
        })),
        message: `找到 ${results.length} 个相关片段`,
      };
    } catch (e: any) {
      return { ok: false, error: `搜索失败: ${e.message}`, results: [] };
    }
  };

  // ── list ───────────────────────────────────────────────────────────────────

  const listHandler = async (input: any, ctx: any): Promise<any> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户', indices: [] };

    const indices = pageIndexStore.get(userId) || new Map();
    return {
      ok: true,
      indices: Array.from(indices.values()).map((t) => ({
        documentId: t.documentId,
        pageCount: t.metadata?.pageCount,
        createdAt: t.createdAt,
      })),
      message: `共 ${indices.size} 个文档索引`,
    };
  };

  // ── delete ─────────────────────────────────────────────────────────────────

  const deleteHandler = async (input: any, ctx: any): Promise<any> => {
    const userId = ctx?.userId;
    if (!userId || userId === 'anonymous') return { ok: false, error: '需要已登录用户' };

    const documentId = String(input.documentId ?? '').trim();
    if (!documentId) return { ok: false, error: 'documentId 必填' };

    pageIndexStore.get(userId)?.delete(documentId);
    return { ok: true, message: `已删除文档索引: ${documentId}` };
  };

  return {
    indexHandler,
    searchHandler,
    listHandler,
    deleteHandler,
  };
}
