/**
 * 订阅服务
 * 管理用户订阅、配额、使用量
 */

import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { calculateUserStorage } from './calculateUserStorage.js';
import path from 'path';

export interface Plan {
  id: string;
  name: string;
  displayNameEn: string;
  displayNameZh: string;
  descriptionEn?: string;
  descriptionZh?: string;
  priceMonthly?: number;  // 美分
  priceYearly?: number;   // 美分
  aiCallsLimit: number;
  storageLimit: number;   // bytes
  concurrentTasksLimit: number;
  features: string[];
  isActive: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: 'active' | 'canceled' | 'expired' | 'past_due' | 'trialing';
  billingCycle: 'monthly' | 'yearly';
  currentPeriodStart: number;
  currentPeriodEnd: number;
  trialEnd?: number;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  stripePriceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UsageRecord {
  id: string;
  userId: string;
  resourceType: 'ai_calls' | 'storage' | 'tasks' | 'api_requests';
  amount: number;
  periodStart: number;
  periodEnd: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface QuotaLimits {
  aiCallsLimit: number;
  storageLimit: number;
  concurrentTasksLimit: number;
}

export interface CurrentUsage {
  aiCalls: number;
  storage: number;
  tasks: number;
}

export class SubscriptionService {
  private workspaceRoot?: string;

  constructor(private db: AsyncDatabase, workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 获取所有可用套餐
   */
  async getPlans(): Promise<Plan[]> {
    const rows = await this.db.query<{
      id: string;
      name: string;
      display_name_en: string;
      display_name_zh: string;
      description_en?: string;
      description_zh?: string;
      price_monthly?: number;
      price_yearly?: number;
      ai_calls_limit: number;
      storage_limit: number;
      concurrent_tasks_limit: number;
      features: string;
      is_active: number;
    }>(`SELECT * FROM plans WHERE is_active = 1 ORDER BY price_monthly ASC`);

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      displayNameEn: r.display_name_en,
      displayNameZh: r.display_name_zh,
      descriptionEn: r.description_en,
      descriptionZh: r.description_zh,
      priceMonthly: r.price_monthly ?? undefined,
      priceYearly: r.price_yearly ?? undefined,
      aiCallsLimit: r.ai_calls_limit,
      storageLimit: r.storage_limit,
      concurrentTasksLimit: r.concurrent_tasks_limit,
      features: JSON.parse(r.features || '[]'),
      isActive: r.is_active === 1,
    }));
  }

  /**
   * 获取用户当前订阅
   */
  async getUserSubscription(userId: string): Promise<Subscription | null> {
    const row = await this.db.queryOne<{
      id: string; user_id: string; plan_id: string; status: string; billing_cycle: string;
      current_period_start: number; current_period_end: number; trial_end?: number;
      cancel_at_period_end: number; stripe_subscription_id?: string; stripe_customer_id?: string;
      stripe_price_id?: string; created_at: number; updated_at: number;
    }>(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, [userId]);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      planId: row.plan_id,
      status: row.status as Subscription['status'],
      billingCycle: row.billing_cycle as Subscription['billingCycle'],
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      trialEnd: row.trial_end,
      cancelAtPeriodEnd: row.cancel_at_period_end === 1,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId: row.stripe_customer_id,
      stripePriceId: row.stripe_price_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 获取用户配额限制
   */
  async getQuotaLimits(userId: string): Promise<QuotaLimits> {
    const subscription = await this.getUserSubscription(userId);
    
    if (!subscription) {
      return {
        aiCallsLimit: 100,
        storageLimit: 100 * 1024 * 1024, // 100MB
        concurrentTasksLimit: 1,
      };
    }

    const plan = await this.db.queryOne<{ ai_calls_limit: number; storage_limit: number; concurrent_tasks_limit: number }>(
      'SELECT * FROM plans WHERE id = ?',
      [subscription.planId]
    );
    
    if (!plan) {
      return {
        aiCallsLimit: 100,
        storageLimit: 100 * 1024 * 1024,
        concurrentTasksLimit: 1,
      };
    }

    return {
      aiCallsLimit: plan.ai_calls_limit === -1 ? Infinity : plan.ai_calls_limit,
      storageLimit: plan.storage_limit === -1 ? Infinity : plan.storage_limit,
      concurrentTasksLimit: plan.concurrent_tasks_limit === -1 ? Infinity : plan.concurrent_tasks_limit,
    };
  }

  /**
   * 获取用户当前周期的使用量
   */
  async getCurrentUsage(userId: string): Promise<CurrentUsage> {
    const subscription = await this.getUserSubscription(userId);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const periodStart = subscription?.currentPeriodStart ?? now - thirtyDaysMs;
    const periodEnd = subscription?.currentPeriodEnd ?? now;

    const aiCalls = await this.db.queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM usage_records
       WHERE user_id = ? AND resource_type = 'ai_calls' AND period_start < ? AND period_end > ?`,
      [userId, periodEnd, periodStart]
    );
    const runningTasks = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND status IN ('pending', 'running')`,
      [userId]
    );

    return {
      aiCalls: aiCalls?.total ?? 0,
      storage: 0,
      tasks: runningTasks?.count ?? 0,
    };
  }

