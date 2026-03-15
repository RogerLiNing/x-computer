/**
 * Chat service — calls configured LLM (OpenAI-compatible or Anthropic) for assistant replies.
 * Used by POST /api/chat; credentials come from frontend request (not stored on server).
 */
import { serverLogger } from '../observability/ServerLogger.js';

/** 支持 assistant 带 tool_calls、tool 结果消息（用于 Agent 循环） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息中的工具调用（用于多轮 tool 对话） */
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** role 为 tool 时必填，对应 tool_calls[].id */
  tool_call_id?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

/** OpenAI-style tool definition for function calling */
export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Parsed tool call from model response（含 id 用于回传 tool 结果） */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMWithToolsResult {
  content: string;
  toolCalls: LLMToolCall[];
}

/** 部分 API（如阿里 DashScope）必须带 model；当 modelId 为 __custom__ 或空时按 base 回退默认模型 */
function effectiveModelForRequest(modelId: string, effectiveBase: string): string | undefined {
  if (modelId && modelId !== '__custom__') return modelId;
  const base = (effectiveBase || '').toLowerCase();
  if (base.includes('dashscope.aliyuncs.com')) return 'qwen-plus';
  return undefined;
}

/** 图片生成结果（OpenRouter/OpenAI 兼容：extra_body.modalities = ["image"]，响应中 message.images） */
export interface GenerateImageResult {
  content: string;
  images: string[];
}

/**
 * Call the configured LLM and return the assistant reply text.
 * 仅对 Anthropic 走专用 API，其余一律按 OpenAI 兼容接口调用（不限制提供商）。
 * @throws Error with message suitable for frontend if request fails
 */
export async function callLLM(req: ChatRequest): Promise<string> {
  const { messages, providerId, modelId, baseUrl, apiKey } = req;

  if (!messages.length) throw new Error('messages 不能为空');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('需要至少一条用户消息');

  const effectiveBase = (baseUrl || '').replace(/\/$/, '');
  const key = (apiKey || '').trim();

  if (providerId === 'anthropic') {
    return callAnthropic({ effectiveBase, modelId, apiKey: key, messages });
  }

  return callOpenAICompatible({ effectiveBase, modelId, apiKey: key, messages });
}

/**
 * Call the configured LLM with optional tools (function calling).
 * When the model returns tool_calls (e.g. file_write), they are parsed and returned for the caller to execute.
 * Only OpenAI-compatible providers support tools; Anthropic returns content only and toolCalls: [].
 */
export async function callLLMWithTools(req: ChatRequest, tools: LLMToolDef[]): Promise<LLMWithToolsResult> {
  const { messages, providerId, modelId, baseUrl, apiKey } = req;

  if (!messages.length) throw new Error('messages 不能为空');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('需要至少一条用户消息');

  const effectiveBase = (baseUrl || '').replace(/\/$/, '');
  const key = (apiKey || '').trim();

  if (providerId === 'anthropic' || tools.length === 0) {
    const content = await callLLM(req);
    return { content, toolCalls: [] };
  }

  return callOpenAICompatibleWithTools({
    effectiveBase,
    modelId,
    apiKey: key,
    messages,
    tools,
  });
}

/**
 * Call LLM with tools, streaming content chunks via onChunk. Returns final content and toolCalls.
 * When provider is Anthropic or tools empty, falls back to non-streaming.
 */
export async function callLLMWithToolsStream(
  req: ChatRequest,
  tools: LLMToolDef[],
  onChunk: (chunk: string) => void,
): Promise<LLMWithToolsResult> {
  if (req.providerId === 'anthropic' || tools.length === 0) {
    const result = await callLLMWithTools(req, tools);
    if (result.content) onChunk(result.content);
    return result;
  }
  return streamOpenAICompatibleWithTools(
    {
      effectiveBase: (req.baseUrl || '').replace(/\/$/, ''),
      modelId: req.modelId,
      apiKey: (req.apiKey || '').trim(),
      messages: req.messages,
      tools,
    },
    onChunk,
  );
}

/**
 * Stream the LLM response; yields content chunks.
 * @throws Error with message suitable for frontend if request fails
 */
export async function* callLLMStream(req: ChatRequest): AsyncGenerator<string> {
  const { messages, providerId, modelId, baseUrl, apiKey } = req;

  if (!messages.length) throw new Error('messages 不能为空');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('需要至少一条用户消息');

  const effectiveBase = (baseUrl || '').replace(/\/$/, '');
  const key = (apiKey || '').trim();

  if (providerId === 'anthropic') {
    yield* streamAnthropic({ effectiveBase, modelId, apiKey: key, messages });
    return;
  }

  yield* streamOpenAICompatible({ effectiveBase, modelId, apiKey: key, messages });
}

