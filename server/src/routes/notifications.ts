import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: number;
  expiresAt: number | null;
}

function toNotification(row: { id: string; user_id: string; type: string; title: string; body: string | null; link: string | null; read: number; created_at: number; expires_at: number | null }): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: !!row.read,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createNotificationsRouter(db: AsyncDatabase): Router {
  const router = Router();

  // GET /api/notifications — 获取通知列表
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
      const includeRead = req.query.includeRead === 'true';
      const notifications = await db.getNotifications(userId, { limit, includeRead });
      res.json({ success: true, data: notifications.map(toNotification) });
    } catch (err) {
      serverLogger.error('notifications', '获取通知失败', String(err));
      res.status(500).json({ success: false, error: '获取通知失败' });
    }
  });

  // GET /api/notifications/unread-count — 获取未读数
  router.get('/unread-count', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const count = await db.getUnreadNotificationCount(userId);
      res.json({ success: true, data: { count } });
    } catch (err) {
      serverLogger.error('notifications', '获取未读数失败', String(err));
      res.status(500).json({ success: false, error: '获取未读数失败' });
    }
  });

  // PATCH /api/notifications/:id/read — 标记单条已读
  router.patch('/:id/read', async (req, res) => {
    try {
      const userId = (req as any).userId;
      await db.markNotificationRead(req.params.id, userId);
      res.json({ success: true });
    } catch (err) {
      serverLogger.error('notifications', '标记已读失败', String(err));
      res.status(500).json({ success: false, error: '标记已读失败' });
    }
  });

  // POST /api/notifications/mark-all-read — 全部已读
  router.post('/mark-all-read', async (req, res) => {
    try {
      const userId = (req as any).userId;
      await db.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (err) {
      serverLogger.error('notifications', '全部已读失败', String(err));
      res.status(500).json({ success: false, error: '全部已读失败' });
    }
  });

  // DELETE /api/notifications/:id — 删除单条通知
  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      await db.deleteNotification(req.params.id, userId);
      res.json({ success: true });
    } catch (err) {
      serverLogger.error('notifications', '删除通知失败', String(err));
      res.status(500).json({ success: false, error: '删除通知失败' });
    }
  });

  return router;
}
