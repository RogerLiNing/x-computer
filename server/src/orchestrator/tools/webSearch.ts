/**
 * 多引擎网页搜索工具
 * 支持 MiniMax、Serper.dev、Perplexity、Brave、DuckDuckGo
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from './types.js';
import { loadDefaultConfig } from '../../config/defaultConfig.js';


export const webSearchDefinition: ToolDefinition = {
  name: 'web_search',
  displayName: '网络搜索',
  description: '搜索互联网获取最新信息。AI 应在 query 中包含当前日期以获取最新结果（如「2026年5月」），否则可能返回过时内容。',
  domain: ['chat', 'coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'query', type: 'string', description: '搜索关键词或问题（建议包含当前日期以获取最新结果）', required: true },
    { name: 'numResults', type: 'number', description: '返回结果数量，默认为 5，最多 10', required: false },
  ],
  requiredPermissions: [],
};

// ── Provider adapters ──────────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  message?: string;
  error?: string;
}

// Serper.dev — simple Google results
async function searchSerper(query: string, apiKey: string, numResults: number): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: numResults }),
  });
  if (!res.ok) throw new Error(`Serper API error: ${res.status}`);
  const data = await res.json() as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (data.organic ?? []).slice(0, numResults).map(r => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
  }));
}

// Perplexity Sonar
async function searchPerplexity(query: string, apiKey: string, numResults: number): Promise<SearchResult[]> {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: `Search the web for: ${query}` }],
      max_tokens: 1000,
    }),
  });
  if (!res.ok) throw new Error(`Perplexity API error: ${res.status}`);
  const data = await res.json() as { citations?: string[]; choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '';
  const citations = data.citations ?? [];
  // Perplexity returns conversational answer; extract URLs as results
  return citations.slice(0, numResults).map((url, i) => ({
    title: `结果 ${i + 1}`,
    url,
    snippet: '',
  }));
}

// MiniMax search — uses the official /v1/coding_plan/search endpoint
async function searchMiniMax(query: string, apiKey: string, numResults: number): Promise<SearchResult[]> {
  const baseUrl = 'https://api.minimaxi.com';
  const res = await fetch(`${baseUrl}/v1/coding_plan/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax search API error ${res.status}: ${err}`);
  }
  const data = await res.json() as {
    organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
  };
  return (data.organic ?? []).slice(0, numResults).map(r => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
  }));
}

// Brave Search
async function searchBrave(query: string, apiKey: string, numResults: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(numResults) });
  const res = await fetch(`https://api.search.brave.com/resrv/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });
  if (!res.ok) throw new Error(`Brave API error: ${res.status}`);
  const data = await res.json() as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>
    }
  };
  return (data.web?.results ?? []).slice(0, numResults).map(r => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));
}

// DuckDuckGo HTML (no API key needed, but may be blocked in China)
async function searchDuckDuckGo(query: string, numResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`);

  const html = await res.text();
  const results: SearchResult[] = [];
  const liPattern = /<li class="result"[^>]*>([\s\S]*?)<\/li>/gi;
  let count = 0;
  let blockMatch;

  while ((blockMatch = liPattern.exec(html)) !== null && count < numResults) {
    const block = blockMatch[1];
    const urlMatch = /href="(https?:\/\/[^"]+)"/.exec(block);
    const titleMatch = /result__a[^>]*>([^<]+)<\/a>/.exec(block);
    const snippetMatch = /result__snippet[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!urlMatch || !titleMatch) continue;
    const resultUrl = urlMatch[1];
    if (resultUrl.includes('duckduckgo')) continue;
    results.push({
      title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
      url: resultUrl,
      snippet: snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
        : '',
    });
    count++;
  }
  return results;
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function webSearch(
  input: { query?: unknown; numResults?: unknown; provider?: unknown; apiKey?: unknown },
  ctx: { userId?: string; getConfig?: (key: string) => string | undefined },
): Promise<SearchResponse> {
  const query = String(input.query ?? '').trim();
  if (!query) return { query, results: [], total: 0, error: 'query 不能为空' };

  const numResults = Math.min(Math.max(parseInt(String(input.numResults ?? '5'), 10) || 5, 1), 10);

  // Load user config if not provided
  let provider = String(input.provider ?? '');
  let apiKey = String(input.apiKey ?? '');
  if ((!provider || !apiKey) && ctx.userId) {
    try {
      if (ctx.getConfig) {
        // Try search_config first
        const searchRaw = ctx.getConfig('search_config');
        if (searchRaw) {
          const cfg = JSON.parse(searchRaw) as { provider?: string; apiKey?: string };
          provider = provider || cfg.provider || '';
          apiKey = apiKey || cfg.apiKey || '';
        }
        // Fallback to llm_config MiniMax API key from user config
        if (!apiKey) {
          const llmRaw = ctx.getConfig('llm_config');
          if (llmRaw) {
            const llm = JSON.parse(llmRaw) as {
              providers?: Array<{ id?: string; apiKey?: string; baseUrl?: string }>;
            };
            const mmx = llm.providers?.find(p => p.id === 'Minimax' || p.id === 'minimax');
            if (mmx?.apiKey) apiKey = mmx.apiKey;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback to server-side .x-config.json MiniMax API key
  if (!apiKey) {
    const serverConfig = loadDefaultConfig();
    const mmx = serverConfig.llm_config?.providers?.find(
      p => p.id === 'Minimax' || p.id === 'minimax'
    );
    if (mmx?.apiKey) apiKey = mmx.apiKey;
  }

  // Default to MiniMax (always available via server config fallback)
  if (!provider) provider = 'minimax';

  try {
    let results: SearchResult[];

    switch (provider) {
      case 'minimax':
        if (!apiKey) return { query, results: [], total: 0, error: 'MiniMax 需要 API Key，请在设置中配置' };
        results = await searchMiniMax(query, apiKey, numResults);
        break;
      case 'serper':
        if (!apiKey) return { query, results: [], total: 0, error: 'Serper.dev 需要 API Key，请在设置中配置' };
        results = await searchSerper(query, apiKey, numResults);
        break;
      case 'perplexity':
        if (!apiKey) return { query, results: [], total: 0, error: 'Perplexity 需要 API Key，请在设置中配置' };
        results = await searchPerplexity(query, apiKey, numResults);
        break;
      case 'brave':
        if (!apiKey) return { query, results: [], total: 0, error: 'Brave Search 需要 API Key，请在设置中配置' };
        results = await searchBrave(query, apiKey, numResults);
        break;
      case 'duckduckgo':
      default:
        results = await searchDuckDuckGo(query, numResults);
        break;
    }

    if (results.length === 0) {
      return { query, results: [], total: 0, message: '未找到相关结果，请尝试更换关键词。' };
    }

    return {
      query,
      results: results.map((r, i) => ({ ...r, index: i + 1 })),
      total: results.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { query, results: [], total: 0, error: `搜索失败: ${message}` };
  }
}

export function createWebSearchHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const query = String(input.query ?? '').trim();
    if (!query) {
      throw new Error('web_search: query is required');
    }
    await new Promise((r) => setTimeout(r, 200)); // brief delay
    const context = ctx as {
      userId?: string;
      getConfig?: (userId: string, key: string) => string | undefined;
    } | undefined;
    // ExecutionContext.getConfig takes (userId, key) but webSearch expects (key)
    const getCfg = context?.userId && context.getConfig
      ? (key: string) => context.getConfig!(context.userId!, key)
      : undefined;
    return webSearch(input, { userId: context?.userId, getConfig: getCfg });
  };
}
