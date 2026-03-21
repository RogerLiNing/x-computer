import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import type { AppDatabase } from '../../db/database.js';
import {
  getWhatsAppConnection,
  disconnectWhatsApp,
  parseWhatsAppConfig,
  CREDENTIALS_BASE,
} from '../../whatsapp/whatsappService.js';
import { getSystemProxy } from '../../utils/systemProxy.js';

export function createWhatsAppRouter(db: AppDatabase | undefined): Router {
  const router = Router();

  router.get('/whatsapp/system-proxy', (_req, res) => {
    try {
      const url = getSystemProxy();
      res.json({ ok: true, proxy: url ?? '' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '检测失败' });
    }
  });

  /** WhatsApp 连接状态。需登录。 */
  router.get('/whatsapp/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const config = parseWhatsAppConfig(await db.getConfig(userId, 'whatsapp_config'));
      const conn = getWhatsAppConnection(userId, db.getConfig.bind(db));
      const status = conn.getStatus();
      res.json({
        ok: true,
        enabled: config?.enabled ?? false,
        status,
        allowFrom: config?.allowFrom ?? [],
        allowSelfChat: config?.allowSelfChat ?? false,
        proxy: config?.proxy ?? '',
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '获取失败' });
    }
  });

  /** WhatsApp 登录：连接并返回 QR 码（data URL），或已连接则返回 alreadyConnected。需登录。 */
  router.post('/whatsapp/login', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const proxyFromBody = (req.body as { proxy?: string })?.proxy?.trim();
      disconnectWhatsApp(userId);
      const conn = getWhatsAppConnection(userId, db.getConfig.bind(db));
      type WhatsAppLoginResult = { qr?: string; alreadyConnected?: boolean; error?: string };
      const resultPromise = new Promise<WhatsAppLoginResult>((resolve) => {
        conn.setQrCallback((qr) => resolve({ qr }));
        conn.setConnectedCallback(() => resolve({ alreadyConnected: true }));
        conn.setDisconnectCallback((reason, detail) => {
          const msg = reason === 'logged_out' ? '已登出' : (detail ? `连接断开：${detail}` : '连接断开，请重试');
          resolve({ error: msg });
        });
        conn.connect(proxyFromBody).then((r) => {
          if (!r.ok && r.error) resolve({ error: r.error });
        });
      });
      const result = await Promise.race([
        resultPromise,
        new Promise<WhatsAppLoginResult>((_, reject) => setTimeout(() => reject(new Error('QR 超时（60秒），请检查网络后重试')), 60000)),
      ]);
      if (result.error) res.status(408).json({ ok: false, error: result.error });
      else if (result.alreadyConnected) res.json({ ok: true, alreadyConnected: true });
      else if (result.qr) res.json({ ok: true, qr: result.qr });
      else res.status(408).json({ ok: false, error: '未获取到 QR 码，请重试' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '登录失败' });
    }
  });

  /** WhatsApp 登出：断开连接并清除本地凭证。需登录。 */
  router.post('/whatsapp/logout', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      disconnectWhatsApp(userId);
      const credsPath = path.join(CREDENTIALS_BASE, userId);
      if (fs.existsSync(credsPath)) {
        fs.rmSync(credsPath, { recursive: true });
      }
      res.json({ ok: true, message: '已登出' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '登出失败' });
    }
  });

  /** WhatsApp 收件箱：从数据库读取已收到的消息。需登录。 */
  router.get('/whatsapp/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getWhatsAppMessagesByUser(userId, limit);
      res.json({ ok: true, messages: rows });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败', messages: [] });
    }
  });

  return router;
}
