/**
 * PageIndex 树搜索器
 * 
 * 使用 LLM 推理进行树搜索
 */

import type { LLMProvider } from './types.js'
import type {
  PageIndexTree,
  PageIndexNode,
  SearchResult,
  SearchOptions,
} from './types.js'

/**
 * 默认搜索选项
 */
const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  topK: 5,
  threshold: 0.7,
  includeContent: false,
  includeReasoning: true,
  mode: 'hybrid',
}

/**
 * PageIndex 树搜索器
 */
export class PageIndexSearcher {
  constructor(private llm: LLMProvider) {}

  /**
   * 在 PageIndex 树中搜索
   */
  async search(
    tree: PageIndexTree,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options } as Required<SearchOptions>
    const startTime = Date.now()

    // 1. 从根节点开始搜索
    const candidates = await this.searchNode(tree.root, query, [], opts)

    // 2. 按相关性排序并过滤
    const threshold = opts.threshold ?? 0.7
    const topK = opts.topK ?? 5
    
    const results = candidates
      .filter(r => r.relevance >= threshold)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, topK)

    return results
  }

  /**
   * 搜索节点
   */
  private async searchNode(
    node: PageIndexNode,
    query: string,
    path: string[],
    opts: Required<SearchOptions>
  ): Promise<SearchResult[]> {
    const currentPath = [...path, node.title]

    // 如果是叶子节点
    if (!node.nodes || node.nodes.length === 0) {
      const relevance = await this.computeRelevance(node, query, opts.includeReasoning ?? true)
      
      return [{
        relevance,
        node,
        path: currentPath,
        content: node.content,
        pages: {
          start: node.startIndex,
          end: node.endIndex,
        },
        reasoning: opts.includeReasoning 
          ? await this.getReasoning(node, query)
          : undefined,
      }]
    }

    // 如果是分支节点，决定搜索策略
    const mode = opts.mode ?? 'hybrid'
    if (mode === 'breadth') {
      return this.searchBreadth(node, query, currentPath, opts)
    } else if (mode === 'depth') {
      return this.searchDepth(node, query, currentPath, opts)
    } else {
      return this.searchHybrid(node, query, currentPath, opts)
    }
  }

  /**
   * 广度优先搜索
   */
  private async searchBreadth(
    node: PageIndexNode,
    query: string,
    path: string[],
    opts: Required<SearchOptions>
  ): Promise<SearchResult[]> {
    // 评估所有子节点
    const evaluations = await Promise.all(
      (node.nodes || []).map(async child => ({
        node: child,
        relevance: await this.computeRelevance(child, query, opts.includeReasoning ?? true),
      }))
    )

    // 选择最相关的子节点
    const sorted = evaluations.sort((a, b) => b.relevance - a.relevance)
    const results: SearchResult[] = []

    // 递归搜索前 N 个最相关的节点
    const topNodes = sorted.slice(0, 3)
    
    for (const { node: child } of topNodes) {
      const childResults = await this.searchNode(child, query, path, opts)
      results.push(...childResults)
    }

    return results
  }

  /**
   * 深度优先搜索
   */
  private async searchDepth(
    node: PageIndexNode,
    query: string,
    path: string[],
    opts: Required<SearchOptions>
  ): Promise<SearchResult[]> {
    // 使用 LLM 选择最佳路径
    const bestChild = await this.selectBestChild(node, query)
    
    if (!bestChild) {
      return []
    }

    return this.searchNode(bestChild, query, path, opts)
  }

  /**
   * 混合搜索
   */
  private async searchHybrid(
    node: PageIndexNode,
    query: string,
    path: string[],
    opts: Required<SearchOptions>
  ): Promise<SearchResult[]> {
    // 1. 先用 LLM 选择最相关的子节点
    const candidates = await this.selectTopChildren(node, query, 3)
    
    // 2. 对候选节点进行广度搜索
    const results: SearchResult[] = []
    
    for (const child of candidates) {
      const childResults = await this.searchNode(child, query, path, {
        ...opts,
        mode: 'depth', // 深度搜索候选节点
      })
      results.push(...childResults)
    }

    return results
  }

  /**
   * 计算相关性
   */
  private async computeRelevance(
    node: PageIndexNode,
    query: string,
    includeReasoning: boolean
  ): Promise<number> {
    const prompt = `Given a query and a document section, rate their relevance on a scale of 0-1.

Query: "${query}"

Section Title: "${node.title}"
Section Summary: "${node.summary}"
Pages: ${node.startIndex}-${node.endIndex}

Return only a number between 0 and 1, where:
- 0 = completely irrelevant
- 0.5 = partially relevant
- 1 = highly relevant

Relevance score:`

    try {
      const response = await this.llm.generate(prompt, { maxTokens: 10 })
      const score = parseFloat(response.trim())
      
      if (isNaN(score) || score < 0 || score > 1) {
        return 0.5 // 默认值
      }
      
      return score
    } catch {
      return 0.5
    }
  }

  /**
   * 选择最佳子节点
   */
  private async selectBestChild(
    node: PageIndexNode,
    query: string
  ): Promise<PageIndexNode | null> {
    if (!node.nodes || node.nodes.length === 0) {
      return null
    }

    const children = node.nodes
    const prompt = `Given a query, select the most relevant section to search.

Query: "${query}"

Available sections:
${children.map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`).join('\n')}

