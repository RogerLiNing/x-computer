/**
 * PageIndex 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PageIndexGenerator } from './PageIndexGenerator.js'
import { PageIndexSearcher } from './PageIndexSearcher.js'
import type { ParsedDocument, LLMProvider } from './types.js'

/**
 * Mock LLM Provider
 */
class MockLLMProvider implements LLMProvider {
  async generate(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    // 根据查询返回模拟的响应
    if (prompt.includes('Summarize')) {
      return 'This is a summary of the content.'
    }
    
    if (prompt.includes('Classify')) {
      return 'unknown'
    }
    
    if (prompt.includes('table of contents')) {
      return JSON.stringify([
        { title: 'Introduction', level: 1, startIndex: 0, endIndex: 2 },
        { title: 'Main Content', level: 1, startIndex: 3, endIndex: 7 },
        { title: 'Conclusion', level: 1, startIndex: 8, endIndex: 9 },
      ])
    }
    
    if (prompt.includes('rate their relevance')) {
      return '0.85'
    }
    
    if (prompt.includes('most relevant')) {
      return '1'
    }
    
    return 'mock response'
  }

  async chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    return this.generate(messages[messages.length - 1].content, options)
  }
}

/**
 * 创建测试文档
 */
function createTestDocument(): ParsedDocument {
  return {
    pages: [
      { pageNumber: 0, text: 'Title: Financial Report 2026\n\nThis document presents the financial results for fiscal year 2026.' },
      { pageNumber: 1, text: 'Introduction\n\nThe company achieved significant growth in revenue and profitability.' },
      { pageNumber: 2, text: 'Revenue increased by 25% compared to the previous year, reaching $100 million.' },
      { pageNumber: 3, text: 'Main Content\n\nDetailed financial analysis follows.' },
      { pageNumber: 4, text: 'Operating expenses decreased by 10%, demonstrating improved efficiency.' },
      { pageNumber: 5, text: 'Net income reached $15 million, a 40% increase year-over-year.' },
      { pageNumber: 6, text: 'Cash flow remained strong with $20 million in operating cash flow.' },
      { pageNumber: 7, text: 'Conclusion\n\nThe company is well-positioned for continued growth.' },
      { pageNumber: 8, text: 'Future outlook remains positive with plans for expansion into new markets.' },
      { pageNumber: 9, text: 'Thank you for your continued trust and partnership.' },
    ],
    metadata: {
      pageCount: 10,
      wordCount: 100,
      language: 'en',
    },
  }
}

describe('PageIndexGenerator', () => {
  let generator: PageIndexGenerator
  let mockLLM: MockLLMProvider

  beforeEach(() => {
    mockLLM = new MockLLMProvider()
    generator = new PageIndexGenerator(mockLLM)
  })

  describe('generateIndex', () => {
    it('should generate a PageIndex tree from a document', async () => {
      const document = createTestDocument()
      
      const tree = await generator.generateIndex(document)
      
      expect(tree).toBeDefined()
      expect(tree.documentId).toBeDefined()
      expect(tree.root).toBeDefined()
      expect(tree.createdAt).toBeGreaterThan(0)
      expect(tree.metadata?.pageCount).toBe(10)
    })

    it('should create a root node with correct structure', async () => {
      const document = createTestDocument()
      
      const tree = await generator.generateIndex(document)
      
      expect(tree.root.title).toBe('Document')
      expect(tree.root.nodeId).toBeDefined()
      expect(tree.root.startIndex).toBe(0)
      expect(tree.root.endIndex).toBe(9)
      expect(tree.root.summary).toBeDefined()
    })

    it('should create child nodes for sections', async () => {
      const document = createTestDocument()
      
      const tree = await generator.generateIndex(document, {
        maxDepth: 2,
        maxPagesPerNode: 3,
      })
      
      expect(tree.root.nodes).toBeDefined()
      expect(tree.root.nodes!.length).toBeGreaterThan(0)
    })

    it('should generate node summaries', async () => {
      const document = createTestDocument()
      
      const tree = await generator.generateIndex(document, {
        addNodeSummary: true,
      })
      
      expect(tree.root.summary).toBeDefined()
      expect(tree.root.summary.length).toBeGreaterThan(0)
    })

    it('should respect maxPagesPerNode option', async () => {
      const document = createTestDocument()
      
      const tree = await generator.generateIndex(document, {
        maxPagesPerNode: 2,
        maxDepth: 3,
      })
      
      // 检查所有叶子节点不超过 maxPagesPerNode
      const checkNode = (node: any) => {
        const pageCount = node.endIndex - node.startIndex + 1
        if (!node.nodes || node.nodes.length === 0) {
          expect(pageCount).toBeLessThanOrEqual(2)
        } else {
          node.nodes.forEach(checkNode)
        }
      }
      
      checkNode(tree.root)
    })
  })

  describe('with empty document', () => {
    it('should handle documents with single page', async () => {
      const document: ParsedDocument = {
        pages: [
          { pageNumber: 0, text: 'Single page document' },
        ],
        metadata: {
          pageCount: 1,
          wordCount: 10,
        },
      }
      
      const tree = await generator.generateIndex(document)
      
      expect(tree.root.startIndex).toBe(0)
      expect(tree.root.endIndex).toBe(0)
    })
  })
})

