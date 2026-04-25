import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import { HookService, type HookPoint, type HookFailureMode, HOOK_POINTS } from '../hooks/HookService.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createHooksRouter(db: AppDatabase): Router {
  const svc = new HookService(db);
  const router = Router();

  // GET /api/hooks — list all hooks for current user
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const hooks = await svc.listHooks(userId);
      res.json({ success: true, data: hooks });
    } catch (err) {
      serverLogger.error('hooks', '获取 hooks 列表失败', String(err));
      res.status(500).json({ success: false, error: '获取 hooks 列表失败' });
    }
  });

  // POST /api/hooks — create a new hook
  router.post('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { name, hookPoint, url, enabled, failureMode, timeoutMs, headers, priority } = req.body as {
        name?: string;
        hookPoint?: string;
        url?: string;
        enabled?: boolean;
        failureMode?: string;
        timeoutMs?: number;
        headers?: Record<string, string>;
        priority?: number;
      };

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ success: false, error: 'name is required' });
        return;
      }
      if (!hookPoint || !HOOK_POINTS.includes(hookPoint as HookPoint)) {
        res.status(400).json({ success: false, error: `hookPoint must be one of: ${HOOK_POINTS.join(', ')}` });
        return;
      }
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        res.status(400).json({ success: false, error: 'url must be a valid HTTP(S) URL' });
        return;
      }

      const hook = await svc.createHook({
        userId,
        name: name.trim(),
        hookPoint: hookPoint as HookPoint,
        url,
        enabled,
        failureMode: failureMode as HookFailureMode | undefined,
        timeoutMs,
        headers,
        priority,
      });

      serverLogger.info('hooks', 'Hook 已创建', `userId=${userId} name=${name} point=${hookPoint}`);
      res.status(201).json({ success: true, data: hook });
    } catch (err) {
      serverLogger.error('hooks', '创建 hook 失败', String(err));
      res.status(500).json({ success: false, error: '创建 hook 失败' });
    }
  });

  // GET /api/hooks/:id — get a specific hook
  router.get('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const hook = await svc.getHook(req.params.id, userId);
      if (!hook) {
        res.status(404).json({ success: false, error: 'Hook not found' });
        return;
      }
      res.json({ success: true, data: hook });
    } catch (err) {
      serverLogger.error('hooks', '获取 hook 失败', String(err));
      res.status(500).json({ success: false, error: '获取 hook 失败' });
    }
  });

  // PUT /api/hooks/:id — update a hook
  router.put('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { name, hookPoint, url, enabled, failureMode, timeoutMs, headers, priority } = req.body as {
        name?: string;
        hookPoint?: string;
        url?: string;
        enabled?: boolean;
        failureMode?: string;
        timeoutMs?: number;
        headers?: Record<string, string>;
        priority?: number;
      };

      if (hookPoint && !HOOK_POINTS.includes(hookPoint as HookPoint)) {
        res.status(400).json({ success: false, error: `hookPoint must be one of: ${HOOK_POINTS.join(', ')}` });
        return;
      }
      if (url && !url.startsWith('http')) {
        res.status(400).json({ success: false, error: 'url must be a valid HTTP(S) URL' });
        return;
      }

      const hook = await svc.updateHook(req.params.id, userId, {
        name: name?.trim(),
        hookPoint: hookPoint as HookPoint | undefined,
        url,
        enabled,
        failureMode: failureMode as HookFailureMode | undefined,
        timeoutMs,
        headers,
        priority,
      });

      if (!hook) {
        res.status(404).json({ success: false, error: 'Hook not found' });
        return;
      }
      res.json({ success: true, data: hook });
    } catch (err) {
      serverLogger.error('hooks', '更新 hook 失败', String(err));
      res.status(500).json({ success: false, error: '更新 hook 失败' });
    }
  });

  // DELETE /api/hooks/:id — delete a hook
  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const deleted = await svc.deleteHook(req.params.id, userId);
      if (!deleted) {
        res.status(404).json({ success: false, error: 'Hook not found' });
        return;
      }
      res.json({ success: true, data: { message: 'Hook deleted' } });
    } catch (err) {
      serverLogger.error('hooks', '删除 hook 失败', String(err));
      res.status(500).json({ success: false, error: '删除 hook 失败' });
    }
  });

  // POST /api/hooks/:id/toggle — enable/disable a hook
  router.post('/:id/toggle', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { enabled } = req.body as { enabled?: boolean };
      const hook = await svc.toggleHook(req.params.id, userId, enabled ?? true);
      if (!hook) {
        res.status(404).json({ success: false, error: 'Hook not found' });
        return;
      }
      res.json({ success: true, data: hook });
    } catch (err) {
      serverLogger.error('hooks', '切换 hook 状态失败', String(err));
      res.status(500).json({ success: false, error: '切换 hook 状态失败' });
    }
  });

  return router;
}
