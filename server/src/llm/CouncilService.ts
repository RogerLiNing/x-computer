/**
 * LLM Council Service
 *
 * Queries multiple LLM models in parallel and synthesizes their responses.
 * Based on IronClaw's llm-council skill design.
 */

import type { AppDatabase, AsyncDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { resolveLLMCredentials } from './credentialResolver.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface CouncilRequest {
  prompt: string;
  context?: string;
  models: Array<{
    providerId: string;
    modelId: string;
  }>;
  synthesisPrompt?: string;
}

export interface CouncilResponse {
  results: Array<{
    providerId: string;
    modelId: string;
    response: string;
    error?: string;
    elapsedMs: number;
  }>;
  synthesis?: string;
}

interface LLMConfig {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey: string;
  apiType?: 'openai' | 'anthropic';
}

export class CouncilService {
  constructor(
    private db: AppDatabase | AsyncDatabase,
    private subscriptionService?: SubscriptionService,
  ) {}

  async queryCouncil(userId: string, req: CouncilRequest): Promise<CouncilResponse> {
    if (!req.models || req.models.length === 0) {
      throw new Error('At least one model is required');
    }
    if (!req.prompt?.trim()) {
      throw new Error('Prompt is required');
    }

    // Resolve credentials for all models
    const configs: (LLMConfig | null)[] = await Promise.all(
      req.models.map(({ providerId, modelId }) =>
        resolveLLMCredentials(userId, this.db, this.subscriptionService, { providerId, modelId }),
      ),
    );

    // Filter out unavailable models
    const available = req.models
      .map((m, i) => ({ model: m, config: configs[i] }))
      .filter((item): item is { model: { providerId: string; modelId: string }; config: LLMConfig } => item.config !== null);

    if (available.length === 0) {
      throw new Error('No models are available with configured credentials');
    }

    // Execute parallel calls
    const results = await Promise.all(
      available.map(async ({ model, config }) => {
        const start = Date.now();
        try {
          const response = await this.callModel(config, req.prompt, req.context);
          return {
            providerId: model.providerId,
            modelId: model.modelId,
            response,
            elapsedMs: Date.now() - start,
          };
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          serverLogger.warn('council', 'Model call failed', `provider=${model.providerId} model=${model.modelId} error=${reason}`);
          return {
            providerId: model.providerId,
            modelId: model.modelId,
            response: '',
            error: reason,
            elapsedMs: Date.now() - start,
          };
        }
      }),
    );

    // Synthesize if we have multiple responses and no critical errors
    const successful = results.filter((r) => !r.error);
    let synthesis: string | undefined;
    if (successful.length >= 2) {
      try {
        synthesis = await this.synthesize(req, results);
      } catch (err: unknown) {
        serverLogger.warn('council', 'Synthesis failed', String(err));
      }
    }

    return { results, synthesis };
  }

  private async callModel(config: LLMConfig, prompt: string, context?: string): Promise<string> {
    const messages = [
      ...(context ? [{ role: 'system' as const, content: context }] : []),
      { role: 'user' as const, content: prompt },
    ];

    if (config.apiType === 'anthropic') {
      return this.callAnthropic(config, messages);
    }
    return this.callOpenAICompatible(config, messages);
  }

  private async callOpenAICompatible(config: LLMConfig, messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>): Promise<string> {
    const base = config.baseUrl || 'https://openrouter.ai/api/v1';
    const url = `${base}/chat/completions`;
    const effectiveModel = this.effectiveModelForRequest(config.modelId, base);

    const body: Record<string, unknown> = {
      model: effectiveModel || config.modelId,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
    };
    if (body.model === undefined) delete body.model;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
    }

    const data = (await res.json().catch(() => ({}))) as any;
    let content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      const reasoningContent = data?.choices?.[0]?.message?.reasoning_content;
      if (typeof reasoningContent === 'string' && reasoningContent.trim()) {
        content = reasoningContent;
      } else {
        throw new Error('Model did not return a valid response');
      }
    }
    return this.stripThinkTags(content);
  }

  private async callAnthropic(config: LLMConfig, messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>): Promise<string> {
    const base = config.baseUrl || 'https://api.anthropic.com';

    const systemParts: string[] = [];
    const apiMessages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        apiMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model: config.modelId,
      max_tokens: 4096,
      messages: apiMessages,
    };
    if (systemParts.length) body.system = systemParts.join('\n\n');

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
    }

    const data = (await res.json().catch(() => ({}))) as any;
    const contentBlocks = data?.content;
    if (!Array.isArray(contentBlocks)) throw new Error('Model did not return a valid response');

    const textParts: string[] = [];
    for (const block of contentBlocks) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      }
    }
    if (textParts.length === 0) throw new Error('Model did not return text content');
    return textParts.join('\n');
  }

  private async synthesize(req: CouncilRequest, results: CouncilResponse['results']): Promise<string> {
    // Find the first successful result to use for synthesis
    const firstWorking = results.find((r) => !r.error && r.response);
    if (!firstWorking) return '';

    const base = firstWorking.providerId ? await resolveLLMCredentials(
      results.find((r) => !r.error)?.providerId ?? '',
      this.db,
      this.subscriptionService,
    ) : null;

    const providerId = results.find((r) => !r.error)?.providerId ?? 'openrouter';
    const config = await resolveLLMCredentials(providerId, this.db, this.subscriptionService, { providerId });
    if (!config) return '';

    const synthesisPrompt = req.synthesisPrompt ?? `You are a synthesis AI. Given multiple expert opinions from different AI models, identify consensus, flag disagreements, and produce a unified answer. Reference which model contributed each insight.`;

    const labeled = results
      .filter((r) => !r.error && r.response)
      .map((r) => `**${r.providerId}/${r.modelId}**:\n${r.response}`)
      .join('\n\n---\n\n');

    const prompt = `${synthesisPrompt}\n\nHere are the expert opinions:\n\n${labeled}\n\nSynthesize a balanced answer:`;

    if (config.apiType === 'anthropic') {
      return this.callAnthropic(config, [{ role: 'user', content: prompt }]);
    }
    return this.callOpenAICompatible(config, [{ role: 'user', content: prompt }]);
  }

  private effectiveModelForRequest(modelId: string, baseUrl: string): string {
    // OpenRouter uses prefixed model names (e.g. "openai/gpt-4o")
    if (baseUrl.includes('openrouter') && !modelId.includes('/')) {
      return modelId;
    }
    return modelId;
  }

  private stripThinkTags(content: string): string {
    return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }
}
