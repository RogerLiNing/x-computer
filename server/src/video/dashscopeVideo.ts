/**
 * 阿里云百炼 - 万相视频生成（文生视频、图生视频-首帧、参考生视频）。
 * 统一端点 video-synthesis，异步：创建任务 → 轮询 task_id 获取结果。
 * 文档：文生视频 / 图生视频 / 参考生视频 API 参考
 */

const VIDEO_SYNTHESIS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
const TASKS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks';

export type DashScopeVideoModel = 'wan2.6-r2v-flash' | 'wan2.6-r2v';
/** 文生视频模型，如 wan2.6-t2v、wan2.5-t2v-preview、wan2.2-t2v-plus */
export type DashScopeT2VModel = string;
/** 图生视频（首帧）模型，如 wan2.6-i2v-flash、wan2.6-i2v、wan2.2-i2v-plus */
export type DashScopeI2VModel = string;

export interface DashScopeVideoInput {
  /** 文本提示词，描述生成视频中期望的元素与视觉；用 character1/character2 引用参考角色 */
  prompt: string;
  /** 参考文件 URL 数组（图像 0～5，视频 0～3，总数 ≤5）；顺序对应 character1, character2, ... */
  reference_urls: string[];
  /** 反向提示词，可选 */
  negative_prompt?: string;
}

export interface DashScopeVideoParameters {
  /** 分辨率，如 "1280*720"、"1920*1080"；必须为具体宽*高 */
  size?: string;
  /** 时长（秒），2～10，默认 5 */
  duration?: number;
  /** 是否生成有声视频（仅 wan2.6-r2v-flash） */
  audio?: boolean;
  /** single 单镜头 / multi 多镜头 */
  shot_type?: 'single' | 'multi';
  /** 是否添加「AI生成」水印 */
  watermark?: boolean;
  /** 随机种子，可选 */
  seed?: number;
}

export interface DashScopeVideoResult {
  task_id: string;
  task_status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
  video_url?: string;
  orig_prompt?: string;
  code?: string;
  message?: string;
}

/** 从环境变量读取轮询超时（毫秒），默认 5 分钟 */
function getPollTimeoutMs(): number {
  const env = process.env.DASHSCOPE_VIDEO_POLL_TIMEOUT_MS?.trim();
  if (!env) return 5 * 60 * 1000;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
}

/** 创建参考生视频任务，返回 task_id */
async function createVideoTask(
  apiKey: string,
  model: DashScopeVideoModel,
  input: DashScopeVideoInput,
  parameters?: DashScopeVideoParameters,
): Promise<{ task_id: string }> {
  const body = {
    model,
    input: {
      prompt: input.prompt.trim().slice(0, 1500),
      reference_urls: input.reference_urls,
      ...(input.negative_prompt != null && input.negative_prompt !== ''
        ? { negative_prompt: input.negative_prompt.trim().slice(0, 500) }
        : {}),
    },
    parameters: {
      size: parameters?.size ?? '1280*720',
      duration: parameters?.duration ?? 5,
      audio: parameters?.audio ?? true,
      shot_type: parameters?.shot_type ?? 'single',
      watermark: parameters?.watermark ?? false,
      ...(parameters?.seed != null ? { seed: parameters.seed } : {}),
    },
  };

  const res = await fetch(VIDEO_SYNTHESIS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    output?: { task_id?: string; task_status?: string };
    code?: string;
    message?: string;
  };

  if (!res.ok) {
    const msg = data?.message ?? data?.code ?? res.statusText;
    throw new Error(String(msg || `创建视频任务失败: ${res.status}`));
  }

  const taskId = data?.output?.task_id;
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('创建视频任务未返回 task_id');
  }
  return { task_id: taskId };
}

