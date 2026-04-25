/**
 * Per-user chat rate limiter middleware.
 *
 * Prevents spam by limiting each user to 1 chat request per interval.
 * Uses in-memory tracking (per server instance).
 * Returns HTTP 429 with a friendly message when rate limited.
 *
 * Stale entries (> 1 hour old) are lazily cleaned to prevent unbounded memory growth.
 *
 * Inspired by lovely_reminder/backend/app/api/v1/ai.py rate limiting.
 */

import type { Request, Response, NextFunction } from 'express';
import { serverLogger } from '../observability/ServerLogger.js';

const RATE_LIMIT_INTERVAL_MS = 2_000; // 2 seconds per user
const STALE_TTL_MS = 60 * 60 * 1_000; // 1 hour — entries older than this are considered stale
const CLEANUP_INTERVAL = 50; // perform batch cleanup every N requests

/** userId → timestamp of last chat request */
const lastRequestByUser = new Map<string, number>();

/** Counter for triggering batch cleanup */
let requestCount = 0;

/** Resets all in-memory rate-limit state. Use in test beforeEach / beforeAll. */
export function resetRateLimitState(): void {
  lastRequestByUser.clear();
  requestCount = 0;
}

/**
 * Express middleware: blocks users who send more than 1 chat request
 * within RATE_LIMIT_INTERVAL_MS. Skips anonymous / missing userId.
 */
export function chatRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as { userId?: string }).userId ?? '';

  // Skip anonymous users or requests without user context
  if (!userId || userId === 'anonymous') {
    next();
    return;
  }

  const now = Date.now();
  const lastRequest = lastRequestByUser.get(userId) ?? 0;
  const elapsed = now - lastRequest;

  // Lazy cleanup: check individual entry for staleness when we read it
  if (lastRequest > 0 && now - lastRequest > STALE_TTL_MS) {
    lastRequestByUser.delete(userId);
  }

  // Batch cleanup every N requests to also remove entries that were never read again
  requestCount++;
  if (requestCount % CLEANUP_INTERVAL === 0) {
    const cutoff = now - STALE_TTL_MS;
    for (const [uid, ts] of lastRequestByUser) {
      if (ts < cutoff) lastRequestByUser.delete(uid);
    }
  }

  if (lastRequest > 0 && elapsed < RATE_LIMIT_INTERVAL_MS && now - lastRequest <= STALE_TTL_MS) {
    const remainingMs = RATE_LIMIT_INTERVAL_MS - elapsed;
    const remainingSec = Math.ceil(remainingMs / 1000);
    serverLogger.info('rate-limit', `请求过于频繁，已拦截`, `userId=${userId} elapsed=${elapsed}ms`);
    res.status(429).json({
      error: 'rate_limited',
      message: `发送太频繁啦，请稍等 ${remainingSec} 秒～`,
      retryAfter: remainingMs,
    });
    return;
  }

  lastRequestByUser.set(userId, now);
  next();
}
