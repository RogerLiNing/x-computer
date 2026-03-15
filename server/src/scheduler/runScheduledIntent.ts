/**
 * 执行 X 主脑的定时意图：以对应用户身份跑一次 Agent 循环，intent 作为唯一用户消息。
 * 不限制内容——X 想做啥就做啥（进化提示词、搜索、写脚本、通知用户等）。
 * R018：LLM/网络类瞬时失败时自动重试（有限次数 + 退避）。
 */

import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { ScheduledJob } from './XScheduler.js';
import { serverLogger } from '../observability/ServerLogger.js';

const MAX_RETRIES = 2; // 最多重试 2 次，共 3 次尝试
const INITIAL_BACKOFF_MS = 2000;
const BACKOFF_MULTIPLIER = 2.5;

/** 是否为可重试的瞬时错误（网络、提供商限流/临时错误等），供定时与 run-now 共用 */
export function isRetriableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /provider returned error|fetch failed|econnrefused|enotfound|etimedout|network|timeout/i.test(msg) ||
    /请求失败:\s*5\d\d|rate limit|overloaded|capacity/i.test(msg) ||
    /无法连接|未返回有效回复/i.test(msg)
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带重试执行异步函数（退避：2s、5s…），仅对 isRetriableError 为 true 的错重试 */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; initialBackoffMs?: number; backoffMultiplier?: number; logLabel?: string },
): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const initialBackoffMs = opts.initialBackoffMs ?? INITIAL_BACKOFF_MS;
  const backoffMultiplier = opts.backoffMultiplier ?? BACKOFF_MULTIPLIER;
  const label = opts.logLabel ?? 'run';
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const retriable = isRetriableError(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries && retriable) {
        const backoffMs = Math.round(initialBackoffMs * Math.pow(backoffMultiplier, attempt));
        serverLogger.warn('scheduler', `${label} 第 ${attempt + 1} 次失败，${backoffMs}ms 后重试`, msg);
        await sleep(backoffMs);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

export interface RunScheduledIntentDeps {
  orchestrator: AgentOrchestrator;
  getSystemPrompt: (userId: string) => Promise<string>;
  getLLMConfig: (userId: string) => Promise<{
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  } | null>;
  /** 执行前确保该用户 MCP 已加载（可选） */
  ensureUserMcp?: (userId: string) => Promise<void>;
  /** 因未配置大模型而跳过时回调（可用来通知用户） */
  onSkip?: (userId: string) => void;
  /** 本轮执行完成后回调（用于触发进化判断等），传入 intent 与 X 的回复内容 */
  onRoundComplete?: (payload: { userId: string; lastUserMessage: string; lastAssistantContent: string }) => void | Promise<void>;
}

export async function runScheduledIntent(
  job: ScheduledJob,
  deps: RunScheduledIntentDeps,
): Promise<void> {
  const { orchestrator, getSystemPrompt, getLLMConfig, ensureUserMcp, onSkip, onRoundComplete } = deps;
  const { userId, intent } = job;
  if (ensureUserMcp) await ensureUserMcp(userId);
  const llmConfig = await getLLMConfig(userId);
  if (!llmConfig?.providerId || !llmConfig?.modelId) {
    serverLogger.warn('scheduler', `跳过定时任务 ${job.id}: 用户 ${userId} 未配置大模型`);
    onSkip?.(userId);
    return;
  }
  const systemPrompt = await getSystemPrompt(userId);
  const messages = [{ role: 'user' as const, content: intent }];
  serverLogger.info('scheduler', `执行定时任务 ${job.id}`, `userId=${userId} intent=${intent.slice(0, 80)}`);

  try {
    const { content } = await runWithRetry(
      () =>
        orchestrator.runIntentAsPersistedTask({
          intent,
          llmConfig: {
            providerId: llmConfig.providerId,
            modelId: llmConfig.modelId,
            baseUrl: llmConfig.baseUrl,
            apiKey: llmConfig.apiKey,
          },
          systemPrompt,
          userId,
          source: 'scheduled_job',
          sourceId: job.id,
          title: '定时任务',
        }),
      { logLabel: `定时任务 ${job.id}` },
    );
    serverLogger.info('scheduler', `定时任务 ${job.id} 完成`, `回复长度=${(content ?? '').length}`);
    if (onRoundComplete) {
      await Promise.resolve(onRoundComplete({ userId, lastUserMessage: intent, lastAssistantContent: content ?? '' }));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    serverLogger.error('scheduler', `定时任务 ${job.id} 失败: ${msg}`);
    if (err instanceof Error && err.stack) serverLogger.error('scheduler', err.stack);
  }
}
