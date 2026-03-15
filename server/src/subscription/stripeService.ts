/**
 * Stripe 支付集成服务
 * 处理订阅创建、Webhook 事件等
 */

import Stripe from 'stripe';
import type { SubscriptionService } from './SubscriptionService.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceIds: {
    personalMonthly: string;
    personalYearly: string;
    proMonthly: string;
    proYearly: string;
    testMonthly?: string;   // $0.10/月，用于支付流程测试
    testYearly?: string;    // 可选，同 testMonthly 用于年付
  };
}

export class StripePaymentService {
  private stripe: Stripe;
  private webhookSecret: string;
  private priceIds: StripeConfig['priceIds'];

  constructor(
    private config: StripeConfig,
    private subscriptionService: SubscriptionService
  ) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: '2026-02-25.clover',
    });
    this.webhookSecret = config.webhookSecret;
    this.priceIds = config.priceIds;
  }

  /**
   * 创建 Checkout Session
   */
  async createCheckoutSession(
    userId: string,
    planId: string,
    billingCycle: 'monthly' | 'yearly',
    options?: {
      successUrl?: string;
      cancelUrl?: string;
      trialPeriodDays?: number;
    }
  ): Promise<{ sessionId: string; url: string }> {
    try {
      // 获取对应的 Stripe Price ID
      const priceId = this.getPriceId(planId, billingCycle);
      
      if (!priceId) {
        throw new Error(`No Stripe price ID found for plan ${planId} (${billingCycle})`);
      }

      // 检查用户是否已有 Stripe Customer
      const existingSubscription = await this.subscriptionService.getUserSubscription(userId);
      const customerId = existingSubscription?.stripeCustomerId?.trim() || undefined;

      // 创建 Checkout Session（无 customer 时 Stripe 会在 Checkout 中创建新客户）
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        ...(customerId ? { customer: customerId } : {}),
        client_reference_id: userId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: options?.successUrl ?? `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: options?.cancelUrl ?? `${process.env.FRONTEND_URL}/subscription`,
        subscription_data: options?.trialPeriodDays
          ? {
              trial_period_days: options.trialPeriodDays,
            }
          : undefined,
        metadata: {
          userId,
          planId,
          billingCycle,
        },
      });

      serverLogger.info('stripe/checkout', '创建 Checkout Session', `userId=${userId} planId=${planId} sessionId=${session.id}`);

      return {
        sessionId: session.id,
        url: session.url!,
      };
    } catch (err) {
      serverLogger.error('stripe/checkout', '创建 Checkout Session 失败', `error=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * 处理 Stripe Webhook 事件
   */
  async handleWebhook(payload: string | Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    } catch (err) {
      serverLogger.error('stripe/webhook', 'Webhook 签名验证失败', `error=${err instanceof Error ? err.message : String(err)}`);
      throw new Error('Webhook signature verification failed');
    }

    serverLogger.info('stripe/webhook', `收到 Webhook 事件`, `type=${event.type} id=${event.id}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        default:
          serverLogger.info('stripe/webhook', `未处理的事件类型`, `type=${event.type}`);
      }
    } catch (err) {
      serverLogger.error('stripe/webhook', `处理 Webhook 事件失败`, `type=${event.type} error=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * 取消订阅
   */
  async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      serverLogger.info('stripe/cancel', '取消订阅', `subscriptionId=${stripeSubscriptionId}`);
    } catch (err) {
      serverLogger.error('stripe/cancel', '取消订阅失败', `error=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * 立即取消订阅
   */
  async cancelSubscriptionImmediately(stripeSubscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(stripeSubscriptionId);

      serverLogger.info('stripe/cancel', '立即取消订阅', `subscriptionId=${stripeSubscriptionId}`);
    } catch (err) {
      serverLogger.error('stripe/cancel', '立即取消订阅失败', `error=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * 重新激活订阅
   */
  async reactivateSubscription(stripeSubscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      serverLogger.info('stripe/reactivate', '重新激活订阅', `subscriptionId=${stripeSubscriptionId}`);
    } catch (err) {
      serverLogger.error('stripe/reactivate', '重新激活订阅失败', `error=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // ── 私有方法 ──

  private getPriceId(planId: string, billingCycle: 'monthly' | 'yearly'): string | null {
    const key = `${planId}${billingCycle === 'monthly' ? 'Monthly' : 'Yearly'}` as keyof StripeConfig['priceIds'];
    return this.priceIds[key] ?? null;
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.userId || session.client_reference_id;
    const planId = session.metadata?.planId;
    const billingCycle = session.metadata?.billingCycle as 'monthly' | 'yearly';

    if (!userId || !planId || !billingCycle) {
      serverLogger.error('stripe/checkout', 'Checkout Session 缺少必要的 metadata');
      return;
    }

    const stripeSubscriptionId = session.subscription as string;
    const stripeCustomerId = session.customer as string;

    // 获取订阅详情
    const stripeSubscription = await this.stripe.subscriptions.retrieve(stripeSubscriptionId);

    const existingSubscription = await this.subscriptionService.getUserSubscription(userId);
    
    if (existingSubscription) {
      await this.subscriptionService.updateSubscriptionStripeByUserId(userId, {
        plan_id: planId,
        billing_cycle: billingCycle,
        status: stripeSubscription.status === 'trialing' ? 'trialing' : 'active',
        current_period_start: (stripeSubscription as any).current_period_start * 1000,
        current_period_end: (stripeSubscription as any).current_period_end * 1000,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_customer_id: stripeCustomerId,
        stripe_price_id: stripeSubscription.items.data[0]?.price.id ?? undefined,
      });
    } else {
      await this.subscriptionService.createSubscription(userId, planId, billingCycle, {
        stripeSubscriptionId,
        stripeCustomerId,
        stripePriceId: stripeSubscription.items.data[0]?.price.id,
        trialEnd: stripeSubscription.trial_end ? stripeSubscription.trial_end * 1000 : undefined,
      });
    }

    serverLogger.info('stripe/checkout', 'Checkout 完成，订阅已创建', `userId=${userId} planId=${planId}`);
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      serverLogger.error('stripe/subscription', '订阅缺少 userId metadata');
      return;
    }

    await this.subscriptionService.updateSubscriptionByStripeId(subscription.id, {
      status: subscription.status === 'trialing' ? 'trialing' : subscription.status === 'active' ? 'active' : 'past_due',
      current_period_start: (subscription as any).current_period_start * 1000,
      current_period_end: (subscription as any).current_period_end * 1000,
      cancel_at_period_end: subscription.cancel_at_period_end,
    });

    serverLogger.info('stripe/subscription', '订阅已更新', `subscriptionId=${subscription.id} status=${subscription.status}`);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    await this.subscriptionService.setSubscriptionStatusByStripeId(subscription.id, 'canceled');
    serverLogger.info('stripe/subscription', '订阅已删除', `subscriptionId=${subscription.id}`);
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    const userId = (invoice as any).subscription_details?.metadata?.userId;
    const subscriptionId = (invoice as any).subscription as string;

    if (!userId) {
      serverLogger.error('stripe/payment', '发票缺少 userId metadata');
      return;
    }

    const subId = await this.subscriptionService.getSubscriptionIdByStripeId(subscriptionId);
    const id = `payment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await this.subscriptionService.insertPaymentHistory({
      id,
      user_id: userId,
      subscription_id: subId,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: 'succeeded',
      stripe_payment_intent_id: (invoice as any).payment_intent as string ?? null,
      stripe_invoice_id: invoice.id,
      description: invoice.description ?? null,
    });

    serverLogger.info('stripe/payment', '支付成功', `userId=${userId} amount=${invoice.amount_paid} ${invoice.currency}`);
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const userId = (invoice as any).subscription_details?.metadata?.userId;
    const subscriptionId = (invoice as any).subscription as string;

    if (!userId) {
      serverLogger.error('stripe/payment', '发票缺少 userId metadata');
      return;
    }

    const subId = await this.subscriptionService.getSubscriptionIdByStripeId(subscriptionId);
    const id = `payment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await this.subscriptionService.insertPaymentHistory({
      id,
      user_id: userId,
      subscription_id: subId,
      amount: invoice.amount_due,
      currency: invoice.currency,
      status: 'failed',
      stripe_payment_intent_id: (invoice as any).payment_intent as string ?? null,
      stripe_invoice_id: invoice.id,
      description: invoice.description ?? null,
    });

    await this.subscriptionService.setSubscriptionStatusByStripeId(subscriptionId, 'past_due');

    serverLogger.warn('stripe/payment', '支付失败', `userId=${userId} amount=${invoice.amount_due} ${invoice.currency}`);
  }
}
