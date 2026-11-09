import { serverLogger } from '../observability/ServerLogger.js';

/**
 * 模型请求在「没连上」时自动重试。
 *
 * 只重试连接阶段的失败（连接超时、被拒绝、DNS 暂时失败等）：这时请求还没发到模型服务，
 * 重试不会重复计费，也不会产生两份回复。连接后中断（ECONNRESET）、HTTP 错误都不重试。
 */
const CONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS: readonly number[] = [500, 1500];

export interface ConnectRetryOptions {
  readonly fetchImpl?: typeof fetch;
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null)?.code ?? (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function isConnectFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false;
  const code = errorCode(error);
  return code !== undefined && CONNECT_FAILURE_CODES.has(code);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchWithConnectRetry(url: string, init: RequestInit, options: ConnectRetryOptions = {}): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? sleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isConnectFailure(error) || init.signal?.aborted) throw error;
      const host = (() => { try { return new URL(url).host; } catch { return 'unknown'; } })();
      serverLogger.warn('llm/connect', '连接模型服务失败，稍后重试', `host=${host} code=${errorCode(error)} attempt=${attempt}`);
      await wait(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1], init.signal ?? undefined);
    }
  }
}
