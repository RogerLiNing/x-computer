/**
 * 调用 OpenAI 兼容的 /embeddings 接口，用于记忆向量化与召回检索。
 * 使用系统设置中的「向量嵌入」模型（defaultByModality.vector）。
 */

import { serverLogger } from '../observability/ServerLogger.js';

export interface EmbeddingConfig {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * 请求单条文本的 embedding 向量。
 * 不限制提供商，凡提供 OpenAI 兼容 /embeddings 的均可使用。
 * @returns 归一化后的向量，失败时抛出 Error
 */
export async function callEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  const { providerId, modelId, baseUrl = '', apiKey = '' } = config;
  const effectiveBase = baseUrl.replace(/\/$/, '');
  if (!effectiveBase && providerId !== 'anthropic') {
    throw new Error('请配置该提供商的 Base URL（向量嵌入）');
  }

  const url = `${effectiveBase}/embeddings`;
  const body: { model?: string; input: string; encoding_format?: string; provider?: { order: string[] } } = {
    input: text.slice(0, 8000),
    encoding_format: 'float',
  };
  if (modelId && modelId !== '__custom__') {
    body.model = modelId;
  }
  // 不注入 provider，与 OpenRouter 官方示例一致：https://openrouter.ai/openai/text-embedding-3-small/api

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  if (effectiveBase.includes('openrouter.ai')) {
    headers['Referer'] = 'https://openrouter.ai';
  }

  serverLogger.info(
    'memory/embed',
    `POST ${url}`,
    JSON.stringify({ model: body.model, encoding_format: body.encoding_format, provider: body.provider, inputLength: body.input.length }),
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
      throw new Error('无法连接嵌入服务，请检查 Base URL 与网络', { cause: e });
    }
    throw e;
  }

  const data = (await res.json().catch(() => ({}))) as any;
  const bodyError = typeof data?.error === 'string' ? data.error : data?.error?.message ?? data?.message;
  if (!res.ok) {
    throw new Error(bodyError || res.statusText || `嵌入请求失败: ${res.status}`);
  }
  if (bodyError) {
    const hint =
      /no successful provider|provider.*response/i.test(String(bodyError)) && effectiveBase.includes('openrouter')
        ? ' 若使用 OpenRouter，请确认选择的是嵌入模型（如 openai/text-embedding-3-small），而非聊天模型。'
        : '';
    throw new Error(bodyError + hint);
  }

  let embedding: number[] | undefined = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) && Array.isArray(data?.data) && data.data[0] && typeof data.data[0] === 'object') {
    const first = data.data[0] as Record<string, unknown>;
    embedding = first.embedding as number[] | undefined;
  }
  if (!Array.isArray(embedding) && Array.isArray(data?.data) && data.data.length > 0) {
    const first = data.data[0];
    if (Array.isArray(first)) embedding = first as number[];
  }
  if (!Array.isArray(embedding) && data?.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const single = data.data as Record<string, unknown>;
    embedding = single.embedding as number[] | undefined;
  }
  if (!Array.isArray(embedding) && Array.isArray(data?.embedding)) {
    embedding = data.embedding;
  }
  if (typeof embedding === 'string') {
    try {
      const decoded = Buffer.from(embedding, 'base64');
      const floats = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.length / 4);
      embedding = Array.from(floats);
    } catch {
      embedding = undefined;
    }
  }
  if (Array.isArray(embedding) && embedding.length > 0 && (typeof embedding[0] === 'string' || typeof embedding[0] !== 'number')) {
    embedding = embedding.map((x) => (typeof x === 'number' && !Number.isNaN(x) ? x : Number(x)));
    if (embedding.some((x) => Number.isNaN(x))) embedding = [];
  }
  if (!Array.isArray(embedding) || embedding.length === 0) {
    const hint = data?.error?.message || (typeof data?.data === 'string' ? data.data : '');
    const keys = data && typeof data === 'object' ? Object.keys(data).join(',') : '';
    const dataArr = data?.data;
    const dataHint = Array.isArray(dataArr)
      ? 'data.length=' +
        dataArr.length +
        (dataArr[0] != null && typeof dataArr[0] === 'object'
          ? ' data[0].keys=' + Object.keys(dataArr[0] as object).join(',')
          : '')
      : 'data.type=' + typeof dataArr;
    throw new Error(
      '嵌入接口未返回有效向量' + (hint ? ': ' + hint : '') + (keys ? ' 响应键=' + keys : '') + ' ' + dataHint,
    );
  }
  return embedding as number[];
}

const EMBEDDING_BATCH_MAX = 20;

/**
 * 批量请求 embedding（OpenAI 兼容接口支持 input 数组），减少重建索引时的请求次数。
 * 单次最多 EMBEDDING_BATCH_MAX 条；若某条失败则整批回退为逐条请求（由调用方处理）。
 */
export async function callEmbeddingBatch(
  texts: string[],
  config: EmbeddingConfig,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const trimmed = texts.map((t) => String(t ?? '').slice(0, 8000));
  const { providerId, modelId, baseUrl = '', apiKey = '' } = config;
  const effectiveBase = baseUrl.replace(/\/$/, '');
  if (!effectiveBase && providerId !== 'anthropic') {
    throw new Error('请配置该提供商的 Base URL（向量嵌入）');
  }

  const url = `${effectiveBase}/embeddings`;
  const body: { model?: string; input: string[]; encoding_format?: string } = {
    input: trimmed,
    encoding_format: 'float',
  };
  if (modelId && modelId !== '__custom__') {
    body.model = modelId;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  if (effectiveBase.includes('openrouter.ai')) {
    headers['Referer'] = 'https://openrouter.ai';
  }

  serverLogger.info(
    'memory/embed-batch',
    `POST ${url}`,
    JSON.stringify({ model: body.model, batchSize: trimmed.length }),
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(msg)) {
      throw new Error('无法连接嵌入服务，请检查 Base URL 与网络', { cause: e });
    }
    throw e;
  }

  const data = (await res.json().catch(() => ({}))) as { data?: Array<{ embedding?: number[] }>; error?: unknown };
  if (!res.ok) {
    const errMsg = typeof data?.error === 'string' ? data.error : (data?.error as Error)?.message ?? res.statusText;
    throw new Error(errMsg || `嵌入请求失败: ${res.status}`);
  }

  const list = Array.isArray(data?.data) ? data.data : [];
  const out: number[][] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const item = list[i];
    let vec = item?.embedding;
    if (!Array.isArray(vec) && item && typeof item === 'object') {
      vec = (item as Record<string, unknown>).embedding as number[] | undefined;
    }
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error(`嵌入接口未返回第 ${i + 1} 条有效向量`);
    }
    out.push(vec as number[]);
  }
  return out;
}
