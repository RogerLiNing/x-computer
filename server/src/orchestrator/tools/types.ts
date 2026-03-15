/**
 * 工具执行依赖：由 ToolExecutor 注入，供各分类工具（file/shell/llm 等）使用。
 * 便于将工具实现拆分到独立目录与文件，而不产生循环依赖。
 */
import type { SandboxFS } from '../../tooling/SandboxFS.js';
import type { UserSandboxManager } from '../../tooling/UserSandboxManager.js';
import type { MemoryService } from '../../memory/MemoryService.js';
import type { ToolDefinition } from '@x-computer/shared';

export type { ToolDefinition };

/** 工具执行时所需的执行器能力（resolveFS、simulateDelay、API Key 等） */
export interface ToolExecutorDeps {
  resolveFS(context?: unknown): Promise<SandboxFS | undefined>;
  simulateDelay(min: number, max: number): Promise<void>;
  getZhipuApiKey(ctx?: unknown): string | undefined;
  getDashScopeApiKey(ctx?: unknown): string | undefined;
  getMemoryServiceForUser?(userId: string): Promise<MemoryService | null>;
  getVectorConfigForUser?(
    userId: string
  ): Promise<{ providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null>;
  userSandboxManager?: UserSandboxManager;
  sandboxFS?: SandboxFS;
}

/** 工具处理函数： (input, context?) => Promise<unknown>，由各工具模块的 createHandler(deps) 返回 */
export type ToolHandler = (
  input: Record<string, unknown>,
  context?: unknown
) => Promise<unknown>;
