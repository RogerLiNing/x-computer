/**
 * Admin utility/monitoring routes extracted from api.ts
 * Routes: /context, /mode, /tools, /mcp/reload, /policy/rules, /audit, /logs
 */

import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { PolicyEngine } from '../policy/PolicyEngine.js';
import type { AuditLogger } from '../observability/AuditLogger.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { ExecutionMode } from '../../../shared/src/index.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { loadMcpAndRegisterForUser, reloadMcpAndRegister } from '../mcp/loadAndRegister.js';

export function createAdminRouter(
  orchestrator: AgentOrchestrator,
  policy: PolicyEngine,
  audit: AuditLogger,
  sandboxFS?: SandboxFS,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
): Router {
  const router = Router();

  // ── Computer Context ─────────────────────────────────────

  /** Get current computer context (what the AI perceives) */
  router.get('/context', (_req, res) => {
    const ctx = orchestrator.getComputerContext();
    res.json(ctx ?? { timestamp: 0, message: 'No context yet' });
  });

  // ── Execution Mode ───────────────────────────────────────

  router.get('/mode', (_req, res) => {
    res.json({ mode: orchestrator.getMode() });
  });

  router.post('/mode', (req, res) => {
    const { mode } = req.body as { mode: ExecutionMode };
    if (mode !== 'auto' && mode !== 'approval') {
      res.status(400).json({ error: 'Mode must be "auto" or "approval"' });
      return;
    }
    orchestrator.setMode(mode);
    res.json({ mode });
  });

  // ── Tools ────────────────────────────────────────────────

  router.get('/tools', (_req, res) => {
    res.json(orchestrator.getTools());
  });

  // ── MCP ─────────────────────────────────────────────────

  /** MCP 重载：按用户重载（有 userId 时从该用户工作区/云端加载） */
  router.post('/mcp/reload', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const result =
        userId && userId !== 'anonymous' && userSandboxManager
          ? await loadMcpAndRegisterForUser(
              orchestrator,
              userId,
              userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
              db?.getConfig.bind(db),
            )
          : await reloadMcpAndRegister(orchestrator, sandboxFS?.getRoot());
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '重载失败' });
    }
  });

  // ── Policy ───────────────────────────────────────────────

  router.get('/policy/rules', (_req, res) => {
    res.json(policy.getRules());
  });

  // ── Audit ────────────────────────────────────────────────

  /** 审计日志：有 userId 时优先从 DB 按用户查询，否则返回内存最近条目 */
  router.get('/audit', async (req, res) => {
    const limit = Math.min(500, parseInt(String(req.query?.limit)) || 100);
    const userId = (req as { userId?: string }).userId;
    if (userId && userId !== 'anonymous' && db) {
      try {
        const rows = await db.getAuditByUser(userId, limit);
        return res.json(rows);
      } catch (e: any) {
        serverLogger.warn('audit', 'DB 查询失败，回退内存', e?.message);
      }
    }
    const all = audit.getAll();
    res.json(all.slice(-limit));
  });

  router.get('/audit/task/:taskId', (req, res) => {
    res.json(audit.getTimeline(req.params.taskId));
  });

  // ── Server Logs ────────────────────────────────────────────

  /** 获取后端日志（前端系统日志用） */
  router.get('/logs', (req, res) => {
    const limit = parseInt(String(req.query?.limit)) || 200;
    res.json(serverLogger.getRecent(limit));
  });

  /** 清空后端日志 */
  router.delete('/logs', (_req, res) => {
    serverLogger.clear();
    res.json({ success: true });
  });

  return router;
}
