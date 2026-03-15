/**
 * MCP Registry 客户端：从 registry.modelcontextprotocol.io 拉取 MCP 服务器列表，
 * 支持按关键词过滤（Registry 无搜索 API，需客户端过滤）。
 * @see https://modelcontextprotocol.info/tools/registry/consuming/
 */

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1';

export type McpRegistryRemote = {
  type: string;
  url: string;
  headers?: Array<{ name: string; description?: string; isRequired?: boolean; isSecret?: boolean }>;
};

export type McpRegistryPackage = {
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: { type: string };
  environmentVariables?: Array<{ name: string; description?: string; isRequired?: boolean; isSecret?: boolean }>;
};

export type McpRegistryServer = {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  remotes?: McpRegistryRemote[];
  packages?: McpRegistryPackage[];
};

type RegistryListItem = {
  server: McpRegistryServer;
  _meta?: { 'io.modelcontextprotocol.registry/official'?: { status?: string; isLatest?: boolean } };
};

type RegistryListResponse = {
  servers: RegistryListItem[];
  metadata?: { nextCursor?: string; count?: number };
};

/** 转换为 McpServerConfig 的候选（供前端或 x.add_mcp_server 使用） */
export type McpRegistryEntry = {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  /** 可直接用于 x.add_mcp_server 的配置；优先 HTTP，其次 Stdio */
  config: { id: string; name?: string; url?: string; command?: string; args?: string[]; headers?: Record<string, string>; env?: Record<string, string> };
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
let cache: { servers: McpRegistryEntry[]; ts: number } | null = null;

function fetchRegistryPage(limit: number, cursor?: string): Promise<RegistryListResponse> {
  const url = new URL(`${REGISTRY_BASE}/servers`);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  return fetch(url.toString(), { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`MCP Registry HTTP ${r.status}`);
      return r.json();
    })
    .then((data: RegistryListResponse) => data);
}

function registryItemToEntry(item: RegistryListItem): McpRegistryEntry | null {
  const s = item.server;
  const status = item._meta?.['io.modelcontextprotocol.registry/official']?.status;
  if (status === 'deleted') return null;

  const safeId = (s.name || 'mcp-server').replace(/[/.]/g, '-').toLowerCase();
  const title = s.title || s.name;

  // 优先 HTTP remote
  const remote = s.remotes?.[0];
  if (remote && (remote.type === 'streamable-http' || remote.type === 'sse') && remote.url) {
    const headers: Record<string, string> = {};
    for (const h of remote.headers ?? []) {
      if (h.isRequired && h.name) {
        headers[h.name] = '${API_KEY}';
      }
    }
    return {
      name: s.name,
      title,
      description: s.description,
      version: s.version,
      websiteUrl: s.websiteUrl,
      config: {
        id: safeId,
        name: title,
        url: remote.url,
        ...(Object.keys(headers).length ? { headers, env: { API_KEY: '' } } : {}),
      },
    };
  }

  // 其次 Stdio (npm)
  const pkg = s.packages?.find((p) => p.registryType === 'npm' && p.identifier);
  if (pkg?.identifier) {
    const env: Record<string, string> = {};
    for (const ev of pkg.environmentVariables ?? []) {
      if (ev.isRequired && ev.name) env[ev.name] = '';
    }
    return {
      name: s.name,
      title,
      description: s.description,
      version: s.version,
      websiteUrl: s.websiteUrl,
      config: {
        id: safeId,
        name: title,
        command: 'npx',
        args: ['--yes', pkg.identifier],
        ...(Object.keys(env).length ? { env } : {}),
      },
    };
  }

  return null;
}

/** 从 Registry 拉取并缓存服务器列表（最多拉取 maxFetch 条） */
async function loadAndCacheServers(maxFetch = 500): Promise<McpRegistryEntry[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.servers;
  }
  const all: McpRegistryEntry[] = [];
  let cursor: string | undefined;
  const pageSize = 100;
  let pages = 0;
  const maxPages = Math.ceil(maxFetch / pageSize);

  while (pages < maxPages) {
    const res = await fetchRegistryPage(pageSize, cursor);
    for (const item of res.servers ?? []) {
      const entry = registryItemToEntry(item);
      if (entry) all.push(entry);
    }
    cursor = res.metadata?.nextCursor;
    pages++;
    if (!cursor) break;
  }

  cache = { servers: all, ts: Date.now() };
  return all;
}

export type McpRegistrySearchResult =
  | { ok: true; servers: McpRegistryEntry[] }
  | { ok: false; error: string };

/**
 * 搜索 MCP Registry：拉取服务器列表并在客户端按关键词过滤。
 * Registry 无搜索 API，通过 name/description/title 做大小写不敏感匹配。
 */
export async function searchMcpRegistry(query: string, limit = 20): Promise<McpRegistrySearchResult> {
  const q = String(query ?? '').trim().toLowerCase();
  const limitNum = Math.min(Math.max(1, Math.floor(Number(limit) || 20)), 50);

  try {
    const servers = await loadAndCacheServers();

    const filtered =
      q === ''
        ? servers.slice(0, limitNum)
        : servers.filter((s) => {
            const name = (s.name ?? '').toLowerCase();
            const title = (s.title ?? '').toLowerCase();
            const desc = (s.description ?? '').toLowerCase();
            return name.includes(q) || title.includes(q) || desc.includes(q);
          });

    return {
      ok: true,
      servers: filtered.slice(0, limitNum),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `MCP Registry 请求失败: ${msg}` };
  }
}
