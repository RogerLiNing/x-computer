import {backgroundAutostartEnabled} from '../config/backgroundRuntime.js';
import { getDefaultScheduler } from '../scheduler/XScheduler.js';
import { Router } from 'express';
import type { PluginRegistry } from '../plugins/PluginRegistry.js';

export function createRuntimeRouter(plugins: PluginRegistry): Router {
  const router = Router();

  router.get('/plugins', (_req, res) => {
    res.json({
      profile: plugins.profile,
      backgroundAutostart: backgroundAutostartEnabled(),
      scheduler: getDefaultScheduler()?.getStats() ?? null,
      plugins: plugins.list(),
    });
  });

  return router;
}