/**
 * Call an image-generation model (OpenRouter/OpenAI compatible with modalities: ["image"]).
 * Request body includes extra_body: { modalities: ["image"] }; response message may have .images array.
 * @returns { content, images } where images are data URLs (e.g. data:image/png;base64,...)
 */
/** 图片生成可选的参考图（data URL 或 http(s) URL），1–3 张时走 DashScope 图像编辑 API 以保持人物一致 */
export type GenerateImageOptions = { referenceImageUrls?: string[] };

export async function callLLMGenerateImage(
  req: ChatRequest & GenerateImageOptions,
): Promise<GenerateImageResult> {
  const { messages, providerId, modelId, baseUrl, apiKey, referenceImageUrls } = req;
  if (!messages.length) throw new Error('messages 不能为空');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('需要至少一条用户消息');

  const effectiveBase = (baseUrl || '').replace(/\/$/, '');
  const key = (apiKey || '').trim();
  if (providerId === 'anthropic') {
    throw new Error('图片生成当前仅支持 OpenAI 兼容接口（如 OpenRouter）或阿里 DashScope，请选用支持 image 模态的提供商');
  }

  const refs = referenceImageUrls?.filter((u) => typeof u === 'string' && u.length > 0) ?? [];
  if (effectiveBase.includes('dashscope.aliyuncs.com')) {
    if (refs.length >= 1 && refs.length <= 3) {
      return callDashScopeImageEdit({
        baseUrl: effectiveBase,
        modelId,
        apiKey: key,
        prompt: typeof lastUser.content === 'string' ? lastUser.content : '',
        referenceImages: refs,
      });
    }
    // 无参考图时：若为文生图异步模型（千问/万相）则走 text2image/image-synthesis；否则走 multimodal-generation
    const effectiveModel = (modelId && modelId !== '__custom__' ? modelId : 'wan2.6-image').toLowerCase();
    const { DASHSCOPE_TEXT2IMAGE_MODELS, callDashScopeText2Image } = await import('../image/dashscopeText2Image.js');
    if (key && DASHSCOPE_TEXT2IMAGE_MODELS.has(effectiveModel)) {
      const promptText = typeof lastUser.content === 'string' ? lastUser.content.trim() : '';
      if (!promptText) throw new Error('图片描述不能为空');
      const { images } = await callDashScopeText2Image(key, {
        model: effectiveModel,
        input: { prompt: promptText.slice(0, 2000) },
        parameters: { size: '1664*928', n: 1, prompt_extend: true, watermark: false },
      });
      return { content: '', images };
    }
    return callDashScopeGenerateImage({
      baseUrl: effectiveBase,
      modelId,
      apiKey: key,
      prompt: typeof lastUser.content === 'string' ? lastUser.content : '',
    });
  }

  return callOpenAICompatibleGenerateImage({
    effectiveBase,
    modelId,
    apiKey: key,
    messages,
  });
}

/** 阿里 DashScope 文生图：multimodal-generation/generation，content 须为 [{ text: "..." }] */
async function callDashScopeGenerateImage(opts: {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  prompt: string;
}): Promise<GenerateImageResult> {
  const { baseUrl, modelId, apiKey, prompt } = opts;
  const promptText = prompt.trim().slice(0, IMAGE_PROMPT_MAX_LENGTH);
  if (!promptText) throw new Error('图片描述不能为空');

  let host: string;
  try {
    host = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).hostname;
  } catch {
    host = 'dashscope.aliyuncs.com';
  }
  const imageUrl = `https://${host}/api/v1/services/aigc/multimodal-generation/generation`;
  const effectiveModel = modelId && modelId !== '__custom__' ? modelId : 'wan2.6-image';

  const body = {
    model: effectiveModel,
    input: {
      messages: [
        {
          role: 'user',
          content: [{ text: promptText }],
        },
      ],
    },
    parameters: {
      negative_prompt:
        '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲。',
      prompt_extend: true,
      watermark: false,
      size: '1280*720',
    },
  };

  const res = await fetch(imageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg = (data?.message as string) ?? (data?.code as string) ?? res.statusText;
    throw new Error(String(errMsg || `请求失败: ${res.status}`));
  }

  const choices = (data?.output as Record<string, unknown>)?.choices as Array<{
    message?: { content?: Array<{ type?: string; image?: string }> };
  }> | undefined;
  const contentArr = choices?.[0]?.message?.content;
  const images: string[] = [];
  if (Array.isArray(contentArr)) {
    for (const item of contentArr) {
      // DashScope 响应：content 数组元素可能只有 image 字段，或同时有 type 和 image
      const imageUrl = item?.image;
      if (typeof imageUrl === 'string' && imageUrl) {
        // 如果有 type 字段，只取 type === 'image' 的；否则只要有 image 字段就取
        if (!item.type || item.type === 'image') {
          images.push(imageUrl);
        }
      }
    }
  }
  return { content: '', images };
}

