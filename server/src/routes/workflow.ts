import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { fireSignal } from '../signals/signalService.js';
import { workflowFireEvent } from '../workflow/workflowClient.js';
import { executeWorkflowTask } from '../workflow/executeTask.js';

type SignalFireDeps = Parameters<typeof fireSignal>[3];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TriggerFn = (...args: any[]) => void;

export function createWorkflowRouter(
  db: AppDatabase,
  userSandboxManager: UserSandboxManager,
  signalFireDeps: SignalFireDeps,
  triggerXRunForUser: TriggerFn,
): Router {
  const router = Router();

  /** R041：信号触发后通知工作流引擎（若有 event 类型触发器） */
  async function notifyWorkflowOnSignal(userId: string, signal: string): Promise<void> {
    if (!userId || userId === 'anonymous') return;
    workflowFireEvent(userId, signal).catch(() => {});
  }

  // 脚本通过 HTTP 发送信号（如监控脚本判断条件满足后唤醒 agent，不每次跑 agent）
  router.post('/signals/emit', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录，请提供 X-User-Id 或先登录' });
        return;
      }
      if (!db || !signalFireDeps) {
        res.status(503).json({ error: '信号服务不可用' });
        return;
      }
      const body = req.body as { signal?: string; payload?: Record<string, unknown> };
      const signal = typeof body?.signal === 'string' ? body.signal.trim() : '';
      if (!signal) {
        res.status(400).json({ error: 'body.signal 必填' });
        return;
      }
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : undefined;
      const result = await fireSignal(userId, signal, payload, signalFireDeps);
      void notifyWorkflowOnSignal(userId, signal);
      res.json({ ok: true, fired: result.fired, skipped: result.skipped });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** R041：工作流引擎执行任务回调（script/ai 等），由工作流引擎 HTTP 调用 */
  router.post('/workflow/execute-task', async (req, res) => {
    try {
      const body = req.body as {
        userId?: string;
        instanceId?: string;
        nodeId?: string;
        taskType?: string;
        config?: Record<string, unknown>;
        variables?: Record<string, unknown>;
      };
      const { userId, instanceId, nodeId, taskType, config, variables } = body;
      if (!userId || !instanceId || !nodeId || !taskType) {
        res.status(400).json({ error: '需要 userId, instanceId, nodeId, taskType' });
        return;
      }
      const runIntent: (uid: string, intent: string) => void = (uid, intent) =>
        triggerXRunForUser(uid, intent);
      const output = await executeWorkflowTask(
        { userId, instanceId, nodeId, taskType, config: config ?? {}, variables: variables ?? {} },
        {
          userSandboxManager,
          runIntent,
        },
      );
      res.json(output);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
