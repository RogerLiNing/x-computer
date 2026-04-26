import os from 'os';
import fs from 'fs';
import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

function getDiskUsage(): Array<{ mount: string; total: number; free: number; usedPercent: number }> {
  try {
    // Node 18+ statfs
    if ('statfs' in fs) {
      const stats = (fs as typeof fs & { statfs(path: string): { bsize: number; blocks: number; bfree: number } }).statfs('/');
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      return [{ mount: '/', total, free, usedPercent: Math.round((used / total) * 100) }];
    }
  } catch { /* ignore */ }
  return [];
}

export function createSystemHealthRouter(db: AsyncDatabase): Router {
  const router = Router();

  // GET /api/admin/health — 完整系统健康状态
  router.get('/', async (_req, res) => {
    const start = Date.now();
    const mem = process.memoryUsage();
    const sysTotal = os.totalmem();
    const sysFree = os.freemem();

    // 任务统计
    let tasks = { total: 0, pending: 0, running: 0, completed: 0, failed: 0 };
    try {
      const taskRow = await db.queryOne<{ total: number; pending: number; running: number; completed: number; failed: number }>(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status IN ('pending','queued') THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM tasks`
      );
      if (taskRow) tasks = taskRow;
    } catch { /* ignore */ }

    // 数据库状态
    let dbStatus: 'ok' | 'error' = 'ok';
    let dbError: string | undefined;
    try {
      await db.queryOne<{ cnt: number }>('SELECT 1 as cnt');
      dbStatus = 'ok';
    } catch (err) {
      dbStatus = 'error';
      dbError = String(err);
    }

    const latency = Date.now() - start;

    res.json({
      success: true,
      data: {
        uptime: Math.floor(process.uptime()),
        memory: {
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          rss: mem.rss,
          systemTotal: sysTotal,
          systemFree: sysFree,
          systemUsedPercent: Math.round(((sysTotal - sysFree) / sysTotal) * 100),
          heapUsedPercent: mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0,
        },
        cpu: {
          loadavg: os.loadavg(),
          cores: os.cpus().length,
        },
        tasks,
        database: {
          dialect: db.getDialect(),
          status: dbStatus,
          error: dbError,
        },
        disk: getDiskUsage(),
        version: process.version,
        pid: process.pid,
        timestamp: Date.now(),
      },
      meta: { latencyMs: latency },
    });
  });

  // GET /api/admin/health/stats — 快速统计
  router.get('/stats', async (_req, res) => {
    try {
      const mem = process.memoryUsage();
      const loadavg = os.loadavg();
      const sysTotal = os.totalmem();
      const sysFree = os.freemem();

      const taskRow = await db.queryOne<{ total: number; pending: number; running: number }>(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN status IN ('pending','queued') THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running
         FROM tasks`
      );

      res.json({
        success: true,
        data: {
          uptime: Math.floor(process.uptime()),
          memoryUsedPercent: mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0,
          systemUsedPercent: Math.round(((sysTotal - sysFree) / sysTotal) * 100),
          loadavg1m: loadavg[0],
          cores: os.cpus().length,
          tasks: {
            total: taskRow?.total ?? 0,
            pending: taskRow?.pending ?? 0,
            running: taskRow?.running ?? 0,
          },
          dbStatus: 'ok',
          disk: getDiskUsage(),
        },
      });
    } catch (err) {
      serverLogger.error('system-health', 'stats 失败', String(err));
      res.status(500).json({ success: false, error: '获取统计失败' });
    }
  });

  return router;
}
