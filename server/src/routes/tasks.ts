import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { CreateTaskRequest } from '../../../shared/src/index.js';
import { aiCallsQuota, tasksQuota } from '../subscription/quotaMiddleware.js';
import { ensureUserMcpLoaded } from '../mcp/loadAndRegister.js';

export function createTasksRouter(
  orchestrator: AgentOrchestrator,
  userSandboxManager: UserSandboxManager | undefined,
  db: AppDatabase | undefined,
  subscriptionService: SubscriptionService | undefined,
): Router {
  const router = Router();

  const aiQuota = subscriptionService ? aiCallsQuota(subscriptionService) : (_req: any, _res: any, next: any) => next();
  const taskQuota = subscriptionService ? tasksQuota(subscriptionService) : (_req: any, _res: any, next: any) => next();

  /** Create and run a task（带 llmConfig 时会走 Agent 循环，需先加载该用户 MCP 以便任务内可调用 MCP 且鉴权正确）。每次创建任务计 1 次 AI 调用。 */
  router.post('/tasks', taskQuota, aiQuota, async (req, res) => {
    try {
      const request = req.body as CreateTaskRequest;
      if (!request.domain || !request.title || !request.description) {
        res.status(400).json({ error: 'Missing required fields: domain, title, description' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      if (request.llmConfig && userSandboxManager && db) {
        await ensureUserMcpLoaded(
          orchestrator,
          userId,
          userSandboxManager.getUserWorkspaceRoot.bind(userSandboxManager),
          db.getConfig.bind(db),
        );
      }
      const task = await orchestrator.createAndRun(request, userId);
      res.status(201).json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Get all tasks（按用户过滤：有 userId 时只返回该用户任务） */
  router.get('/tasks', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    const all = orchestrator.getAllTasks();
    const list =
      userId && userId !== 'anonymous'
        ? all.filter((t) => (t.metadata as { userId?: string } | undefined)?.userId === userId)
        : all;
    res.json(list);
  });

  /** Get a specific task（运行用户只能查看自己的任务） */
  router.get('/tasks/:id', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    const task = orchestrator.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const taskUserId = (task.metadata as { userId?: string } | undefined)?.userId;
    if (userId && userId !== 'anonymous' && taskUserId && taskUserId !== userId) {
      res.status(403).json({ error: '无权查看该任务' });
      return;
    }
    res.json(task);
  });

  /** Pause a task */
  router.post('/tasks/:id/pause', (req, res) => {
    const ok = orchestrator.pauseTask(req.params.id);
    res.json({ success: ok });
  });

  /** Resume a task */
  router.post('/tasks/:id/resume', (req, res) => {
    const ok = orchestrator.resumeTask(req.params.id);
    res.json({ success: ok });
  });

  /** Approve a step */
  router.post('/tasks/:id/steps/:stepId/approve', (req, res) => {
    const ok = orchestrator.approveStep(req.params.id, req.params.stepId);
    res.json({ success: ok });
  });

  /** Reject a step */
  router.post('/tasks/:id/steps/:stepId/reject', (req, res) => {
    const ok = orchestrator.rejectStep(req.params.id, req.params.stepId);
    res.json({ success: ok });
  });

  /** 失败任务重试：body { mode: 'restart' | 'from_failure' }，默认 restart */
  router.post('/tasks/:id/retry', async (req, res) => {
    const mode = (req.body?.mode === 'from_failure' ? 'from_failure' : 'restart') as 'restart' | 'from_failure';
    const ok = await orchestrator.retryTask(req.params.id, mode);
    if (!ok) {
      res.status(400).json({ error: 'Task not found or not in failed state' });
      return;
    }
    res.json({ success: true, mode });
  });

  return router;
}
