/**
 * HTTP 请求工具
 * 使用 Node.js 原生 fetch，封装 GET/POST 等常见 HTTP 请求。
 *
 * 反爬虫优化（见 UA 池、Headers 注入、请求间隔）：
 * 注意：Cloudflare JS Challenge 等需要浏览器环境的防护无法绕过。
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from './types.js';

const MAX_BODY_SIZE = 100 * 1024; // 100KB

export const httpRequestDefinition: ToolDefinition = {
  name: 'http_request',
  displayName: 'HTTP 请求',
  description: '发送 HTTP 请求获取网页或 API 内容。支持 GET/POST/PUT/DELETE。用于抓取网页、调用公开 API。内置反爬虫优化（随机 UA、请求间隔、浏览器 Headers），但 Cloudflare JS Challenge 等防护无法绕过。',
  domain: ['coding'],
  riskLevel: 'medium',
  parameters: [
    { name: 'url', type: 'string', description: '目标 URL（必须以 http:// 或 https:// 开头）', required: true },
    { name: 'method', type: 'string', description: 'HTTP 方法：GET（默认）/ POST / PUT / DELETE / HEAD / OPTIONS', required: false },
    { name: 'headers', type: 'object', description: '请求头，键值对对象。如 { "Content-Type": "application/json" }。会与内置反爬虫 Headers 合并。', required: false },
    { name: 'body', type: 'string', description: '请求体（POST/PUT 时使用），JSON 字符串或普通文本', required: false },
    { name: 'timeout', type: 'number', description: '超时时间（毫秒），默认 30000（30秒），最多 60000', required: false },
    { name: 'skipAntiBotHeaders', type: 'boolean', description: '设为 true 跳过内置反爬虫 Headers（用于已有完整 UA/Headers 的 API 请求，避免冲突）', required: false },
  ],
  requiredPermissions: [],
};

// ── 反爬虫优化 ────────────────────────────────────────────────────────────────

// 真实浏览器 UA 池（定期更新）
const UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
];

// 全局请求间隔控制（毫秒）：避免同一目标短时间内大量请求
const MIN_REQUEST_INTERVAL_MS = 1500; // 同一 host 两次请求至少间隔 1.5s
const lastRequestAt = new Map<string, number>();

// 敏感响应头，在返回给 AI 之前过滤掉
const SENSITIVE_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'set-cookie2',
  'x-api-key', 'x-auth-token', 'x-csrf-token',
  'proxy-authenticate', 'proxy-authorization',
  'www-authenticate', 'x-forwarded-authorization',
  'x-slb-ip', 'x-forwards',
]);

// ── 工具函数 ────────────────────────────────────────────────────────────────

function randomUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function filterSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    filtered[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[已过滤]' : value;
  }
  return filtered;
}

/** 提取 host 用于请求间隔控制 */
function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 等待至满足最小请求间隔 */
async function waitForRateLimit(url: string): Promise<void> {
  const host = extractHost(url);
  const last = lastRequestAt.get(host) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestAt.set(host, Date.now());
}

/**
 * 将超长内容保存到沙箱临时文件，返回保存路径。
 * 超过 THRESHOLD（默认 2000 字符）时触发。
 */
