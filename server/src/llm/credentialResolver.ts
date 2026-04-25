/**
 * LLM 凭证解析器（服务器端）
 *
 * 安全策略：API Key 只存在于服务器端，前端永远不存、不传 key。
 *
 * 凭证查找优先级：
 * 1. 若用户已购 pro/enterprise → 查用户数据库配置 (db.getConfig(userId, 'llm_config'))
 * 2. 服务器默认配置 (.x-config.json)
 * 3. 环境变量 (OPENROUTER_API_KEY / LLM_API_KEY)
 *
 * 同时提供公开接口：GET /api/llm/config（不含 apiKey）
 */

import { loadDefaultConfig } from '../config/defaultConfig.js';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import type { AsyncDatabase } from '../db/database.js';

export interface LLMConfig {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey: string;
  /** API 类型：'openai' 使用 OpenAI 兼容接口，'anthropic' 使用 Anthropic 接口 */
  apiType?: 'openai' | 'anthropic';
}

/** 只暴露给前端的配置（不含 apiKey） */
export interface PublicLLMConfig {
  providers: Array<{ id: string; name: string; baseUrl?: string }>;
  defaultByModality: Record<string, { providerId: string; modelId: string } | undefined>;
}

/** 从服务器配置（含 .x-config.json / env）构建 PublicLLMConfig */
export function buildPublicLLMConfig(): PublicLLMConfig {
  const defaults = loadDefaultConfig();
  const llm = defaults?.llm_config;
  return {
    providers: (llm?.providers ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
    })),
    defaultByModality: (llm?.defaultByModality as Record<string, { providerId: string; modelId: string } | undefined>) ?? {},
  };
}

/** 从配置对象中提取 provider 的 apiKey 和 apiType */
function extractApiKeyFromConfig(
  config: { providers?: Array<{ id: string; baseUrl?: string; apiKey?: string; apiType?: string }> } | null,
  providerId: string,
): { baseUrl?: string; apiKey?: string; apiType?: string } | null {
  if (!config?.providers?.length) return null;
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider?.apiKey) return null;
  return { baseUrl: provider.baseUrl, apiKey: provider.apiKey, apiType: provider.apiType };
}

/** 统一凭证查找：返回 { providerId, modelId, baseUrl, apiKey } 或 null */
export async function resolveLLMCredentials(
  userId: string,
  db: AppDatabase | AsyncDatabase | undefined,
  subscriptionService: SubscriptionService | undefined,
  overrides?: { providerId?: string; modelId?: string },
): Promise<LLMConfig | null> {
  const provId = overrides?.providerId ?? '';
  const modId = overrides?.modelId ?? '';

  // 1. 若用户已购 pro/enterprise，优先用其自定义配置
  const canUseUserConfig =
    !subscriptionService ||
    (await (async () => {
      try {
        const sub = await subscriptionService.getUserSubscription(userId);
        return sub ? ['pro', 'enterprise'].includes(sub.planId) : false;
      } catch {
        return false;
      }
    })());

  if (canUseUserConfig && db) {
    try {
      const raw = await db.getConfig(userId, 'llm_config');
      if (raw) {
        const config = JSON.parse(raw) as { providers?: Array<{ id: string; baseUrl?: string; apiKey?: string; apiType?: string }> };
        const creds = extractApiKeyFromConfig(config, provId);
        if (creds) {
          return {
            providerId: provId,
            modelId: modId || '__custom__',
            baseUrl: creds.baseUrl,
            apiKey: creds.apiKey as string,
            apiType: creds.apiType as 'openai' | 'anthropic' | undefined,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  // 2. 服务器默认配置 (.x-config.json)
  const defaults = loadDefaultConfig();
  const defaultCreds = extractApiKeyFromConfig(defaults?.llm_config ?? null, provId);
  if (defaultCreds) {
    return {
      providerId: provId,
      modelId: modId || '__custom__',
      baseUrl: defaultCreds.baseUrl,
      apiKey: defaultCreds.apiKey as string,
      apiType: defaultCreds.apiType as 'openai' | 'anthropic' | undefined,
    };
  }

  // 3. 环境变量
  const apiKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.LLM_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim() || process.env.LLM_MODEL?.trim() || 'openai/gpt-4o-mini';
  if (apiKey) {
    return {
      providerId: 'openrouter',
      modelId: model,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey,
      apiType: 'openai' as const,
    };
  }

  return null;
}
