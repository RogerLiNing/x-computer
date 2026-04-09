/**
 * 混合记忆服务
 * 
 * 整合 PageIndex (推理检索) 和向量检索
 * 
 * 架构:
 * 用户查询
 *     │
 *     ├─ PageIndex (结构化文档)
 *     │   ├─ 文档索引
 *     │   ├─ 树搜索
 *     │   └─ 推理检索
 *     │
 *     ├─ VectorStore (非结构化记忆)
 *     │   ├─ 向量化
 *     │   └─ 相似度搜索
 *     │
 *     └─ 智能路由
 *         ├─ 文档类型判断
 *         └─ 选择最佳检索方式
 */

import type { SandboxFS } from '../tooling/SandboxFS.js'
import type { VectorStore } from './vectorStore.js'
import type { MemoryService } from './MemoryService.js'
import type {
  PageIndexTree,
  SearchResult,
  SearchOptions,
  HybridSearchResult,
  RetrievalContext,
  PageIndexStore,
} from '../pageindex/types.js'
import { PageIndexGenerator } from '../pageindex/PageIndexGenerator.js'
import { PageIndexSearcher } from '../pageindex/PageIndexSearcher.js'

/**
 * 文档类型
 */
type DocumentType = 'structured' | 'unstructured' | 'unknown'

/**
 * LLM 提供者接口
 */
interface LLMProvider {
  generate(prompt: string, options?: {
    maxTokens?: number
    temperature?: number
  }): Promise<string>
  
  chat(messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>, options?: {
    maxTokens?: number
    temperature?: number
  }): Promise<string>
}

/**
 * 混合检索选项
 */
interface HybridRetrievalOptions {
  /** 用户ID */
  userId?: string
  
  /** 会话ID */
  sessionId?: string
  
  /** 返回结果数量 */
  topK?: number
  
  /** 最小相关性阈值 */
  threshold?: number
  
  /** 文档类型 */
  documentType?: DocumentType
  
  /** 是否包含推理过程 */
  includeReasoning?: boolean
  
  /** 工作空间ID */
  workspaceId?: string
  
  /** 查询向量（用于向量检索） */
  queryVector?: number[]
}

/**
 * 混合记忆服务
 */
export class HybridMemoryService {
  private pageIndex: Map<string, PageIndexTree> = new Map()
  private generator: PageIndexGenerator
  private searcher: PageIndexSearcher

  constructor(
    private memoryService: MemoryService,
    private llm: LLMProvider,
    private fs: SandboxFS,
    private vectorStore?: VectorStore,
    private pageIndexStore?: PageIndexStore,
  ) {
    this.generator = new PageIndexGenerator(llm)
    this.searcher = new PageIndexSearcher(llm)
  }

  /**
   * 智能检索 - 路由到最佳检索方式
   */
  async retrieve(
    query: string,
    options: HybridRetrievalOptions = {}
  ): Promise<HybridSearchResult[]> {
    const {
      topK = 5,
      threshold = 0.7,
      documentType = 'unknown',
      includeReasoning = false,
      workspaceId,
      queryVector,
    } = options

    // 1. 判断文档类型（如果未指定）
    const docType = documentType === 'unknown' 
      ? await this.classifyDocumentType(query)
      : documentType

    // 2. 根据类型选择检索策略
    if (docType === 'structured') {
      // 优先使用 PageIndex
      const results = await this.searchPageIndex(query, { topK, threshold, includeReasoning })
      if (results.length > 0) return results
      
      // 回退到向量检索
      return this.searchVector(query, { topK, workspaceId, queryVector })
    } else if (docType === 'unstructured') {
      // 使用向量检索
      return this.searchVector(query, { topK, workspaceId, queryVector })
    } else {
      // 混合检索
      return this.hybridSearch(query, { topK, threshold, includeReasoning, workspaceId, queryVector })
    }
  }