/** 阿里 DashScope 图像编辑（多图输入 + 文本指令）：千问图像编辑模型，1–3 张参考图 + 编辑指令，保持人物一致等 */
async function callDashScopeImageEdit(opts: {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  prompt: string;
  referenceImages: string[];
}): Promise<GenerateImageResult> {
  const { baseUrl, modelId, apiKey, prompt, referenceImages } = opts;
  const promptText = prompt.trim().slice(0, IMAGE_PROMPT_MAX_LENGTH);
  if (!promptText) throw new Error('编辑指令不能为空');
  if (referenceImages.length < 1 || referenceImages.length > 3) {
    throw new Error('参考图数量须为 1–3 张');
  }

  let host: string;
  try {
    host = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).hostname;
  } catch {
    host = 'dashscope.aliyuncs.com';
  }
  const imageUrl = `https://${host}/api/v1/services/aigc/multimodal-generation/generation`;
  const effectiveModel =
    modelId && modelId !== '__custom__' ? modelId : 'qwen-image-edit-max';

  const content: Array<{ image: string } | { text: string }> = [
    ...referenceImages.map((url) => ({ image: url })),
    { text: promptText },
  ];

  const body = {
    model: effectiveModel,
    input: {
      messages: [{ role: 'user', content }],
    },
    parameters: {
      n: 1,
      negative_prompt:
        '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲。',
      prompt_extend: true,
      watermark: false,
      size: '1280*720',
    },
  };

  const res = await fetch(imageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg = (data?.message as string) ?? (data?.code as string) ?? res.statusText;
    throw new Error(String(errMsg || `请求失败: ${res.status}`));
  }

  const choices = (data?.output as Record<string, unknown>)?.choices as Array<{
    message?: { content?: Array<{ type?: string; image?: string }> };
  }> | undefined;
  const contentArr = choices?.[0]?.message?.content;
  const images: string[] = [];
  if (Array.isArray(contentArr)) {
    for (const item of contentArr) {
      const imageUrlVal = item?.image;
      if (typeof imageUrlVal === 'string' && imageUrlVal) {
        if (!item.type || item.type === 'image') images.push(imageUrlVal);
      }
    }
  }
  return { content: '', images };
}

/** 多数图像 API 对 prompt 有长度上限，超出会报 content length invalid；此处限制字符数 */
const IMAGE_PROMPT_MAX_LENGTH = 2000;

async function callOpenAICompatibleGenerateImage(opts: {
  effectiveBase: string;
  modelId: string;
  apiKey: string;
  messages: ChatMessage[];
}): Promise<GenerateImageResult> {
  const { effectiveBase, modelId, apiKey, messages } = opts;
  if (!effectiveBase) throw new Error('请配置该提供商的 Base URL');
  const url = `${effectiveBase}/chat/completions`;
  const truncatedMessages = messages.map((m) => {
    const content = typeof m.content === 'string' ? m.content : '';
    const truncated =
      content.length > IMAGE_PROMPT_MAX_LENGTH ? content.slice(0, IMAGE_PROMPT_MAX_LENGTH) : content;
    return { role: m.role, content: truncated };
  });
  const body: Record<string, unknown> = {
    model: effectiveModelForRequest(modelId, effectiveBase),
    messages: truncatedMessages,
    max_tokens: 1024,
    modalities: ['image', 'text'],
  };
  if (body.model === undefined) delete body.model;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg = (data?.error as { message?: string })?.message ?? (data?.message as string) ?? res.statusText;
    throw new Error(errMsg || `请求失败: ${res.status}`);
  }

  const msg = (data?.choices as Array<{ message?: Record<string, unknown> }>)?.[0]?.message;
  if (!msg) throw new Error('模型未返回有效回复');

  const content = typeof msg.content === 'string' ? msg.content : '';
  const rawImages = msg.images as Array<{ image_url?: { url?: string } }> | undefined;
  const images: string[] = [];
  if (Array.isArray(rawImages)) {
    for (const img of rawImages) {
      const urlVal = img?.image_url?.url;
      if (typeof urlVal === 'string' && (urlVal.startsWith('data:') || urlVal.startsWith('http'))) {
        images.push(urlVal);
      }
    }
  }
  return { content, images };
}

