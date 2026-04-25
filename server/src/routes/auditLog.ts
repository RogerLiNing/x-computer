import { Router } from 'express';
import type { AppDatabase, AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createAuditLogRouter(db: AppDatabase | AsyncDatabase): Router {
  const router = Router();

  // GET /api/audit-log — query audit logs with filters
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { taskId, type, riskLevel, startTime, endTime, limit, offset } = req.query as Record<string, string | undefined>;

      const parsedLimit = limit ? Math.min(parseInt(limit), 500) : 100;
      const parsedOffset = offset ? parseInt(offset) : 0;

      // Check if the user is an admin — admins can see all logs
      const isAdmin = (req as any).isAdmin;
      const queryUserId = isAdmin ? (userId !== 'anonymous' ? userId : undefined) : userId;

      const { rows, total } = await db.queryAudit({
        userId: queryUserId,
        taskId: taskId || undefined,
        type: type || undefined,
        riskLevel: riskLevel || undefined,
        startTime: startTime ? parseInt(startTime) : undefined,
        endTime: endTime ? parseInt(endTime) : undefined,
        limit: parsedLimit,
        offset: parsedOffset,
      });

      const entries = (Array.isArray(rows) ? rows : []).map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        taskId: r.task_id,
        stepId: r.step_id,
        type: r.type,
        intent: r.intent,
        action: r.action,
        result: r.result,
        riskLevel: r.risk_level,
        metadata: r.metadata_json ? (() => { try { return JSON.parse(r.metadata_json); } catch { return null; } })() : null,
        createdAt: r.created_at,
      }));

      res.json({
        success: true,
        data: entries,
        meta: {
          total: typeof total === 'number' ? total : 0,
          limit: parsedLimit,
          offset: parsedOffset,
        },
      });
    } catch (err) {
      serverLogger.error('audit-log', '查询审计日志失败', String(err));
      res.status(500).json({ success: false, error: '查询审计日志失败' });
    }
  });

  // GET /api/audit-log/stats — aggregate statistics
  router.get('/stats', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const isAdmin = (req as any).isAdmin;
      const queryUserId = isAdmin && userId !== 'anonymous' ? userId : userId;

      // Count by type
      const { rows } = await db.queryAudit({ userId: queryUserId, limit: 10000 });
      const byType: Record<string, number> = {};
      let total = 0;
      for (const r of rows as any[]) {
        const t = r.type ?? 'unknown';
        byType[t] = (byType[t] ?? 0) + 1;
        total++;
      }

      res.json({
        success: true,
        data: { total, byType },
      });
    } catch (err) {
      serverLogger.error('audit-log', '获取审计统计失败', String(err));
      res.status(500).json({ success: false, error: '获取审计统计失败' });
    }
  });

  return router;
}
