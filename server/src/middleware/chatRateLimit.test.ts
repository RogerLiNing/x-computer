import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatRateLimit, resetRateLimitState } from './chatRateLimit.js';
import type { Request, Response } from 'express';

function mockReq(userId: string, originalUrl = '/api/chat/agent/stream'): Request {
  return { userId, method: 'POST', originalUrl } as unknown as Request;
}

// Create fresh spy-backed mocks each time so tests don't share state
function createMockRes(): Response {
  const res = {
    setHeader: () => {},
    status: vi.fn(function (this: typeof res, _code: number) { return res; }),
    json: vi.fn(function (this: typeof res, data: unknown) { return res; }),
    getHeader: () => undefined,
  };
  return res as unknown as Response;
}

describe('chatRateLimit', () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.useRealTimers();
  });

  it('passes through when userId is empty string', () => {
    const req = mockReq('');
    const res = createMockRes();
    const next = vi.fn();
    chatRateLimit(req as Request, res, next as any);
    expect(next).toHaveBeenCalled();
  });

  it('passes through for anonymous userId', () => {
    const req = mockReq('anonymous');
    const res = createMockRes();
    const next = vi.fn();
    chatRateLimit(req as Request, res, next as any);
    expect(next).toHaveBeenCalled();
  });

  it('passes through when user has no prior request', () => {
    const req = mockReq(`uid_${Date.now()}_${Math.random()}`);
    const res = createMockRes();
    const next = vi.fn();
    chatRateLimit(req as Request, res, next as any);
    expect(next).toHaveBeenCalled();
  });

  it('rate-limits when same user sends a second request within 2 seconds', () => {
    const userId = `uid_rate_limit_${Date.now()}`;
    const next1 = vi.fn();
    // First request: passes
    chatRateLimit(mockReq(userId) as Request, createMockRes(), next1 as any);
    expect(next1).toHaveBeenCalled();

    // Second request immediately: should be rate-limited
    const res2 = createMockRes();
    const next2 = vi.fn();
    chatRateLimit(mockReq(userId) as Request, res2, next2 as any);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(429);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'rate_limited' }),
    );
  });

  it('allows sequential assistant operations on different channels', () => {
    const userId = `uid_channel_${Date.now()}`;
    const classifyNext = vi.fn();
    const streamNext = vi.fn();

    chatRateLimit(
      mockReq(userId, '/api/chat/classify-writing-intent'),
      createMockRes(),
      classifyNext as any,
    );
    chatRateLimit(
      mockReq(userId, '/api/chat/agent/stream'),
      createMockRes(),
      streamNext as any,
    );

    expect(classifyNext).toHaveBeenCalledOnce();
    expect(streamNext).toHaveBeenCalledOnce();
  });

  it('allows request again after interval passes', () => {
    vi.useFakeTimers();
    const userId = `uid_interval_${Date.now()}`;

    // First request
    chatRateLimit(mockReq(userId) as Request, createMockRes(), vi.fn());

    vi.advanceTimersByTime(2_100);

    const res = createMockRes();
    const next = vi.fn();
    chatRateLimit(mockReq(userId) as Request, res, next as any);
    expect(next).toHaveBeenCalled();
  });
});
