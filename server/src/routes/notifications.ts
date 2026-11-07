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
const DND_DEFAULTS={enabled:false,quietHoursStart:null as string|null,quietHoursEnd:null as string|null};
const DND_KEYS=['enabled','quietHoursStart','quietHoursEnd'] as const;
function validDnd(value:unknown):value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const prefs=value as Record<string,unknown>;
  return (prefs.enabled===undefined||typeof prefs.enabled==='boolean')&&['quietHoursStart','quietHoursEnd'].every(key=>prefs[key]===undefined||prefs[key]===null||typeof prefs[key]==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(prefs[key] as string));
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

  // GET /api/notifications/dnd — 获取 DND 免打扰设置
  router.get('/dnd', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const row = await db.queryOne<{ value: string }>(
        'SELECT value FROM user_config WHERE user_id = ? AND `key` = ?',
        [userId, 'dnd_preferences'],
      );
      if (row?.value) {
        const prefs=JSON.parse(row.value);if(!validDnd(prefs))throw new Error('已有免打扰设置格式无效');
        res.json({ success: true, data: {enabled:prefs.enabled??false,quietHoursStart:prefs.quietHoursStart??null,quietHoursEnd:prefs.quietHoursEnd??null} });
      } else {
        res.json({ success: true, data: { enabled: false, quietHoursStart: null, quietHoursEnd: null } });
      }
    } catch (err) {
      serverLogger.error('notifications', '获取 DND 设置失败', String(err));
      res.status(500).json({ success: false, error: '获取 DND 设置失败' });
    }
  });

  // PUT /api/notifications/dnd — 保存 DND 免打扰设置
  router.put('/dnd', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const prefs=req.body;if(!validDnd(prefs)||!DND_KEYS.some(key=>prefs[key]!==undefined)){res.status(400).json({error:'免打扰参数无效'});return;}
      const original=await db.getConfig(userId,'dnd_preferences');
      if(original!==undefined){try{if(!validDnd(JSON.parse(original)))throw Error('invalid');}catch{res.status(409).json({error:'已有设置格式异常，已保留原数据，请检查后重试'});return;}}
      const sqlite=db.getDialect()==='sqlite',keys=DND_KEYS.filter(key=>prefs[key]!==undefined),values=keys.map(key=>JSON.stringify(prefs[key])),now=sqlite?Date.now():new Date().toISOString().slice(0,19).replace('T',' ');
      await db.run(`${sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO user_config(user_id,\`key\`,value,updated_at) VALUES (?,'dnd_preferences',?,?)`,[userId,JSON.stringify(DND_DEFAULTS),now]);
      const edits=keys.map(key=>`'$.${key}',${sqlite?'json(?)':'CAST(? AS JSON)'}`).join(',');
      await db.run(`UPDATE user_config SET value=${sqlite?'json_set':'JSON_SET'}(value,${edits}),updated_at=? WHERE user_id=? AND \`key\`='dnd_preferences' AND ${sqlite?"json_type(value)='object'":"JSON_TYPE(value)='OBJECT'"}`,[...values,now,userId]);
      const saved=JSON.parse(await db.getConfig(userId,'dnd_preferences')??'null');
      if(!validDnd(saved)||keys.some(key=>saved[key]!==prefs[key])){res.status(409).json({error:'设置已变化，请重新查看后再试'});return;}
      res.json({ success: true });
    } catch (err) {
      serverLogger.error('notifications', '保存 DND 设置失败', String(err));
      res.status(500).json({ success: false, error: '保存 DND 设置失败' });
    }
  });

  return router;
}
