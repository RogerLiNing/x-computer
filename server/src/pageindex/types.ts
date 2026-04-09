/**
 * PageIndex 类型定义
 * 
 * 无向量、基于推理的 RAG 系统
 * 参考: https://github.com/VectifyAI/PageIndex
 */

/**
 * PageIndex 树节点
 */
export interface PageIndexNode {
  /** 节点标题 */
  title: string
  
  /** 节点唯一标识 */
  nodeId: string
  
  /** 起始页码（0-indexed） */
  startIndex: number
  
  /** 结束页码 */
  endIndex: number
  
  /** 节点摘要 */
  summary: string
  
  /** 子节点 */
  nodes?: PageIndexNode[]
  
  /** 内容片段（可选） */
  content?: string
  
  /** 元数据（可选） */
  metadata?: Record<string, unknown>
}

/**
 * PageIndex 树
 */
export interface PageIndexTree {
  /** 文档ID */
  documentId: string
  
  /** 根节点 */
  root: PageIndexNode
  
  /** 创建时间 */
  createdAt: number
  
  /** 文档元信息 */
  metadata?: {
    filename?: string
    pageCount?: number
    wordCount?: number
    language?: string
  }
}

/**
 * 页面内容
 */
export interface PageContent {
  /** 页码 */
  pageNumber: number
  
  /** 文本内容 */
  text: string
  
  /** 字符偏移 */
  charOffset?: number
}

/**
 * 文档结构
 */
export interface DocumentStructure {
  /** 检测到的目录 */
  tableOfContents?: {
    title: string
    level: number
    pageNumber: number
  }[]
  
  /** 文档类型 */
  documentType?: 'pdf' | 'markdown' | 'html' | 'text'
  
  /** 章节列表 */
  sections?: DocumentSection[]
}

/**
 * 文档章节
 */
export interface DocumentSection {
  title: string
  level: number
  startIndex: number
  endIndex: number
  content?: string
}

/**
 * 索引生成选项
 */
export interface PageIndexOptions {
  /** LLM 模型 */
  model?: string
  
  /** 每节点最大页数 */
  maxPagesPerNode?: number
  
  /** 每节点最大 token */
  maxTokensPerNode?: number
  
  /** 是否添加节点 ID */
  addNodeId?: boolean
  
  /** 是否添加节点摘要 */
  addNodeSummary?: boolean
  
  /** 是否添加文档描述 */
  addDocDescription?: boolean
  
  /** 语言 */
  language?: string
  
  /** 最大深度 */
  maxDepth?: number
}

/**
 * 搜索结果
 */
export interface SearchResult {
  /** 相关性分数 (0-1) */
  relevance: number
  
  /** 匹配的节点 */
  node: PageIndexNode
  
  /** 节点路径 */
  path: string[]
  
  /** 内容片段 */
  content?: string
  
  /** 页码范围 */
  pages: {
    start: number
    end: number
  }
  
  /** 推理过程 */
  reasoning?: string
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  /** 返回结果数量 */
  topK?: number
  
  /** 最小相关性阈值 */
  threshold?: number
  
  /** 是否包含内容 */
  includeContent?: boolean
  
  /** 是否包含推理过程 */
  includeReasoning?: boolean
  
  /** 搜索模式 */
  mode?: 'breadth' | 'depth' | 'hybrid'
}

/**
 * 索引存储接口
 */
export interface PageIndexStore {
  /** 保存索引 */
  save(tree: PageIndexTree): Promise<void>
  
  /** 加载索引 */
  load(documentId: string): Promise<PageIndexTree | null>
  
  /** 删除索引 */
  delete(documentId: string): Promise<void>
  
  /** 列出所有索引 */
  list(): Promise<PageIndexTree[]>
}

/**
 * LLM 提供者接口
 */
export interface LLMProvider {
  /** 生成文本 */
  generate(prompt: string, options?: {
    maxTokens?: number
    temperature?: number
  }): Promise<string>
  
  /** 对话补全 */
  chat(messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>, options?: {
    maxTokens?: number
    temperature?: number
  }): Promise<string>
}

/**
 * 文档解析器接口
 */
export interface DocumentParser {
  /** 解析文档 */
  parse(buffer: Buffer): Promise<ParsedDocument>
}

/**
 * 解析后的文档
 */
export interface ParsedDocument {
  /** 页面列表 */
  pages: PageContent[]
  
  /** 文档结构 */
  structure?: DocumentStructure
  
  /** 元数据 */
  metadata: {
    filename?: string
    pageCount: number
    wordCount?: number
    language?: string
  }
}

/**
 * 混合检索结果
 */
export interface HybridSearchResult {
  /** 来源类型 */
  source: 'pageindex' | 'vector' | 'hybrid'
  
  /** 相关性分数 */
  relevance: number
  
  /** 内容 */
  content: string
  
  /** 元数据 */
  metadata: {
    /** PageIndex 特有 */
    nodeId?: string
    pages?: string
    reasoning?: string
    
    /** 向量特有 */
    vectorId?: string
    score?: number
    
    /** 通用 */
    documentId?: string
    source?: string
  }
}

/**
 * 检索上下文
 */
export interface RetrievalContext {
  /** 用户ID */
  userId?: string
  
  /** 会话ID */
  sessionId?: string
  
  /** 文档类型 */
  documentType?: 'structured' | 'unstructured' | 'unknown'
  
  /** 查询意图 */
  queryIntent?: string
  
  /** 时间范围 */
  timeRange?: {
    start?: number
    end?: number
  }
}

/**
 * PageIndex 指标
 */
export interface PageIndexMetrics {
  /** 索引时间 (ms) */
  indexTime: number
  
  /** 搜索时间 (ms) */
  searchTime: number
  
  /** 节点数量 */
  nodeCount: number
  
  /** 树深度 */
  treeDepth: number
  
  /** LLM 调用次数 */
  llmCalls: number
  
  /** Token 使用量 */
  tokenUsage: number
  
  /** 准确率 */
  accuracy?: number
}