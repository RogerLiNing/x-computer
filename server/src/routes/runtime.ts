import {backgroundAutostartEnabled} from '../config/backgroundRuntime.js';
import { Router } from 'express';
import type { PluginRegistry } from '../plugins/PluginRegistry.js';

export function createRuntimeRouter(plugins: PluginRegistry): Router {
  const router = Router();

  router.get('/plugins', (_req, res) => {
    res.json({
      profile: plugins.profile,
      backgroundAutostart: backgroundAutostartEnabled(),
      plugins: plugins.list(),
    });
  });

  return router;
}
