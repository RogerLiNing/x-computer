import { Router } from 'express';
import type { AppDatabase } from '../../db/database.js';
import { getDiscordConnection, disconnectDiscord, parseDiscordConfig } from '../../discord/discordService.js';

export function createDiscordRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/discord/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseDiscordConfig(await db.getConfig(userId, 'discord_config'));
      const conn = getDiscordConnection(userId, db.getConfig.bind(db));
      res.json({ ok: true, enabled: config?.enabled ?? false, status: conn.getStatus(), botInfo: conn.getBotInfo(), allowFrom: config?.allowFrom ?? [], dmPolicy: config?.dmPolicy ?? 'allowlist' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '获取失败' }); }
  });

  router.post('/discord/connect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const config = parseDiscordConfig(await db.getConfig(userId, 'discord_config'));
      if (!config?.enabled || !config.botToken) { res.status(400).json({ ok: false, error: '请先启用并填写 Bot Token' }); return; }
      disconnectDiscord(userId);
      const conn = getDiscordConnection(userId, db.getConfig.bind(db));
      const result = await conn.connect(config.botToken);
      if (result.ok) res.json({ ok: true });
      else res.status(400).json({ ok: false, error: result.error });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '连接失败' }); }
  });

  router.post('/discord/disconnect', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      disconnectDiscord(userId);
      res.json({ ok: true, message: '已断开' });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '断开失败' }); }
  });

  router.get('/discord/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getChannelMessagesByUser(userId, 'discord', limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) { res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] }); }
  });

  return router;
}
