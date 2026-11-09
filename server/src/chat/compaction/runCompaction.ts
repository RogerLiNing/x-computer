import type { ChatMessage } from '../chatService.js';
import { describeModel } from '../../llm/modelCatalog.js';
import { serverLogger } from '../../observability/ServerLogger.js';
import { compactMessages, DEFAULT_COMPACTION, shouldCompact, type CompactionResult } from './compaction.js';

export interface CompactionModel { providerId: string; modelId: string }

/**
 * Compacts in place when the conversation no longer fits the model's window. Returns the result when a
 * compaction happened so the caller can checkpoint; `undefined` means the messages were left alone.
 * Any failure is logged and swallowed: a compaction problem must never stop the run.
 */
export async function compactIfNeeded(
  messages: ChatMessage[],
  model: CompactionModel,
  summarize: (prompt: string) => Promise<string>,
  options: { reserveTokens?: number; keepRecentTokens?: number } = {},
): Promise<CompactionResult | undefined> {
  const info = describeModel(model.providerId, model.modelId);
  const reserveTokens = options.reserveTokens ?? DEFAULT_COMPACTION.reserveTokens;
  if (!shouldCompact(messages, { contextWindow: info.contextWindow, reserveTokens })) return undefined;
  const keepRecentTokens = Math.min(options.keepRecentTokens ?? DEFAULT_COMPACTION.keepRecentTokens, Math.max(2_000, Math.floor(info.contextWindow / 4)));
  try {
    const result = await compactMessages(messages, { keepRecentTokens }, summarize);
    if (!result) return undefined;
    messages.splice(0, messages.length, ...result.messages);
    serverLogger.info('chat/compaction', `上下文压缩：${result.summarizedCount} 条消息 → 摘要`, `${result.tokensBefore} → ${result.tokensAfter} tokens（窗口 ${info.contextWindow}）`);
    return result;
  } catch (error: unknown) {
    serverLogger.warn('chat/compaction', '上下文压缩失败，继续使用原始历史', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
