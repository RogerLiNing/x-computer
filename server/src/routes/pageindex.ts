/**
 * PageIndex API 路由
 * 
 * 提供文档索引和搜索功能
 */

import { Router } from 'express'
import type { PageIndexTree, PageIndexOptions, SearchOptions } from '../pageindex/types.js'
import { PageIndexGenerator } from '../pageindex/PageIndexGenerator.js'
import { PageIndexSearcher } from '../pageindex/PageIndexSearcher.js'
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js'
import type { AppDatabase } from '../db/database.js'
import { resolveLLMCredentials } from '../llm/credentialResolver.js'
import type { SubscriptionService } from '../subscription/SubscriptionService.js'
import { serverLogger } from '../observability/ServerLogger.js'
import type { ChatRequest } from '../chat/chatService.js'

/**
 * 简单的 LLM Provider 适配器
 */
class LLMProviderAdapter {
  constructor(
    private userId: string,
    private db: AppDatabase,
    private subscriptionService?: SubscriptionService
  ) {}

  async generate(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    const creds = await resolveLLMCredentials(this.userId, this.db, this.subscriptionService, {
      providerId: 'Minimax',
      modelId: 'MiniMax-M2.7-highspeed',
    })

    if (!creds) {
      throw new Error('No LLM credentials available')
    }

    // 使用项目的 LLM 调用服务
    const { callLLM } = await import('../chat/chatService.js')
    
    const request: ChatRequest = {
      messages: [{ role: 'user', content: prompt }],
      providerId: creds.providerId,
      modelId: creds.modelId,
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
    }
    
    const response = await callLLM(request)

    return response
  }

  async chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    const creds = await resolveLLMCredentials(this.userId, this.db, this.subscriptionService, {
      providerId: 'Minimax',
      modelId: 'MiniMax-M2.7-highspeed',
    })

    if (!creds) {
      throw new Error('No LLM credentials available')
    }

    const { callLLM } = await import('../chat/chatService.js')
    
    const request: ChatRequest = {
      messages: messages,
      providerId: creds.providerId,
      modelId: creds.modelId,
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
    }
    
    const response = await callLLM(request)

    return response
  }
}

/**
 * 内存中的 PageIndex 存储
 */
class InMemoryPageIndexStore {
  private indices: Map<string, PageIndexTree> = new Map()

  async save(tree: PageIndexTree): Promise<void> {
    this.indices.set(tree.documentId, tree)
  }

  async load(documentId: string): Promise<PageIndexTree | null> {
    return this.indices.get(documentId) || null
  }

  async delete(documentId: string): Promise<void> {
    this.indices.delete(documentId)
  }

  async list(): Promise<PageIndexTree[]> {
    return Array.from(this.indices.values())
  }
}

// 全局存储
const pageIndexStore = new InMemoryPageIndexStore()

export function createPageIndexRouter(
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
  subscriptionService?: SubscriptionService,
): Router {
  const router = Router()

  /**
   * POST /api/pageindex/generate
   * 为文档生成 PageIndex
   * 
   * Body: {
   *   document: { pages: Array<{ pageNumber: number, text: string }>, metadata: {...} },
   *   options: { maxPagesPerNode?: number, ... }
   * }
   */
  router.post('/generate', async (req, res) => {
    try {
      const userId = (req as any).userId
      if (!userId || !db) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { document, options = {} } = req.body

      if (!document || !document.pages) {
        res.status(400).json({ error: 'Document with pages is required' })
        return
      }

      // 创建 LLM Provider
      const llm = new LLMProviderAdapter(userId, db, subscriptionService)
      const generator = new PageIndexGenerator(llm)

      // 生成索引
      const index = await generator.generateIndex(document, options as PageIndexOptions)

      // 保存索引
      await pageIndexStore.save(index)

      serverLogger.info('pageindex/generate', 'PageIndex generated', `userId=${userId} documentId=${index.documentId} pageCount=${document.pages.length}`)

      res.json({
        success: true,
        index,
      })
    } catch (error) {
      serverLogger.error('pageindex/generate', 'PageIndex generation failed', error instanceof Error ? error.message : String(error))

      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'PageIndex generation failed' 
      })
    }
  })

  /**
   * POST /api/pageindex/search
   * 使用 PageIndex 搜索
   * 
   * Body: {
   *   documentId: string,
   *   query: string,
   *   options: { topK?: number, threshold?: number, ... }
   * }
   */
  router.post('/search', async (req, res) => {
    try {
      const userId = (req as any).userId
      if (!userId || !db) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { documentId, query, options = {} } = req.body

      if (!documentId || !query) {
        res.status(400).json({ error: 'documentId and query are required' })
        return
      }

      // 加载索引
      const tree = await pageIndexStore.load(documentId)
      if (!tree) {
        res.status(404).json({ error: 'PageIndex not found' })
        return
      }

      // 创建 LLM Provider
      const llm = new LLMProviderAdapter(userId, db, subscriptionService)
      const searcher = new PageIndexSearcher(llm)

      // 搜索
      const results = await searcher.search(tree, query, options as SearchOptions)

      serverLogger.info('pageindex/search', 'PageIndex search completed', `userId=${userId} documentId=${documentId} query=${query.slice(0, 50)} resultCount=${results.length}`)

      res.json({
        success: true,
        results,
      })
    } catch (error) {
      serverLogger.error('pageindex/search', 'PageIndex search failed', error instanceof Error ? error.message : String(error))

      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'PageIndex search failed' 
      })
    }
  })

  /**
   * GET /api/pageindex/:documentId
   * 获取 PageIndex
   */
  router.get('/:documentId', async (req, res) => {
    try {
      const userId = (req as any).userId
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { documentId } = req.params

      const tree = await pageIndexStore.load(documentId)
      if (!tree) {
        res.status(404).json({ error: 'PageIndex not found' })
        return
      }

      res.json({
        success: true,
        index: tree,
      })
    } catch (error) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to load PageIndex' 
      })
    }
  })

  /**
   * DELETE /api/pageindex/:documentId
   * 删除 PageIndex
   */
  router.delete('/:documentId', async (req, res) => {
    try {
      const userId = (req as any).userId
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const { documentId } = req.params

      await pageIndexStore.delete(documentId)

      serverLogger.info('pageindex/delete', 'PageIndex deleted', `userId=${userId} documentId=${documentId}`)

      res.json({
        success: true,
        message: 'PageIndex deleted',
      })
    } catch (error) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to delete PageIndex' 
      })
    }
  })

  /**
   * GET /api/pageindex
   * 列出所有 PageIndex
   */
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const indices = await pageIndexStore.list()

      res.json({
        success: true,
        indices: indices.map(tree => ({
          documentId: tree.documentId,
          createdAt: tree.createdAt,
          pageCount: tree.metadata?.pageCount,
        })),
      })
    } catch (error) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to list PageIndices' 
      })
    }
  })

  return router
}