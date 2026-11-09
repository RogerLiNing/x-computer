import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { PluginRegistry } from '../plugins/PluginRegistry.js';
import { PackageRegistry } from '../packages/PackageRegistry.js';
import { PackageCatalog, configuredCatalogUrls } from '../packages/catalog.js';
import { serverLogger } from '../observability/ServerLogger.js';

const PKG_ID = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/;

function requireUser(req: { userId?: string }): string | undefined {
  return req.userId && req.userId !== 'anonymous' ? req.userId : undefined;
}

/**
 * Installed packages per user plus the deployment's built-in server plugins (read-only),
 * and a read-only view of the configured package catalog. Installing goes through the
 * `x.package_install` tool so the assistant can explain permissions first.
 */
export interface PackageToolReloader { reloadPackageToolsForUser(userId: string): Promise<void> }

export function createPackagesRouter(db?: AppDatabase, userSandboxManager?: UserSandboxManager, plugins?: PluginRegistry, reloader?: PackageToolReloader, catalog: PackageCatalog = new PackageCatalog(configuredCatalogUrls())): Router {
  const router = Router();
  const registry = db ? new PackageRegistry(db) : undefined;
  const reload = async (userId: string) => { try { await reloader?.reloadPackageToolsForUser(userId); } catch (error: unknown) { serverLogger.warn('packages', '重新注册包工具失败', error instanceof Error ? error.message : String(error)); } };

  router.get('/packages/catalog', async (req, res) => {
    if (!requireUser(req)) return res.status(401).json({ error: '需要登录' });
    if (!catalog.configured) return res.json({ configured: false, packages: [] });
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      res.json({ configured: true, packages: (await catalog.search(query)).slice(0, 100) });
    } catch (error: unknown) {
      serverLogger.warn('packages', '读取包目录失败', error instanceof Error ? error.message : String(error));
      res.status(502).json({ error: '读取包目录失败' });
    }
  });

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
      await reload(userId);
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
      await reload(userId);
      res.json({ ok: true });
    } catch (error: unknown) {
      serverLogger.warn('packages', `移除包 ${id} 失败`, error instanceof Error ? error.message : String(error));
      res.status(500).json({ error: '移除失败' });
    }
  });

  return router;
}
