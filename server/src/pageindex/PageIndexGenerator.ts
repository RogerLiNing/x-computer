/**
 * PageIndex 索引生成器
 * 
 * 为文档生成树状索引结构
 */

import { v4 as uuid } from 'uuid'
import type { LLMProvider } from './types.js'
import type {
  PageIndexNode,
  PageIndexTree,
  PageIndexOptions,
  DocumentStructure,
  DocumentSection,
  ParsedDocument,
  PageContent,
} from './types.js'

/**
 * 默认选项
 */
const DEFAULT_OPTIONS: PageIndexOptions = {
  maxPagesPerNode: 10,
  maxTokensPerNode: 2000,
  addNodeId: true,
  addNodeSummary: true,
  addDocDescription: true,
  maxDepth: 5,
}

/**
 * PageIndex 索引生成器
 */
export class PageIndexGenerator {
  constructor(private llm: LLMProvider) {}

  /**
   * 为文档生成 PageIndex 树结构
   */
  async generateIndex(
    document: ParsedDocument,
    options: PageIndexOptions = {}
  ): Promise<PageIndexTree> {
    const opts = { ...DEFAULT_OPTIONS, ...options } as Required<PageIndexOptions>
    const startTime = Date.now()

    // 1. 检测文档结构
    const structure = await this.detectStructure(document)

    // 2. 构建树状索引
    const root = await this.buildTree(document, structure, opts)

    const tree: PageIndexTree = {
      documentId: uuid(),
      root,
      createdAt: Date.now(),
      metadata: {
        pageCount: document.pages.length,
        wordCount: document.metadata.wordCount,
        language: document.metadata.language,
      },
    }

    return tree
  }

  /**
   * 检测文档结构
   */
  private async detectStructure(document: ParsedDocument): Promise<DocumentStructure> {
    if (document.structure) {
      return document.structure
    }

    // 使用 LLM 检测结构
    const prompt = `Analyze the following document structure and extract the table of contents.

Document pages:
${document.pages.slice(0, 10).map((p, i) => `Page ${i}: ${p.text.slice(0, 500)}`).join('\n\n')}

Return a JSON array of sections with:
- title: section title
- level: heading level (1-6)
- pageNumber: starting page number

Format: [{"title": "...", "level": 1, "pageNumber": 0}]`

    try {
      const response = await this.llm.generate(prompt, { maxTokens: 2000 })
      const sections = JSON.parse(response) as DocumentSection[]
      
      return {
        tableOfContents: sections.map(s => ({
          title: s.title,
          level: s.level,
          pageNumber: s.startIndex,
        })),
        sections,
      }
    } catch {
      // 如果解析失败，生成默认结构
      return this.generateDefaultStructure(document)
    }
  }

  /**
   * 生成默认结构
   */
  private generateDefaultStructure(document: ParsedDocument): DocumentStructure {
    const pagesPerSection = 10
    const sections: DocumentSection[] = []
    
    for (let i = 0; i < document.pages.length; i += pagesPerSection) {
      const endPage = Math.min(i + pagesPerSection, document.pages.length)
      sections.push({
        title: `Section ${sections.length + 1}`,
        level: 1,
        startIndex: i,
        endIndex: endPage - 1,
      })
    }
    
    return { sections }
  }

  /**
   * 构建树状索引
   */
  private async buildTree(
    document: ParsedDocument,
    structure: DocumentStructure,
    opts: Required<PageIndexOptions>
  ): Promise<PageIndexNode> {
    const sections = structure.sections || []
    
    if (sections.length === 0) {
      // 如果没有章节，为整个文档创建单一节点
      return this.createNodeFromPages(
        document.pages,
        'Document',
        opts
      )
    }

    // 构建根节点
    const root: PageIndexNode = {
      title: 'Document',
      nodeId: this.generateNodeId(),
      startIndex: 0,
      endIndex: document.pages.length - 1,
      summary: opts.addDocDescription 
        ? await this.generateDocumentSummary(document)
        : '',
      nodes: [],
    }

    // 递归构建子节点
    if (opts.maxDepth && opts.maxDepth > 0) {
      root.nodes = await this.buildChildNodes(
        document,
        sections,
        opts,
        1 // depth
      )
    }

    return root
  }

