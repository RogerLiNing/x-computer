import { resolveLlmApiType } from '../../../shared/src/index.js';
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function publicUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return !url.username && !url.password && !url.search && !url.hash ? value : undefined; }
  catch { return undefined; }
}

/** Only model selection and credential presence belong in browser configuration. */
export function publicLLMConfig(value: unknown) {
  const config = object(value);
  const providers = (Array.isArray(config.providers) ? config.providers : []).map(object).filter(p => typeof p.id === 'string').map(p => ({
    id: p.id as string, name: typeof p.name === 'string' ? p.name : p.id as string,
    baseUrl: publicUrl(p.baseUrl), apiType: resolveLlmApiType(p.id as string, p.baseUrl, p.apiType),
    apiKeyConfigured: typeof p.apiKey === 'string' ? !!p.apiKey : p.apiKeyConfigured === true,
  }));
  const defaults = Object.entries(object(config.defaultByModality)).flatMap(([key, value]) => {
    const selected = object(value);
    return typeof selected.providerId === 'string' && typeof selected.modelId === 'string'
      ? [[key, { providerId: selected.providerId, modelId: selected.modelId }]] : [];
  });
  return { providers, defaultByModality: Object.fromEntries(defaults) };
}

/** A browser round trip never erases a saved key merely because GET omitted it. */
export function mergeUserLLMConfig(value: unknown, previous: string | undefined): unknown {
  const input = typeof value === 'string' ? JSON.parse(value) : value;
  const config = object(input);
  if (!Array.isArray(config.providers) || config.providers.some(p => typeof object(p).id !== 'string' ||
      (Object.hasOwn(object(p), 'apiKey') && typeof object(p).apiKey !== 'string'))) throw new Error('模型配置无效');
  let stored: Record<string, unknown> = {};
  try { stored = object(previous ? JSON.parse(previous) : {}); } catch { /* An invalid old config has no reusable credential. */ }
  const old = (Array.isArray(stored.providers) ? stored.providers : []).map(object);
  const incomingProviders = config.providers as unknown[];
  const visible = publicLLMConfig(config);
  return { ...visible, providers: visible.providers.map((provider, index) => {
    const incoming = object(incomingProviders[index]);
    const existing = old.find(p => p.id === provider.id);
    const apiKey = Object.hasOwn(incoming, 'apiKey') ? incoming.apiKey : existing?.apiKey;
    // Keep the user's actual endpoint on the server even when its URL includes credentials.
    return { ...provider, baseUrl: typeof incoming.baseUrl === 'string' ? incoming.baseUrl : existing?.baseUrl,
      ...(typeof apiKey === 'string' ? { apiKey } : {}) };
  }) };
}
