import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { listAllCapabilities, registerCapability } from '../capabilities/CapabilityRegistry.js';

export function createCapabilitiesRouter(orchestrator: AgentOrchestrator): Router {
  const router = Router();

  router.get('/capabilities', (_req, res) => {
    const tools = orchestrator.getTools();
    const caps = listAllCapabilities(tools);
    res.json({ capabilities: caps });
  });

  router.post('/capabilities/register', (req, res) => {
    try {
      const { name, description, source } = req.body as { name?: string; description?: string; source?: 'builtin' | 'mcp' | 'skill' };
      if (!name || typeof description !== 'string') {
        res.status(400).json({ error: '缺少 name 或 description' });
        return;
      }
      registerCapability({ name, description, source });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '注册失败' });
    }
  });

  return router;
}
