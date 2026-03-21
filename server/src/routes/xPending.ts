import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

const PENDING_REQUESTS_KEY = 'x_pending_requests';

export function createXPendingRouter(db?: AppDatabase): Router {
  const router = Router();

  type PendingItem = { id: string; content: string; createdAt: number };

  async function getPendingList(userId: string): Promise<PendingItem[]> {
    if (!db) return [];
    try {
      const raw = await db.getConfig(userId, PENDING_REQUESTS_KEY);
      return raw ? (JSON.parse(raw) as PendingItem[]) : [];
    } catch {
      return [];
    }
  }

  // GET /x/pending-requests
  router.get('/x/pending-requests', async (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    const list = await getPendingList(userId);
    res.json({ items: list, total: list.length });
  });

  // POST /x/pending-requests
  router.post('/x/pending-requests', async (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    if (!db) { res.status(503).json({ error: '服务不可用' }); return; }
    const { content } = (req.body ?? {}) as { content?: string };
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'content 必填' });
      return;
    }
    const list = await getPendingList(userId);
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    list.push({ id, content: text, createdAt: Date.now() });
    await db.setConfig(userId, PENDING_REQUESTS_KEY, JSON.stringify(list));
    res.status(201).json({ id, content: text, createdAt: list[list.length - 1].createdAt, total: list.length });
  });

  // DELETE /x/pending-requests (clear all)
  router.delete('/x/pending-requests', async (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    if (!db) { res.status(503).json({ error: '服务不可用' }); return; }
    await db.setConfig(userId, PENDING_REQUESTS_KEY, JSON.stringify([]));
    res.json({ success: true, remaining: 0 });
  });

  // DELETE /x/pending-requests/:id
  router.delete('/x/pending-requests/:id', async (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    if (!db) { res.status(503).json({ error: '服务不可用' }); return; }
    const list = (await getPendingList(userId)).filter((x) => x.id !== req.params.id);
    await db.setConfig(userId, PENDING_REQUESTS_KEY, JSON.stringify(list));
    res.json({ success: true, remaining: list.length });
  });

  return router;
}