  /**
   * 获取用户实际存储使用量（异步计算文件系统大小）
   */
  async getActualStorageUsage(userId: string): Promise<number> {
    if (!this.workspaceRoot) {
      return 0;
    }

    const userWorkspace = path.join(this.workspaceRoot, 'users', userId, 'workspace');
    return await calculateUserStorage(userWorkspace);
  }

  /**
   * 获取用户套餐的功能特性列表（用于按套餐限制工具/MCP 等）
   * 如 trial: ['basic_features'], personal: ['all_features','priority_support'], pro: ['all_features','priority_support','advanced_tools']
   */
  async getPlanFeatures(userId: string): Promise<string[]> {
    const subscription = await this.getUserSubscription(userId);
    if (!subscription) return ['basic_features'];
    const plan = await this.db.queryOne<{ features: string }>('SELECT features FROM plans WHERE id = ?', [subscription.planId]);
    if (!plan?.features) return ['basic_features'];
    try {
      return JSON.parse(plan.features) as string[];
    } catch {
      return ['basic_features'];
    }
  }

  /**
   * 检查用户是否有足够配额
   */
  async checkQuota(userId: string, resourceType: 'ai_calls' | 'storage' | 'tasks'): Promise<boolean> {
    const limits = await this.getQuotaLimits(userId);
    const usage = await this.getCurrentUsage(userId);

    switch (resourceType) {
      case 'ai_calls':
        return usage.aiCalls < limits.aiCallsLimit;
      case 'storage':
        return true;
      case 'tasks':
        return usage.tasks < limits.concurrentTasksLimit;
    }
  }

