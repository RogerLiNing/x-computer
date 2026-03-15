import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';

/**
 * SandboxFS — a sandboxed file system that confines all operations to a workspace directory.
 * Prevents path traversal and ensures isolation from the host system.
 */

/** 若内容像 HTML 实体编码（如 LLM/API 返回的 &lt; &gt;），解码为原始 HTML，避免写入后无法渲染 */
function decodeHtmlEntitiesIfNeeded(content: string): string {
  const t = content.trimStart();
  if (!t.startsWith('&lt;') || !t.includes('&gt;')) return content;
  return content
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export interface FSEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  /** 修改时间，ISO 字符串精确到秒 */
  modified: string;
  /** 创建时间，ISO 字符串精确到秒（部分系统无 birthtime 则与 modified 一致） */
  created: string;
  permissions: string;
}

export class SandboxFS {
  private root: string;
  private userId?: string;
  private subscriptionService?: SubscriptionService;

  constructor(workspaceRoot?: string, options?: {
    userId?: string;
    subscriptionService?: SubscriptionService;
  }) {
    this.root = workspaceRoot || path.join(os.tmpdir(), 'x-computer-workspace');
    this.userId = options?.userId;
    this.subscriptionService = options?.subscriptionService;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });

    // Create default directory structure（含 memory 供主脑记忆与向量索引）
    const dirs = ['文档', '下载', '项目', '图片', '桌面', 'memory', '文档/周报', '文档/合同', '项目/x-computer'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.root, dir), { recursive: true });
    }

    // 主脑/助手提示词文件：初始为空，首次组装提示词时由 MemoryService.ensure* 写入默认内容
    const memoryPromptFiles: Record<string, string> = {
      'memory/BASE_PROMPT.md': '',
      'memory/ASSISTANT_PROMPT.md': '',
      'memory/EVOLVED_CORE_PROMPT.md': '',
    };
    for (const [filePath, content] of Object.entries(memoryPromptFiles)) {
      const full = path.join(this.root, filePath);
      try {
        await fs.access(full);
      } catch {
        await fs.writeFile(full, content, 'utf-8');
      }
    }

    // Create sample files if they don't exist
    const sampleFiles: Record<string, string> = {
      '备忘录.txt': '这是 X-Computer 的备忘录文件。\n\n可以在这里记录重要事项。\n\n创建于 2026-02-10',
      '工作计划.md': `# 工作计划\n\n## 本周目标\n\n1. 完成 AI 自主电脑系统 MVP\n2. 实现桌面壳层\n3. 打通 AI 编排核心\n\n## 备注\n\n- 前端: React + TypeScript\n- 后端: Node.js + Express\n`,
      '文档/产品需求文档.md': `# 产品需求文档\n\n## 概述\n\nX-Computer 是一台 AI 驱动的自主电脑系统。\n\n## 功能需求\n\n### 1. 桌面界面\n- 窗口管理\n- 任务栏\n- 通知中心\n\n### 2. AI 能力\n- 聊天协作\n- 编程开发\n- 智能体任务\n- 办公自动化\n`,
      '文档/会议纪要.md': `# 会议纪要\n\n**日期**: 2026-02-10\n**参会人**: 全体\n\n## 议题\n\n1. Q1 产品路线图\n2. AI 功能集成方案\n3. 市场反馈汇总\n\n## 决议\n\n- 确认采用混合隔离策略\n- 优先实现办公电脑基线\n`,
      '项目/x-computer/README.md': `# X-Computer\n\nAI 自主电脑系统\n\n## 快速开始\n\nnpm install\nnpm run dev\n`,
      '项目/x-computer/package.json': '{\n  "name": "x-computer",\n  "version": "0.1.0"\n}\n',
    };

    for (const [filePath, content] of Object.entries(sampleFiles)) {
      const full = path.join(this.root, filePath);
      try {
        await fs.access(full);
      } catch {
        await fs.writeFile(full, content, 'utf-8');
      }
    }
  }

  getRoot(): string {
    return this.root;
  }

  /**
   * Resolve and validate a path within the sandbox.
   */
  private resolve(userPath: string): string {
    // Normalize and resolve
    const resolved = path.resolve(this.root, userPath.replace(/^\//, ''));

    // Ensure it's within the sandbox root
    if (!resolved.startsWith(this.root)) {
      throw new Error('Path traversal detected — access denied');
    }

    return resolved;
  }

  async list(dirPath: string): Promise<FSEntry[]> {
    const resolved = this.resolve(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });

    const results: FSEntry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden files
      const fullPath = path.join(resolved, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        const created =
          stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime.toISOString() : stat.mtime.toISOString();
        results.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          created,
          permissions: this.formatPermissions(stat.mode),
        });
      } catch {
        // Skip inaccessible files
      }
    }

    // Sort: directories first, then by name
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    return results;
  }

  async read(filePath: string): Promise<string> {
    const resolved = this.resolve(filePath);
    return fs.readFile(resolved, 'utf-8');
  }

  /** 读取二进制文件（如图片），供图片查看器等使用 */
  async readBinary(filePath: string): Promise<Buffer> {
    const resolved = this.resolve(filePath);
    return fs.readFile(resolved);
  }

  /** 写入文本：若文件已存在则追加（前加换行），否则创建并写入。内容若为 HTML 实体编码则先解码。 */
  async write(filePath: string, content: string): Promise<void> {
    const decoded = decodeHtmlEntitiesIfNeeded(content);
    const resolved = this.resolve(filePath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    
    let oldSize = 0;
    try {
      const stat = await fs.stat(resolved);
      if (stat.isFile()) {
        oldSize = stat.size;
        await fs.appendFile(resolved, '\n' + decoded, 'utf-8');
        const newStat = await fs.stat(resolved);
        this.recordStorageChange(newStat.size - oldSize);
        return;
      }
    } catch {
      // 文件不存在，走创建逻辑
    }
    await fs.writeFile(resolved, decoded, 'utf-8');
    const newStat = await fs.stat(resolved);
    this.recordStorageChange(newStat.size - oldSize);
  }

  /** 覆写文件内容（不追加）；用于需要整体替换的文件。内容若为 HTML 实体编码则先解码。 */
  async writeOverwrite(filePath: string, content: string): Promise<void> {
    const decoded = decodeHtmlEntitiesIfNeeded(content);
    const resolved = this.resolve(filePath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    
    let oldSize = 0;
    try {
      const stat = await fs.stat(resolved);
      oldSize = stat.size;
    } catch {
      // 文件不存在
    }
    
    await fs.writeFile(resolved, decoded, 'utf-8');
    const newStat = await fs.stat(resolved);
    this.recordStorageChange(newStat.size - oldSize);
  }

  /** 写入二进制内容（如图片）到沙箱路径 */
  async writeBinary(filePath: string, data: Buffer): Promise<void> {
    const resolved = this.resolve(filePath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    
    let oldSize = 0;
    try {
      const stat = await fs.stat(resolved);
      oldSize = stat.size;
    } catch {
      // 文件不存在
    }
    
    await fs.writeFile(resolved, data);
    this.recordStorageChange(data.length - oldSize);
  }

  async mkdir(dirPath: string): Promise<void> {
    const resolved = this.resolve(dirPath);
    await fs.mkdir(resolved, { recursive: true });
  }

  async delete(targetPath: string): Promise<void> {
    const resolved = this.resolve(targetPath);
    const stat = await fs.stat(resolved);
    const sizeToDelete = stat.isDirectory() ? await this.getDirectorySize(resolved) : stat.size;
    
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true });
    } else {
      await fs.unlink(resolved);
    }
    
    this.recordStorageChange(-sizeToDelete);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const resolvedOld = this.resolve(oldPath);
    const resolvedNew = this.resolve(newPath);
    await fs.rename(resolvedOld, resolvedNew);
  }

  async stat(filePath: string): Promise<{ size: number; modified: string; isDirectory: boolean }> {
    const resolved = this.resolve(filePath);
    const s = await fs.stat(resolved);
    return {
      size: s.size,
      modified: s.mtime.toISOString(),
      isDirectory: s.isDirectory(),
    };
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      const resolved = this.resolve(filePath);
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  private formatPermissions(mode: number): string {
    const perms = (mode & 0o777).toString(8);
    return perms.padStart(3, '0');
  }

  /**
   * Human-readable file size.
   */
  static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * 记录存储变化（正数表示增加，负数表示减少）
   */
  private recordStorageChange(bytes: number): void {
    if (!this.userId || !this.subscriptionService || bytes === 0) {
      return;
    }

    void this.subscriptionService.recordUsage(
      this.userId,
      'storage',
      bytes,
      { operation: 'file_write', timestamp: Date.now() }
    ).catch(() => {});
  }

  /**
   * 计算目录总大小（递归）
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(fullPath);
        } else {
          const stat = await fs.stat(fullPath);
          totalSize += stat.size;
        }
      }
    } catch {
      // 忽略错误
    }
    return totalSize;
  }
}
