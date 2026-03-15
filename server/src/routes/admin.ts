/**
 * Admin 路由：/api/admin/* 需管理员权限
 * 用户列表、封禁/解封、系统概览、套餐与使用量
 */

import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { createRequireAdmin } from '../middleware/requireAdmin.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';

const ADMIN_BANNED_KEY = 'admin_banned';

export function createAdminRouter(db: AsyncDatabase, subscriptionService?: SubscriptionService): Router {
  const router = Router();
  const requireAdmin = createRequireAdmin(db);

  router.use(requireAdmin);

  /** GET /api/admin/check - 校验是否为 admin（前端判断是否展示 Admin 应用） */
  router.get('/check', (_req, res) => {
    res.json({ admin: true });
  });

  /** GET /api/admin/users - 用户列表，支持分页与搜索；含套餐与使用量 */
  router.get('/users', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

      const result = await db.listAdminUsers({ limit, offset, search });

      if (subscriptionService) {
        const usersWithSub = await Promise.all(
          result.users.map(async (u) => {
            try {
              const [sub, limits, usage] = await Promise.all([
                subscriptionService.getUserSubscription(u.id),
                subscriptionService.getQuotaLimits(u.id),
                subscriptionService.getCurrentUsage(u.id),
              ]);
              const storage = await subscriptionService.getActualStorageUsage(u.id);
              return {
                ...u,
                planId: sub?.planId ?? 'free',
                planStatus: sub?.status ?? null,
                limits: limits
                  ? {
                      aiCallsLimit: limits.aiCallsLimit === Infinity ? -1 : limits.aiCallsLimit,
                      storageLimit: limits.storageLimit === Infinity ? -1 : limits.storageLimit,
                      concurrentTasksLimit: limits.concurrentTasksLimit === Infinity ? -1 : limits.concurrentTasksLimit,
                    }
                  : null,
                usage: usage ? { aiCalls: usage.aiCalls, storage, tasks: usage.tasks } : null,
              };
            } catch {
              return { ...u, planId: 'free', planStatus: null, limits: null, usage: null };
            }
          }),
        );
        res.json({ users: usersWithSub, total: result.total });
        return;
      }

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取用户列表失败';
      res.status(500).json({ error: msg });
    }
  });

  /** GET /api/admin/users/:id - 用户详情（含套餐与使用量） */
  router.get('/users/:id', async (req, res) => {
    const userId = req.params.id;
    if (!userId) {
      res.status(400).json({ error: '缺少用户 ID' });
      return;
    }
    try {
      const user = await db.getUser(userId);
      if (!user) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      const email = await db.getEmailByUserId(userId);
      const banned = (await db.getConfig(userId, ADMIN_BANNED_KEY)) === '1';

      let planId = 'free';
      let planStatus: string | null = null;
      let limits: { aiCallsLimit: number; storageLimit: number; concurrentTasksLimit: number } | null = null;
      let usage: { aiCalls: number; storage: number; tasks: number } | null = null;

      if (subscriptionService) {
        try {
          const [sub, l, u] = await Promise.all([
            subscriptionService.getUserSubscription(userId),
            subscriptionService.getQuotaLimits(userId),
            subscriptionService.getCurrentUsage(userId),
          ]);
          planId = sub?.planId ?? 'free';
          planStatus = sub?.status ?? null;
          limits = l
            ? {
                aiCallsLimit: l.aiCallsLimit === Infinity ? -1 : l.aiCallsLimit,
                storageLimit: l.storageLimit === Infinity ? -1 : l.storageLimit,
                concurrentTasksLimit: l.concurrentTasksLimit === Infinity ? -1 : l.concurrentTasksLimit,
              }
            : null;
          const storage = await subscriptionService.getActualStorageUsage(userId);
          usage = u ? { aiCalls: u.aiCalls, storage, tasks: u.tasks } : null;
        } catch {
          /* ignore */
        }
      }

      res.json({
        id: user.id,
        displayName: user.display_name,
        email: email ?? null,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        banned,
        planId,
        planStatus,
        limits,
        usage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取用户详情失败';
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/admin/users/:id/ban - 封禁用户 */
  router.post('/users/:id/ban', async (req, res) => {
    const userId = req.params.id;
    if (!userId) {
      res.status(400).json({ error: '缺少用户 ID' });
      return;
    }
    if (userId === req.userId) {
      res.status(400).json({ error: '不能封禁自己' });
      return;
    }
    try {
      const user = await db.getUser(userId);
      if (!user) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      await db.setConfig(userId, ADMIN_BANNED_KEY, '1');
      res.json({ success: true, banned: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '封禁失败';
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/admin/users/:id/unban - 解封用户 */
  router.post('/users/:id/unban', async (req, res) => {
    const userId = req.params.id;
    if (!userId) {
      res.status(400).json({ error: '缺少用户 ID' });
      return;
    }
    try {
      await db.deleteConfig(userId, ADMIN_BANNED_KEY);
      res.json({ success: true, banned: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '解封失败';
      res.status(500).json({ error: msg });
    }
  });

  /** GET /api/admin/stats - 系统概览 */
  router.get('/stats', async (req, res) => {
    try {
      const result = await db.listAdminUsers({ limit: 1, offset: 0 });
      const totalUsers = result.total;

      let taskCount = 0;
      try {
        const tasks = await db.getAllTasks?.();
        taskCount = Array.isArray(tasks) ? tasks.length : 0;
      } catch {
        taskCount = 0;
      }

      res.json({
        totalUsers,
        totalTasks: taskCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取统计失败';
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/admin/users/:id/plan - 管理员调整用户套餐（升级/降级） */
  router.post('/users/:id/plan', async (req, res) => {
    const userId = req.params.id;
    const { planId, billingCycle } = req.body ?? {};
    if (!userId || typeof planId !== 'string' || !planId.trim()) {
      res.status(400).json({ error: '缺少用户 ID 或套餐 ID' });
      return;
    }
    if (!subscriptionService) {
      res.status(501).json({ error: '订阅服务未配置' });
      return;
    }
    const planIdTrim = planId.trim();
    const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
    try {
      const user = await db.getUser(userId);
      if (!user) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      const existing = await subscriptionService.getUserSubscription(userId);
      if (existing) {
        await subscriptionService.updateSubscriptionStripeByUserId(userId, {
          plan_id: planIdTrim,
          billing_cycle: cycle,
        });
      } else {
        await subscriptionService.createSubscription(userId, planIdTrim, cycle);
      }
      res.json({ success: true, planId: planIdTrim, billingCycle: cycle });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '调整套餐失败';
      res.status(500).json({ error: msg });
    }
  });

  /** GET /api/admin/plans - 获取所有套餐（供下拉选择） */
  router.get('/plans', async (req, res) => {
    if (!subscriptionService) {
      return res.json({ plans: [] });
    }
    try {
      const plans = await subscriptionService.getPlans();
      res.json({ plans });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : '获取套餐失败' });
    }
  });

  /** GET /api/admin/config - 全局配置（只读） */
  router.get('/config', (_req, res) => {
    const config = loadDefaultConfig();
    res.json({
      allowRegister: config.auth?.allowRegister ?? true,
    });
  });

  return router;
}
