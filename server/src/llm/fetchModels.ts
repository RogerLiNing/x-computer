import { boundedHttpRequest } from '../mcp/httpTransport.js';
/** 从提供商拉取的模型项（与前端 llmPresets 的 ImportedModel 一致） */
export interface ImportedModel {
  id: string;
  name?: string;
}

export class ModelImportError extends Error {}

const DEEPSEEK_ORIGIN = 'https://api.deepseek.com';

function isDeepSeekBase(base: string): boolean {
  const url = new URL(base);
  return url.origin === DEEPSEEK_ORIGIN && !url.username && !url.password && !url.search && !url.hash
    && /^\/(?:v1|anthropic(?:\/v1)?)?\/?$/.test(url.pathname);
}

/**
 * 请求提供商 /models 或 /v1/models 路径获取模型列表（OpenAI 兼容）。
 * 与 frontend/src/constants/llmPresets.ts 的 fetchModelsFromProvider 逻辑一致。
 */
export async function fetchModelsFromProvider(
  baseUrl: string,
  apiKey?: string,
  trustedServer = false,
): Promise<ImportedModel[]> {
  const base = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('请先填写 Base URL');
  // 已含版本路径（如 /v3、/v2）时只请求 /models，避免 .../v3/v1/models 报错（如火山方舟）
  const hasVersionPath = /\/(v\d+)(\/|$)/.test(base);
  const deepSeek = isDeepSeekBase(base);
  const urlsToTry = deepSeek ? [DEEPSEEK_ORIGIN + '/models']
    : hasVersionPath ? [base + '/models'] : [base + '/models', base + '/v1/models'];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  let lastErr: ModelImportError | null = null;
  for (const url of urlsToTry) {
    try {
      const res = await boundedHttpRequest(url, headers, '', {
        method: 'GET', trustedServer, ...(deepSeek ? { allowHttpsProxyFakeIp: true } : {}),
      });
      if (res.status === 401 || res.status === 403) {
        throw new ModelImportError(`提供商拒绝访问（HTTP ${res.status}），请检查密钥和账号权限`);
      }
      if (res.status < 200 || res.status >= 300) {
        lastErr = new ModelImportError(`模型列表请求失败（HTTP ${res.status}）`);
        continue;
      }
      const json = JSON.parse(res.text) as unknown[] | { data?: unknown[] };
      const list: unknown[] = Array.isArray(json) ? json : (json?.data ?? []);
      if (!Array.isArray(list)) {
        lastErr = new ModelImportError('响应格式不是数组或 { data: [] }');
        continue;
      }
      if (list.length > 10000) throw new Error('模型列表过大');
      return list.map((m: unknown) => {
        const x = m as { id?: string; name?: string };
        return { id: x?.id ?? String(m), name: typeof x?.name === 'string' ? x.name : undefined };
      });
    } catch (error) {
      if (error instanceof ModelImportError) throw error;
      lastErr = new ModelImportError('模型服务地址不可访问或响应无效');
    }
  }
  throw lastErr ?? new ModelImportError('无法获取模型列表');
}
