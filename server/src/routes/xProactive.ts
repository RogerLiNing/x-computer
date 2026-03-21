import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import { getMessages as getXProactiveMessages, markRead as markXProactiveRead } from '../x/XProactiveMessages.js';

const X_DONE_LOG_KEY = 'x_done_log';

export function createXProactiveRouter(db: AppDatabase | undefined): Router {
  const router = Router();

  // ── 主脑 X 主动找用户：主动消息列表（供 X 主脑入口展示） ──
  router.get('/x/proactive-messages', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const list = getXProactiveMessages(userId);
      res.json({ messages: list });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  /** 标记 X 主动消息为已读：用户点击「已读」或 X 通过工具标记。Body: { id: string } 或 { ids: string[] } */
  router.post('/x/proactive-messages/read', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const body = req.body as { id?: string; ids?: string[] };
      const ids = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [];
      for (const id of ids) if (typeof id === 'string' && id) markXProactiveRead(userId, id);
      res.json({ success: true, marked: ids.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '标记失败' });
    }
  });

  /** 近期已完成清单（含一次性与定时/周期），供前端展示 */
  router.get('/x/done-log', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') { res.status(401).json({ ok: false, error: '需要登录' }); return; }
      if (!db) { res.status(503).json({ ok: false, error: '服务不可用' }); return; }
      const raw = await db.getConfig(userId, X_DONE_LOG_KEY);
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 30));
      let oneTime: { at: number; summary: string; schedule?: string; title?: string; action?: string }[] = [];
      let scheduled: { at: number; summary: string; schedule?: string; title?: string; action?: string }[] = [];
      if (raw) {
        try {
          const arr = JSON.parse(raw) as { at: number; summary: string; scheduled?: boolean; schedule?: string; title?: string; action?: string }[];
          if (Array.isArray(arr)) {
            const recent = arr.slice(-limit).reverse();
            const toEntry = (e: typeof arr[0]) => ({
              at: e.at,
              summary: e.summary,
              ...(e.schedule && { schedule: e.schedule }),
              ...(e.title && { title: e.title }),
              ...(e.action && { action: e.action }),
            });
            oneTime = recent.filter((e) => !e.scheduled).map(toEntry);
            scheduled = recent.filter((e) => e.scheduled).map(toEntry);
          }
        } catch { /* ignore */ }
      }
      res.json({ ok: true, oneTime, scheduled });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败' });
    }
  });

  // NOTE: /x/greet is DEFERRED - it has many closure dependencies on local functions in api.ts
  // (getSystemPromptForScheduler, buildGreetContext, getLLMConfigForScheduler,
  //  ensureUserMcpForScheduler, orchestrator.runChatAgentLoop, ensureDefaultScheduleForUser,
  //  getUserLanguage, serverLogger)

  return router;
}