  /**
   * 记录使用量
   */
  async recordUsage(
    userId: string,
    resourceType: 'ai_calls' | 'storage' | 'tasks' | 'api_requests',
    amount: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const subscription = await this.getUserSubscription(userId);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // 付费用户用订阅周期；免费用户用「过去 30 天」窗口，与 getCurrentUsage 查询保持一致
    const periodStart = subscription?.currentPeriodStart ?? now - thirtyDaysMs;
    const periodEnd = subscription?.currentPeriodEnd ?? now;

    const id = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    await this.db.run(
      `INSERT INTO usage_records (id, user_id, resource_type, amount, period_start, period_end, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, resourceType, amount, periodStart, periodEnd, metadata ? JSON.stringify(metadata) : null, now]
    );

    serverLogger.info('subscription/usage', `记录使用量`, `userId=${userId} type=${resourceType} amount=${amount}`);
  }

  /**
   * 创建订阅
   */
  async createSubscription(
    userId: string,
    planId: string,
    billingCycle: 'monthly' | 'yearly',
    options?: {
      stripeSubscriptionId?: string;
      stripeCustomerId?: string;
      stripePriceId?: string;
      trialEnd?: number;
    }
  ): Promise<Subscription> {
    const plan = await this.db.queryOne('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    const now = Date.now();
    const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const periodStart = now;
    const periodEnd = billingCycle === 'yearly' 
      ? now + 365 * 24 * 60 * 60 * 1000 
      : now + 30 * 24 * 60 * 60 * 1000;

    await this.db.run(
      `INSERT INTO subscriptions (
        id, user_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, trial_end,
        stripe_subscription_id, stripe_customer_id, stripe_price_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, planId, options?.trialEnd ? 'trialing' : 'active', billingCycle, periodStart, periodEnd,
       options?.trialEnd ?? null, options?.stripeSubscriptionId ?? null, options?.stripeCustomerId ?? null, options?.stripePriceId ?? null, now, now]
    );

    serverLogger.info('subscription/create', `创建订阅`, `userId=${userId} planId=${planId} cycle=${billingCycle}`);

    const sub = await this.getUserSubscription(userId);
    if (!sub) throw new Error('createSubscription: getUserSubscription returned null');
    return sub;
  }

  /**
   * 更新订阅状态
   */
  async updateSubscriptionStatus(subscriptionId: string, status: Subscription['status']): Promise<void> {
    await this.db.run(`UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?`, [status, Date.now(), subscriptionId]);
    serverLogger.info('subscription/update', `更新订阅状态`, `subscriptionId=${subscriptionId} status=${status}`);
  }

  /**
   * 取消订阅（在周期结束时）
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.db.run(`UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?`, [Date.now(), subscriptionId]);
    serverLogger.info('subscription/cancel', `取消订阅`, `subscriptionId=${subscriptionId}`);
  }

  /**
   * 立即取消订阅
   */
  async cancelSubscriptionImmediately(subscriptionId: string): Promise<void> {
    await this.db.run(`UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?`, [Date.now(), subscriptionId]);
    serverLogger.info('subscription/cancel', `立即取消订阅`, `subscriptionId=${subscriptionId}`);
  }

  /**
   * 重新激活已取消的订阅（取消 cancel_at_period_end 标记）
   */
  async reactivateSubscription(subscriptionId: string): Promise<void> {
    await this.db.run(`UPDATE subscriptions SET cancel_at_period_end = 0, updated_at = ? WHERE id = ?`, [Date.now(), subscriptionId]);
  }

