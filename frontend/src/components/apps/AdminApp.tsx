/**
 * Admin 管理应用：用户管理、系统概览（仅管理员可见）
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Loader2, Search, Ban, CircleCheck, BarChart3, RefreshCw, ChevronDown } from 'lucide-react';
import { api } from '@/utils/api';

interface AdminUser {
  id: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  banned: boolean;
  planId?: string;
  planStatus?: string | null;
  limits?: { aiCallsLimit: number; storageLimit: number; concurrentTasksLimit: number } | null;
  usage?: { aiCalls: number; storage: number; tasks: number } | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 0 || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatLimit(val: number): string {
  return val === -1 || val === Infinity ? '∞' : val.toLocaleString();
}

export function AdminApp() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  const [stats, setStats] = useState<{ totalUsers: number; totalTasks: number } | null>(null);
  const [plans, setPlans] = useState<Array<{ id: string; displayNameEn: string; displayNameZh: string }>>([]);
  const limit = 20;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminListUsers({ limit, offset: page * limit, search: search || undefined });
      setUsers(res.users);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const loadStats = useCallback(async () => {
    try {
      const s = await api.adminStats();
      setStats(s);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    api.adminGetPlans().then((r) => setPlans(r.plans ?? [])).catch(() => setPlans([]));
  }, []);

  const handleSetPlan = async (userId: string, planId: string) => {
    setActing(`plan-${userId}`);
    try {
      await api.adminSetUserPlan(userId, planId);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  const handleBan = async (userId: string) => {
    setActing(userId);
    try {
      await api.adminBanUser(userId);
      await loadUsers();
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  const handleUnban = async (userId: string) => {
    setActing(userId);
    try {
      await api.adminUnbanUser(userId);
      await loadUsers();
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  const formatDate = (s: string) => {
    try {
      const d = new Date(s);
      return d.toLocaleString();
    } catch {
      return s;
    }
  };

  return (
    <div className="flex flex-col h-full bg-desktop-bg text-desktop-text overflow-auto">
      <div className="p-4 border-b border-white/10">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Users size={20} />
          {t('admin.title')}
        </h1>

        {stats && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-center gap-3">
              <BarChart3 size={24} className="text-desktop-accent shrink-0" />
              <div>
                <p className="text-xs text-desktop-muted">{t('admin.totalUsers')}</p>
                <p className="text-lg font-semibold">{stats.totalUsers}</p>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-center gap-3">
              <RefreshCw size={24} className="text-desktop-accent shrink-0" />
              <div>
                <p className="text-xs text-desktop-muted">{t('admin.totalTasks')}</p>
                <p className="text-lg font-semibold">{stats.totalTasks}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 p-4 overflow-auto">
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-desktop-muted" />
            <input
              type="text"
              placeholder={t('admin.searchUsers')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setPage(0) && loadUsers()}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-desktop-accent"
            />
          </div>
          <button
            type="button"
            onClick={() => { setPage(0); loadUsers(); }}
            className="px-4 py-2 rounded-lg bg-desktop-accent/20 text-desktop-accent hover:bg-desktop-accent/30 text-sm"
          >
            {t('common.search')}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-desktop-muted" />
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10">
                    <th className="text-left py-3 px-3 font-medium">{t('admin.userId')}</th>
                    <th className="text-left py-3 px-3 font-medium">{t('admin.email')}</th>
                    <th className="text-left py-3 px-3 font-medium">{t('admin.displayName')}</th>
                    <th className="text-left py-3 px-3 font-medium">{t('admin.plan')}</th>
                    <th className="text-left py-3 px-3 font-medium">{t('admin.aiCalls')}</th>
                    <th className="text-left py-3 px-3 font-medium">{t('admin.storage')}</th>
                    <th className="text-left py-3 px-3 font-medium">{t('admin.createdAt')}</th>
                    <th className="text-left py-3 px-3 font-medium">{t('admin.status')}</th>
                    <th className="text-right py-3 px-3 font-medium">{t('admin.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const planKey = u.planId === 'trial' ? 'freeTrial' : u.planId === 'free' ? 'freePlan' : u.planId ?? '';
                    const planLabel = planKey ? (t(`subscription.${planKey}`) || u.planId) : '—';
                    const aiCalls = u.usage ? `${u.usage.aiCalls.toLocaleString()} / ${formatLimit(u.limits?.aiCallsLimit ?? 0)}` : '—';
                    const storageLimit = u.limits?.storageLimit ?? 0;
                    const storage = u.usage
                      ? `${formatBytes(u.usage.storage)} / ${storageLimit === -1 ? '∞' : formatBytes(storageLimit)}`
                      : '—';
                    return (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-3 font-mono text-xs text-desktop-muted truncate max-w-[100px]" title={u.id}>{u.id.slice(0, 8)}…</td>
                      <td className="py-2 px-3">{u.email ?? '—'}</td>
                      <td className="py-2 px-3">{u.displayName ?? '—'}</td>
                      <td className="py-2 px-3">
                        {plans.length > 0 ? (
                          <select
                            value={u.planId ?? 'trial'}
                            onChange={(e) => handleSetPlan(u.id, e.target.value)}
                            disabled={!!acting}
                            className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-desktop-accent disabled:opacity-50"
                            title={u.planStatus ?? undefined}
                          >
                            <option value="trial">{t('subscription.freeTrial')}</option>
                            {plans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {i18n.language?.startsWith?.('zh') ? p.displayNameZh : p.displayNameEn}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs" title={u.planStatus ?? undefined}>{planLabel}</span>
                        )}
                        {acting === `plan-${u.id}` && <Loader2 size={12} className="inline-block ml-1 animate-spin" />}
                      </td>
                      <td className="py-2 px-3 text-xs text-desktop-muted">{aiCalls}</td>
                      <td className="py-2 px-3 text-xs text-desktop-muted">{storage}</td>
                      <td className="py-2 px-3 text-desktop-muted text-xs">{formatDate(u.createdAt)}</td>
                      <td className="py-2 px-3">
                        {u.banned ? (
                          <span className="text-red-400 text-xs">{t('admin.banned')}</span>
                        ) : (
                          <span className="text-green-400 text-xs">{t('admin.active')}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {u.banned ? (
                          <button
                            type="button"
                            onClick={() => handleUnban(u.id)}
                            disabled={!!acting}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-50"
                          >
                            {acting === u.id ? <Loader2 size={12} className="animate-spin" /> : <CircleCheck size={12} />}
                            {t('admin.unban')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleBan(u.id)}
                            disabled={!!acting}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                          >
                            {acting === u.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                            {t('admin.ban')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>

            {total > limit && (
              <div className="mt-4 flex items-center justify-between text-sm text-desktop-muted">
                <span>
                  {t('admin.pageInfo', { from: page * limit + 1, to: Math.min((page + 1) * limit, total), total })}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 rounded bg-white/5 disabled:opacity-50"
                  >
                    {t('common.back')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * limit >= total}
                    className="px-3 py-1 rounded bg-white/5 disabled:opacity-50"
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
