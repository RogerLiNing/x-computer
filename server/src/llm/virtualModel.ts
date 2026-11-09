import { loadDefaultConfig } from '../config/defaultConfig.js';
import { estimateTokens } from './modelCatalog.js';

/** The one virtual model shipped: pick a cheap or a strong physical model per request. */
export const AUTO_MODEL_ID = 'auto';

export interface PhysicalModel { providerId: string; modelId: string }

export interface AutoRouteConfig {
  cheap: PhysicalModel;
  strong: PhysicalModel;
  /** Prompts estimated above this many tokens go to the strong model. Default 6000. */
  longInputTokens?: number;
}

export interface RouteFeatures {
  /** Tools the request will offer the model. */
  toolCount: number;
  hasImages: boolean;
  /** Full prompt text the model will see (system + history + user). */
  promptText: string;
  /** The newest user message, inspected for intent words. */
  lastUserMessage: string;
  /** Tier chosen earlier in the same run; follow-up rounds stay there. */
  sticky?: RouteTier;
}

export type RouteTier = 'cheap' | 'strong';

export interface RouteDecision { tier: RouteTier; model: PhysicalModel; reason: string }

const DEFAULT_LONG_INPUT_TOKENS = 6000;
/** Words that usually mean the person wants careful, long-form or multi-step work. */
const STRONG_INTENT = /写(一篇|份|个)|撰写|起草|分析|方案|报告|总结全文|规划|设计|重构|代码|编程|调试|推理|证明|详细|深入|对比|评估|翻译全文|长文/;

export function isVirtualModel(modelId: string | undefined): boolean {
  return (modelId ?? '').trim().toLowerCase() === AUTO_MODEL_ID;
}

function isPhysical(value: unknown): value is PhysicalModel {
  return !!value && typeof value === 'object' && typeof (value as PhysicalModel).providerId === 'string' && typeof (value as PhysicalModel).modelId === 'string'
    && !isVirtualModel((value as PhysicalModel).modelId);
}

/** Parses an `autoRoute` block from a user's or the deployment's llm config. */
export function parseAutoRoute(value: unknown): AutoRouteConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { cheap?: unknown; strong?: unknown; longInputTokens?: unknown };
  if (!isPhysical(raw.cheap) || !isPhysical(raw.strong)) return undefined;
  const longInputTokens = typeof raw.longInputTokens === 'number' && raw.longInputTokens > 0 ? raw.longInputTokens : undefined;
  return { cheap: raw.cheap, strong: raw.strong, ...(longInputTokens ? { longInputTokens } : {}) };
}

/** User config wins over the deployment default. */
export function resolveAutoRoute(userLlmConfig: unknown): AutoRouteConfig | undefined {
  const fromUser = parseAutoRoute((userLlmConfig as { autoRoute?: unknown } | null | undefined)?.autoRoute);
  if (fromUser) return fromUser;
  return parseAutoRoute((loadDefaultConfig().llm_config as { autoRoute?: unknown } | undefined)?.autoRoute);
}

/** Deterministic routing: tool use, images, long prompts and demanding intents go to the strong model. */
export function routeVirtualModel(features: RouteFeatures, config: AutoRouteConfig): RouteDecision {
  if (features.sticky) return { tier: features.sticky, model: config[features.sticky], reason: '沿用本次运行已选的模型' };
  const limit = config.longInputTokens ?? DEFAULT_LONG_INPUT_TOKENS;
  if (features.hasImages) return { tier: 'strong', model: config.strong, reason: '请求包含图片' };
  if (features.toolCount > 0) return { tier: 'strong', model: config.strong, reason: '需要调用工具' };
  if (estimateTokens(features.promptText) > limit) return { tier: 'strong', model: config.strong, reason: '上下文较长' };
  if (STRONG_INTENT.test(features.lastUserMessage)) return { tier: 'strong', model: config.strong, reason: '任务需要深入处理' };
  return { tier: 'cheap', model: config.cheap, reason: '简短对话' };
}
