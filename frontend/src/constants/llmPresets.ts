import type { LLMModality, LLMSystemConfig, LLMProviderConfig, ModalityModelSelection } from '@shared/index';

const STORAGE_KEY = 'x-computer-llm-config';
const SECRETS_KEY = 'x-computer-llm-secrets';
const IMPORTED_MODELS_KEY = 'x-computer-llm-imported-models';

/** 预设提供商 ID（参考 OpenClaw / OpenCode） */
export const BUILTIN_PROVIDER_IDS = [
  'openai', 'anthropic', 'openrouter', 'deepseek', 'moonshot',
  'alibaba', 'zhipu', 'volcengine', 'ollama', 'custom',
] as const;

/** 预设提供商显示名与默认 baseUrl */
export const PROVIDER_META: Record<string, { name: string; baseUrl?: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  moonshot: { name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  alibaba: { name: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  volcengine: { name: '火山方舟 (豆包)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  ollama: { name: '本地 Ollama', baseUrl: 'http://localhost:11434/v1' },
  custom: { name: '自定义', baseUrl: '' },
};

/** 各提供商在各模态下的预置模型列表（参考 OpenClaw、OpenCode） */
export const MODELS_BY_PROVIDER_AND_MODALITY: Record<string, Partial<Record<LLMModality, { id: string; label: string }[]>>> = {
  openai: {
    chat: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'gpt-4o-audio-preview', label: 'GPT-4o Audio' },
      { id: 'o1', label: 'o1' },
      { id: 'o1-mini', label: 'o1 Mini' },
    ],
    text: [
      { id: 'gpt-4o', label: 'GPT-4o (128K)' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { id: 'o1', label: 'o1 (长推理)' },
    ],
    video: [],
    image: [
      { id: 'dall-e-3', label: 'DALL·E 3' },
      { id: 'dall-e-2', label: 'DALL·E 2' },
    ],
    image_edit: [{ id: 'dall-e-2', label: 'DALL·E 2 编辑' }],
    vector: [
      { id: 'text-embedding-3-small', label: 'text-embedding-3-small' },
      { id: 'text-embedding-3-large', label: 'text-embedding-3-large' },
    ],
  },
  anthropic: {
    chat: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    ],
    text: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (200K)' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    ],
    video: [],
    image: [],
    image_edit: [],
    vector: [],
  },
  openrouter: {
    chat: [
      { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'deepseek/deepseek-chat-v3.5', label: 'DeepSeek Chat V3.5' },
      { id: 'moonshotai/kimi-k2', label: 'Kimi K2' },
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    ],
    text: [
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
    ],
    video: [],
    image: [],
    image_edit: [],
    vector: [],
  },
  deepseek: {
    chat: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1 (推理)' },
      { id: 'deepseek-coder', label: 'DeepSeek Coder' },
    ],
    text: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat (128K)' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ],
    video: [],
    image: [],
    image_edit: [],
    vector: [],
  },
  moonshot: {
    chat: [
      { id: 'kimi-k2.5', label: 'Kimi K2.5' },
      { id: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo' },
      { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
      { id: 'moonshot-v1-8k', label: 'Kimi 8K (旧)' },
      { id: 'moonshot-v1-128k', label: 'Kimi 128K (旧)' },
    ],
    text: [
      { id: 'kimi-k2.5', label: 'Kimi K2.5 (256K)' },
      { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
    ],
    video: [],
    image: [],
    image_edit: [],
    vector: [],
  },
  alibaba: {
    chat: [
      { id: 'qwen-plus', label: '通义千问 Plus' },
      { id: 'qwen-turbo', label: '通义千问 Turbo' },
      { id: 'qwen-max', label: '通义千问 Max' },
      { id: 'qwen-max-longcontext', label: '通义千问 Max 长文本' },
    ],
    text: [
      { id: 'qwen-max-longcontext', label: '通义千问 Max 长文本' },
      { id: 'qwen-plus', label: '通义千问 Plus' },
    ],
    video: [],
    image: [],
    image_edit: [],
    vector: [{ id: 'text-embedding-v3', label: '通义 Embedding V3' }],
  },
  zhipu: {
    chat: [
      { id: 'glm-4-plus', label: 'GLM-4 Plus' },
      { id: 'glm-4-flash', label: 'GLM-4 Flash' },
      { id: 'glm-4-long', label: 'GLM-4 长文本' },
    ],
    text: [
      { id: 'glm-4-long', label: 'GLM-4 长文本' },
      { id: 'glm-4-plus', label: 'GLM-4 Plus' },
    ],
    video: [],
    image: [],
    image_edit: [],
    vector: [],
  },
  volcengine: {
    chat: [
      { id: 'doubao-1-5-pro-32k-250115', label: '豆包 1.5 Pro 32K' },
      { id: 'doubao-1-5-lite-32k-250115', label: '豆包 1.5 Lite 32K' },
      { id: 'doubao-seed-1-6-flash-250828', label: '豆包 Seed 1.6 Flash' },
      { id: 'deepseek-r1-250528', label: 'DeepSeek R1' },
      { id: 'deepseek-v3-250324', label: 'DeepSeek V3' },
      { id: 'kimi-k2-250905', label: 'Kimi K2' },
      { id: 'glm-4-7-251222', label: 'GLM-4-7' },
    ],
    text: [
      { id: 'doubao-1-5-pro-256k-250115', label: '豆包 1.5 Pro 256K' },
      { id: 'doubao-1-5-pro-32k-250115', label: '豆包 1.5 Pro 32K' },
      { id: 'deepseek-r1-250528', label: 'DeepSeek R1' },
      { id: 'deepseek-v3-250324', label: 'DeepSeek V3' },
    ],
    video: [],
    image: [
      { id: 'doubao-seedream-4-0-250828', label: '豆包 Seedream 4.0' },
      { id: 'doubao-seedream-3-0-t2i-250415', label: '豆包 Seedream 3.0 文生图' },
    ],
    image_edit: [{ id: 'doubao-seededit-3-0-i2i-250628', label: '豆包 Seededit 3.0 图生图' }],
    vector: [
      { id: 'doubao-embedding-large-text-250515', label: '豆包 Embedding Large' },
    ],
  },
  ollama: {
    chat: [
      { id: 'llama3.2', label: 'Llama 3.2' },
      { id: 'qwen2.5', label: 'Qwen 2.5' },
      { id: 'deepseek-r1', label: 'DeepSeek R1' },
      { id: 'llava', label: 'LLaVA (多模态)' },
    ],
    text: [
      { id: 'qwen2.5', label: 'Qwen 2.5' },
      { id: 'deepseek-r1', label: 'DeepSeek R1' },
    ],
    video: [],
    image: [{ id: 'llava', label: 'LLaVA' }],
    image_edit: [],
    vector: [{ id: 'nomic-embed-text', label: 'Nomic Embed Text' }],
  },
  custom: { chat: [], text: [], video: [], image: [], image_edit: [], vector: [] },
};

/** 各模态显示名 */
export const MODALITY_LABELS: Record<LLMModality, string> = {
  chat: '聊天 / 对话',
  text: '长文本',
  video: '视频理解',
  image: '文生图',
  image_edit: '图生图 / 图像编辑',
  vector: '向量嵌入',
};

function defaultSelection(providerId: string, modality: LLMModality): ModalityModelSelection {
  const list = MODELS_BY_PROVIDER_AND_MODALITY[providerId]?.[modality];
  const modelId = list?.length ? list[0].id : '__custom__';
  return { providerId, modelId };
}

function getDefaultConfig(): LLMSystemConfig {
  const providerId = 'openai';
  return {
    providers: [
      { id: 'openai', name: PROVIDER_META.openai.name, baseUrl: PROVIDER_META.openai.baseUrl, apiKeyConfigured: false },
    ],
    defaultByModality: {
      chat: defaultSelection(providerId, 'chat'),
      text: defaultSelection(providerId, 'text'),
      video: defaultSelection(providerId, 'video'),
      image: defaultSelection(providerId, 'image'),
      image_edit: defaultSelection(providerId, 'image_edit'),
      vector: defaultSelection(providerId, 'vector'),
    },
  };
}

function loadFromStorage(): LLMSystemConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultConfig();
    const parsed = JSON.parse(raw) as LLMSystemConfig;
    if (parsed.providers?.length && parsed.defaultByModality) {
      const mod = parsed.defaultByModality as Record<string, ModalityModelSelection>;
      if (!('image_edit' in mod) || mod.image_edit == null) {
        const firstId = parsed.providers[0]?.id ?? 'openai';
        mod.image_edit = mod.image ?? defaultSelection(firstId, 'image_edit');
      }
      return parsed as LLMSystemConfig;
    }
  } catch {
    // ignore
  }
  return getDefaultConfig();
}

function saveToStorage(config: LLMSystemConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function loadSecrets(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SECRETS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveSecrets(secrets: Record<string, string>): void {
  try {
    localStorage.setItem(SECRETS_KEY, JSON.stringify(secrets));
  } catch {
    // ignore
  }
}

export const DEFAULT_LLM_CONFIG = getDefaultConfig();
export { loadFromStorage, saveToStorage, saveSecrets, STORAGE_KEY, SECRETS_KEY };

// ── 从 API 导入的模型列表（按提供商存储）────────────────────────

export interface ImportedModel {
  id: string;
  name?: string;
}

export type ImportedModelsByProvider = Record<string, ImportedModel[]>;

export function loadImportedModels(): ImportedModelsByProvider {
  try {
    const raw = localStorage.getItem(IMPORTED_MODELS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ImportedModelsByProvider;
  } catch {
    return {};
  }
}

export function saveImportedModels(data: ImportedModelsByProvider): void {
  try {
    localStorage.setItem(IMPORTED_MODELS_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

/** 请求提供商 /models 或 /v1/models 路径获取模型列表（OpenAI 兼容） */
export async function fetchModelsFromProvider(
  baseUrl: string,
  apiKey?: string
): Promise<ImportedModel[]> {
  const base = (baseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('请先填写 Base URL');
  // 已含版本路径（如 /v3、/v2）时只请求 /models，避免 .../v3/v1/models 报错（如火山方舟）
  const hasVersionPath = /\/(v\d+)(\/|$)/.test(base);
  const urlsToTry = hasVersionPath ? [base + '/models'] : [base + '/models', base + '/v1/models'];
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  let lastErr: Error | null = null;
  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) {
        lastErr = new Error(`${url}: ${res.status}`);
        continue;
      }
      const json = (await res.json()) as unknown[] | { data?: unknown[] };
      const list: unknown[] = Array.isArray(json) ? json : (json?.data ?? []);
      if (!Array.isArray(list)) {
        lastErr = new Error('响应格式不是数组或 { data: [] }');
        continue;
      }
      return list.map((m: unknown) => {
        const x = m as { id?: string; name?: string };
        return { id: x?.id ?? String(m), name: typeof x?.name === 'string' ? x.name : undefined };
      });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error('无法获取模型列表');
}
