import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { AppDatabase } from '../db/database.js';
import { runWithRetry } from '../scheduler/runScheduledIntent.js';
import { fire as fireHook } from '../hooks/HookRegistry.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createXGroupRunRouter(
  orchestrator: AgentOrchestrator,
  db: AppDatabase | undefined,
  getSystemPromptForScheduler: (uid: string) => Promise<string>,
  getLLMConfigForScheduler: (uid: string) => Promise<{ providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null>,
  ensureUserMcpForScheduler: ((uid: string) => Promise<void>) | undefined,
  ensureDefaultScheduleForUser: (userId: string | undefined) => void,
  triggerXRunForUser: (
    userId: string,
    intent: string,
    source?: string,
    actionFingerprint?: string,
    metadata?: Record<string, unknown>,
  ) => void,
): Router {
  const router = Router();

  const X_GROUP_RUN_HISTORY_KEY = 'x_group_run_history';

  /** 用户手动触发 X 立即执行一次（与定时任务同流程：以当前用户身份跑 Agent，可带工具），便于观察 X 如何操作。
   * 请求体可带 intent；若带 providerId/modelId（与前端「大模型配置」一致），优先使用，否则从 db 的 llm_config 读取。 */
  router.post('/x/run-now', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '请先登录后再触发 X 执行' });
        return;
      }
      const body = (req.body ?? {}) as {
        intent?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      const intent =
        body.intent?.trim() ||
        '用户手动触发：做一次自检，简要说明当前状态与待办；如有需要可联系用户。你可以使用任何工具（读对话、更新提示词、定下一个定时等）。';
      if (ensureUserMcpForScheduler) await ensureUserMcpForScheduler(userId);
      let llmConfig: { providerId: string; modelId: string; baseUrl?: string; apiKey?: string } | null = null;
      if (body.providerId && body.modelId) {
        llmConfig = {
          providerId: body.providerId,
          modelId: body.modelId,
          baseUrl: body.baseUrl || undefined,
          apiKey: body.apiKey || undefined,
        };
      }
      if (!llmConfig) {
        const fromDb = await getLLMConfigForScheduler(userId);
        if (fromDb?.providerId && fromDb?.modelId) {
          llmConfig = {
            providerId: fromDb.providerId,
            modelId: fromDb.modelId,
            baseUrl: fromDb.baseUrl,
            apiKey: fromDb.apiKey,
          };
        }
      }
      if (!llmConfig?.providerId || !llmConfig?.modelId) {
        res.status(400).json({
          error: '请先在「系统设置 → 大模型配置」中配置聊天模型，X 才能执行。',
          content: '',
        });
        return;
      }
      const systemPrompt = await getSystemPromptForScheduler(userId);
      serverLogger.info('x/run-now', `用户手动触发 X 执行`, `userId=${userId} intent=${intent.slice(0, 60)}`);
      const { content } = await runWithRetry(
        () =>
          orchestrator.runIntentAsPersistedTask({
            intent,
            llmConfig: {
              providerId: llmConfig.providerId,
              modelId: llmConfig.modelId,
              baseUrl: llmConfig.baseUrl,
              apiKey: llmConfig.apiKey,
            },
            systemPrompt,
            userId,
            source: 'run_now',
            title: '手动执行',
          }),
        { logLabel: 'x/run-now' },
      );
      ensureDefaultScheduleForUser(userId);
      fireHook('x_chat_round_complete', {
        userId,
        lastUserMessage: intent,
        lastAssistantContent: content ?? '',
      });
      res.json({ content: content?.trim() || '（执行完成，无文本回复）' });
    } catch (err: any) {
      serverLogger.error('x/run-now', err?.message, err?.stack);
      res.status(500).json({
        error: err?.message ?? '执行失败',
        content: '',
      });
    }
  });

  /** 用户请求停止当前正在执行的群组任务（x.run_group 会在每名成员间检查此标志） */
  router.post('/x/cancel-group-run', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      orchestrator.setGroupRunCancel(userId, true);
      res.json({ success: true, message: '已请求停止群组执行' });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '操作失败' });
    }
  });

  /** 群组执行记录：查看群组对话与工作过程（x.run_group 每次执行会写入） */
  router.get('/x/group-run-history', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const groupId = typeof req.query?.groupId === 'string' ? req.query.groupId.trim() || undefined : undefined;
      const limit = typeof req.query?.limit === 'string' ? Math.min(Math.max(1, parseInt(req.query.limit, 10) || 30), 50) : 30;
      if (!db) {
        return res.json({ runs: [] });
      }
      const raw = await db.getConfig(userId, X_GROUP_RUN_HISTORY_KEY);
      let list: Array<{ id: string; groupId: string; groupName: string; goal: string; results: Array<{ agentId: string; agentName: string; content: string }>; cancelled?: boolean; createdAt: number }>;
      try {
        const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
        const filtered = Array.isArray(arr) ? arr.filter((x): x is { id: string; groupId: string; groupName: string; goal: string; results: unknown[]; cancelled?: boolean; createdAt: number } => x != null && typeof x === 'object' && typeof (x as any).createdAt === 'number') : [];
        list = filtered.map((x) => ({
          ...x,
          results: Array.isArray(x.results) ? x.results.filter((r): r is { agentId: string; agentName: string; content: string } => r != null && typeof r === 'object' && typeof (r as any).content === 'string') : [],
        }));
      } catch {
        list = [];
      }
      let runs = list;
      if (groupId) runs = runs.filter((r) => r.groupId === groupId);
      runs = runs.slice(0, limit);
      res.json({ runs });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败', runs: [] });
    }
  });

  return router;
}
