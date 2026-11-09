import { randomUUID } from 'node:crypto';
import { serverLogger } from '../observability/ServerLogger.js';
import { describeModel, estimateCostUsd } from './modelCatalog.js';

/** One model call's token accounting, as the provider reported it. */
export interface ModelUsageEvent {
  userId?: string;
  runId?: string;
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  /** Set when the call was routed through a virtual model such as `auto`. */
  virtualModelId?: string;
  at?: number;
}

export interface ModelUsageRecord extends ModelUsageEvent { id: string; totalTokens: number; costUsd?: number; at: number }

export type ModelUsageSink = (record: ModelUsageRecord) => void | Promise<void>;

let sink: ModelUsageSink | undefined;

export function setModelUsageSink(next: ModelUsageSink | undefined): void { sink = next; }

/** Called by the model adapters after every response that carried usage. Never throws into the model path. */
export function recordModelUsage(event: ModelUsageEvent): ModelUsageRecord {
  const info = describeModel(event.providerId, event.modelId);
  const costUsd = estimateCostUsd(info, event);
  const record: ModelUsageRecord = { ...event, id: randomUUID(), at: event.at ?? Date.now(), totalTokens: event.promptTokens + event.completionTokens, ...(costUsd !== undefined ? { costUsd } : {}) };
  if (sink) {
    Promise.resolve().then(() => sink?.(record)).catch((error: unknown) => serverLogger.warn('llm', '用量写入失败', error instanceof Error ? error.message : String(error)));
  }
  return record;
}

/** Reads an OpenAI-style or Anthropic-style usage object; returns undefined when the provider sent none. */
export function parseProviderUsage(raw: unknown): { promptTokens: number; completionTokens: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const usage = raw as Record<string, unknown>;
  const prompt = numberOf(usage.prompt_tokens) ?? numberOf(usage.input_tokens);
  const completion = numberOf(usage.completion_tokens) ?? numberOf(usage.output_tokens);
  if (prompt === undefined && completion === undefined) return undefined;
  return { promptTokens: prompt ?? 0, completionTokens: completion ?? 0 };
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
