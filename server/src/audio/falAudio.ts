/**
 * fal.ai queue API：音效（CassetteAI）与音乐（CassetteAI / MusicGen / Stable Audio）。
 * 使用 queue.fal.run：提交 → 轮询状态 → 取结果。
 */

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const SOUND_EFFECTS_MODEL = 'cassetteai/sound-effects-generator';

/** 从环境变量读取队列等待上限（毫秒），未设置则用默认值 */
function getQueueTimeoutMs(defaultMs: number): number {
  const env = process.env.FAL_QUEUE_TIMEOUT_MS?.trim();
  if (!env) return defaultMs;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

/** 可选音乐模型：cassetteai 较快、MusicGen/Stable Audio 质量更好 */
export const FAL_MUSIC_MODELS = [
  'cassetteai/music-generator',
  'fal-ai/musicgen',
  'fal-ai/stable-audio',
] as const;
export type FalMusicModelId = (typeof FAL_MUSIC_MODELS)[number];

export interface AudioApiConfig {
  falKey?: string;
  musicApiKey?: string;
  elevenLabsKey?: string;
  /** fal 音乐模型：cassetteai/music-generator | fal-ai/musicgen | fal-ai/stable-audio，默认 cassetteai */
  falMusicModel?: string;
  /** 为 true 且保存路径在 apps/ 下时，llm.generate_image 使用 fal FLUX 生成（游戏形象、图标等），与音效/音乐共用 FAL_KEY；其他场景用大模型配置的图像模态 */
  useFalForImage?: boolean;
}

export async function getAudioApiConfig(
  getConfig: ((userId: string, key: string) => string | undefined | Promise<string | undefined>) | undefined,
  userId: string | undefined,
): Promise<AudioApiConfig> {
  const fromEnv: AudioApiConfig = {
    falKey: process.env.FAL_KEY?.trim() || undefined,
    musicApiKey: process.env.MUSICAPI_KEY?.trim() || undefined,
    elevenLabsKey: process.env.ELEVENLABS_API_KEY?.trim() || undefined,
    falMusicModel: process.env.FAL_MUSIC_MODEL?.trim() || undefined,
    useFalForImage: process.env.FAL_USE_FOR_IMAGE === 'true' || undefined,
  };
  if (!userId || !getConfig) return fromEnv;
  const raw = getConfig(userId, 'audio_api_config');
  const value = raw instanceof Promise ? await raw : raw;
  if (!value) return fromEnv;
  try {
    const parsed = JSON.parse(value) as AudioApiConfig;
    return {
      falKey: parsed.falKey?.trim() || fromEnv.falKey,
      musicApiKey: parsed.musicApiKey?.trim() || fromEnv.musicApiKey,
      elevenLabsKey: parsed.elevenLabsKey?.trim() || fromEnv.elevenLabsKey,
      falMusicModel: parsed.falMusicModel?.trim() || fromEnv.falMusicModel,
      useFalForImage: parsed.useFalForImage ?? fromEnv.useFalForImage,
    };
  } catch {
    return fromEnv;
  }
}

async function falQueueSubmit(
  apiKey: string,
  modelId: string,
  input: Record<string, unknown>,
): Promise<{ request_id: string; response_url: string; status_url: string }> {
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
    throw new Error(`fal submit failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { request_id: string; response_url?: string; status_url?: string };
  if (!data.request_id) throw new Error('fal submit: no request_id');
  const status_url = data.status_url ?? `${FAL_QUEUE_BASE}/${modelId}/requests/${data.request_id}/status`;
  const response_url = data.response_url ?? `${FAL_QUEUE_BASE}/${modelId}/requests/${data.request_id}`;
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
    const statusRes = await fetch(statusUrl, { headers });
    if (!statusRes.ok) throw new Error(`fal status failed: ${statusRes.status}`);
    const statusData = (await statusRes.json()) as { status: string };
    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetch(responseUrl, { headers });
      if (!resultRes.ok) throw new Error(`fal result failed: ${resultRes.status}`);
      const resultData = (await resultRes.json()) as { response?: unknown };
      return resultData.response ?? resultData;
    }
    if (statusData.status === 'CANCELLED' || statusData.status === 'FAILED') {
      throw new Error(`fal job ${statusData.status}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('fal queue timeout');
}

/** 生成音效，返回音频文件 URL（WAV）。 */
export async function callFalSoundEffect(
  apiKey: string,
  prompt: string,
  durationSeconds: number,
): Promise<{ url: string }> {
  const clamped = Math.max(1, Math.min(30, Math.round(durationSeconds)));
  const { status_url, response_url } = await falQueueSubmit(apiKey, SOUND_EFFECTS_MODEL, {
    prompt: prompt.trim(),
    duration: clamped,
  });
  const timeoutMs = getQueueTimeoutMs(120_000);
  const response = (await falQueueWaitForResult(apiKey, status_url, response_url, timeoutMs)) as {
    audio_file?: { url?: string };
  };
  const url = response?.audio_file?.url;
  if (!url || typeof url !== 'string') throw new Error('fal sound effect: no audio_file.url');
  return { url };
}

/** 生成音乐，返回音频文件 URL。支持 cassetteai / fal-ai/musicgen / fal-ai/stable-audio */
export async function callFalMusic(
  apiKey: string,
  prompt: string,
  durationSeconds: number,
  modelId: string = 'cassetteai/music-generator',
): Promise<{ url: string }> {
  const clamped = Math.max(5, Math.min(180, Math.round(durationSeconds)));
  const normalizedModel = modelId?.trim() && FAL_MUSIC_MODELS.includes(modelId.trim() as FalMusicModelId)
    ? modelId.trim()
    : 'cassetteai/music-generator';

  let input: Record<string, unknown>;
  if (normalizedModel === 'fal-ai/stable-audio') {
    input = { prompt: prompt.trim(), seconds_total: clamped, steps: 100 };
  } else if (normalizedModel === 'fal-ai/musicgen') {
    input = { prompt: prompt.trim(), duration: clamped };
  } else {
    input = { prompt: prompt.trim(), duration: clamped };
  }

  const { status_url, response_url } = await falQueueSubmit(apiKey, normalizedModel, input);
  const timeoutMs = getQueueTimeoutMs(180_000);
  const response = (await falQueueWaitForResult(apiKey, status_url, response_url, timeoutMs)) as {
    audio_file?: { url?: string };
    audio_url?: { url?: string } | string;
  };

  const url =
    response?.audio_file?.url ??
    (typeof response?.audio_url === 'string' ? response.audio_url : response?.audio_url?.url);
  if (!url || typeof url !== 'string') throw new Error('fal music: no audio url in response');
  return { url };
}
