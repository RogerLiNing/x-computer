import {backgroundAutostartEnabled} from '../config/backgroundRuntime.js';
import { Router } from 'express';
import { getDefaultScheduler } from '../scheduler/XScheduler.js';
import type { AppDatabase } from '../db/database.js';
import type { ScheduledOccurrenceService } from '../scheduler/ScheduledOccurrenceService.js';

export function createSchedulerRouter(db?: AppDatabase, getOccurrences?: () => ScheduledOccurrenceService | undefined): Router {
  const router = Router();

  /** 定时任务状态：是否在跑、任务数，下次运行时间，便于确认定时是否正常 */
  router.get('/x/scheduler-status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const scheduler = getDefaultScheduler();
      if (!scheduler) {
        return res.json({ backgroundAutostart:backgroundAutostartEnabled(),running: false, jobCount: 0, nextRunAt: null, nextRunAtISO: null, jobs: [] });
      }
      await scheduler.loadJobs();
      const stats = scheduler.getStats(userId ?? undefined);
      const list = scheduler.listJobs(userId ?? undefined);
      res.json({
        running: scheduler.isRunning(),
        backgroundAutostart:backgroundAutostartEnabled(),
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

  router.get('/x/scheduled-jobs', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const scheduler = getDefaultScheduler();
      await scheduler?.loadJobs();
      const list = scheduler ? scheduler.listJobs(userId) : [];
      res.json({ jobs: list });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  router.get('/x/scheduled-runs', async (req, res) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    const focus = req.query.focus;
    if (focus !== undefined && (typeof focus !== 'string' || !/^[a-f0-9]{32}$/.test(focus))) {
      return res.status(400).json({ error: '执行记录编号无效' });
    }
    try { res.json({ runs: await getOccurrences?.()?.list(req.userId, focus) ?? [] }); }
    catch { res.status(503).json({ error: '执行记录暂不可用' }); }
  });
  router.post('/x/scheduled-runs/:id/stop', async (req, res) => {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    const service = getOccurrences?.();
    if (!service) return res.status(503).json({ error: '调度服务未就绪' });
    try { await service.cancel(req.userId, req.params.id); res.json({ success: true }); }
    catch { res.status(404).json({ error: '执行记录不存在、无权访问或暂时无法停止' }); }
  });

  /** POST /api/reminders — 创建提醒 */
  router.post('/reminders', async (req, res) => {
    try {
    const userId = (req as { userId?: string }).userId ?? '';
    if (!userId||userId==='anonymous') { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { message, at, sessionId } = req.body ?? {};
    if (typeof message !== 'string'||!message.trim()||message.length>2000) {
      res.status(400).json({ error: 'Missing message' });
      return;
    }

    let runAtMs: number;
    if (at!==undefined&&at!==null&&(typeof at==='string'||typeof at==='number')) {
      runAtMs = typeof at === 'number' ? at : new Date(at).getTime();
    } else {
      res.status(400).json({ error: 'Missing at (ISO string or timestamp)' });
      return;
    }
    if (!Number.isFinite(runAtMs)) return res.status(400).json({ error: '执行时间无效' });
    if (sessionId!==undefined&&sessionId!==null&&(typeof sessionId!=='string'||!sessionId.trim()||!db||(await db.getSession(sessionId))?.user_id!==userId)) {
      return res.status(400).json({ error: '提醒会话不存在或无权访问' });
    }

    const scheduler = getDefaultScheduler();
    if (!scheduler) { res.status(503).json({ error: 'Scheduler not available' }); return; }
    if(!db){res.status(503).json({error:'提醒存储未就绪'});return;}
    const targetSession=sessionId|| (await db.createSession(userId,'我的提醒','normal_chat')).id;

    const job = await scheduler.addJob(
      userId,
      message.trim(),
      runAtMs,
      undefined, // cron
      undefined, // inMinutes
      undefined, // inHours
      targetSession,
      `提醒: ${message.slice(0, 40)}`,
    );

    res.status(201).json({
      id: job.id,
      intent: job.intent,
      runAt: job.runAt,
      runAtISO: new Date(job.runAt).toISOString(),
      sessionId: job.sessionId,
      backgroundPaused:!backgroundAutostartEnabled(),
    });
    } catch { res.status(503).json({ error: '提醒尚未保存，请稍后重试' }); }
  });

  /** DELETE /api/reminders/:id — 删除提醒 */
  router.delete('/reminders/:id', async (req, res) => {
    try {
    const userId = (req as { userId?: string }).userId ?? '';
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const scheduler = getDefaultScheduler();
    if (!scheduler) { res.status(503).json({ error: 'Scheduler not available' }); return; }

    await scheduler.loadJobs();
    const job = scheduler.listJobs(userId).find((j) => j.id === req.params.id);
    if (!job) { res.status(404).json({ error: 'Reminder not found' }); return; }
    if (job.userId !== userId) { res.status(403).json({ error: 'Forbidden' }); return; }

    await scheduler.removeJob(job.id);
    res.json({ success: true });
    } catch { res.status(503).json({ error: '提醒尚未取消，请稍后重试' }); }
  });

  /** GET /api/reminders — 列出当前用户的提醒 */
  router.get('/reminders', async (req, res) => {
    try {
    const userId = (req as { userId?: string }).userId ?? '';
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const scheduler = getDefaultScheduler();
    await scheduler?.loadJobs();
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
    } catch { res.status(503).json({ error: '提醒暂不可用' }); }
  });

  return router;
}