async function callOpenAICompatible(opts: {
  effectiveBase: string;
  modelId: string;
  apiKey: string;
  messages: ChatMessage[];
}): Promise<string> {
  const { effectiveBase, modelId, apiKey, messages } = opts;
  if (!effectiveBase) throw new Error('请配置该提供商的 Base URL');
  const url = `${effectiveBase}/chat/completions`;
  const body = {
    model: effectiveModelForRequest(modelId, effectiveBase),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: 1024,
  };
  if (body.model === undefined) delete (body as any).model;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
      throw new Error('无法连接 LLM 服务，请检查 Base URL 与网络', { cause: e });
    }
    throw e;
  }

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.message || res.statusText;
    throw new Error(errMsg || `请求失败: ${res.status}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('模型未返回有效回复');
  return content;
}

async function callOpenAICompatibleWithTools(opts: {
  effectiveBase: string;
  modelId: string;
  apiKey: string;
  messages: ChatMessage[];
  tools: LLMToolDef[];
}): Promise<LLMWithToolsResult> {
  const { effectiveBase, modelId, apiKey, messages, tools } = opts;
  if (!effectiveBase) throw new Error('请配置该提供商的 Base URL');
  const url = `${effectiveBase}/chat/completions`;
  const toolsBody = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
  const apiMessages = messages.map((m) => {
    if (m.role === 'tool' && m.tool_call_id != null) {
      return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id };
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return {
        role: 'assistant' as const,
        content: m.content || '',
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        })),
      };
    }
    return { role: m.role, content: m.content || '' };
  });

  const body = {
    model: effectiveModelForRequest(modelId, effectiveBase),
    messages: apiMessages,
    max_tokens: 4096,
    tools: toolsBody,
    tool_choice: 'auto' as const,
  };
  if (body.model === undefined) delete (body as any).model;

  const systemMsg = apiMessages.find((m) => m.role === 'system');
  const systemLen = typeof systemMsg?.content === 'string' ? systemMsg.content.length : 0;
  serverLogger.info(
    'llm/request',
    `POST ${url} messages=${apiMessages.length} tools=[${tools.map((t) => t.name).join(', ')}] systemPromptLen=${systemLen}`,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
      throw new Error('无法连接 LLM 服务，请检查 Base URL 与网络', { cause: e });
    }
    throw e;
  }

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.message || res.statusText;
    throw new Error(errMsg || `请求失败: ${res.status}`);
  }

  const msg = data?.choices?.[0]?.message;
  if (!msg) throw new Error('模型未返回有效回复');
  const content = msg.content;
  const text = typeof content === 'string' ? content : '';
  const rawToolCalls = msg.tool_calls || [];
  const toolCalls: LLMToolCall[] = [];
  for (const tc of rawToolCalls) {
    const fn = tc?.function;
    if (!fn || fn.name === undefined) continue;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === 'string') {
      try {
        args = JSON.parse(fn.arguments) as Record<string, unknown>;
      } catch {
        // ignore invalid JSON
      }
    }
    const id = typeof tc.id === 'string' ? tc.id : `call_${toolCalls.length}`;
    toolCalls.push({ id, name: fn.name, arguments: args });
  }
  return { content: text, toolCalls };
}

async function streamOpenAICompatibleWithTools(
  opts: {
    effectiveBase: string;
    modelId: string;
    apiKey: string;
    messages: ChatMessage[];
    tools: LLMToolDef[];
  },
  onChunk: (chunk: string) => void,
): Promise<LLMWithToolsResult> {
  const { effectiveBase, modelId, apiKey, messages, tools } = opts;
  if (!effectiveBase) throw new Error('请配置该提供商的 Base URL');
  const url = `${effectiveBase}/chat/completions`;
  const toolsBody = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
  const apiMessages = messages.map((m) => {
    if (m.role === 'tool' && m.tool_call_id != null) {
      return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id };
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return {
        role: 'assistant' as const,
        content: m.content || '',
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        })),
      };
    }
    return { role: m.role, content: m.content || '' };
  });
  const body = {
    model: effectiveModelForRequest(modelId, effectiveBase),
    messages: apiMessages,
    max_tokens: 4096,
    stream: true as const,
    tools: toolsBody,
    tool_choice: 'auto' as const,
  };
  if (body.model === undefined) delete (body as any).model;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e: unknown) {
    const err = e as { message?: string; cause?: { code?: string; message?: string } };
    const causeCode = err?.cause && typeof err.cause === 'object' && 'code' in err.cause ? (err.cause as { code?: string }).code : undefined;
    const causeMsg = err?.cause && typeof err.cause === 'object' && 'message' in err.cause ? (err.cause as { message?: string }).message : undefined;
    serverLogger.error(
      'chat/agent/stream',
      `fetch failed: ${err?.message ?? e}${causeCode ? ` (cause: ${causeCode}${causeMsg ? ` - ${causeMsg}` : ''})` : ''}`,
    );
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(err?.message ?? '')) {
      throw new Error('无法连接 LLM 服务，请检查 Base URL 与网络', { cause: e });
    }
    throw e;
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as any;
    throw new Error(data?.error?.message || data?.message || res.statusText || `请求失败: ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCallsAccum: Array<{ id: string; name: string; args: string }> = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as any;
          const delta = parsed?.choices?.[0]?.delta;
          if (!delta) continue;
          const text = delta.content;
          if (typeof text === 'string') {
            content += text;
            onChunk(text);
          }
          const rawTc = delta.tool_calls;
          if (Array.isArray(rawTc)) {
            for (const tc of rawTc) {
              const idx = tc.index ?? 0;
              while (toolCallsAccum.length <= idx) {
                toolCallsAccum.push({ id: '', name: '', args: '' });
              }
              const acc = toolCallsAccum[idx]!;
              if (tc.id) acc.id = tc.id;
              const fn = tc.function;
              if (fn) {
                if (fn.name) acc.name = fn.name;
                if (fn.arguments) acc.args += fn.arguments;
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  const toolCalls: LLMToolCall[] = [];
  for (const acc of toolCallsAccum) {
    if (!acc.name) continue;
    let args: Record<string, unknown> = {};
    if (acc.args) {
      try {
        args = JSON.parse(acc.args) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
    toolCalls.push({
      id: acc.id || `call_${toolCalls.length}`,
      name: acc.name,
      arguments: args,
    });
  }
  return { content, toolCalls };
}

async function callAnthropic(opts: {
  effectiveBase: string;
  modelId: string;
  apiKey: string;
  messages: ChatMessage[];
}): Promise<string> {
  const { effectiveBase, modelId, apiKey, messages } = opts;
  const base = effectiveBase || 'https://api.anthropic.com';
  if (!apiKey) throw new Error('该提供商需要配置 API Key');

  const systemParts: string[] = [];
  const apiMessages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else {
      apiMessages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      });
    }
  }

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: 1024,
    messages: apiMessages,
  };
  if (systemParts.length) body.system = systemParts.join('\n\n');

  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const errMsg = data?.error?.message || data?.message || res.statusText;
    throw new Error(errMsg || `请求失败: ${res.status}`);
  }

  const content = data?.content?.[0]?.text;
  if (typeof content !== 'string') throw new Error('模型未返回有效回复');
  return content;
}

