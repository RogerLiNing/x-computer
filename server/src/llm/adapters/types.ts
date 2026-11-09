import type { ChatMessage, LLMToolCall, LLMToolDef, ModelImage } from '../../chat/chatService.js';
import type { ModelInfo } from '../modelCatalog.js';

/** One request to a physical model, independent of the provider's wire protocol. */
export interface ModelRequest {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  messages: ChatMessage[];
  tools?: LLMToolDef[];
  inputImages?: ModelImage[];
  signal?: AbortSignal;
}

export interface ModelResult {
  content: string;
  toolCalls: LLMToolCall[];
}

export type ModelApiKind = 'openai' | 'anthropic';

/**
 * The seam between X and a model provider. Each adapter owns one wire protocol; usage accounting
 * and budget enforcement happen inside the shared fetch path, so adapters only shape requests and
 * parse responses.
 */
export interface ModelAdapter {
  readonly kind: ModelApiKind;
  describe(request: Pick<ModelRequest, 'providerId' | 'modelId'>): ModelInfo;
  complete(request: ModelRequest): Promise<ModelResult>;
  /** Streams visible text through `onChunk`; resolves with the full result once the model stops. */
  stream(request: ModelRequest, onChunk: (chunk: string) => void): Promise<ModelResult>;
}