describe('PageIndexSearcher', () => {
  let searcher: PageIndexSearcher
  let mockLLM: MockLLMProvider
  let testTree: any

  beforeEach(async () => {
    mockLLM = new MockLLMProvider()
    searcher = new PageIndexSearcher(mockLLM)
    
    // 创建测试树
    testTree = {
      documentId: 'test-doc-1',
      createdAt: Date.now(),
      root: {
        title: 'Document',
        nodeId: 'root',
        startIndex: 0,
        endIndex: 9,
        summary: 'Financial report for 2026',
        nodes: [
          {
            title: 'Introduction',
            nodeId: 'node-1',
            startIndex: 0,
            endIndex: 2,
            summary: 'Company overview and growth',
          },
          {
            title: 'Main Content',
            nodeId: 'node-2',
            startIndex: 3,
            endIndex: 6,
            summary: 'Detailed financial analysis and performance metrics',
          },
          {
            title: 'Conclusion',
            nodeId: 'node-3',
            startIndex: 7,
            endIndex: 9,
            summary: 'Future outlook and expansion plans',
          },
        ],
      },
    }
  })

  describe('search', () => {
    it('should return search results', async () => {
      const results = await searcher.search(testTree, 'revenue growth', {
        topK: 3,
        threshold: 0.5,
      })
      
      expect(results).toBeDefined()
      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('should include relevance scores', async () => {
      const results = await searcher.search(testTree, 'financial analysis', {
        threshold: 0.0,
      })
      
      results.forEach(result => {
        expect(result.relevance).toBeGreaterThanOrEqual(0)
        expect(result.relevance).toBeLessThanOrEqual(1)
      })
    })

    it('should include node paths', async () => {
      const results = await searcher.search(testTree, 'test query', {
        threshold: 0.0,
        includeReasoning: false,
      })
      
      results.forEach(result => {
        expect(result.path).toBeDefined()
        expect(result.path.length).toBeGreaterThan(0)
      })
    })

    it('should include reasoning when requested', async () => {
      const results = await searcher.search(testTree, 'revenue', {
        threshold: 0.0,
        includeReasoning: true,
      })
      
      results.forEach(result => {
        expect(result.reasoning).toBeDefined()
        expect(result.reasoning!.length).toBeGreaterThan(0)
      })
    })

    it('should filter results by threshold', async () => {
      const results = await searcher.search(testTree, 'test', {
        threshold: 0.9,
      })
      
      results.forEach(result => {
        expect(result.relevance).toBeGreaterThanOrEqual(0.9)
      })
    })
  })

  describe('findByKeyword', () => {
    it('should find nodes by keyword', async () => {
      const results = await searcher.findByKeyword(testTree, 'financial')
      
      expect(results.length).toBeGreaterThan(0)
      
      results.forEach(result => {
        const matchesKeyword = 
          result.title.toLowerCase().includes('financial') ||
          result.summary.toLowerCase().includes('financial')
        expect(matchesKeyword).toBe(true)
      })
    })

    it('should return empty array for non-matching keyword', async () => {
      const results = await searcher.findByKeyword(testTree, 'nonexistent keyword xyz 12345')
      
      expect(results.length).toBe(0)
    })
  })

  describe('getNodePath', () => {
    it('should return path to node', () => {
      const node = testTree.root.nodes[0]
      const path = searcher.getNodePath(node, testTree)
      
      expect(path).toBeDefined()
      expect(path[0]).toBe('Document')
      expect(path).toContain('Introduction')
    })
  })
})

describe('Integration', () => {
  it('should work end-to-end', async () => {
    const mockLLM = new MockLLMProvider()
    const generator = new PageIndexGenerator(mockLLM)
    const searcher = new PageIndexSearcher(mockLLM)
    
    // 生成索引
    const document = createTestDocument()
    const tree = await generator.generateIndex(document)
    
    // 搜索
    const results = await searcher.search(tree, 'revenue and profitability', {
      topK: 3,
      threshold: 0.5,
    })
    
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].node).toBeDefined()
    expect(results[0].relevance).toBeGreaterThan(0)
  })
})