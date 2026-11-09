import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { PluginRegistry } from '../plugins/PluginRegistry.js';
import { PackageRegistry } from '../packages/PackageRegistry.js';
import { serverLogger } from '../observability/ServerLogger.js';

const PKG_ID = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/;

function requireUser(req: { userId?: string }): string | undefined {
  return req.userId && req.userId !== 'anonymous' ? req.userId : undefined;
}

/**
 * Installed packages per user plus the deployment's built-in server plugins (read-only).
 * Phase one exposes list, enable/disable and remove; installing from a catalog comes later.
 */
export function createPackagesRouter(db?: AppDatabase, userSandboxManager?: UserSandboxManager, plugins?: PluginRegistry): Router {
  const router = Router();
  const registry = db ? new PackageRegistry(db) : undefined;

  router.get('/packages', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    if (!registry) return res.status(503).json({ error: '包注册表不可用' });
    try {
      if (userSandboxManager) {
        const { sandboxFS } = await userSandboxManager.getForUser(userId);
        await registry.migrateMiniApps(userId, sandboxFS);
      }
      res.json({ packages: await registry.list(userId), builtin: plugins?.list() ?? [] });
    } catch (error: unknown) {
      serverLogger.warn('packages', '读取包列表失败', error instanceof Error ? error.message : String(error));
      res.status(500).json({ error: '读取包列表失败' });
    }
  });

  router.post('/packages/:id/enabled', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    if (!registry) return res.status(503).json({ error: '包注册表不可用' });
    const { id } = req.params;
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (!PKG_ID.test(id) || typeof enabled !== 'boolean') return res.status(400).json({ error: '需要合法的包 id 与布尔 enabled' });
    try {
      if (!(await registry.setEnabled(userId, id, enabled))) return res.status(404).json({ error: '包不存在' });
      res.json({ ok: true, package: await registry.get(userId, id) });
    } catch (error: unknown) {
      serverLogger.warn('packages', `切换包 ${id} 失败`, error instanceof Error ? error.message : String(error));
      res.status(500).json({ error: '更新失败' });
    }
  });

  router.delete('/packages/:id', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    if (!registry) return res.status(503).json({ error: '包注册表不可用' });
    const { id } = req.params;
    if (!PKG_ID.test(id)) return res.status(400).json({ error: '包 id 非法' });
    try {
      if (!(await registry.remove(userId, id))) return res.status(404).json({ error: '包不存在' });
      res.json({ ok: true });
    } catch (error: unknown) {
      serverLogger.warn('packages', `移除包 ${id} 失败`, error instanceof Error ? error.message : String(error));
      res.status(500).json({ error: '移除失败' });
    }
  });

  return router;
}
