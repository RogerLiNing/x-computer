/**
 * 订阅管理应用
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, CreditCard, Calendar, TrendingUp, FileText } from 'lucide-react';
import { getUserId } from '@/utils/userId';
import { api } from '@/utils/api';

interface Plan {
  id: string;
  name: string;
  displayNameEn: string;
  displayNameZh: string;
  descriptionEn?: string;
  descriptionZh?: string;
  priceMonthly?: number;
  priceYearly?: number;
  aiCallsLimit: number;
  storageLimit: number;
  concurrentTasksLimit: number;
  features: string[];
  isActive: boolean;
}

interface Subscription {
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

interface QuotaLimits {
  aiCallsLimit: number;
  storageLimit: number;
  concurrentTasksLimit: number;
}

interface CurrentUsage {
  aiCalls: number;
  storage: number;
  tasks: number;
}

interface SubscriptionData {
  subscription: Subscription | null;
  limits: QuotaLimits;
  usage: CurrentUsage;
}

export function SubscriptionApp() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [invoices, setInvoices] = useState<Array<{ id: string; amount: number; currency: string; status: string; description: string | null; createdAt: number }>>([]);
  const [selectedBillingCycle, setSelectedBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = { 'X-User-Id': getUserId() };
      
      const [plansRes, subRes] = await Promise.all([
        fetch('/api/subscriptions/plans', { headers }),
        fetch('/api/subscriptions/me', { headers }),
      ]);

      if (!plansRes.ok || !subRes.ok) {
        const errorText = !plansRes.ok 
          ? await plansRes.text() 
          : await subRes.text();
        throw new Error(`Failed to load subscription data: ${errorText}`);
      }

      const plansData = await plansRes.json();
      const subData = await subRes.json();

      setPlans(plansData.plans);
      setSubscriptionData(subData);

      try {
        const invRes = await api.getSubscriptionInvoices(20);
        setInvoices(invRes.invoices ?? []);
      } catch {
        setInvoices([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Failed to load subscription data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (planId: string) => {
    try {
      const res = await fetch('/api/subscriptions/checkout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': getUserId(),
        },
        body: JSON.stringify({
          planId,
          billingCycle: selectedBillingCycle,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create checkout session');
      }

      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to upgrade');
    }
  };

  const handleCancel = async () => {
    if (!confirm(t('subscription.cancel') + '?')) {
      return;
    }

    try {
      const res = await fetch('/api/subscriptions/me/cancel', {
        method: 'POST',
        headers: { 'X-User-Id': getUserId() },
      });

      if (!res.ok) {
        throw new Error('Failed to cancel subscription');
      }

      await loadData();
      alert('Subscription will be canceled at the end of the current period');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const handleReactivate = async () => {
    try {
      const res = await fetch('/api/subscriptions/me/reactivate', {
        method: 'POST',
      });

      if (!res.ok) {
        throw new Error('Failed to reactivate subscription');
      }

      await loadData();
      alert('Subscription reactivated');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reactivate');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === Infinity || bytes === -1) return t('subscription.unlimited');
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatNumber = (num: number): string => {
    if (num === Infinity || num === -1) return t('subscription.unlimited');
    return num.toLocaleString();
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(i18n.language);
  };

  const getPlanDisplayName = (plan: Plan): string => {
    return i18n.language === 'zh-CN' ? plan.displayNameZh : plan.displayNameEn;
  };

  const getPlanDescription = (plan: Plan): string => {
    const localeKey = `subscription.${plan.id}Desc`;
    const fromLocale = t(localeKey);
    if (fromLocale && fromLocale !== localeKey) return fromLocale;
    return i18n.language === 'zh-CN' ? (plan.descriptionZh ?? '') : (plan.descriptionEn ?? '');
  };

  const getStatusColor = (status: Subscription['status']): string => {
    switch (status) {
      case 'active':
        return 'text-green-400';
      case 'trialing':
        return 'text-blue-400';
      case 'canceled':
      case 'expired':
        return 'text-red-400';
      case 'past_due':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-desktop-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-desktop-accent text-white rounded-lg hover:bg-desktop-accent/80"
          >
            {t('subscription.loading')}
          </button>
        </div>
      </div>
    );
  }

  const currentPlan = plans.find(p => p.id === subscriptionData?.subscription?.planId);
  const planDisplayName = subscriptionData?.subscription
    ? (currentPlan ? getPlanDisplayName(currentPlan) : t(`subscription.${subscriptionData.subscription.planId}`))
    : t('subscription.freePlan');

  return (
    <div className="h-full overflow-auto bg-desktop-bg/50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 当前订阅状态与使用量（免费用户也显示） */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-desktop-text mb-2">
                {t('subscription.currentPlan')}
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-desktop-accent">
                  {planDisplayName}
                </span>
                {subscriptionData?.subscription && (
                  <span className={`text-sm ${getStatusColor(subscriptionData.subscription.status)}`}>
                    {t(`subscription.${subscriptionData.subscription.status}`)}
                  </span>
                )}
              </div>
            </div>
            {subscriptionData?.subscription?.status === 'active' && !subscriptionData.subscription.cancelAtPeriodEnd && (
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10"
              >
                {t('subscription.cancel')}
              </button>
            )}
            {subscriptionData?.subscription?.cancelAtPeriodEnd && (
              <button
                onClick={handleReactivate}
                className="px-4 py-2 text-sm text-green-400 border border-green-400/30 rounded-lg hover:bg-green-400/10"
              >
                {t('subscription.reactivate')}
              </button>
            )}
          </div>

          {subscriptionData?.subscription && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-desktop-accent" />
                <div>
                  <p className="text-xs text-desktop-text/60">{t('subscription.currentPeriod')}</p>
                  <p className="text-sm text-desktop-text">
                    {formatDate(subscriptionData.subscription.currentPeriodStart)} - {formatDate(subscriptionData.subscription.currentPeriodEnd)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-desktop-accent" />
                <div>
                  <p className="text-xs text-desktop-text/60">{t('subscription.billingCycle')}</p>
                  <p className="text-sm text-desktop-text">
                    {t(`subscription.${subscriptionData.subscription.billingCycle}`)}
                  </p>
                </div>
              </div>
              {subscriptionData.subscription.trialEnd && (
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="text-xs text-desktop-text/60">{t('subscription.trialEndsOn')}</p>
                    <p className="text-sm text-desktop-text">
                      {formatDate(subscriptionData.subscription.trialEnd)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 使用量（免费与付费用户均显示） */}
          {subscriptionData && (
            <div className={`${subscriptionData?.subscription ? 'mt-6 pt-6 border-t border-white/10' : ''}`}>
              <h3 className="text-sm font-medium text-desktop-text mb-4">{t('subscription.usage')}</h3>
              <div className="space-y-3">
                <UsageBar
                  label={t('subscription.aiCalls')}
                  current={subscriptionData.usage.aiCalls}
                  limit={subscriptionData.limits.aiCallsLimit}
                  formatter={formatNumber}
                />
                <UsageBar
                  label={t('subscription.storage')}
                  current={subscriptionData.usage.storage}
                  limit={subscriptionData.limits.storageLimit}
                  formatter={formatBytes}
                />
                <UsageBar
                  label={t('subscription.concurrentTasks')}
                  current={subscriptionData.usage.tasks}
                  limit={subscriptionData.limits.concurrentTasksLimit}
                  formatter={formatNumber}
                />
              </div>
            </div>
          )}
        </div>

        {/* 账单历史（R058） */}
        {invoices.length > 0 && (
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
            <h3 className="text-sm font-medium text-desktop-text mb-4 flex items-center gap-2">
              <FileText size={18} className="text-desktop-accent" />
              {t('account.invoices')}
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 text-sm"
                >
                  <div>
                    <span className="text-desktop-text">
                      {inv.description ?? `Invoice ${inv.id.slice(0, 8)}`}
                    </span>
                    <span className="text-desktop-text/50 ml-2">
                      {formatDate(inv.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${inv.status === 'succeeded' ? 'text-green-400' : inv.status === 'failed' ? 'text-red-400' : 'text-desktop-text/60'}`}>
                      {inv.status}
                    </span>
                    <span className="text-desktop-accent font-medium">
                      {(inv.amount / 100).toFixed(2)} {inv.currency.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 计费周期选择 */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setSelectedBillingCycle('monthly')}
            className={`px-6 py-2 rounded-lg transition-colors ${
              selectedBillingCycle === 'monthly'
                ? 'bg-desktop-accent text-white'
                : 'bg-white/5 text-desktop-text hover:bg-white/10'
            }`}
          >
            {t('subscription.monthly')}
          </button>
          <button
            onClick={() => setSelectedBillingCycle('yearly')}
            className={`px-6 py-2 rounded-lg transition-colors ${
              selectedBillingCycle === 'yearly'
                ? 'bg-desktop-accent text-white'
                : 'bg-white/5 text-desktop-text hover:bg-white/10'
            }`}
          >
            {t('subscription.yearly')}
          </button>
        </div>

        {/* 套餐列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map(plan => {
            const price = selectedBillingCycle === 'monthly' ? plan.priceMonthly : plan.priceYearly;
            const isCurrentPlan = plan.id === subscriptionData?.subscription?.planId;

            return (
              <div
                key={plan.id}
                className={`bg-white/5 backdrop-blur-sm rounded-xl p-6 border ${
                  isCurrentPlan ? 'border-desktop-accent' : 'border-white/10'
                } hover:border-white/20 transition-colors`}
              >
                <h3 className="text-xl font-semibold text-desktop-text mb-2">
                  {getPlanDisplayName(plan)}
                </h3>
                <p className="text-sm text-desktop-text/60 mb-4 h-10">
                  {getPlanDescription(plan)}
                </p>

                {price !== undefined && price !== null ? (
                  <div className="mb-6">
                    <span className="text-3xl font-bold text-desktop-accent">
                      ${(price / 100).toFixed(0)}
                    </span>
                    <span className="text-sm text-desktop-text/60">
                      {selectedBillingCycle === 'monthly' ? t('subscription.perMonth') : t('subscription.perYear')}
                    </span>
                  </div>
                ) : (
                  <div className="mb-6">
                    <span className="text-lg text-desktop-text/60">
                      {t('subscription.contactSales')}
                    </span>
                  </div>
                )}

                <ul className="space-y-2 mb-6">
                  <li className="flex items-center gap-2 text-sm text-desktop-text">
                    <Check className="w-4 h-4 text-green-400" />
                    {formatNumber(plan.aiCallsLimit)} {t('subscription.aiCalls')}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-desktop-text">
                    <Check className="w-4 h-4 text-green-400" />
                    {formatBytes(plan.storageLimit)} {t('subscription.storage')}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-desktop-text">
                    <Check className="w-4 h-4 text-green-400" />
                    {formatNumber(plan.concurrentTasksLimit)} {t('subscription.concurrentTasks')}
                  </li>
                </ul>

                <button
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={isCurrentPlan}
                  className={`w-full py-2 rounded-lg transition-colors ${
                    isCurrentPlan
                      ? 'bg-white/5 text-desktop-text/40 cursor-not-allowed'
                      : 'bg-desktop-accent text-white hover:bg-desktop-accent/80'
                  }`}
                >
                  {isCurrentPlan ? t('subscription.currentPlan') : t('subscription.upgrade')}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UsageBar({
  label,
  current,
  limit,
  formatter,
}: {
  label: string;
  current: number;
  limit: number;
  formatter: (n: number) => string;
}) {
  const percentage = limit === Infinity || limit === -1 ? 0 : Math.min((current / limit) * 100, 100);
  const isNearLimit = percentage > 80;

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-desktop-text/60 mb-1">
        <span>{label}</span>
        <span>
          {formatter(current)} / {formatter(limit)}
        </span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${isNearLimit ? 'bg-yellow-400' : 'bg-desktop-accent'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
