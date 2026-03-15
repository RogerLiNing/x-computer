/**
 * UserSandboxManager — 按 userId 管理隔离的 SandboxFS 与 SandboxShell 实例。
 *
 * 目录结构：
 *   basePath/
 *     users/
 *       {userId}/
 *         workspace/           ← 用户主工作区（X 主脑、任务等）
 *           memory/
 *           agents/
 *             {agentId}/       ← 每个 agent 独立目录
 *               ...
 *           ...
 */

import path from 'path';
import fs from 'fs/promises';
import { SandboxFS } from './SandboxFS.js';
import { SandboxShell } from './SandboxShell.js';
import type { UserContainerManager } from '../container/UserContainerManager.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';

export interface UserSandbox {
  userId: string;
  sandboxFS: SandboxFS;
  sandboxShell: SandboxShell;
}

export interface AgentSandbox {
  userId: string;
  agentId: string;
  sandboxFS: SandboxFS;
  sandboxShell: SandboxShell;
}

export class UserSandboxManager {
  private basePath: string;
  private cache = new Map<string, UserSandbox>();
  private containerManager?: UserContainerManager;
  private useContainer: boolean;
  private subscriptionService?: SubscriptionService;

  constructor(basePath: string, options?: {
    containerManager?: UserContainerManager;
    useContainer?: boolean;
    subscriptionService?: SubscriptionService;
  }) {
    this.basePath = basePath;
    this.containerManager = options?.containerManager;
    this.useContainer = options?.useContainer ?? false;
    this.subscriptionService = options?.subscriptionService;
  }

  /** 获取用户的工作区根目录路径（不创建） */
  getUserWorkspaceRoot(userId: string): string {
    return path.join(this.basePath, 'users', userId, 'workspace');
  }

  /** 获取指定 agent 的独立工作目录路径（不创建） */
  getAgentWorkspaceRoot(userId: string, agentId: string): string {
    return path.join(this.getUserWorkspaceRoot(userId), 'agents', agentId);
  }

  private agentCache = new Map<string, AgentSandbox>();

  /**
   * 获取（或创建）某 agent 的隔离沙箱。每个 agent 有独立目录，file.write/shell.run 等操作限于该目录。
   */
  async getForAgent(userId: string, agentId: string): Promise<AgentSandbox> {
    const key = `${userId}:${agentId}`;
    const existing = this.agentCache.get(key);
    if (existing) return existing;

    const agentRoot = this.getAgentWorkspaceRoot(userId, agentId);
    await fs.mkdir(agentRoot, { recursive: true });

    const sandboxFS = new SandboxFS(agentRoot, {
      userId,
      subscriptionService: this.subscriptionService,
    });
    const sandboxShell = new SandboxShell(agentRoot, 30_000, {
      userId,
      containerManager: this.containerManager,
      useContainer: this.useContainer,
    });
    await sandboxFS.init();

    const sandbox: AgentSandbox = { userId, agentId, sandboxFS, sandboxShell };
    this.agentCache.set(key, sandbox);
    return sandbox;
  }

  /**
   * 获取（或创建）某用户的隔离沙箱。
   * 首次访问时会初始化目录结构。
   */
  async getForUser(userId: string): Promise<UserSandbox> {
    const existing = this.cache.get(userId);
    if (existing) return existing;

    const workspaceRoot = this.getUserWorkspaceRoot(userId);

    // 确保用户目录存在
    await fs.mkdir(workspaceRoot, { recursive: true });

    const sandboxFS = new SandboxFS(workspaceRoot, {
      userId,
      subscriptionService: this.subscriptionService,
    });
    const sandboxShell = new SandboxShell(workspaceRoot, 30_000, {
      userId,
      containerManager: this.containerManager,
      useContainer: this.useContainer,
    });

    // 初始化默认目录和文件（如 memory/ 等）
    await sandboxFS.init();

    const sandbox: UserSandbox = { userId, sandboxFS, sandboxShell };
    this.cache.set(userId, sandbox);
    return sandbox;
  }

  /** 检查某用户的沙箱是否已初始化 */
  async hasUser(userId: string): Promise<boolean> {
    try {
      await fs.access(this.getUserWorkspaceRoot(userId));
      return true;
    } catch {
      return false;
    }
  }

  /** 列出所有已创建的用户 ID */
  async listUsers(): Promise<string[]> {
    const usersDir = path.join(this.basePath, 'users');
    try {
      const entries = await fs.readdir(usersDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * 将 fromUserId 的工作区文件合并到 toUserId（登录/注册后关联匿名数据）。
   * 仅复制 to 中不存在的路径，不覆盖已有文件。
   */
  async mergeWorkspaceInto(fromUserId: string, toUserId: string): Promise<void> {
    if (fromUserId === toUserId) return;
    const fromRoot = this.getUserWorkspaceRoot(fromUserId);
    const toRoot = this.getUserWorkspaceRoot(toUserId);
    try {
      await fs.mkdir(toRoot, { recursive: true });
    } catch {
      /* toRoot 已存在 */
    }
    const copyOne = async (relPath: string): Promise<void> => {
      const src = path.join(fromRoot, relPath);
      const dest = path.join(toRoot, relPath);
      try {
        const stat = await fs.stat(src);
        try {
          await fs.access(dest);
        } catch {
          if (stat.isDirectory()) {
            await fs.mkdir(dest, { recursive: true });
            const names = await fs.readdir(src);
            for (const name of names) {
              await copyOne(path.join(relPath, name));
            }
          } else {
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.copyFile(src, dest);
          }
        }
      } catch {
        /* 忽略单文件错误 */
      }
    };
    const topNames = await fs.readdir(fromRoot).catch(() => []);
    for (const name of topNames) {
      await copyOne(name);
    }
    this.cache.delete(toUserId);
  }

  /** 获取基础路径 */
  getBasePath(): string {
    return this.basePath;
  }

  /** 清除缓存（测试用） */
  clearCache(): void {
    this.cache.clear();
    this.agentCache.clear();
  }
}
