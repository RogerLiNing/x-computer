import { loadDefaultConfig } from '../config/defaultConfig.js';

/** What the platform knows about a model before calling it. Prices are USD per million tokens and are estimates. */
export interface ModelInfo {
  contextWindow: number;
  supportsTools: boolean;
  supportsImages: boolean;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  /** 'catalog' = built-in table, 'config' = overridden in .x-config.json, 'default' = unknown model */
  source: 'catalog' | 'config' | 'default';
}

export interface ModelInfoOverride extends Partial<Omit<ModelInfo, 'source'>> {
  /** Case-insensitive substring of the model id, or `provider:substring`. */
  match: string;
}

interface CatalogRule { match: RegExp; info: Omit<ModelInfo, 'source'> }

const K = 1024;
const rule = (match: RegExp, contextWindow: number, supportsImages: boolean, inputUsdPerMTok?: number, outputUsdPerMTok?: number, supportsTools = true): CatalogRule =>
  ({ match, info: { contextWindow, supportsTools, supportsImages, inputUsdPerMTok, outputUsdPerMTok } });

/** Ordered: the first matching rule wins, so specific ids come before families. */
const CATALOG: CatalogRule[] = [
  rule(/^gpt-4o-mini/i, 128 * K, true, 0.15, 0.6),
  rule(/^gpt-4o/i, 128 * K, true, 2.5, 10),
  rule(/^gpt-4\.1-nano/i, 1000 * K, true, 0.1, 0.4),
  rule(/^gpt-4\.1-mini/i, 1000 * K, true, 0.4, 1.6),
  rule(/^gpt-4\.1/i, 1000 * K, true, 2, 8),
  rule(/^o1-mini|^o3-mini|^o4-mini/i, 128 * K, false, 1.1, 4.4),
  rule(/^o1|^o3/i, 200 * K, true, 15, 60),
  rule(/claude-.*opus/i, 200 * K, true, 15, 75),
  rule(/claude-.*haiku/i, 200 * K, true, 0.8, 4),
  rule(/claude/i, 200 * K, true, 3, 15),
  rule(/^deepseek-reasoner|deepseek-r1/i, 128 * K, false, 0.55, 2.19),
  rule(/deepseek/i, 128 * K, false, 0.27, 1.1),
  rule(/minimax-m\d|abab/i, 200 * K, false),
  rule(/minimax/i, 200 * K, false),
  rule(/qwen.*vl|qwen-omni/i, 128 * K, true),
  rule(/qwen.*long/i, 1000 * K, false),
  rule(/qwen/i, 128 * K, false),
  rule(/glm-4v|glm-4\.\dv/i, 128 * K, true),
  rule(/glm/i, 128 * K, false),
  rule(/moonshot|kimi/i, 128 * K, false),
  rule(/doubao.*vision/i, 128 * K, true),
  rule(/doubao/i, 128 * K, false),
  rule(/gemini.*flash/i, 1000 * K, true, 0.1, 0.4),
  rule(/gemini/i, 1000 * K, true, 1.25, 10),
  rule(/llama|mistral|mixtral|phi-|gemma/i, 32 * K, false),
];

const DEFAULT_INFO: Omit<ModelInfo, 'source'> = { contextWindow: 32 * K, supportsTools: true, supportsImages: false };

function configOverrides(): ModelInfoOverride[] {
  const models = (loadDefaultConfig().llm_config as { models?: unknown } | undefined)?.models;
  if (!Array.isArray(models)) return [];
  return models.filter((item): item is ModelInfoOverride => !!item && typeof item === 'object' && typeof (item as { match?: unknown }).match === 'string');
}

function overrideMatches(override: ModelInfoOverride, providerId: string, modelId: string): boolean {
  const [head, ...rest] = override.match.split(':');
  const needle = (rest.length ? rest.join(':') : head).toLowerCase();
  const providerOk = rest.length === 0 || head.toLowerCase() === providerId.toLowerCase();
  return providerOk && modelId.toLowerCase().includes(needle);
}

/** Looks a model up in the deployment overrides first, then the built-in table. Never throws. */
export function describeModel(providerId: string, modelId: string, overrides: ModelInfoOverride[] = configOverrides()): ModelInfo {
  const override = overrides.find((item) => overrideMatches(item, providerId, modelId));
  const base = CATALOG.find((item) => item.match.test(modelId))?.info;
  if (override) {
    const { match: _match, ...fields } = override;
    return { ...(base ?? DEFAULT_INFO), ...fields, source: 'config' };
  }
  return base ? { ...base, source: 'catalog' } : { ...DEFAULT_INFO, source: 'default' };
}

export interface TokenUsage { promptTokens: number; completionTokens: number }

/** USD cost when the catalog knows both prices; undefined otherwise so callers never show a made-up number. */
export function estimateCostUsd(info: Pick<ModelInfo, 'inputUsdPerMTok' | 'outputUsdPerMTok'>, usage: TokenUsage): number | undefined {
  if (info.inputUsdPerMTok === undefined || info.outputUsdPerMTok === undefined) return undefined;
  return (usage.promptTokens * info.inputUsdPerMTok + usage.completionTokens * info.outputUsdPerMTok) / 1_000_000;
}

/** Rough token estimate for routing and compaction decisions: CJK ≈ 1 token per character, Latin ≈ 4 characters per token. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const char of text) if (/[　-鿿豈-﫿]/.test(char)) cjk += 1;
  return cjk + Math.ceil((text.length - cjk) / 4);
}
