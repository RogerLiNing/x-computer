import type { Request, Response, NextFunction } from 'express';

const RATE_LIMIT_INTERVAL_MS = 2_000;
const STALE_TTL_MS = 60 * 60 * 1_000;
const lastRequestByChannel = new Map<string, number>();

function getRequestChannel(req: Request): string {
  const rawPath = req.originalUrl || req.url || req.path || '/chat';
  const path = rawPath.split('?')[0] || '/chat';
  return `${req.method || 'POST'}:${path}`;
}

export function chatRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as { userId?: string }).userId ?? '';
  if (!userId || userId === 'anonymous') {
    next();
    return;
  }

  const now = Date.now();
  const channel = getRequestChannel(req);
  const key = `${userId}:${channel}`;
  const lastRequest = lastRequestByChannel.get(key);
  if (lastRequest && now - lastRequest < RATE_LIMIT_INTERVAL_MS) {
    const retryAfter = RATE_LIMIT_INTERVAL_MS - (now - lastRequest);
    res.setHeader('Retry-After', String(Math.ceil(retryAfter / 1_000)));
    res.status(429).json({
      error: 'rate_limited',
      message: '发送太频繁，请稍后再试。',
      retryAfter,
      channel,
    });
    return;
  }

  if (lastRequest && now - lastRequest > STALE_TTL_MS) {
    lastRequestByChannel.delete(key);
  }
  lastRequestByChannel.set(key, now);
  next();
}

export function resetRateLimitState(): void {
  lastRequestByChannel.clear();
}