  /**
   * 构建子节点
   */
  private async buildChildNodes(
    document: ParsedDocument,
    sections: DocumentSection[],
    opts: Required<PageIndexOptions>,
    depth: number
  ): Promise<PageIndexNode[]> {
    const nodes: PageIndexNode[] = []
    
    for (const section of sections) {
      const maxDepth = opts.maxDepth || 5
      if (section.endIndex - section.startIndex > (opts.maxPagesPerNode || 10) && depth < maxDepth) {
        // 进一步分割
        const subSections = await this.splitSection(
          document,
          section,
          opts
        )
        
        const node: PageIndexNode = {
          title: section.title,
          nodeId: this.generateNodeId(),
          startIndex: section.startIndex,
          endIndex: section.endIndex,
          summary: opts.addNodeSummary 
            ? await this.generateSectionSummary(document, section)
            : '',
          nodes: await this.buildChildNodes(
            document,
            subSections,
            opts,
            depth + 1
          ),
        }
        
        nodes.push(node)
      } else {
        // 创建叶子节点
        const pages = document.pages.slice(
          section.startIndex,
          section.endIndex + 1
        )
        
        const node = await this.createNodeFromPages(
          pages,
          section.title,
          opts
        )
        
        node.startIndex = section.startIndex
        node.endIndex = section.endIndex
        
        nodes.push(node)
      }
    }
    
    return nodes
  }

  /**
   * 从页面创建节点
   */
  private async createNodeFromPages(
    pages: PageContent[],
    title: string,
    opts: Required<PageIndexOptions>
  ): Promise<PageIndexNode> {
    const content = pages.map(p => p.text).join('\n\n')
    
    return {
      title,
      nodeId: this.generateNodeId(),
      startIndex: pages[0]?.pageNumber || 0,
      endIndex: pages[pages.length - 1]?.pageNumber || 0,
      summary: opts.addNodeSummary 
        ? await this.generateSummary(content)
        : '',
    }
  }

  /**
   * 分割章节
   */
  private async splitSection(
    document: ParsedDocument,
    section: DocumentSection,
    opts: Required<PageIndexOptions>
  ): Promise<DocumentSection[]> {
    const pageRange = section.endIndex - section.startIndex + 1
    const subSections: DocumentSection[] = []
    const maxPages = opts.maxPagesPerNode || 10
    
    let currentIndex = section.startIndex
    while (currentIndex <= section.endIndex) {
      const endPage = Math.min(
        currentIndex + maxPages - 1,
        section.endIndex
      )
      
      subSections.push({
        title: `${section.title} (Part ${subSections.length + 1})`,
        level: section.level + 1,
        startIndex: currentIndex,
        endIndex: endPage,
      })
      
      currentIndex = endPage + 1
    }
    
    return subSections
  }

  /**
   * 生成文档摘要
   */
  private async generateDocumentSummary(document: ParsedDocument): Promise<string> {
    const firstPages = document.pages.slice(0, 5).map(p => p.text).join('\n\n')
    
    const prompt = `Summarize the following document in 2-3 sentences:

${firstPages.slice(0, 2000)}

Summary:`
    
    return this.llm.generate(prompt, { maxTokens: 200 })
  }

  /**
   * 生成章节摘要
   */
  private async generateSectionSummary(
    document: ParsedDocument,
    section: DocumentSection
  ): Promise<string> {
    const content = document.pages
      .slice(section.startIndex, section.endIndex + 1)
      .map(p => p.text)
      .join('\n\n')
    
    return this.generateSummary(content.slice(0, 2000))
  }

  /**
   * 生成摘要
   */
  private async generateSummary(content: string): Promise<string> {
    const prompt = `Summarize the following content in 1-2 sentences:

${content.slice(0, 1500)}

Summary:`
    
    return this.llm.generate(prompt, { maxTokens: 150 })
  }

  /**
   * 生成节点 ID
   */
  private generateNodeId(): string {
    return uuid().replace(/-/g, '').slice(0, 8)
  }
}