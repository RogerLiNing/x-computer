import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from './types.js';

export const webSearchDefinition: ToolDefinition = {
  name: 'web_search',
  displayName: '网络搜索',
  description: '搜索互联网获取最新信息。使用 DuckDuckGo 引擎，无需 API Key。',
  domain: ['chat', 'coding'],
  riskLevel: 'low',
  parameters: [
    { name: 'query', type: 'string', description: '搜索关键词或问题（建议用英文，效果更好）', required: true },
    { name: 'numResults', type: 'number', description: '返回结果数量，默认为 5，最多 10', required: false },
  ],
  requiredPermissions: [],
};

interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string, numResults: number = 5): Promise<DuckDuckGoResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=wt-wt`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);
  }

  const html = await response.text();

  // Parse results from HTML
  const results: DuckDuckGoResult[] = [];
  // Each result is in a <a> tag with class "result__a"
  const linkPattern = /<a class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  // Snippet is in <a class="result__snippet" ...>
  const snippetPattern = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  // Find all result blocks
  const resultBlockPattern = /<div class="result results_links_deep highlight_d">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let match;
  let blockMatch;

  // Simpler approach: find all <li class="result"> blocks
  const liPattern = /<li class="result"[^>]*>([\s\S]*?)<\/li>/gi;
  let count = 0;

  while ((blockMatch = liPattern.exec(html)) !== null && count < numResults) {
    const block = blockMatch[1];

    // Extract URL from the first <a> in the block (the result link)
    const urlMatch = /href="(https?:\/\/[^"]+)"/.exec(block);
    if (!urlMatch) continue;
    const resultUrl = urlMatch[1];

    // Extract title - text from the result__a link
    const titleMatch = /result__a[^>]*>([^<]+)<\/a>/.exec(block);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();

    // Extract snippet
    const snippetMatch = /result__snippet[^>]*>([\s\S]*?)<\/a>/.exec(block);
    let snippet = '';
    if (snippetMatch) {
      snippet = snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    }

    if (title && resultUrl && !resultUrl.includes('duckduckgo')) {
      results.push({ title, url: resultUrl, snippet });
      count++;
    }
  }

  return results;
}

export function createWebSearchHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input) => {
    const query = String(input.query ?? '').trim();
    if (!query) {
      throw new Error('web_search: query is required');
    }

    const numResults = Math.min(Math.max(parseInt(String(input.numResults ?? '5'), 10) || 5, 1), 10);

    await new Promise((r) => setTimeout(r, 200)); // brief delay to respect rate limits

    try {
      const results = await searchDuckDuckGo(query, numResults);

      if (results.length === 0) {
        return {
          query,
          results: [],
          message: '未找到相关结果，请尝试更换关键词。',
        };
      }

      return {
        query,
        results: results.map((r, i) => ({
          index: i + 1,
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
        total: results.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        query,
        results: [],
        error: `搜索失败: ${message}`,
      };
    }
  };
}
