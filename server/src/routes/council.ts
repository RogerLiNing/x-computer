import { Router } from 'express';
import type { AppDatabase, AsyncDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { CouncilService } from '../llm/CouncilService.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createCouncilRouter(
  db: AppDatabase | AsyncDatabase,
  subscriptionService?: SubscriptionService,
): Router {
  const svc = new CouncilService(db, subscriptionService);
  const router = Router();

  /**
   * POST /api/llm/council
   * Query multiple LLM models in parallel.
   *
   * Body: {
   *   prompt: string;          // Required: the question/prompt
   *   context?: string;        // Optional: system context
   *   models: Array<{          // Required: at least one model
   *     providerId: string;
   *     modelId: string;
   *   }>;
   *   synthesisPrompt?: string; // Optional: custom synthesis instruction
   * }
   *
   * Returns: {
   *   results: Array<{
   *     providerId: string;
   *     modelId: string;
   *     response: string;
   *     error?: string;
   *     elapsedMs: number;
   *   }>;
   *   synthesis?: string;
   * }
   */
  router.post('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const body = req.body as {
        prompt?: string;
        context?: string;
        models?: Array<{ providerId?: string; modelId?: string }>;
        synthesisPrompt?: string;
      };

      if (!body?.prompt?.trim()) {
        res.status(400).json({ success: false, error: 'prompt is required' });
        return;
      }
      if (!Array.isArray(body.models) || body.models.length === 0) {
        res.status(400).json({ success: false, error: 'models array is required with at least one entry' });
        return;
      }

      const result = await svc.queryCouncil(userId, {
        prompt: body.prompt,
        context: body.context,
        models: body.models.map((m) => ({
          providerId: m.providerId ?? '',
          modelId: m.modelId ?? '',
        })),
        synthesisPrompt: body.synthesisPrompt,
      });

      serverLogger.info('council', 'Council query completed', `userId=${userId} models=${body.models.length} results=${result.results.length}`);
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      serverLogger.error('council', 'Council query failed', reason);
      res.status(500).json({ success: false, error: reason });
    }
  });

  return router;
}
