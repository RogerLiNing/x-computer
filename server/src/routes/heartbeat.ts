/**
 * Heartbeat 心跳路由：管理心跳配置和通知
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { HeartbeatService } from '../heartbeat/HeartbeatService.js';

export function createHeartbeatRouter(
  db: AppDatabase,
  subscriptionService: SubscriptionService,
  orchestrator: AgentOrchestrator,
  heartbeatService: HeartbeatService,
): Router {
  const router = Router();

  // ── 配置端点 ─────────────────────────────────────────────────

  /** GET /api/heartbeat/config - 获取当前用户心跳配置 */
  router.get('/config', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const config = await heartbeatService.getConfig(userId);
      res.json(config);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  /** PUT /api/heartbeat/config - 更新心跳配置 */
  router.put('/config', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }

      const { enabled, intervalMinutes, quotaAlertThreshold, taskAlertEnabled } = req.body ?? {};

      const config = await heartbeatService.setConfig(userId, {
        ...(enabled !== undefined && { enabled: !!enabled }),
        ...(intervalMinutes !== undefined && { intervalMinutes: Math.max(5, Math.min(1440, Number(intervalMinutes))) }),
        ...(quotaAlertThreshold !== undefined && { quotaAlertThreshold: Math.max(0.1, Math.min(1.0, Number(quotaAlertThreshold))) }),
        ...(taskAlertEnabled !== undefined && { taskAlertEnabled: !!taskAlertEnabled }),
      });

      res.json({ success: true, config });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
    }
  });

  // ── 通知端点 ─────────────────────────────────────────────────

  /** GET /api/heartbeat/notifications - 获取最近通知列表 */
  router.get('/notifications', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }

      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const notifications = await heartbeatService.getNotifications(userId, limit);
      res.json({ notifications });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  /** DELETE /api/heartbeat/notifications/:id - 忽略通知 */
  router.delete('/notifications/:id', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }

      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: '缺少通知 ID' });
        return;
      }

      await heartbeatService.dismissNotification(userId, id);
      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '忽略失败' });
    }
  });

  // ── Checklist 端点 ───────────────────────────────────────────

  /** GET /api/heartbeat/checklist - 获取当前用户的 HEARTBEAT.md 检查清单 */
  router.get('/checklist', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const content = await heartbeatService.getChecklist(userId);
      res.json({ content });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  /** PUT /api/heartbeat/checklist - 保存 HEARTBEAT.md 检查清单 */
  router.put('/checklist', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const { content } = req.body ?? {};
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content 字段必填' });
        return;
      }
      await heartbeatService.setChecklist(userId, content);
      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '保存失败' });
    }
  });

  /** POST /api/heartbeat/checklist/run - 手动执行一次检查清单 */
  router.post('/checklist/run', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const result = await heartbeatService.executeHeartbeatCheck(userId);
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '执行失败' });
    }
  });

  /** GET /api/heartbeat/checklist/history - 获取历史检查记录 */
  router.get('/checklist/history', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 10));
      const history = await heartbeatService.getCheckFindings(userId, limit);
      res.json({ history });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  // ── 状态端点（仅管理员） ────────────────────────────────────

  /** GET /api/heartbeat/stats - 获取心跳服务状态（仅管理员） */
  router.get('/stats', async (_req, res) => {
    try {
      const stats = await heartbeatService.getStats();
      res.json(stats);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  return router;
}
