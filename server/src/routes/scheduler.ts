import { Router } from 'express';
import { getDefaultScheduler } from '../scheduler/XScheduler.js';
import type { AppDatabase } from '../db/database.js';

export function createSchedulerRouter(db?: AppDatabase): Router {
  const router = Router();

  /** 定时任务状态：是否在跑、任务数，下次运行时间，便于确认定时是否正常 */
  router.get('/x/scheduler-status', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const scheduler = getDefaultScheduler();
      if (!scheduler) {
        return res.json({ running: false, jobCount: 0, nextRunAt: null, nextRunAtISO: null, jobs: [] });
      }
      const stats = scheduler.getStats(userId ?? undefined);
      const list = scheduler.listJobs(userId ?? undefined);
      res.json({
        running: scheduler.isRunning(),
        jobCount: stats.jobCount,
        nextRunAt: stats.nextRunAt,
        nextRunAtISO: stats.nextRunAt != null ? new Date(stats.nextRunAt).toISOString() : null,
        jobs: list.map((j) => ({
          id: j.id,
          name: j.name,
          intent: j.intent.slice(0, 80),
          runAt: j.runAt,
          runAtISO: new Date(j.runAt).toISOString(),
          cron: j.cron,
          sessionId: j.sessionId,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.get('/x/scheduled-jobs', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const scheduler = getDefaultScheduler();
      const list = scheduler ? scheduler.listJobs(userId) : [];
      res.json({ jobs: list });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  /** POST /api/reminders — 创建提醒 */
  router.post('/reminders', async (req, res) => {
    const userId = (req as { userId?: string }).userId ?? '';
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { message, at, sessionId } = req.body ?? {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Missing message' });
      return;
    }

    let runAtMs: number;
    if (at) {
      runAtMs = typeof at === 'number' ? at : new Date(at).getTime();
    } else {
      res.status(400).json({ error: 'Missing at (ISO string or timestamp)' });
      return;
    }

    const scheduler = getDefaultScheduler();
    if (!scheduler) { res.status(503).json({ error: 'Scheduler not available' }); return; }

    const job = scheduler.addJob(
      userId,
      message,
      runAtMs,
      undefined, // cron
      undefined, // inMinutes
      undefined, // inHours
      sessionId && typeof sessionId === 'string' ? sessionId : undefined,
      `提醒: ${message.slice(0, 40)}`,
    );

    res.status(201).json({
      id: job.id,
      intent: job.intent,
      runAt: job.runAt,
      runAtISO: new Date(job.runAt).toISOString(),
      sessionId: job.sessionId,
    });
  });

  /** DELETE /api/reminders/:id — 删除提醒 */
  router.delete('/reminders/:id', (req, res) => {
    const userId = (req as { userId?: string }).userId ?? '';
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const scheduler = getDefaultScheduler();
    if (!scheduler) { res.status(503).json({ error: 'Scheduler not available' }); return; }

    const job = scheduler.listJobs(userId).find((j) => j.id === req.params.id);
    if (!job) { res.status(404).json({ error: 'Reminder not found' }); return; }
    if (job.userId !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }

    scheduler.removeJob(job.id);
    res.json({ success: true });
  });

  /** GET /api/reminders — 列出当前用户的提醒 */
  router.get('/reminders', (req, res) => {
    const userId = (req as { userId?: string }).userId ?? '';
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const scheduler = getDefaultScheduler();
    const list = scheduler ? scheduler.listJobs(userId).filter((j) => !!j.sessionId) : [];
    res.json({
      reminders: list.map((j) => ({
        id: j.id,
        name: j.name,
        intent: j.intent,
        runAt: j.runAt,
        runAtISO: new Date(j.runAt).toISOString(),
        sessionId: j.sessionId,
        cron: j.cron,
      })),
    });
  });

  return router;
}

