import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import { WebhookService } from '../webhook/WebhookService.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createWebhooksRouter(db: AppDatabase): Router {
  const router = Router();
  const svc = new WebhookService(db);

  // GET /api/admin/webhooks — 列出当前用户所有 webhook
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const webhooks = await svc.listWebhooks(userId);
      // 不返回 secret
      const safe = webhooks.map(({ secret: _s, ...rest }) => ({ ...rest, hasSecret: true }));
      res.json({ success: true, data: safe });
    } catch (err) {
      serverLogger.error('webhooks', '列表失败', String(err));
      res.status(500).json({ success: false, error: '获取 webhook 列表失败' });
    }
  });

  // POST /api/admin/webhooks — 创建 webhook
  router.post('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { name, description, events, headers } = req.body as {
        name?: string;
        description?: string;
        events?: string[];
        headers?: Record<string, string>;
      };
      if (!name || !Array.isArray(events) || events.length === 0) {
        res.status(400).json({ success: false, error: 'name 和 events 必填' });
        return;
      }
      const validEvents = ['task.trigger', 'github.push', 'github.pull_request', 'github.issue_comment', 'schedule', 'manual'];
      for (const e of events) {
        if (!validEvents.includes(e)) {
          res.status(400).json({ success: false, error: `不支持的事件类型: ${e}` });
          return;
        }
      }
      const webhook = await svc.createWebhook({ userId, name, description, events, headers });
      res.json({ success: true, data: { ...webhook, hasSecret: true } });
    } catch (err) {
      serverLogger.error('webhooks', '创建失败', String(err));
      res.status(500).json({ success: false, error: '创建 webhook 失败' });
    }
  });

  // GET /api/admin/webhooks/:id — 获取单个 webhook
  router.get('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const webhook = await svc.getWebhook(req.params.id, userId);
      if (!webhook) { res.status(404).json({ success: false, error: 'Webhook 不存在' }); return; }
      res.json({ success: true, data: { ...webhook, hasSecret: true } });
    } catch (err) {
      serverLogger.error('webhooks', '获取失败', String(err));
      res.status(500).json({ success: false, error: '获取 webhook 失败' });
    }
  });

  // PUT /api/admin/webhooks/:id — 更新 webhook
  router.put('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { name, description, events, enabled, headers } = req.body as {
        name?: string;
        description?: string;
        events?: string[];
        enabled?: boolean;
        headers?: Record<string, string> | null;
      };
      const webhook = await svc.updateWebhook(req.params.id, userId, { name, description, events, enabled, headers });
      if (!webhook) { res.status(404).json({ success: false, error: 'Webhook 不存在' }); return; }
      res.json({ success: true, data: { ...webhook, hasSecret: true } });
    } catch (err) {
      serverLogger.error('webhooks', '更新失败', String(err));
      res.status(500).json({ success: false, error: '更新 webhook 失败' });
    }
  });

  // DELETE /api/admin/webhooks/:id — 删除 webhook
  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const webhook = await svc.getWebhook(req.params.id, userId);
      if (!webhook) { res.status(404).json({ success: false, error: 'Webhook 不存在' }); return; }
      await svc.deleteWebhook(req.params.id, userId);
      res.json({ success: true, data: { message: 'Webhook 已删除' } });
    } catch (err) {
      serverLogger.error('webhooks', '删除失败', String(err));
      res.status(500).json({ success: false, error: '删除 webhook 失败' });
    }
  });

  // POST /api/admin/webhooks/:id/regenerate-secret — 重新生成密钥
  router.post('/:id/regenerate-secret', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const result = await svc.regenerateSecret(req.params.id, userId);
      if (!result) { res.status(404).json({ success: false, error: 'Webhook 不存在' }); return; }
      res.json({ success: true, data: result });
    } catch (err) {
      serverLogger.error('webhooks', '重新生成密钥失败', String(err));
      res.status(500).json({ success: false, error: '重新生成密钥失败' });
    }
  });

  // GET /api/admin/webhooks/:id/logs — 获取调用日志
  router.get('/:id/logs', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const webhook = await svc.getWebhook(req.params.id, userId);
      if (!webhook) { res.status(404).json({ success: false, error: 'Webhook 不存在' }); return; }
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await svc.getWebhookLogs(req.params.id, userId, limit);
      res.json({ success: true, data: logs });
    } catch (err) {
      serverLogger.error('webhooks', '获取日志失败', String(err));
      res.status(500).json({ success: false, error: '获取 webhook 日志失败' });
    }
  });

  return router;
}
