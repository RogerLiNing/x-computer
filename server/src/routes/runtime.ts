import {backgroundAutostartEnabled} from '../config/backgroundRuntime.js';
import { getDefaultScheduler } from '../scheduler/XScheduler.js';
import { describeEffectiveConfig } from '../config/defaultConfig.js';
import { createRequireAdmin } from '../middleware/requireAdmin.js';
import type { AppDatabase } from '../db/database.js';
import { Router } from 'express';
import type { PluginRegistry } from '../plugins/PluginRegistry.js';

export function createRuntimeRouter(plugins: PluginRegistry, db?: AppDatabase): Router {
  const router = Router();
  const requireAdmin = db ? createRequireAdmin(db) : undefined;

  router.get('/plugins', (_req, res) => {
    res.json({
      profile: plugins.profile,
      backgroundAutostart: backgroundAutostartEnabled(),
      scheduler: getDefaultScheduler()?.getStats() ?? null,
      plugins: plugins.list(),
    });
  });

  /** The assembled configuration with its layers; credentials are masked. Admin only. */
  router.get('/config', async (req, res, next) => {
    if (!requireAdmin) return res.status(403).json({ error: '仅管理员可查看配置' });
    requireAdmin(req, res, () => { res.json(describeEffectiveConfig()); });
    void next;
  });

  return router;
}
