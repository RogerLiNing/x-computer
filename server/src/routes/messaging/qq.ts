import { Router } from 'express';
import type { AppDatabase } from '../../db/database.js';
import { getQQConnection, disconnectQQ, reconnectQQ, parseQQConfig } from '../../qq/qqService.js';

export function createQQRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/qq/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseQQConfig(await db.getConfig(userId, 'qq_config'));
      const conn = getQQConnection(userId, db.getConfig.bind(db));
      const selfOpenid = await db.getConfig(userId, 'qq_self_openid');
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), botInfo: conn.getBotInfo(), dmPolicy: config?.dmPolicy ?? 'open', groupPolicy: config?.groupPolicy ?? 'open', selfOpenid: selfOpenid ?? null });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  router.post('/qq/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseQQConfig(await db.getConfig(userId, 'qq_config'));
      if (!config?.enabled || !config.appId || !config.secret) { res.status(400).json({ ok: false, error: '请先启用并填写 AppID 和 Secret' }); return; }
      disconnectQQ(userId);
      const conn = getQQConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.appId, config.secret, config.sandbox);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  router.post('/qq/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectQQ(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  /** 手动重连 QQ Bot（清除自动重连计数并重新连接） */
  router.post('/qq/reconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const result = await reconnectQQ(userId, db.getConfig.bind(db));
      if (result.ok) res.json({ ok: true, message: '重连成功' });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '重连失败' }); }
  });

  router.get('/qq/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'qq', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
  });

  return router;
}
