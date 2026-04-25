import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createScheduledJobsRouter(db: AsyncDatabase): Router {
  const router = Router();

  // GET /api/scheduled-jobs — 列出当前用户所有定时任务
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const jobs = await db.listScheduledJobsByUser(userId);
      res.json({ success: true, data: jobs.map(mapJob) });
    } catch (err) {
      serverLogger.error('scheduled-jobs', '列表失败', String(err));
      res.status(500).json({ success: false, error: '获取定时任务列表失败' });
    }
  });

  // POST /api/scheduled-jobs — 创建定时任务
  router.post('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { name, intent, cron, nextRun } = req.body as {
        name?: string;
        intent?: string;
        cron?: string;
        nextRun?: number;
      };
      if (!intent) {
        res.status(400).json({ success: false, error: 'intent 必填' });
        return;
      }
      const id = crypto.randomUUID();
      const now = Date.now();
      const runAt = nextRun ?? (cron ? now + 60000 : now);
      await db.insertScheduledJob({
        id,
        user_id: userId,
        name: name ?? null,
        intent,
        run_at: runAt,
        cron: cron ?? null,
        enabled: true,
        next_run: runAt,
        created_at: now,
      });
      serverLogger.info('scheduled-jobs', '定时任务已创建', `id=${id} userId=${userId} intent=${intent}`);
      res.json({ success: true, data: { id, userId, name: name ?? intent, intent, cron: cron ?? null, enabled: true, nextRun: runAt, createdAt: now } });
    } catch (err) {
      serverLogger.error('scheduled-jobs', '创建失败', String(err));
      res.status(500).json({ success: false, error: '创建定时任务失败' });
    }
  });

  // GET /api/scheduled-jobs/:id — 获取单个任务
  router.get('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const jobs = await db.listScheduledJobsByUser(userId);
      const job = jobs.find((j) => j.id === req.params.id);
      if (!job) { res.status(404).json({ success: false, error: '定时任务不存在' }); return; }
      res.json({ success: true, data: mapJob(job) });
    } catch (err) {
      serverLogger.error('scheduled-jobs', '获取失败', String(err));
      res.status(500).json({ success: false, error: '获取定时任务失败' });
    }
  });

  // PUT /api/scheduled-jobs/:id — 更新任务
  router.put('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const jobs = await db.listScheduledJobsByUser(userId);
      const job = jobs.find((j) => j.id === req.params.id);
      if (!job) { res.status(404).json({ success: false, error: '定时任务不存在' }); return; }

      const { name, intent, cron, enabled, nextRun } = req.body as {
        name?: string;
        intent?: string;
        cron?: string | null;
        enabled?: boolean;
        nextRun?: number | null;
      };
      await db.updateScheduledJob(req.params.id, {
        name,
        intent,
        cron,
        enabled,
        next_run: nextRun,
      });
      serverLogger.info('scheduled-jobs', '定时任务已更新', `id=${req.params.id}`);
      const updated = await db.listScheduledJobsByUser(userId);
      const updatedJob = updated.find((j) => j.id === req.params.id);
      res.json({ success: true, data: updatedJob ? mapJob(updatedJob) : null });
    } catch (err) {
      serverLogger.error('scheduled-jobs', '更新失败', String(err));
      res.status(500).json({ success: false, error: '更新定时任务失败' });
    }
  });

  // DELETE /api/scheduled-jobs/:id — 删除任务
  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const jobs = await db.listScheduledJobsByUser(userId);
      const job = jobs.find((j) => j.id === req.params.id);
      if (!job) { res.status(404).json({ success: false, error: '定时任务不存在' }); return; }
      await db.deleteScheduledJob(req.params.id);
      serverLogger.info('scheduled-jobs', '定时任务已删除', `id=${req.params.id}`);
      res.json({ success: true, data: { message: '定时任务已删除' } });
    } catch (err) {
      serverLogger.error('scheduled-jobs', '删除失败', String(err));
      res.status(500).json({ success: false, error: '删除定时任务失败' });
    }
  });

  // POST /api/scheduled-jobs/:id/toggle — 启用/禁用任务
  router.post('/:id/toggle', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const jobs = await db.listScheduledJobsByUser(userId);
      const job = jobs.find((j) => j.id === req.params.id);
      if (!job) { res.status(404).json({ success: false, error: '定时任务不存在' }); return; }
      const newEnabled = !job.enabled;
      await db.updateScheduledJob(req.params.id, { enabled: newEnabled });
      serverLogger.info('scheduled-jobs', `定时任务已${newEnabled ? '启用' : '禁用'}`, `id=${req.params.id}`);
      res.json({ success: true, data: { id: req.params.id, enabled: newEnabled } });
    } catch (err) {
      serverLogger.error('scheduled-jobs', '切换失败', String(err));
      res.status(500).json({ success: false, error: '切换定时任务状态失败' });
    }
  });

  return router;
}

function mapJob(row: {
  id: string; user_id: string; name: string | null; intent: string;
  run_at: number; cron: string | null; enabled: number; next_run: number | null; created_at: number;
}) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    intent: row.intent,
    cron: row.cron,
    enabled: !!row.enabled,
    nextRun: row.next_run ?? row.run_at,
    createdAt: row.created_at,
  };
}
