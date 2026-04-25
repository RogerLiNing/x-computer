/**
 * Global test setup — runs before each test file.
 *
 * Resets in-memory singleton state that would otherwise bleed between test files
 * running in the same vitest worker:
 *
 * 1. Chat rate-limit map (chatRateLimit.ts) — shared across all routes using it
 */
import { resetRateLimitState } from './middleware/chatRateLimit.js';
import { clearDefaultConfigCache } from './config/defaultConfig.js';

beforeEach(() => {
  resetRateLimitState();
  vi.clearAllMocks();
});

beforeAll(() => {
  resetRateLimitState();
  clearDefaultConfigCache();
});