  /**
   * 按 userId 更新订阅的 Stripe 相关字段（供 Stripe Webhook 使用）
   */
  async updateSubscriptionStripeByUserId(
    userId: string,
    fields: {
      plan_id?: string;
      billing_cycle?: string;
      status?: string;
      current_period_start?: number;
      current_period_end?: number;
      stripe_subscription_id?: string;
      stripe_customer_id?: string;
      stripe_price_id?: string;
    }
  ): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `UPDATE subscriptions SET plan_id = COALESCE(?, plan_id), billing_cycle = COALESCE(?, billing_cycle), status = COALESCE(?, status),
       current_period_start = COALESCE(?, current_period_start), current_period_end = COALESCE(?, current_period_end),
       stripe_subscription_id = COALESCE(?, stripe_subscription_id), stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_price_id = COALESCE(?, stripe_price_id), updated_at = ?
       WHERE user_id = ?`,
      [fields.plan_id ?? null, fields.billing_cycle ?? null, fields.status ?? null, fields.current_period_start ?? null, fields.current_period_end ?? null,
       fields.stripe_subscription_id ?? null, fields.stripe_customer_id ?? null, fields.stripe_price_id ?? null, now, userId]
    );
  }

  /**
   * 按 stripe_subscription_id 更新订阅（供 Webhook 使用）
   */
  async updateSubscriptionByStripeId(
    stripeSubscriptionId: string,
    fields: { status?: string; current_period_start?: number; current_period_end?: number; cancel_at_period_end?: boolean }
  ): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `UPDATE subscriptions SET status = COALESCE(?, status), current_period_start = COALESCE(?, current_period_start), current_period_end = COALESCE(?, current_period_end),
       cancel_at_period_end = COALESCE(?, cancel_at_period_end), updated_at = ? WHERE stripe_subscription_id = ?`,
      [fields.status ?? null, fields.current_period_start ?? null, fields.current_period_end ?? null, fields.cancel_at_period_end === undefined ? null : (fields.cancel_at_period_end ? 1 : 0), now, stripeSubscriptionId]
    );
  }

  /**
   * 按 stripe_subscription_id 将订阅状态设为 canceled 或 past_due
   */
  async setSubscriptionStatusByStripeId(stripeSubscriptionId: string, status: string): Promise<void> {
    await this.db.run(`UPDATE subscriptions SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?`, [status, Date.now(), stripeSubscriptionId]);
  }

  /**
   * 写入支付历史（供 Stripe Webhook 使用，需存在 payment_history 表）
   */
  async insertPaymentHistory(record: {
    id: string;
    user_id: string;
    subscription_id: string | null;
    amount: number;
    currency: string;
    status: string;
    stripe_payment_intent_id: string | null;
    stripe_invoice_id: string | null;
    description: string | null;
  }): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `INSERT INTO payment_history (id, user_id, subscription_id, amount, currency, status, stripe_payment_intent_id, stripe_invoice_id, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.user_id, record.subscription_id, record.amount, record.currency, record.status, record.stripe_payment_intent_id, record.stripe_invoice_id, record.description, now, now]
    );
  }

  /**
   * 获取用户账单/支付历史（R058 用户仪表板）
   */
  async getPaymentHistory(userId: string, limit: number = 20): Promise<{
    id: string;
    subscriptionId: string | null;
    amount: number;
    currency: string;
    status: string;
    stripeInvoiceId: string | null;
    description: string | null;
    createdAt: number;
  }[]> {
    const rows = await this.db.query<{
      id: string;
      subscription_id: string | null;
      amount: number;
      currency: string;
      status: string;
      stripe_invoice_id: string | null;
      description: string | null;
      created_at: number;
    }>(`SELECT id, subscription_id, amount, currency, status, stripe_invoice_id, description, created_at
        FROM payment_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]);
    return rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscription_id,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      stripeInvoiceId: r.stripe_invoice_id,
      description: r.description,
      createdAt: r.created_at,
    }));
  }

  /** 根据 stripe_subscription_id 解析本地 subscription id（用于 payment_history.subscription_id） */
  async getSubscriptionIdByStripeId(stripeSubscriptionId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(`SELECT id FROM subscriptions WHERE stripe_subscription_id = ?`, [stripeSubscriptionId]);
    return row?.id ?? null;
  }

  /**
   * 获取用户的使用历史
   */
  async getUsageHistory(userId: string, limit: number = 30): Promise<UsageRecord[]> {
    const rows = await this.db.query<{
      id: string;
      user_id: string;
      resource_type: string;
      amount: number;
      period_start: number;
      period_end: number;
      metadata: string | null;
      created_at: number;
    }>(`SELECT * FROM usage_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, [userId, limit]);

    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      resourceType: r.resource_type as UsageRecord['resourceType'],
      amount: r.amount,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.created_at,
    }));
  }

  /**
   * 检查订阅是否过期，并更新状态
   */
  async checkAndUpdateExpiredSubscriptions(): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE status = 'trialing' AND trial_end < ?`,
      [now, now]
    );
    await this.db.run(
      `UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE status = 'active' AND current_period_end < ? AND cancel_at_period_end = 1`,
      [now, now]
    );
    serverLogger.info('subscription/check', '检查并更新过期订阅');
  }
}
