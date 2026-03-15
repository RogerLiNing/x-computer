/** 从提供商拉取的模型项（与前端 llmPresets 的 ImportedModel 一致） */
export interface ImportedModel {
  id: string;
  name?: string;
}

/**
 * 请求提供商 /models 或 /v1/models 路径获取模型列表（OpenAI 兼容）。
 * 与 frontend/src/constants/llmPresets.ts 的 fetchModelsFromProvider 逻辑一致。
 */
export async function fetchModelsFromProvider(
  baseUrl: string,
  apiKey?: string
): Promise<ImportedModel[]> {
  const base = (baseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('请先填写 Base URL');
  // 已含版本路径（如 /v3、/v2）时只请求 /models，避免 .../v3/v1/models 报错（如火山方舟）
  const hasVersionPath = /\/(v\d+)(\/|$)/.test(base);
  const urlsToTry = hasVersionPath ? [base + '/models'] : [base + '/models', base + '/v1/models'];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
