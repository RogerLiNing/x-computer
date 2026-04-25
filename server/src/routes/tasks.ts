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

  /** Get task execution history with analytics */
  router.get('/tasks/history', async (req, res) => {
    if (!db) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }
    try {
      const userId = (req as { userId?: string }).userId;
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
      const tasks = await db.listTasksByUser(userId ?? 'anonymous', limit);

      // Compute aggregate stats
      const total = tasks.length;
      const completed = tasks.filter((t) => t.status === 'completed').length;
      const failed = tasks.filter((t) => t.status === 'failed').length;
      const durations = tasks
        .map((t) => t.duration_ms)
        .filter((d): d is number => d !== null && d !== undefined);
      const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
      const totalCost = tasks.reduce((sum, t) => sum + (t.actual_cost ?? 0), 0);

      // Tool execution breakdown (fetch full tasks for tool_executions)
      const taskIds = tasks.map((t) => t.id);
      const fullTasks = await db.getAllTasks();
      const relevantTasks = fullTasks.filter((t) => taskIds.includes(t.id));
      const toolCounts: Record<string, number> = {};
      const toolDurations: Record<string, number[]> = {};
      for (const task of relevantTasks) {
        if (!task.tool_executions) continue;
        try {
          const executions = JSON.parse(task.tool_executions) as Array<{ toolName: string; durationMs: number }>;
          for (const ex of executions) {
            toolCounts[ex.toolName] = (toolCounts[ex.toolName] ?? 0) + 1;
            if (!toolDurations[ex.toolName]) toolDurations[ex.toolName] = [];
            toolDurations[ex.toolName]!.push(ex.durationMs);
          }
        } catch { /* ignore parse errors */ }
      }
      const toolStats = Object.entries(toolCounts).map(([toolName, totalCalls]) => {
        const durs = toolDurations[toolName] ?? [];
        return {
          toolName,
          totalCalls,
          avgDurationMs: durs.length > 0 ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
        };
      }).sort((a, b) => b.totalCalls - a.totalCalls);

      res.json({
        success: true,
        data: {
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            updated_at: t.updated_at,
            started_at: t.started_at,
            completed_at: t.completed_at,
            duration_ms: t.duration_ms,
            actual_cost: t.actual_cost,
          })),
          stats: {
            total,
            completed,
            failed,
            success_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
            avg_duration_ms: avgDurationMs,
            total_cost: Math.round(totalCost * 100) / 100,
          },
          tool_stats: toolStats.slice(0, 10),
        },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
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
