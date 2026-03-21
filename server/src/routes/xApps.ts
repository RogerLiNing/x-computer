import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import type { Response } from 'express';

export function createXAppsRouter(db: AppDatabase | undefined): Router {
  const router = Router();

  function requireUserIdForAppBackend(req: { userId?: string }, res: Response): string | null {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return null;
    }
    if (!db) {
      res.status(503).json({ error: '数据库不可用' });
      return null;
    }
    return userId;
  }

  router.get('/x-apps/backend/kv/:appId', async (req, res) => {
    let uid = (req as { userId?: string }).userId;
    if (uid === 'anonymous') {
      const token = typeof req.headers['x-app-read-token'] === 'string' ? req.headers['x-app-read-token'].trim() : '';
      if (token && db) {
        const appIdParam = (req.params.appId ?? '').trim();
        const resolved = await db.resolveAppPublicReadToken(token, appIdParam);
        if (resolved) (req as { userId?: string }).userId = uid = resolved;
      }
    }
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const key = (req.query.key as string)?.trim();
    if (!appId) {
      res.status(400).json({ error: 'appId 必填' });
      return;
    }
    if (key !== undefined && key !== '') {
      const value = await db!.appBackendKvGet(userId, appId, key);
      if (value === undefined) {
        res.status(404).json({ error: 'key 不存在' });
        return;
      }
      res.set('Content-Type', 'application/json');
      res.send(value);
      return;
    }
    const prefix = (req.query.prefix as string)?.trim() || undefined;
    const keys = await db!.appBackendKvList(userId, appId, prefix);
    res.json({ keys });
  });

  router.put('/x-apps/backend/kv/:appId', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const key = (req.query.key as string)?.trim() ?? (req.body && typeof req.body.key === 'string' ? req.body.key.trim() : '');
    if (!appId || !key) {
      res.status(400).json({ error: 'appId 与 key 必填（query.key 或 body.key）' });
      return;
    }
    const value = req.body && 'value' in req.body
      ? (typeof req.body.value === 'string' ? req.body.value : JSON.stringify(req.body.value))
      : JSON.stringify(req.body ?? '');
    await db!.appBackendKvSet(userId, appId, key, value);
    res.json({ ok: true });
  });

  router.delete('/x-apps/backend/kv/:appId', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const key = (req.query.key as string)?.trim();
    if (!appId || !key) {
      res.status(400).json({ error: 'appId 与 key 必填（query.key）' });
      return;
    }
    await db!.appBackendKvDelete(userId, appId, key);
    res.json({ ok: true });
  });

  /** 创建应用公开只读 Token：外部分发站点（如 x-blog.example.com）可带此 Token 调用 GET /api/x-apps/backend/kv/:appId 只读访问该应用的 KV，无需 X-User-Id。 */
  router.post('/x-apps/backend/kv/:appId/public-read-token', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    if (!appId) {
      res.status(400).json({ error: 'appId 必填' });
      return;
    }
    const token = await db!.createAppPublicReadToken(userId, appId);
    res.json({ token });
  });

  router.post('/x-apps/backend/queue/:appId/:queueName/push', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const queueName = (req.params.queueName ?? '').trim();
    if (!appId || !queueName) {
      res.status(400).json({ error: 'appId 与 queueName 必填' });
      return;
    }
    const payload = typeof req.body === 'object' && req.body !== null && 'payload' in req.body
      ? (typeof (req.body as { payload: unknown }).payload === 'string'
          ? (req.body as { payload: string }).payload
          : JSON.stringify((req.body as { payload: unknown }).payload))
      : JSON.stringify(req.body ?? '');
    await db!.appBackendQueuePush(userId, appId, queueName, payload);
    res.json({ ok: true });
  });

  router.get('/x-apps/backend/queue/:appId/:queueName/pop', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const queueName = (req.params.queueName ?? '').trim();
    if (!appId || !queueName) {
      res.status(400).json({ error: 'appId 与 queueName 必填' });
      return;
    }
    const payload = await db!.appBackendQueuePop(userId, appId, queueName);
    if (payload === null) {
      res.status(404).json({ error: '队列为空' });
      return;
    }
    res.json({ payload });
  });

  router.get('/x-apps/backend/queue/:appId/:queueName/len', async (req, res) => {
    const userId = requireUserIdForAppBackend(req, res);
    if (userId === null) return;
    const appId = (req.params.appId ?? '').trim();
    const queueName = (req.params.queueName ?? '').trim();
    if (!appId || !queueName) {
      res.status(400).json({ error: 'appId 与 queueName 必填' });
      return;
    }
    const len = await db!.appBackendQueueLen(userId, appId, queueName);
    res.json({ length: len });
  });

  return router;
}
