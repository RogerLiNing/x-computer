/**
 * 订阅相关 API 路由
 */

import { Router } from 'express';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import type { StripePaymentService } from '../subscription/stripeService.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createSubscriptionRoutes(
  subscriptionService: SubscriptionService,
  stripeService?: StripePaymentService
): Router {
  const router = Router();

  /**
   * GET /api/subscriptions/plans
   * 获取所有可用套餐
   */
  router.get('/plans', async (req, res) => {
    try {
      const plans = await subscriptionService.getPlans();
      res.json({ plans });
    } catch (err) {
      serverLogger.error('api/subscriptions/plans', '获取套餐失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch plans' });
    }
  });

  /**
   * GET /api/subscriptions/me
   * 获取当前用户的订阅信息
   */
  router.get('/me', async (req, res) => {
    const userId = (req as any).userId;
    
    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const [subscription, limits, usage] = await Promise.all([
        subscriptionService.getUserSubscription(userId),
        subscriptionService.getQuotaLimits(userId),
        subscriptionService.getCurrentUsage(userId),
      ]);
      const actualStorage = await subscriptionService.getActualStorageUsage(userId);
      if (usage) usage.storage = actualStorage;

      const canConfigureLLM = subscription ? ['pro', 'enterprise'].includes(subscription.planId) : false;
      res.json({
        subscription,
        limits,
        usage,
        canConfigureLLM,
      });
    } catch (err) {
      serverLogger.error('api/subscriptions/me', '获取订阅信息失败', `userId=${userId} error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  });

  /**
   * GET /api/subscriptions/me/invoices
   * 获取当前用户的账单/支付历史（R058 用户仪表板）
   */
  router.get('/me/invoices', async (req, res) => {
    const userId = (req as any).userId;

    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
      const invoices = await subscriptionService.getPaymentHistory(userId, limit);
      res.json({ invoices });
    } catch (err) {
      serverLogger.error('api/subscriptions/me/invoices', '获取账单历史失败', `userId=${userId} error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch invoices' });
    }
  });

  /**
   * GET /api/subscriptions/me/usage
   * 获取当前用户的使用历史
   */
  router.get('/me/usage', async (req, res) => {
    const userId = (req as any).userId;
    
    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const limit = parseInt(req.query.limit as string) || 30;
      const history = await subscriptionService.getUsageHistory(userId, limit);
      res.json({ history });
    } catch (err) {
      serverLogger.error('api/subscriptions/me/usage', '获取使用历史失败', `userId=${userId} error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch usage history' });
    }
  });

  /**
   * POST /api/subscriptions/me/cancel
   * 取消当前用户的订阅（在周期结束时）
   */
  router.post('/me/cancel', async (req, res) => {
    const userId = (req as any).userId;
    
    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const subscription = await subscriptionService.getUserSubscription(userId);
      
      if (!subscription) {
        return res.status(404).json({ error: 'No active subscription found' });
      }

      await subscriptionService.cancelSubscription(subscription.id);
      
      res.json({ 
        success: true,
        message: 'Subscription will be canceled at the end of the current period',
      });
    } catch (err) {
      serverLogger.error('api/subscriptions/me/cancel', '取消订阅失败', `userId=${userId} error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  });

  /**
   * POST /api/subscriptions/me/reactivate
   * 重新激活已取消的订阅
   */
  router.post('/me/reactivate', async (req, res) => {
    const userId = (req as any).userId;
    
    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const subscription = await subscriptionService.getUserSubscription(userId);
      
      if (!subscription) {
        return res.status(404).json({ error: 'No subscription found' });
      }

      await subscriptionService.reactivateSubscription(subscription.id);
      
      res.json({ 
        success: true,
        message: 'Subscription reactivated',
      });
    } catch (err) {
      serverLogger.error('api/subscriptions/me/reactivate', '重新激活订阅失败', `userId=${userId} error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to reactivate subscription' });
    }
  });

  /**
   * POST /api/subscriptions/checkout
   * 创建 Stripe Checkout Session
   */
  router.post('/checkout', async (req, res) => {
    const userId = (req as any).userId;
    
    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { planId, billingCycle, trialPeriodDays } = req.body;

    if (!planId || !billingCycle) {
      return res.status(400).json({ error: 'planId and billingCycle are required' });
    }

    if (!stripeService) {
      return res.status(501).json({ 
        error: 'Stripe not configured',
        message: 'Payment system is not available',
      });
    }

    try {
      const { sessionId, url } = await stripeService.createCheckoutSession(
        userId,
        planId,
        billingCycle,
        { trialPeriodDays }
      );

      res.json({ sessionId, url });
    } catch (err) {
      serverLogger.error('api/subscriptions/checkout', '创建 Checkout Session 失败', `userId=${userId} error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  /**
   * POST /api/subscriptions/webhook
   * Stripe Webhook 端点
   */
  router.post('/webhook', async (req, res) => {
    if (!stripeService) {
      return res.status(501).json({ error: 'Stripe not configured' });
    }

    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    try {
      await stripeService.handleWebhook(req.body, signature);
      res.json({ received: true });
    } catch (err) {
      serverLogger.error('api/subscriptions/webhook', 'Webhook 处理失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  });

  return router;
}
