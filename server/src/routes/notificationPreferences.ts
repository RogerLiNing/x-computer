import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface NotificationPreferences {
  inApp: boolean;
  email: boolean;
  taskEvents: boolean;
  approval: boolean;
  heartbeat: boolean;
  heartbeatDaily: boolean;
  webhook: boolean;
  system: boolean;
  skill: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

const bool = (v: boolean): number => (v ? 1 : 0);

const DEFAULT_PREFS: NotificationPreferences = {
  inApp: true,
  email: false,
  taskEvents: true,
  approval: true,
  heartbeat: true,
  heartbeatDaily: true,
  webhook: true,
  system: true,
  skill: true,
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
};

export function createNotificationPreferencesRouter(db: AsyncDatabase): Router {
  const router = Router();

  // GET /api/notification-preferences — 获取当前用户通知偏好
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const row = await db.queryOne<{
        user_id: string;
        in_app: number;
        email: number;
        task_events: number;
        approval: number;
        heartbeat: number;
        heartbeat_daily: number;
        webhook: number;
        system: number;
        skill: number;
        quiet_hours_enabled: number;
        quiet_hours_start: string | null;
        quiet_hours_end: string | null;
      }>('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]);

      if (!row) {
        res.json({ success: true, data: { ...DEFAULT_PREFS } });
        return;
      }

      res.json({
        success: true,
        data: {
          inApp: !!row.in_app,
          email: !!row.email,
          taskEvents: !!row.task_events,
          approval: !!row.approval,
          heartbeat: !!row.heartbeat,
          heartbeatDaily: !!row.heartbeat_daily,
          webhook: !!row.webhook,
          system: !!row.system,
          skill: !!row.skill,
          quietHoursEnabled: !!row.quiet_hours_enabled,
          quietHoursStart: row.quiet_hours_start,
          quietHoursEnd: row.quiet_hours_end,
        },
      });
    } catch (err) {
      serverLogger.error('notification-prefs', '获取通知偏好失败', String(err));
      res.status(500).json({ success: false, error: '获取通知偏好失败' });
    }
  });

  // PUT /api/notification-preferences — 更新通知偏好
  router.put('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const prefs = req.body as Partial<NotificationPreferences>;
      const now = Date.now();

      // 构建 INSERT OR REPLACE / INSERT ... ON DUPLICATE KEY UPDATE 语句
      const cols = ['user_id', 'updated_at', 'created_at',
        'in_app', 'email', 'task_events', 'approval',
        'heartbeat', 'heartbeat_daily', 'webhook',
        'system', 'skill', 'quiet_hours_enabled',
        'quiet_hours_start', 'quiet_hours_end'];

      const def = DEFAULT_PREFS;
      const vals: (string | number | null)[] = [
        userId, now, now,
        bool(prefs.inApp ?? def.inApp),
        bool(prefs.email ?? def.email),
        bool(prefs.taskEvents ?? def.taskEvents),
        bool(prefs.approval ?? def.approval),
        bool(prefs.heartbeat ?? def.heartbeat),
        bool(prefs.heartbeatDaily ?? def.heartbeatDaily),
        bool(prefs.webhook ?? def.webhook),
        bool(prefs.system ?? def.system),
        bool(prefs.skill ?? def.skill),
        bool(prefs.quietHoursEnabled ?? def.quietHoursEnabled),
        prefs.quietHoursStart ?? null,
        prefs.quietHoursEnd ?? null,
      ];

      const placeholders = vals.map(() => '?').join(', ');
      if (db.getDialect() === 'sqlite') {
        await db.run(
          `INSERT INTO notification_preferences (${cols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT(user_id) DO UPDATE SET ${cols.slice(1).map((c) => `${c}=excluded.${c}`).join(', ')}`,
          vals
        );
      } else {
        // MySQL
        await db.run(
          `INSERT INTO notification_preferences (${cols.join(', ')}) VALUES (${placeholders})
           ON DUPLICATE KEY UPDATE ${cols.slice(1).map((c) => `${c}=VALUES(${c})`).join(', ')}`,
          vals
        );
      }

      serverLogger.info('notification-prefs', '通知偏好已更新', `userId=${userId}`);
      res.json({ success: true, data: { message: '通知偏好已保存' } });
    } catch (err) {
      serverLogger.error('notification-prefs', '保存通知偏好失败', String(err));
      res.status(500).json({ success: false, error: '保存通知偏好失败' });
    }
  });

  return router;
}
