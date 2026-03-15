/**
 * 阿里云百炼 - 文生图（Text-to-Image）异步 API。
 * 千问（Qwen-Image）擅长复杂中英文文字渲染；万相（Wan）用于写实与摄影级效果。
 * API：创建任务 → 轮询 task_id 获取结果。
 * 文档：https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference
 */

const TEXT2IMAGE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const TASKS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks';

/** 支持异步文生图接口的模型（千问 / 万相） */
export const DASHSCOPE_TEXT2IMAGE_MODELS = new Set([
  'qwen-image-plus',
  'qwen-image',
  'wan2.2-t2i-flash',
  'wan2.6-t2i',
  'wan2.5-t2i-preview',
  'wanx2.0-t2i-turbo',
]);

export type DashScopeText2ImageModel = string;

export interface DashScopeText2ImageInput {
  prompt: string;
  negative_prompt?: string;
}

export interface DashScopeText2ImageParameters {
  /** 千问固定 5 种；万相 V2 支持 [512,1440] 内任意宽*高 */
  size?: string;
  /** 生成张数，默认 1 */
  n?: number;
  /** 是否智能改写短 prompt，默认 true */
  prompt_extend?: boolean;
  watermark?: boolean;
  negative_prompt?: string;
}

export interface Text2ImageTaskResult {
  task_id: string;
  task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
  results?: Array<{ url?: string; orig_prompt?: string; actual_prompt?: string }>;
  code?: string;
  message?: string;
}

/** 轮询超时（毫秒），默认 2 分钟 */
function getPollTimeoutMs(): number {
  const env = process.env.DASHSCOPE_TEXT2IMAGE_POLL_TIMEOUT_MS?.trim();
  if (!env) return 2 * 60 * 1000;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : 2 * 60 * 1000;
}

/** 创建文生图任务 */
async function createText2ImageTask(
  apiKey: string,
  model: string,
  input: DashScopeText2ImageInput,
  parameters?: DashScopeText2ImageParameters,
): Promise<{ task_id: string }> {
  const body = {
    model,
    input: {
      prompt: input.prompt.trim(),
      ...(input.negative_prompt != null && input.negative_prompt !== ''
        ? { negative_prompt: input.negative_prompt.trim() }
        : {}),
    },
    parameters: {
      negative_prompt: parameters?.negative_prompt ?? ' ',
      size: parameters?.size ?? '1664*928',
      n: parameters?.n ?? 1,
      prompt_extend: parameters?.prompt_extend ?? true,
      watermark: parameters?.watermark ?? false,
    },
  };

  const res = await fetch(TEXT2IMAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    output?: { task_id?: string };
    code?: string;
    message?: string;
  };

  if (!res.ok) {
    const msg = data?.message ?? data?.code ?? res.statusText;
    throw new Error(String(msg || `创建文生图任务失败: ${res.status}`));
  }

  const taskId = data?.output?.task_id;
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('创建文生图任务未返回 task_id');
  }
  return { task_id: taskId };
}

/** 根据 task_id 查询任务结果 */
async function getTaskResult(apiKey: string, taskId: string): Promise<Text2ImageTaskResult> {
  const url = `${TASKS_BASE_URL}/${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const data = (await res.json().catch(() => ({}))) as {
    output?: Text2ImageTaskResult;
    code?: string;
    message?: string;
  };

  if (!res.ok) {
    const msg = data?.message ?? data?.code ?? res.statusText;
    throw new Error(String(msg || `查询任务失败: ${res.status}`));
  }

  const output = data?.output;
  if (!output) throw new Error('查询任务无 output');
  return {
    task_id: output.task_id ?? taskId,
    task_status: (output.task_status as Text2ImageTaskResult['task_status']) ?? 'UNKNOWN',
    results: output.results,
    code: output.code,
    message: output.message,
  };
}

/** 轮询直到成功或失败，返回图片 URL 列表 */
async function pollUntilDone(
  apiKey: string,
  taskId: string,
  maxWaitMs: number,
  intervalMs: number = 3000,
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await getTaskResult(apiKey, taskId);
    if (result.task_status === 'SUCCEEDED') {
      const urls = (result.results ?? [])
        .map((r) => r?.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
      if (urls.length > 0) return urls;
      throw new Error('任务成功但未返回图片 URL');
    }
    if (result.task_status === 'FAILED' || result.task_status === 'CANCELED') {
      throw new Error(result.message || result.code || `任务状态: ${result.task_status}`);
    }
    if (result.task_status === 'UNKNOWN') {
      throw new Error('任务不存在或已过期（task_id 有效期为 24 小时）');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('文生图超时，请稍后在控制台用 task_id 查询');
}

/**
 * 调用百炼文生图（异步）：创建任务并轮询至完成，返回图片 URL 列表。
 * 需配置 DASHSCOPE_API_KEY；模型与 Endpoint 需同地域。
 */
export async function callDashScopeText2Image(
  apiKey: string,
  options: {
    model: string;
    input: DashScopeText2ImageInput;
    parameters?: DashScopeText2ImageParameters;
    pollTimeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<{ images: string[] }> {
  const { task_id } = await createText2ImageTask(
    apiKey,
    options.model,
    options.input,
    options.parameters,
  );
  const maxWait = options.pollTimeoutMs ?? getPollTimeoutMs();
  const interval = options.pollIntervalMs ?? 3000;
  const images = await pollUntilDone(apiKey, task_id, maxWait, interval);
  return { images };
}