/** 根据 task_id 查询任务结果；成功时返回含 video_url 的结果 */
async function getTaskResult(apiKey: string, taskId: string): Promise<DashScopeVideoResult> {
  const url = `${TASKS_BASE_URL}/${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const data = (await res.json().catch(() => ({}))) as {
    output?: DashScopeVideoResult;
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
    task_status: (output.task_status as DashScopeVideoResult['task_status']) ?? 'UNKNOWN',
    video_url: output.video_url,
    orig_prompt: output.orig_prompt,
    code: output.code,
    message: output.message,
  };
}

/** 轮询直到任务完成或超时；成功返回 video_url */
async function pollUntilDone(
  apiKey: string,
  taskId: string,
  maxWaitMs: number,
  intervalMs: number = 15000,
): Promise<{ video_url: string; orig_prompt?: string }> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await getTaskResult(apiKey, taskId);
    if (result.task_status === 'SUCCEEDED') {
      if (result.video_url) return { video_url: result.video_url, orig_prompt: result.orig_prompt };
      throw new Error('任务成功但未返回 video_url');
    }
    if (result.task_status === 'FAILED' || result.task_status === 'CANCELED') {
      throw new Error(result.message || result.code || `任务状态: ${result.task_status}`);
    }
    if (result.task_status === 'UNKNOWN') {
      throw new Error('任务不存在或已过期（task_id 有效期为 24 小时）');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('视频生成超时，请稍后在控制台用 task_id 查询');
}

/**
 * 调用万相参考生视频：创建任务并轮询至完成，返回视频 URL。
 * 需配置环境变量 DASHSCOPE_API_KEY；模型与 Endpoint 需同地域。
 */
export async function callDashScopeReferenceToVideo(
  apiKey: string,
  options: {
    model?: DashScopeVideoModel;
    input: DashScopeVideoInput;
    parameters?: DashScopeVideoParameters;
    pollTimeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<{ video_url: string; orig_prompt?: string }> {
  const model = options.model ?? 'wan2.6-r2v-flash';
  const { task_id } = await createVideoTask(apiKey, model, options.input, options.parameters);
  const maxWait = options.pollTimeoutMs ?? getPollTimeoutMs();
  const interval = options.pollIntervalMs ?? 15000;
  return pollUntilDone(apiKey, task_id, maxWait, interval);
}

// ── 文生视频 (Text-to-Video) ─────────────────────────────────────────────

export interface DashScopeT2VInput {
  prompt: string;
  negative_prompt?: string;
  audio_url?: string;
}

export interface DashScopeT2VParameters {
  size?: string;
  duration?: number;
  prompt_extend?: boolean;
  shot_type?: 'single' | 'multi';
  watermark?: boolean;
  seed?: number;
}

async function createText2VideoTask(
  apiKey: string,
  model: string,
  input: DashScopeT2VInput,
  parameters?: DashScopeT2VParameters,
): Promise<{ task_id: string }> {
  const body = {
    model,
    input: {
      prompt: input.prompt.trim().slice(0, 1500),
      ...(input.negative_prompt != null && input.negative_prompt !== ''
        ? { negative_prompt: input.negative_prompt.trim().slice(0, 500) }
        : {}),
      ...(input.audio_url ? { audio_url: input.audio_url } : {}),
    },
    parameters: {
      size: parameters?.size ?? '1280*720',
      duration: parameters?.duration ?? 5,
      prompt_extend: parameters?.prompt_extend ?? true,
      shot_type: parameters?.shot_type ?? 'single',
      watermark: parameters?.watermark ?? false,
      ...(parameters?.seed != null ? { seed: parameters.seed } : {}),
    },
  };
  const res = await fetch(VIDEO_SYNTHESIS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { output?: { task_id?: string }; code?: string; message?: string };
  if (!res.ok) throw new Error(String(data?.message ?? data?.code ?? res.statusText));
  const taskId = data?.output?.task_id;
  if (!taskId || typeof taskId !== 'string') throw new Error('创建文生视频任务未返回 task_id');
  return { task_id: taskId };
}

/**
 * 文生视频：根据文本提示词生成视频（可选音频）。模型如 wan2.6-t2v、wan2.5-t2v-preview。
 */
export async function callDashScopeText2Video(
  apiKey: string,
  options: {
    model?: string;
    input: DashScopeT2VInput;
    parameters?: DashScopeT2VParameters;
    pollTimeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<{ video_url: string; orig_prompt?: string }> {
  const model = options.model ?? 'wan2.6-t2v';
  const { task_id } = await createText2VideoTask(apiKey, model, options.input, options.parameters);
  const maxWait = options.pollTimeoutMs ?? getPollTimeoutMs();
  return pollUntilDone(apiKey, task_id, maxWait, 15000);
}

// ── 图生视频-首帧 (Image-to-Video) ────────────────────────────────────────

export interface DashScopeI2VInput {
  prompt: string;
  img_url: string;
  negative_prompt?: string;
  audio_url?: string;
}

export interface DashScopeI2VParameters {
  /** 分辨率档位：480P、720P、1080P（图生视频 API 使用 resolution） */
  resolution?: string;
  duration?: number;
  prompt_extend?: boolean;
  shot_type?: 'single' | 'multi';
  audio?: boolean;
  watermark?: boolean;
  seed?: number;
}

async function createImage2VideoTask(
  apiKey: string,
  model: string,
  input: DashScopeI2VInput,
  parameters?: DashScopeI2VParameters,
): Promise<{ task_id: string }> {
  const body = {
    model,
    input: {
      prompt: input.prompt.trim().slice(0, 1500),
      img_url: input.img_url,
      ...(input.negative_prompt != null && input.negative_prompt !== ''
        ? { negative_prompt: input.negative_prompt.trim().slice(0, 500) }
        : {}),
      ...(input.audio_url ? { audio_url: input.audio_url } : {}),
    },
    parameters: {
      resolution: parameters?.resolution ?? '720P',
      duration: parameters?.duration ?? 5,
      prompt_extend: parameters?.prompt_extend ?? true,
      shot_type: parameters?.shot_type ?? 'single',
      audio: parameters?.audio ?? true,
      watermark: parameters?.watermark ?? false,
      ...(parameters?.seed != null ? { seed: parameters.seed } : {}),
    },
  };
  const res = await fetch(VIDEO_SYNTHESIS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { output?: { task_id?: string }; code?: string; message?: string };
  if (!res.ok) throw new Error(String(data?.message ?? data?.code ?? res.statusText));
  const taskId = data?.output?.task_id;
  if (!taskId || typeof taskId !== 'string') throw new Error('创建图生视频任务未返回 task_id');
  return { task_id: taskId };
}

/**
 * 图生视频（首帧）：根据首帧图像与文本提示词生成视频。模型如 wan2.6-i2v-flash、wan2.2-i2v-plus。
 */
export async function callDashScopeImage2Video(
  apiKey: string,
  options: {
    model?: string;
    input: DashScopeI2VInput;
    parameters?: DashScopeI2VParameters;
    pollTimeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<{ video_url: string; orig_prompt?: string }> {
  const model = options.model ?? 'wan2.6-i2v-flash';
  const { task_id } = await createImage2VideoTask(apiKey, model, options.input, options.parameters);
  const maxWait = options.pollTimeoutMs ?? getPollTimeoutMs();
  return pollUntilDone(apiKey, task_id, maxWait, 15000);
}
