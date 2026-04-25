import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createUsageAnalyticsRouter(db: AsyncDatabase): Router {
  const router = Router();

  /** 解析 days 参数，默认 30 */
  function parseDaysParam(daysStr: string | undefined, defaultDays = 30): number {
    if (!daysStr) return defaultDays;
    const n = parseInt(daysStr, 10);
    return isNaN(n) || n < 1 || n > 365 ? defaultDays : n;
  }

  /** 计算日期范围（UTC 0点） */
  function dateRange(days: number): { start: number; end: number } {
    const now = Date.now();
    const end = Math.floor(now / 86400000) * 86400000; // 当天 UTC 0点
    const start = end - days * 86400000;
    return { start, end };
  }

  // GET /api/admin/usage/overview — 获取当前用户使用量总览
  router.get('/overview', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const days = parseDaysParam(req.query.days as string, 30);
      const { start, end } = dateRange(days);

      // AI 调用量统计
      const aiCalls = await db.queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) as total FROM usage_records
         WHERE user_id = ? AND resource_type = 'ai_calls' AND created_at >= ? AND created_at < ?`,
        [userId, start, end]
      );

      // 任务统计
      const [taskStats, taskDaily] = await Promise.all([
        db.queryOne<{ total: number; completed: number; failed: number }>(
          `SELECT
             COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
           FROM tasks WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
          [userId, start, end]
        ),
        db.queryAll<{ date: number; count: number; status: string }>(
          `SELECT
             (created_at / 86400000) * 86400000 as date,
             COUNT(*) as count,
             status
           FROM tasks
           WHERE user_id = ? AND created_at >= ? AND created_at < ?
           GROUP BY date, status
           ORDER BY date ASC`,
          [userId, start, end]
        ),
      ]);

      // 每日 API 调用趋势
      const apiDaily = await db.queryAll<{ date: number; total: number }>(
        `SELECT
           (created_at / 86400000) * 86400000 as date,
           SUM(amount) as total
         FROM usage_records
         WHERE user_id = ? AND resource_type = 'ai_calls' AND created_at >= ? AND created_at < ?
         GROUP BY date
         ORDER BY date ASC`,
        [userId, start, end]
      );

      // 按资源类型统计
      const byResourceType = await db.queryAll<{ resource_type: string; total: number }>(
        `SELECT resource_type, SUM(amount) as total
         FROM usage_records
         WHERE user_id = ? AND created_at >= ? AND created_at < ?
         GROUP BY resource_type
         ORDER BY total DESC`,
        [userId, start, end]
      );

      // 最新任务
      const recentTasks = await db.queryAll<{
        id: string;
        title: string;
        status: string;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT id, COALESCE(title, domain) as title, status, created_at, updated_at
         FROM tasks WHERE user_id = ?
         ORDER BY updated_at DESC LIMIT 5`,
        [userId]
      );

      res.json({
        success: true,
        data: {
          period: { days, start, end },
          aiCalls: aiCalls?.total ?? 0,
          tasks: {
            total: taskStats?.total ?? 0,
            completed: taskStats?.completed ?? 0,
            failed: taskStats?.failed ?? 0,
          },
          byResourceType: byResourceType.map((r) => ({ type: r.resource_type, total: r.total })),
          dailyApiCalls: apiDaily.map((d) => ({ date: new Date(d.date).toISOString().slice(0, 10), count: d.total })),
          dailyTaskCounts: taskDaily.map((d) => ({
            date: new Date(d.date).toISOString().slice(0, 10),
            count: d.count,
            status: d.status,
          })),
          recentTasks: recentTasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            createdAt: new Date(t.created_at).toISOString(),
            updatedAt: new Date(t.updated_at).toISOString(),
          })),
        },
      });
    } catch (err) {
      serverLogger.error('usage-analytics', '获取使用量总览失败', String(err));
      res.status(500).json({ success: false, error: '获取使用量总览失败' });
    }
  });

  // GET /api/admin/usage/summary — 简洁的使用量摘要（供小组件使用）
  router.get('/summary', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const days = parseDaysParam(req.query.days as string, 7);

      const { start, end } = dateRange(days);
      const prevStart = start - days * 86400000;
      const prevEnd = start;

      // 当前周期
      const current = await db.queryOne<{
        aiCalls: number;
        tasks: number;
        completedTasks: number;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0) FROM usage_records WHERE user_id = ? AND resource_type = 'ai_calls' AND created_at >= ? AND created_at < ?) as aiCalls,
           (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND created_at >= ? AND created_at < ?) as tasks,
           (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?) as completedTasks`,
        [userId, start, end, userId, start, end, userId, start, end]
      );

      // 上周期（用于趋势比较）
      const previous = await db.queryOne<{
        aiCalls: number;
        tasks: number;
        completedTasks: number;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0) FROM usage_records WHERE user_id = ? AND resource_type = 'ai_calls' AND created_at >= ? AND created_at < ?) as aiCalls,
           (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND created_at >= ? AND created_at < ?) as tasks,
           (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?) as completedTasks`,
        [userId, prevStart, prevEnd, userId, prevStart, prevEnd, userId, prevStart, prevEnd]
      );

      function trend(current: number, previous: number): number {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      }

      res.json({
        success: true,
        data: {
          period: { days, label: `最近${days}天` },
          current: {
            aiCalls: current?.aiCalls ?? 0,
            tasks: current?.tasks ?? 0,
            completedTasks: current?.completedTasks ?? 0,
          },
          previous: {
            aiCalls: previous?.aiCalls ?? 0,
            tasks: previous?.tasks ?? 0,
            completedTasks: previous?.completedTasks ?? 0,
          },
          trends: {
            aiCalls: trend(current?.aiCalls ?? 0, previous?.aiCalls ?? 0),
            tasks: trend(current?.tasks ?? 0, previous?.tasks ?? 0),
            completedTasks: trend(current?.completedTasks ?? 0, previous?.completedTasks ?? 0),
          },
        },
      });
    } catch (err) {
      serverLogger.error('usage-analytics', '获取使用量摘要失败', String(err));
      res.status(500).json({ success: false, error: '获取使用量摘要失败' });
    }
  });

  // GET /api/admin/usage/daily — 每日使用量详细数据
  router.get('/daily', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const days = parseDaysParam(req.query.days as string, 30);
      const { start, end } = dateRange(days);

      const rows = await db.queryAll<{
        date: number;
        resource_type: string;
        total: number;
      }>(
        `SELECT
           (created_at / 86400000) * 86400000 as date,
           resource_type,
           SUM(amount) as total
         FROM usage_records
         WHERE user_id = ? AND created_at >= ? AND created_at < ?
         GROUP BY date, resource_type
         ORDER BY date ASC`,
        [userId, start, end]
      );

      // 同时获取每日任务数
      const taskRows = await db.queryAll<{ date: number; status: string; count: number }>(
        `SELECT
           (created_at / 86400000) * 86400000 as date,
           status,
           COUNT(*) as count
         FROM tasks
         WHERE user_id = ? AND created_at >= ? AND created_at < ?
         GROUP BY date, status
         ORDER BY date ASC`,
        [userId, start, end]
      );

      // 合并数据
      type DailyData = Record<string, {
        date: string;
        aiCalls: number;
        tasks: number;
        completedTasks: number;
        failedTasks: number;
      }>;

      const dailyMap: DailyData = {};
      const addDate = (dateNum: number) => {
        const key = new Date(dateNum).toISOString().slice(0, 10);
        if (!dailyMap[key]) {
          dailyMap[key] = { date: key, aiCalls: 0, tasks: 0, completedTasks: 0, failedTasks: 0 };
        }
      };

      for (const row of rows) {
        addDate(row.date);
        if (row.resource_type === 'ai_calls') {
          dailyMap[new Date(row.date).toISOString().slice(0, 10)].aiCalls += row.total;
        }
      }
      for (const row of taskRows) {
        addDate(row.date);
        const key = new Date(row.date).toISOString().slice(0, 10);
        if (row.status === 'completed') dailyMap[key].completedTasks += row.count;
        else if (row.status === 'failed') dailyMap[key].failedTasks += row.count;
        else dailyMap[key].tasks += row.count;
      }

      const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

      res.json({ success: true, data: { period: { days, start, end }, daily } });
    } catch (err) {
      serverLogger.error('usage-analytics', '获取每日使用量失败', String(err));
      res.status(500).json({ success: false, error: '获取每日使用量失败' });
    }
  });

  // GET /api/admin/usage/tasks — 任务详细统计
  router.get('/tasks', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const days = parseDaysParam(req.query.days as string, 30);
      const { start, end } = dateRange(days);

      const byStatus = await db.queryAll<{ status: string; count: number }>(
        `SELECT status, COUNT(*) as count
         FROM tasks WHERE user_id = ? AND created_at >= ? AND created_at < ?
         GROUP BY status
         ORDER BY count DESC`,
        [userId, start, end]
      );

      const byDomain = await db.queryAll<{ domain: string; count: number }>(
        `SELECT domain, COUNT(*) as count
         FROM tasks WHERE user_id = ? AND created_at >= ? AND created_at < ?
         GROUP BY domain
         ORDER BY count DESC
         LIMIT 10`,
        [userId, start, end]
      );

      const topTasks = await db.queryAll<{
        id: string;
        title: string;
        domain: string;
        status: string;
        created_at: number;
        updated_at: number;
      }>(
        `SELECT id, COALESCE(title, domain) as title, domain, status, created_at, updated_at
         FROM tasks WHERE user_id = ? AND created_at >= ? AND created_at < ?
         ORDER BY updated_at DESC
         LIMIT 20`,
        [userId, start, end]
      );

      // 平均每天任务数
      const avgTasksPerDay = days > 0
        ? Math.round((byStatus.reduce((s, r) => s + r.count, 0) / days) * 10) / 10
        : 0;

      res.json({
        success: true,
        data: {
          period: { days, start, end },
          byStatus: byStatus.map((r) => ({ status: r.status, count: r.count })),
          byDomain: byDomain.map((r) => ({ domain: r.domain, count: r.count })),
          topTasks: topTasks.map((t) => ({
            id: t.id,
            title: t.title,
            domain: t.domain,
            status: t.status,
            createdAt: new Date(t.created_at).toISOString(),
            updatedAt: new Date(t.updated_at).toISOString(),
          })),
          avgTasksPerDay,
        },
      });
    } catch (err) {
      serverLogger.error('usage-analytics', '获取任务统计失败', String(err));
      res.status(500).json({ success: false, error: '获取任务统计失败' });
    }
  });

  return router;
}
