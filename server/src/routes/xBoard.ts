import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';

export function createXBoardRouter(db: AppDatabase | undefined): Router {
  const router = Router();

  // ── X Board (任务看板) ────────────────────────────────────

  router.get('/x/board', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const items = await db.listBoardItems(userId);
      res.json({ ok: true, items });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败' });
    }
  });

  router.post('/x/board', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const { title, description, status, priority } = req.body ?? {};
      if (!title || typeof title !== 'string') { res.status(400).json({ ok: false, error: 'title 必填' }); return; }
      const VALID_STATUSES = ['todo', 'in_progress', 'pending', 'done'];
      const VALID_PRIORITIES = ['low', 'medium', 'high'];
      const st = VALID_STATUSES.includes(status) ? status : 'todo';
      const pr = VALID_PRIORITIES.includes(priority) ? priority : 'medium';
      const id = uuid();
      await db.insertBoardItem({ id, user_id: userId, title: title.trim(), description: description?.trim() || undefined, status: st, priority: pr });
      const item = await db.getBoardItem(id);
      res.json({ ok: true, item });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '创建失败' });
    }
  });

  router.patch('/x/board/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const existing = await db.getBoardItem(req.params.id);
      if (!existing || existing.user_id !== userId) { res.status(404).json({ ok: false, error: '未找到该项' }); return; }
      const VALID_STATUSES = ['todo', 'in_progress', 'pending', 'done'];
      const VALID_PRIORITIES = ['low', 'medium', 'high'];
      const fields: Record<string, unknown> = {};
      if (req.body.title !== undefined) fields.title = String(req.body.title).trim();
      if (req.body.description !== undefined) fields.description = String(req.body.description).trim();
      if (req.body.status !== undefined && VALID_STATUSES.includes(req.body.status)) fields.status = req.body.status;
      if (req.body.priority !== undefined && VALID_PRIORITIES.includes(req.body.priority)) fields.priority = req.body.priority;
      if (req.body.sort_order !== undefined) fields.sort_order = Number(req.body.sort_order);
      await db.updateBoardItem(req.params.id, fields);
      const updated = await db.getBoardItem(req.params.id);
      res.json({ ok: true, item: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '更新失败' });
    }
  });

  router.delete('/x/board/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const existing = await db.getBoardItem(req.params.id);
      if (!existing || existing.user_id !== userId) { res.status(404).json({ ok: false, error: '未找到该项' }); return; }
      await db.deleteBoardItem(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '删除失败' });
    }
  });

  return router;
}
