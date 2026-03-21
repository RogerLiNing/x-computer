import { Router } from 'express';
import { getDefaultScheduler } from '../scheduler/XScheduler.js';

export function createSchedulerRouter(): Router {
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
          intent: j.intent.slice(0, 80),
          runAt: j.runAt,
          runAtISO: new Date(j.runAt).toISOString(),
          cron: j.cron,
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

  return router;
}
