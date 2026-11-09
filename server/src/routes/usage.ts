import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import { ModelUsageStore } from '../llm/ModelUsageStore.js';
import { serverLogger } from '../observability/ServerLogger.js';

/** The signed-in user's own model usage: totals, per model and per day. */
export function createUsageRouter(db?: AppDatabase, store: ModelUsageStore | undefined = db ? new ModelUsageStore(db) : undefined): Router {
  const router = Router();
  router.get('/usage/models', async (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') return res.status(401).json({ error: '需要登录' });
    if (!store) return res.status(503).json({ error: '用量统计不可用' });
    const days = Number(req.query.days);
    try {
      res.json(await store.summary(userId, { days: Number.isFinite(days) && days > 0 ? Math.floor(days) : undefined }));
    } catch (error: unknown) {
      serverLogger.warn('llm', '读取用量失败', error instanceof Error ? error.message : String(error));
      res.status(500).json({ error: '读取用量失败' });
    }
  });
  return router;
}
