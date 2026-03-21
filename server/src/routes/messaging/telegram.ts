import { Router } from 'express';
import type { AppDatabase } from '../../db/database.js';
import { getTelegramConnection, disconnectTelegram, parseTelegramConfig } from '../../telegram/telegramService.js';

export function createTelegramRouter(db: AppDatabase): Router {
  const router = Router();

  // ── Telegram 渠道路由 ──────────────────────────────────────

  router.get('/telegram/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseTelegramConfig(await db.getConfig(userId, 'telegram_config'));
      const conn = getTelegramConnection(userId, db.getConfig.bind(db));
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), botInfo: conn.getBotInfo(), allowFrom: config?.allowFrom ?? [], dmPolicy: config?.dmPolicy ?? 'allowlist' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  router.post('/telegram/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseTelegramConfig(await db.getConfig(userId, 'telegram_config'));
      if (!config?.enabled || !config.botToken) { res.status(400).json({ ok: false, error: '请先启用并填写 Bot Token' }); return; }
      disconnectTelegram(userId);
      const conn = getTelegramConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.botToken);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  router.post('/telegram/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectTelegram(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  router.get('/telegram/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'telegram', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
  });

  return router;
}
