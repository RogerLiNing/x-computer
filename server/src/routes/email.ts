import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import { runEmailCheck } from '../email/emailCheckLoop.js';

interface EmailSignalFireDeps {
  runIntent: (userId: string, intent: string, meta?: { signal?: string; actionFingerprint?: string }) => void;
  runAgent: (userId: string, agentId: string, goal: string, meta?: { triggerId?: string; actionFingerprint?: string }) => Promise<void>;
}

export function createEmailRouter(
  db: AppDatabase | undefined,
  signalFireDeps?: EmailSignalFireDeps | null,
): Router {
  const router = Router();

  /** 收件箱：从数据库读取已同步的邮件。邮件由定时任务从 IMAP 同步到 DB，不直接调 IMAP。需登录。 */
  router.get('/email/inbox', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ ok: false, error: '需要登录' });
        return;
      }
      if (!db) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const rows = await db.getEmailsByUser(userId, limit);
      const emails = rows.map((r: { uid: number; messageId?: string; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean }) => ({
        uid: r.uid,
        messageId: r.messageId,
        from: r.from,
        to: r.to,
        subject: r.subject,
        date: r.date,
        text: r.text,
        unseen: r.unseen,
      }));
      res.json({ ok: true, emails });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '读取失败', emails: [] });
    }
  });

  /** 手动触发邮件同步（IMAP → DB），供测试或立即拉取新邮件。新邮件会发出 email_received 信号。需登录。 */
  router.post('/email/sync', async (req, res) => {
    try {
      if (!db || !signalFireDeps) {
        res.status(503).json({ ok: false, error: '服务不可用' });
        return;
      }
      await runEmailCheck({
        db,
        getConfig: db.getConfig.bind(db),
        setConfig: db.setConfig.bind(db),
        runIntent: signalFireDeps.runIntent,
        runAgent: signalFireDeps.runAgent,
      });
      res.json({ ok: true, message: '同步完成' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '同步失败' });
    }
  });

  return router;
}