// ── Streaming (OpenAI-compatible) ─────────────────────────────

async function* streamOpenAICompatible(opts: {
  effectiveBase: string;
  modelId: string;
  apiKey: string;
  messages: ChatMessage[];
}): AsyncGenerator<string> {
  const { effectiveBase, modelId, apiKey, messages } = opts;
  if (!effectiveBase) throw new Error('请配置该提供商的 Base URL');
  const url = `${effectiveBase}/chat/completions`;
  const body = {
    model: effectiveModelForRequest(modelId, effectiveBase),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: 1024,
    stream: true,
  };
  if (body.model === undefined) delete (body as any).model;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
      throw new Error('无法连接 LLM 服务，请检查 Base URL 与网络', { cause: e });
    }
    throw e;
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as any;
    const errMsg = data?.error?.message || data?.message || res.statusText;
    throw new Error(errMsg || `请求失败: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as any;
            const content = parsed?.choices?.[0]?.delta?.content;
            if (typeof content === 'string') yield content;
          } catch {
            // ignore malformed line
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Streaming (Anthropic) ─────────────────────────────────────

async function* streamAnthropic(opts: {
  effectiveBase: string;
  modelId: string;
  apiKey: string;
  messages: ChatMessage[];
}): AsyncGenerator<string> {
  const { effectiveBase, modelId, apiKey, messages } = opts;
  const base = effectiveBase || 'https://api.anthropic.com';
  if (!apiKey) throw new Error('该提供商需要配置 API Key');

  const systemParts: string[] = [];
  const apiMessages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else {
      apiMessages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      });
    }
  }

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: 1024,
    messages: apiMessages,
    stream: true,
  };
  if (systemParts.length) body.system = systemParts.join('\n\n');

  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as any;
    const errMsg = data?.error?.message || data?.message || res.statusText;
    throw new Error(errMsg || `请求失败: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          try {
            const parsed = JSON.parse(data) as any;
            if (parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string') {
              yield parsed.delta.text;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