async function saveLargeContent(
  deps: ToolExecutorDeps,
  ctx: unknown,
  dir: string,
  filename: string,
  content: string,
  threshold = 2000,
): Promise<{ savedTo?: string; preview: string }> {
  if (content.length <= threshold) return { preview: content };

  try {
    const fs = await deps.resolveFS(ctx);
    if (fs) {
      await fs.mkdir(dir);
      const path = `${dir}/${filename}`;
      await fs.writeOverwrite(path, content);
      return {
        savedTo: path,
        preview: content.slice(0, 500),
      };
    }
  } catch {
    // 沙箱不可用时静默降级
  }
  return { preview: content.slice(0, 500) };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export function createHttpRequestHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input: Record<string, unknown>, ctx?: unknown) => {
    const signal = (ctx as { signal?: AbortSignal } | undefined)?.signal;
    signal?.throwIfAborted();
    const url = String(input.url ?? '').trim();
    if (!url) return { error: 'url 不能为空' };
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { error: 'url 必须以 http:// 或 https:// 开头' };
    }

    const method = String(input.method ?? 'GET').toUpperCase();
    const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
    if (!allowedMethods.includes(method)) {
      return { error: `不支持的 HTTP 方法: ${method}，支持: ${allowedMethods.join(', ')}` };
    }

    const skipAntiBot = input.skipAntiBotHeaders === true;

    // 用户传入的 headers 与内置反爬虫 Headers 合并
    const userHeaders = (input.headers as Record<string, string> | undefined) ?? {};

    if (!skipAntiBot) {
      // 如果用户没有指定这些 Header，自动注入
      const targetHost = extractHost(url);
      const defaultHeaders: Record<string, string> = {
        'User-Agent': userHeaders['User-Agent'] ?? userHeaders['user-agent'] ?? randomUA(),
        'Accept': userHeaders['Accept'] ?? '*/*',
        'Accept-Language': userHeaders['Accept-Language'] ?? 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': userHeaders['Accept-Encoding'] ?? 'gzip, deflate, br',
        'Referer': userHeaders['Referer'] ?? userHeaders['Referrer'] ?? `https://${targetHost}/`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        // Cloudflare 等常见检测会用
        'DNT': '1',
      };
      Object.assign(userHeaders, defaultHeaders);
    }

    const body =
      input.body != null && (method === 'POST' || method === 'PUT')
        ? String(input.body)
        : undefined;

    const timeoutMs = Math.min(
      Math.max(parseInt(String(input.timeout ?? '30000'), 10), 1000),
      60_000
    );

    // ── 请求间隔控制 ──
    await waitForRateLimit(url);
    signal?.throwIfAborted();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: userHeaders,
        body,
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      const status = res.status;
      const statusText = res.statusText;

      // 过滤敏感响应头
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const safeHeaders = filterSensitiveHeaders(responseHeaders);
      const contentType = safeHeaders['Content-Type'] ?? safeHeaders['content-type'] ?? '';

      // 读取 body（限制大小）
      let text: string;
      let isJson = contentType.includes('application/json');
      const reader = res.body?.getReader();

      if (!reader) {
        text = await res.text();
      } else {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (total + value.byteLength <= MAX_BODY_SIZE) {
            chunks.push(value);
            total += value.byteLength;
          } else {
            const remaining = MAX_BODY_SIZE - total;
            if (remaining > 0) chunks.push(value.subarray(0, remaining));
            break;
          }
        }
        if (chunks.length === 0) {
          text = '';
        } else if (chunks.length === 1) {
          text = new TextDecoder('utf-8', { fatal: false }).decode(chunks[0]);
        } else {
          const combined = new Uint8Array(
            chunks.reduce((acc, c) => acc + c.byteLength, 0)
          );
          let offset = 0;
          for (const c of chunks) {
            combined.set(c, offset);
            offset += c.byteLength;
          }
          text = new TextDecoder('utf-8', { fatal: false }).decode(combined);
        }
      }

      const truncated = text.length >= MAX_BODY_SIZE;

      // 检测常见反爬虫响应
      let antiBotDetected = false;
      let antiBotHint = '';
      const lowerText = text.toLowerCase();
      if (res.status === 403 || res.status === 429) {
        antiBotDetected = true;
        antiBotHint = `HTTP ${res.status}：可能被目标站点反爬虫机制拦截`;
      } else if (
        lowerText.includes('cf-error') ||
        lowerText.includes('cloudflare') ||
        lowerText.includes('checking your browser') ||
        lowerText.includes('access denied') ||
        lowerText.includes('captcha') ||
        lowerText.includes('blocked') ||
        lowerText.includes('human verification')
      ) {
        antiBotDetected = true;
        antiBotHint = '检测到 Cloudflare/反爬虫页面（需要浏览器环境才能绕过）';
      }

      const bodySave = await saveLargeContent(
        deps, ctx, 'tool-results',
        `http_${Date.now()}_${status}.txt`, text,
      );

      return {
        url,
        method,
        status,
        statusText,
        headers: safeHeaders,
        contentType,
        bodyText: bodySave.savedTo ? undefined : bodySave.preview,
        bodyTextPreview: bodySave.preview.slice(0, 300),
        bodyTextTruncated: truncated,
        bodySize: text.length,
        savedTo: bodySave.savedTo,
        savedToHint: bodySave.savedTo
          ? `完整响应已保存至 ${bodySave.savedTo}，可用 grep 搜索：grep "关键词" ${bodySave.savedTo}`
          : undefined,
        parsedBody: isJson
          ? (() => {
              try { return JSON.parse(text); }
              catch { return undefined; }
            })()
          : undefined,
        antiBotDetected,
        antiBotHint: antiBotDetected ? antiBotHint : undefined,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      signal?.throwIfAborted();
      if (err instanceof Error && err.name === 'AbortError') {
        return { error: `请求超时（${timeoutMs}ms），请检查 URL 是否可访问或提高 timeout` };
      }
      return { error: `请求失败: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