Return only the number (1-${children.length}) of the most relevant section.

Section number:`

    try {
      const response = await this.llm.generate(prompt, { maxTokens: 10 })
      const index = parseInt(response.trim()) - 1
      
      if (index >= 0 && index < children.length) {
        return children[index]
      }
      
      return children[0]
    } catch {
      return children[0]
    }
  }

  /**
   * 选择前 N 个子节点
   */
  private async selectTopChildren(
    node: PageIndexNode,
    query: string,
    n: number
  ): Promise<PageIndexNode[]> {
    if (!node.nodes || node.nodes.length === 0) {
      return []
    }

    const children = node.nodes
    
    // 如果子节点数量 <= n，返回所有
    if (children.length <= n) {
      return children
    }

    // 使用 LLM 排序
    const prompt = `Given a query, rank the following sections by relevance.

Query: "${query}"

Sections:
${children.map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`).join('\n')}

Return only the numbers of the top ${n} most relevant sections, separated by commas.
Example format: 3,1,5

Top ${n} sections:`

    try {
      const response = await this.llm.generate(prompt, { maxTokens: 50 })
      const indices = response
        .split(',')
        .map(s => parseInt(s.trim()) - 1)
        .filter(i => i >= 0 && i < children.length)

      return indices.slice(0, n).map(i => children[i])
    } catch {
      return children.slice(0, n)
    }
  }

  /**
   * 获取推理过程
   */
  private async getReasoning(
    node: PageIndexNode,
    query: string
  ): Promise<string> {
    const prompt = `Explain why this section is relevant to the query.

Query: "${query}"

Section: "${node.title}"
Summary: "${node.summary}"

Provide a brief explanation in 1-2 sentences.`

    try {
      return await this.llm.generate(prompt, { maxTokens: 100 })
    } catch {
      return `Section "${node.title}" may contain relevant information.`
    }
  }

  /**
   * 查找包含特定关键词的节点
   */
  async findByKeyword(
    tree: PageIndexTree,
    keyword: string
  ): Promise<PageIndexNode[]> {
    const results: PageIndexNode[] = []
    
    const search = (node: PageIndexNode) => {
      const matchesKeyword = 
        node.title.toLowerCase().includes(keyword.toLowerCase()) ||
        node.summary.toLowerCase().includes(keyword.toLowerCase())
      
      if (matchesKeyword) {
        results.push(node)
      }
      
      if (node.nodes) {
        for (const child of node.nodes) {
          search(child)
        }
      }
    }
    
    search(tree.root)
    return results
  }

  /**
   * 获取节点的完整路径
   */
  getNodePath(node: PageIndexNode, tree: PageIndexTree): string[] {
    const path: string[] = []
    
    const find = (current: PageIndexNode, target: PageIndexNode): boolean => {
      if (current.nodeId === target.nodeId) {
        path.push(current.title)
        return true
      }
      
      if (current.nodes) {
        for (const child of current.nodes) {
          if (find(child, target)) {
            path.unshift(current.title)
            return true
          }
        }
      }
      
      return false
    }
    
    find(tree.root, node)
    return path
  }
}