/**
 * fal.ai 文生图：FLUX.1 [schnell]，适合游戏形象、图标等。
 * @see https://fal.ai/models/fal-ai/flux/schnell/api
 */

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const FLUX_SCHNELL = 'fal-ai/flux/schnell';

function getQueueTimeoutMs(defaultMs: number): number {
  const env = process.env.FAL_QUEUE_TIMEOUT_MS?.trim();
  if (!env) return defaultMs;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

async function falQueueSubmit(
  apiKey: string,
  modelId: string,
  input: Record<string, unknown>,
): Promise<{ request_id: string; status_url: string; response_url: string }> {
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal image submit failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { request_id: string; status_url?: string; response_url?: string };
  if (!data.request_id) throw new Error('fal image submit: no request_id');
  // 子路径（如 /schnell）仅用于 POST，状态/结果用 base model（fal-ai/flux）
  const baseModel = modelId.split('/').slice(0, -1).join('/') || modelId;
  const status_url = data.status_url ?? `${FAL_QUEUE_BASE}/${baseModel}/requests/${data.request_id}/status`;
  const response_url = data.response_url ?? `${FAL_QUEUE_BASE}/${baseModel}/requests/${data.request_id}`;
  return { request_id: data.request_id, status_url, response_url };
}

async function falQueueWaitForResult(
  apiKey: string,
  statusUrl: string,
  responseUrl: string,
  maxWaitMs: number,
): Promise<unknown> {
  const headers = { Authorization: `Key ${apiKey}` };
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const statusRes = await fetch(statusUrl, { headers, method: 'GET' });
    if (!statusRes.ok) throw new Error(`fal image status failed: ${statusRes.status}`);
    const statusData = (await statusRes.json()) as { status: string };
    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetch(responseUrl, { headers, method: 'GET' });
      if (!resultRes.ok) throw new Error(`fal image result failed: ${resultRes.status}`);
      const resultData = (await resultRes.json()) as { response?: unknown };
      return resultData.response ?? resultData;
    }
    if (statusData.status === 'CANCELLED' || statusData.status === 'FAILED') {
      throw new Error(`fal image job ${statusData.status}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error('fal image queue timeout');
}

export interface CallFalImageOptions {
  /** 输出格式，默认 png 便于透明背景（游戏精灵等） */
  output_format?: 'png' | 'jpeg';
  /** 尺寸预设：square_hd, square, portrait_4_3, landscape_4_3 等，默认 landscape_4_3 */
  image_size?: string;
}

/**
 * 使用 fal FLUX.1 [schnell] 生成图片，返回图片 URL。
 * 适合游戏角色、图标、贴图等；prompt 可带风格如 "pixel art game character, top-down view"。
 */
export async function callFalImage(
  apiKey: string,
  prompt: string,
  options: CallFalImageOptions = {},
): Promise<{ url: string }> {
  const input: Record<string, unknown> = {
    prompt: prompt.trim(),
    output_format: options.output_format ?? 'png',
    image_size: options.image_size ?? 'landscape_4_3',
    num_images: 1,
  };
  const { request_id, status_url, response_url } = await falQueueSubmit(apiKey, FLUX_SCHNELL, input);
  const timeoutMs = getQueueTimeoutMs(120_000);
  const response = (await falQueueWaitForResult(apiKey, status_url, response_url, timeoutMs)) as {
    images?: Array<{ url?: string }>;
  };
  const url = response?.images?.[0]?.url;
  if (!url || typeof url !== 'string') throw new Error('fal image: no image url in response');
  return { url };
}
