import { resolveLlmApiType } from '../../../../shared/src/index.js';
import { callLLM, callLLMWithTools, callLLMWithToolsStream, type ChatRequest } from '../../chat/chatService.js';
import { describeModel } from '../modelCatalog.js';
import type { ModelAdapter, ModelApiKind, ModelRequest, ModelResult } from './types.js';

export type { ModelAdapter, ModelApiKind, ModelRequest, ModelResult } from './types.js';

function toChatRequest(request: ModelRequest, apiType: ModelApiKind): ChatRequest {
  return { messages: request.messages, providerId: request.providerId, modelId: request.modelId, baseUrl: request.baseUrl, apiKey: request.apiKey, apiType, inputImages: request.inputImages, signal: request.signal };
}

function createAdapter(kind: ModelApiKind): ModelAdapter {
  return {
    kind,
    describe: (request) => describeModel(request.providerId, request.modelId),
    async complete(request) {
      const tools = request.tools ?? [];
      if (tools.length === 0) return { content: await callLLM(toChatRequest(request, kind)), toolCalls: [] };
      return callLLMWithTools(toChatRequest(request, kind), tools);
    },
    stream(request, onChunk) {
      return callLLMWithToolsStream(toChatRequest(request, kind), request.tools ?? [], onChunk);
    },
  };
}

const ADAPTERS: Record<ModelApiKind, ModelAdapter> = { openai: createAdapter('openai'), anthropic: createAdapter('anthropic') };

/** Picks the adapter for a provider from its id, base URL and declared API type. */
export function getModelAdapter(config: { providerId: string; baseUrl?: string; apiType?: string }): ModelAdapter {
  return ADAPTERS[resolveLlmApiType(config.providerId, config.baseUrl, config.apiType)];
}
