import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { AuditLogger } from '../observability/AuditLogger.js';

export function createHealthRouter(orchestrator: AgentOrchestrator, audit: AuditLogger): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      tasks: orchestrator.getAllTasks().length,
      auditEntries: audit.count,
    });
  });

  return router;
}
