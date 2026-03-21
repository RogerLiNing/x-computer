import { Router } from 'express';
import type { AppDatabase } from '../../db/database.js';
import { parseSlackConfig, getSlackConnection, disconnectSlack } from '../../slack/slackService.js';

export function createSlackRouter(db: AppDatabase | undefined): Router {
  const router = Router();

  // GET /slack/status
  router.get('/slack/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseSlackConfig(await db.getConfig(userId, 'slack_config'));
      const conn = getSlackConnection(userId, db.getConfig.bind(db));
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), allowFrom: config?.allowFrom ?? [], dmPolicy: config?.dmPolicy ?? 'allowlist' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  // POST /slack/connect
  router.post('/slack/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseSlackConfig(await db.getConfig(userId, 'slack_config'));
      if (!config?.enabled || !config.botToken || !config.appToken) { res.status(400).json({ ok: false, error: '请先启用并填写 Bot Token 和 App Token' }); return; }
      disconnectSlack(userId);
      const conn = getSlackConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.botToken, config.appToken);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  // POST /slack/disconnect
  router.post('/slack/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectSlack(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  // GET /slack/inbox
  router.get('/slack/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'slack', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
  });

  return router;
}