  /**
   * 写入记忆（增强版）
   */
  async writeMemory(
    content: string,
    metadata: {
      type?: 'structured' | 'unstructured'
      source?: string
      userId?: string
      workspaceId?: string
    } = {}
  ): Promise<string> {
    const { type = 'unstructured', source } = metadata

    // 1. 写入基础记忆
    await this.memoryService.appendDaily(content)
    
    // 生成唯一ID
    const memoryId = `memory-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // 2. 如果是结构化文档，生成 PageIndex
    if (type === 'structured' && source) {
      try {
        const pageIndex = await this.generatePageIndex(content)
        this.pageIndex.set(memoryId, pageIndex)
        
        // 保存到存储
        if (this.pageIndexStore) {
          await this.pageIndexStore.save(pageIndex)
        }
      } catch (err) {
        console.error('Failed to generate PageIndex:', err)
      }
    }

    return memoryId
  }

  /**
   * PageIndex 树搜索
   */
  private async searchPageIndex(
    query: string,
    options: {
      topK: number
      threshold: number
      includeReasoning: boolean
    }
  ): Promise<HybridSearchResult[]> {
    const results: HybridSearchResult[] = []

    // 遍历所有已索引的文档
    for (const [memoryId, tree] of this.pageIndex) {
      try {
        const searchResults = await this.searcher.search(tree, query, {
          topK: options.topK,
          threshold: options.threshold,
          includeReasoning: options.includeReasoning,
        })

        for (const result of searchResults) {
          results.push({
            source: 'pageindex',
            relevance: result.relevance,
            content: result.content || result.node.summary,
            metadata: {
              documentId: tree.documentId,
              nodeId: result.node.nodeId,
              pages: `${result.pages.start}-${result.pages.end}`,
              reasoning: result.reasoning,
            },
          })
        }
      } catch (err) {
        console.error(`PageIndex search failed for ${memoryId}:`, err)
      }
    }

    // 按相关性排序
    return results
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, options.topK)
  }

  /**
   * 向量检索
   */
  private async searchVector(
    query: string,
    options: {
      topK: number
      workspaceId?: string
      queryVector?: number[]
    }
  ): Promise<HybridSearchResult[]> {
    if (!this.vectorStore || !options.queryVector) {
      // 使用关键词召回
      const content = await this.memoryService.recallKeyword(query, { days: 7 })
      
      return [{
        source: 'vector',
        relevance: 0.5,
        content,
        metadata: {
          source: 'keyword',
        },
      }]
    }

    // 向量检索
    const entries = await this.vectorStore.search(
      options.queryVector,
      options.topK,
      options.workspaceId
    )

    return entries.map(entry => ({
      source: 'vector' as const,
      relevance: 0.8, // 向量相似度分数
      content: `[${entry.date}] ${entry.filePath}\n${entry.text}`,
      metadata: {
        vectorId: entry.id,
        source: entry.filePath,
      },
    }))
  }

  /**
   * 混合检索
   */
  private async hybridSearch(
    query: string,
    options: {
      topK: number
      threshold: number
      includeReasoning: boolean
      workspaceId?: string
      queryVector?: number[]
    }
  ): Promise<HybridSearchResult[]> {
    // 并行执行两种检索
    const [pageResults, vectorResults] = await Promise.all([
      this.searchPageIndex(query, {
        topK: options.topK * 2,
        threshold: options.threshold * 0.9,
        includeReasoning: options.includeReasoning,
      }),
      this.searchVector(query, {
        topK: options.topK * 2,
        workspaceId: options.workspaceId,
        queryVector: options.queryVector,
      }),
    ])

    // 合并结果
    const merged = this.mergeResults(pageResults, vectorResults, options.topK)

    return merged
  }

  /**
   * 合并结果
   */
  private mergeResults(
    pageResults: HybridSearchResult[],
    vectorResults: HybridSearchResult[],
    topK: number
  ): HybridSearchResult[] {
    // PageIndex 结果权重更高（因为基于推理）
    const weighted = new Map<string, HybridSearchResult>()

    // 添加 PageIndex 结果
    for (const result of pageResults) {
      weighted.set(result.metadata.nodeId || result.content, {
        ...result,
        relevance: result.relevance * 0.7,
        source: 'hybrid',
      })
    }

    // 添加向量结果
    for (const result of vectorResults) {
      const key = result.metadata.vectorId || result.content
      const existing = weighted.get(key)

      if (existing) {
        // 合并分数
        weighted.set(key, {
          ...existing,
          relevance: Math.max(existing.relevance, result.relevance * 0.3),
        })
      } else {
        weighted.set(key, {
          ...result,
          relevance: result.relevance * 0.3,
          source: 'hybrid',
        })
      }
    }

    // 排序并返回 topK
    return Array.from(weighted.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, topK)
  }

  /**
   * 文档类型分类
   */
  private async classifyDocumentType(query: string): Promise<DocumentType> {
    const prompt = `Classify the following query into one of these categories:
- structured: query about structured documents (PDFs, manuals, reports, financial documents)
- unstructured: query about notes, conversations, informal text
- unknown: unclear or mixed

Query: "${query}"

Return only one word: structured, unstructured, or unknown`

    try {
      const response = await this.llm.generate(prompt, { maxTokens: 10, temperature: 0.3 })
      const classification = response.trim().toLowerCase()
      
      if (classification === 'structured' || classification === 'unstructured' || classification === 'unknown') {
        return classification
      }
      
      return 'unknown'
    } catch {
      return 'unknown'
    }
  }

  /**
   * 生成 PageIndex
   */
  private async generatePageIndex(content: string): Promise<PageIndexTree> {
    // 简化的文档解析（实际应该使用 PDF 解析器）
    const pages = content.split('\n\n').map((text, i) => ({
      pageNumber: i,
      text,
      charOffset: 0,
    }))

    const document = {
      pages,
      metadata: {
        pageCount: pages.length,
        wordCount: content.split(/\s+/).length,
        language: 'unknown',
      },
    }

    return this.generator.generateIndex(document)
  }

  /**
   * 加载 PageIndex
   */
  async loadPageIndex(documentId: string): Promise<PageIndexTree | null> {
    if (this.pageIndex.has(documentId)) {
      return this.pageIndex.get(documentId)!
    }

    if (this.pageIndexStore) {
      const tree = await this.pageIndexStore.load(documentId)
      if (tree) {
        this.pageIndex.set(documentId, tree)
      }
      return tree
    }

    return null
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    pageSize: number
    vectorEnabled: boolean
    vectorCount: number
  }> {
    return {
      pageSize: this.pageIndex.size,
      vectorEnabled: !!this.vectorStore,
      vectorCount: this.vectorStore ? await this.vectorStore.count() : 0,
    }
  }
}