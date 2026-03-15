import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Shield, Zap, Monitor, Bot, Info, Plus, Trash2, Key, Package, FileText, ChevronDown, ChevronRight, RefreshCw, Plug, Globe, Terminal, Copy, ChevronUp, Sparkles, Music2, User, Mail, MessageSquare, Pencil, Search, Server, Edit, TestTube, CreditCard, ExternalLink } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTranslation } from 'react-i18next';
import { useDesktopStore } from '@/store/desktopStore';
import { useLLMConfigStore } from '@/store/llmConfigStore';
import type { LLMModality } from '@shared/index';
import {
  BUILTIN_PROVIDER_IDS,
  PROVIDER_META,
  MODELS_BY_PROVIDER_AND_MODALITY,
  MODALITY_LABELS,
} from '@/constants/llmPresets';
import { getInstalledApps, installApp, uninstallApp, BUILTIN_MANIFESTS } from '@/appRegistry';
import type { AppManifest } from '@shared/index';
import { useSystemLogStore, type SystemLogEntry, type LogLevel, type LogCategory, LOG_LEVEL_LABELS, LOG_CATEGORY_LABELS } from '@/store/systemLogStore';
import { api, type McpServerConfig, type McpToolSchema, normalizeMcpConfig } from '@/utils/api';
import { getUserId, getUserIdOrNull, setUserId } from '@/utils/userId';
import { clearAllLocalData } from '@/utils/clearOnLogout';
import { fetchAndApplyUserConfig, getCloudConfigSnapshot } from '@/utils/applyUserConfig';
import { DISPLAY_TIMEZONE } from '@/constants/datetime';

interface Props {
  windowId: string;
}

type SettingsTab = 'general' | 'account' | 'ai' | 'models' | 'mcp' | 'skills' | 'media' | 'channels' | 'security' | 'servers' | 'apps' | 'logs' | 'about';

/** 订阅与额度摘要：显示当前套餐、使用量，并提供开通/管理入口 */
function SubscriptionSummarySection(props: { onOpenSubscription: () => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    subscription: { planId: string; status: string } | null;
    limits: { aiCallsLimit: number; storageLimit: number; concurrentTasksLimit: number };
    usage: { aiCalls: number; storage: number; tasks: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getSubscriptionMe()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === Infinity || bytes === -1) return t('subscription.unlimited');
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatNum = (n: number): string =>
    n === Infinity || n === -1 ? t('subscription.unlimited') : n.toLocaleString();

  if (loading) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-desktop-muted">{t('subscription.loading')}</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-xs text-desktop-muted mb-2">{error ?? t('settings.subscriptionLoadFailed')}</p>
        <button
          type="button"
          onClick={props.onOpenSubscription}
          className="text-xs text-desktop-accent hover:underline"
        >
          {t('subscription.upgradePlan')}
        </button>
      </div>
    );
  }

  const planLabel = data.subscription
    ? (data.subscription.planId === 'trial' ? t('subscription.freeTrial') : t(`subscription.${data.subscription.planId}`))
    : t('subscription.freePlan');
  const pct = (cur: number, lim: number) =>
    lim === Infinity || lim === -1 ? 0 : Math.min((cur / lim) * 100, 100);

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-desktop-text flex items-center gap-2">
          <CreditCard size={14} />
          {t('account.billing')}
        </h4>
        <button
          type="button"
          onClick={props.onOpenSubscription}
          className="flex items-center gap-1 text-xs text-desktop-accent hover:underline"
        >
          {t('subscription.upgradePlan')}
          <ExternalLink size={12} />
        </button>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-desktop-muted">{t('subscription.currentPlan')}</span>
        <span className="text-desktop-text font-medium">{planLabel}</span>
      </div>
      <div className="space-y-2 pt-1 border-t border-white/10">
        <div>
          <div className="flex justify-between text-[11px] text-desktop-muted mb-0.5">
            <span>{t('subscription.aiCalls')}</span>
            <span>{formatNum(data.usage.aiCalls)} / {formatNum(data.limits.aiCallsLimit)}</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full ${pct(data.usage.aiCalls, data.limits.aiCallsLimit) > 80 ? 'bg-yellow-400' : 'bg-desktop-accent'}`}
              style={{ width: `${pct(data.usage.aiCalls, data.limits.aiCallsLimit)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-desktop-muted mb-0.5">
            <span>{t('subscription.storage')}</span>
            <span>{formatBytes(data.usage.storage)} / {formatBytes(data.limits.storageLimit)}</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full ${pct(data.usage.storage, data.limits.storageLimit) > 80 ? 'bg-yellow-400' : 'bg-desktop-accent'}`}
              style={{ width: `${pct(data.usage.storage, data.limits.storageLimit)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-desktop-muted mb-0.5">
            <span>{t('subscription.concurrentTasks')}</span>
            <span>{data.usage.tasks} / {formatNum(data.limits.concurrentTasksLimit)}</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full ${pct(data.usage.tasks, data.limits.concurrentTasksLimit) > 80 ? 'bg-yellow-400' : 'bg-desktop-accent'}`}
              style={{ width: `${pct(data.usage.tasks, data.limits.concurrentTasksLimit)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountSettingsSection(props: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  success: string | null;
  setSuccess: (v: string | null) => void;
  me: { id: string; displayName: string | null; email: string | null; createdAt: string; updatedAt: string } | null;
  setMe: (v: { id: string; displayName: string | null; email: string | null; createdAt: string; updatedAt: string } | null) => void;
  onOpenSubscription?: () => void;
}) {
  const { email, setEmail, password, setPassword, loading, setLoading, error, setError, success, setSuccess, me, setMe, onOpenSubscription } = props;
  const [captchaId, setCaptchaId] = useState('');
  const [captchaQuestion, setCaptchaQuestion] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [allowRegister, setAllowRegister] = useState(true);
  const [userIdCopied, setUserIdCopied] = useState(false);

  const loadMe = useCallback(() => {
    api.getMe().then(setMe).catch(() => setMe(null));
  }, [setMe]);

  const fetchCaptcha = useCallback(async () => {
    try {
      const res = await api.authGetCaptcha();
      setCaptchaId(res.id);
      setCaptchaQuestion(res.question);
      setCaptchaAnswer('');
    } catch (_) {
      setError('获取验证码失败');
    }
  }, [setError]);

  const handleCopyUserId = useCallback((userId: string) => {
    navigator.clipboard.writeText(userId).then(
      () => {
        setUserIdCopied(true);
        setTimeout(() => setUserIdCopied(false), 2000);
      },
      () => { /* 复制失败静默处理 */ },
    );
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    api.authGetSettings().then((s) => setAllowRegister(s.allowRegister)).catch(() => setAllowRegister(true));
  }, []);

  useEffect(() => {
    if (!me?.email) fetchCaptcha();
  }, [me?.email, fetchCaptcha]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    if (!captchaId || !captchaAnswer.trim()) {
      setError('请输入验证码');
      return;
    }
    setLoading(true);
    try {
      const res = await api.authRegister(email.trim(), password, captchaId, captchaAnswer.trim());
      setUserId(res.userId);
      await fetchAndApplyUserConfig();
      loadMe();
      setSuccess('注册成功，当前匿名数据已关联到本账号；配置已同步到本机。');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
      fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    if (!captchaId || !captchaAnswer.trim()) {
      setError('请输入验证码');
      return;
    }
    setLoading(true);
    try {
      const res = await api.authLogin(email.trim(), password, captchaId, captchaAnswer.trim());
      setUserId(res.userId);
      await fetchAndApplyUserConfig();
      loadMe();
      setSuccess('登录成功，配置已从云端同步到本机。');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
      fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setMe(null);
    setSuccess(null);
    setError(null);
    await clearAllLocalData(); // 清空 localStorage、Cookie、Cache
    window.location.reload(); // 刷新以回到登录页
  };

  const isLoggedIn = me?.email != null && me.email !== '';

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-desktop-text">账号</h3>
      {success && (
        <p className="text-xs text-green-500 bg-green-500/10 px-3 py-2 rounded-lg">{success}</p>
      )}
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
      )}

      {me === null ? (
        <p className="text-xs text-desktop-muted">加载中…</p>
      ) : isLoggedIn ? (
        <div className="space-y-4">
          <p className="text-xs text-desktop-muted">
            当前已登录，配置与数据已与该账号关联；换设备或换浏览器后登录同一账号即可同步。
          </p>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-desktop-muted">邮箱</span>
              <span className="text-xs text-desktop-text">{me.email}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-desktop-muted">用户 ID</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-desktop-text font-mono" title={me.id}>{me.id}</span>
                <button
                  type="button"
                  onClick={() => handleCopyUserId(me.id)}
                  className="p-1 hover:bg-white/10 rounded transition-colors"
                  title="复制用户ID"
                >
                  {userIdCopied ? (
                    <span className="text-xs text-green-400">已复制</span>
                  ) : (
                    <Copy size={12} className="text-desktop-muted" />
                  )}
                </button>
              </div>
            </div>
            {me.createdAt && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-desktop-muted">注册于</span>
                <span className="text-xs text-desktop-text">
                  {new Date(me.createdAt).toLocaleString('zh-CN', { timeZone: DISPLAY_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
            )}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 transition-colors"
              >
                退出登录
              </button>
            </div>
          </div>

          {onOpenSubscription && (
            <SubscriptionSummarySection onOpenSubscription={onOpenSubscription} />
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-desktop-muted">
            {allowRegister ? '注册或登录后' : '登录后'}，本机当前匿名数据（对话、任务、沙箱文件等）会自动关联到该账号，无需重新配置。
          </p>
          <div className={`grid gap-6 ${allowRegister ? 'sm:grid-cols-2' : ''}`}>
            {allowRegister && (
            <form onSubmit={handleRegister} className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <h4 className="text-xs font-medium text-desktop-muted">注册新账号</h4>
              <input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:border-desktop-accent/50"
                disabled={loading}
                autoComplete="email"
              />
              <input
                type="password"
                placeholder="密码（至少 6 位）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:border-desktop-accent/50"
                disabled={loading}
                autoComplete="new-password"
              />
              <div className="flex gap-2 items-center">
                <span className="text-xs text-desktop-muted shrink-0">{captchaQuestion}</span>
                <input
                  type="text"
                  placeholder="?"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:border-desktop-accent/50 w-16"
                  disabled={loading}
                />
                <button type="button" onClick={fetchCaptcha} className="p-2 rounded-lg bg-white/5 hover:bg-white/10" title="刷新验证码">
                  <RefreshCw size={14} className="text-desktop-muted" />
                </button>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg bg-desktop-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '处理中…' : '注册'}
              </button>
            </form>
            )}
            <form onSubmit={handleLogin} className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <h4 className="text-xs font-medium text-desktop-muted">登录已有账号</h4>
              <input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:border-desktop-accent/50"
                disabled={loading}
                autoComplete="email"
              />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:border-desktop-accent/50"
                disabled={loading}
                autoComplete="current-password"
              />
              <div className="flex gap-2 items-center">
                <span className="text-xs text-desktop-muted shrink-0">{captchaQuestion}</span>
                <input
                  type="text"
                  placeholder="?"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:border-desktop-accent/50 w-16"
                  disabled={loading}
                />
                <button type="button" onClick={fetchCaptcha} className="p-2 rounded-lg bg-white/5 hover:bg-white/10" title="刷新验证码">
                  <RefreshCw size={14} className="text-desktop-muted" />
                </button>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full px-3 py-2 rounded-lg bg-white/10 text-desktop-text text-xs font-medium hover:bg-white/15 disabled:opacity-50"
              >
                {loading ? '处理中…' : '登录'}
              </button>
            </form>
          </div>
          <p className="text-[11px] text-desktop-muted">
            {getUserIdOrNull()
              ? `当前为匿名使用（ID: ${getUserIdOrNull()!.slice(0, 8)}…）。${allowRegister ? '登录或注册' : '登录'}后会自动切换为该账号并保留本机数据。`
              : allowRegister ? '请登录或注册后使用。' : '请登录后使用。'}
          </p>
        </>
      )}
    </div>
  );
}

const SIMPLE_MODE_KEY = 'x-computer-settings-simple-mode';
const BASIC_TABS: SettingsTab[] = ['general', 'account', 'about'];

export function SettingsApp({ windowId }: Props) {
  const { t } = useTranslation();
  const [simpleMode, setSimpleMode] = useState(() => {
    try {
      return localStorage.getItem(SIMPLE_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [tab, setTab] = useState<SettingsTab>('general');
  const [canConfigureLLM, setCanConfigureLLM] = useState(true); // 默认 true，拉取后更新；仅专业版可配置
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);
  const [accountMe, setAccountMe] = useState<{
    id: string;
    displayName: string | null;
    email: string | null;
    createdAt: string;
    updatedAt: string;
  } | null>(null);

  useEffect(() => {
    api.getSubscriptionMe()
      .then((d) => setCanConfigureLLM(d.canConfigureLLM ?? false))
      .catch(() => setCanConfigureLLM(false));
  }, []);

  useEffect(() => {
    if (tab === 'models' && !canConfigureLLM) setTab('general');
  }, [tab, canConfigureLLM]);

  const allTabs: { id: SettingsTab; labelKey: string; icon: React.ElementType }[] = [
    { id: 'general', labelKey: 'settings.general', icon: Monitor },
    { id: 'account', labelKey: 'settings.account', icon: User },
    { id: 'apps', labelKey: 'settings.apps', icon: Package },
    { id: 'ai', labelKey: 'settings.ai', icon: Bot },
    { id: 'models', labelKey: 'settings.models', icon: Key },
    { id: 'mcp', labelKey: 'settings.mcp', icon: Plug },
    { id: 'skills', labelKey: 'settings.skills', icon: Sparkles },
    { id: 'media', labelKey: 'settings.media', icon: Music2 },
    { id: 'channels', labelKey: 'settings.channels', icon: MessageSquare },
    { id: 'servers', labelKey: 'settings.servers', icon: Server },
    { id: 'security', labelKey: 'settings.security', icon: Shield },
    { id: 'logs', labelKey: 'settings.logs', icon: FileText },
    { id: 'about', labelKey: 'settings.about', icon: Info },
  ];
  const tabs = (simpleMode ? allTabs.filter((t) => BASIC_TABS.includes(t.id)) : allTabs).filter(
    (t) => t.id !== 'models' || canConfigureLLM
  );

  const toggleSimpleMode = (on: boolean) => {
    setSimpleMode(on);
    try {
      localStorage.setItem(SIMPLE_MODE_KEY, on ? '1' : '0');
    } catch {}
    if (!on && !BASIC_TABS.includes(tab)) setTab('general');
  };

  return (
    <div className="h-full flex text-sm min-h-0">
      {/* Sidebar */}
      <div className="w-48 shrink-0 border-r border-white/5 bg-white/[0.01] p-2 overflow-y-auto">
        {tabs.map((tabItem) => {
          const Icon = tabItem.icon;
          return (
            <button
              key={tabItem.id}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
                tab === tabItem.id
                  ? 'bg-desktop-accent/40 text-desktop-text'
                  : 'text-desktop-muted hover:bg-white/5 hover:text-desktop-text'
              }`}
              onClick={() => setTab(tabItem.id)}
            >
              <Icon size={14} />
              {t(tabItem.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5">
        {tab === 'account' && (
          <AccountSettingsSection
            email={accountEmail}
            setEmail={setAccountEmail}
            password={accountPassword}
            setPassword={setAccountPassword}
            loading={accountLoading}
            setLoading={setAccountLoading}
            error={accountError}
            setError={setAccountError}
            success={accountSuccess}
            setSuccess={setAccountSuccess}
            me={accountMe}
            setMe={setAccountMe}
            onOpenSubscription={() => useDesktopStore.getState().openApp('subscription')}
          />
        )}

        {tab === 'general' && (
          <div className="space-y-6">
            <h3 className="text-sm font-medium text-desktop-text">{t('settings.general')}</h3>
            <SettingRow label={t('settings.simpleMode')} description={t('settings.simpleModeDescription')}>
              <div className="flex items-center gap-2">
                <ToggleSwitch value={simpleMode} onToggle={toggleSimpleMode} />
                {simpleMode && (
                  <button
                    type="button"
                    className="text-[11px] text-desktop-accent hover:underline"
                    onClick={() => toggleSimpleMode(false)}
                  >
                    {t('settings.showAdvanced')}
                  </button>
                )}
              </div>
            </SettingRow>
            <SettingRow label={t('settings.theme')} description={t('settings.themeDescription')}>
              <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none">
                <option>{t('settings.themeDark')}</option>
                <option>{t('settings.themeLight')}</option>
                <option>{t('settings.themeSystem')}</option>
              </select>
            </SettingRow>
            <SettingRow label={t('settings.language')} description={t('settings.languageDescription')}>
              <LanguageSwitcher showLabel={false} />
            </SettingRow>
            <SettingRow label={t('settings.notifications')} description={t('settings.notifications')}>
              <ToggleSwitch defaultOn={true} />
            </SettingRow>
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-6">
            <h3 className="text-sm font-medium text-desktop-text">{t('settings.ai')}</h3>
            <SettingRow label={t('settings.defaultModel')} description={t('settings.defaultModelHint')}>
              <span className="text-xs text-desktop-muted">{t('settings.defaultModelSeeModels')}</span>
            </SettingRow>
            <SettingRow label={t('settings.contextMemory')} description={t('settings.contextMemory')}>
              <ToggleSwitch defaultOn={true} />
            </SettingRow>
            <MemoryRebuildIndexRow />
          </div>
        )}

        {tab === 'models' && (
          <LLMModelsSettings />
        )}

        {tab === 'mcp' && (
          <McpSettings />
        )}

        {tab === 'skills' && (
          <SkillsSettings />
        )}

        {tab === 'media' && (
          <MediaApiSettings />
        )}

        {tab === 'channels' && (
          <ChannelsSettings />
        )}

        {tab === 'security' && (
          <div className="space-y-6">
            <h3 className="text-sm font-medium text-desktop-text">{t('settings.security')}</h3>
            <SettingRow label={t('settings.highRiskApproval')} description={t('settings.highRiskApproval')}>
              <ToggleSwitch defaultOn={true} />
            </SettingRow>
            <SettingRow label={t('settings.networkAccess')} description={t('settings.networkAccess')}>
              <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none">
                <option>{t('settings.networkWhitelist')}</option>
                <option>{t('settings.networkOpen')}</option>
                <option>{t('settings.networkIsolated')}</option>
              </select>
            </SettingRow>
            <SettingRow label={t('settings.dataLevel')} description={t('settings.dataLevel')}>
              <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none">
                <option>{t('settings.dataInternal')}</option>
                <option>{t('settings.dataPublic')}</option>
                <option>{t('settings.dataSensitive')}</option>
                <option>{t('settings.dataRegulated')}</option>
              </select>
            </SettingRow>
            <SettingRow label={t('settings.auditLog')} description={t('settings.auditLog')}>
              <ToggleSwitch defaultOn={true} />
            </SettingRow>
          </div>
        )}

        {tab === 'servers' && (
          <ServerManagementSettings />
        )}

        {tab === 'apps' && (
          <AppManagementSettings />
        )}

        {tab === 'logs' && (
          <SystemLogTab />
        )}

        {tab === 'about' && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-desktop-text">{t('settings.aboutTitle')}</h3>
            <div className="bg-white/[0.03] rounded-xl p-5 border border-white/5 space-y-3">
              <div className="text-2xl font-bold bg-gradient-to-r from-desktop-highlight to-purple-400 bg-clip-text text-transparent">
                X-Computer
              </div>
              <div className="text-xs text-desktop-muted">{t('settings.aboutTagline')}</div>
              <div className="text-xs text-desktop-text/70 leading-relaxed">
                {t('settings.aboutDescription')}
              </div>
              <div className="text-xs text-desktop-muted space-y-1 pt-2 border-t border-white/5">
                <div>{t('settings.sandboxIsolation')}</div>
                <div>{t('settings.builtWith')}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 系统日志 ─────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
  error: 'text-red-400 bg-red-500/15',
  warning: 'text-amber-400 bg-amber-500/15',
  info: 'text-blue-400 bg-blue-500/15',
  debug: 'text-desktop-muted bg-white/10',
};

const CATEGORY_COLORS: Record<LogCategory, string> = {
  system: 'text-cyan-400/90 bg-cyan-500/10',
  application: 'text-purple-400/90 bg-purple-500/10',
};

/** 后端日志条目（与前端字段一致，便于合并展示） */
type ServerLogEntry = { id: string; timestamp: number; level: string; category: string; source: string; message: string; detail?: string };

type MergedLogEntry = (SystemLogEntry & { origin: 'frontend' }) | (ServerLogEntry & { origin: 'backend' });

function SystemLogTab() {
  const { entries, clearLogs } = useSystemLogStore();
  const [serverEntries, setServerEntries] = useState<ServerLogEntry[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<LogCategory | 'all'>('all');
  const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
  const [filterOrigin, setFilterOrigin] = useState<'all' | 'frontend' | 'backend'>('all');

  const fetchServerLogs = useCallback(async () => {
    setServerLoading(true);
    setServerError(null);
    try {
      const list = await api.getServerLogs(200);
      setServerEntries(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setServerError(e?.message ?? '获取后端日志失败');
      setServerEntries([]);
    } finally {
      setServerLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServerLogs();
  }, [fetchServerLogs]);

  const merged: MergedLogEntry[] = [
    ...entries.map((e) => ({ ...e, origin: 'frontend' as const })),
    ...serverEntries.map((e) => ({ ...e, origin: 'backend' as const })),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const getOriginId = (e: MergedLogEntry) => (e.origin === 'backend' ? `backend-${e.id}` : e.id);

  const filteredEntries = merged.filter((e) => {
    const category = (e.category ?? 'system') as LogCategory;
    const level = (e.level ?? 'error') as LogLevel;
    if (filterCategory !== 'all' && category !== filterCategory) return false;
    if (filterLevel !== 'all' && level !== filterLevel) return false;
    if (filterOrigin !== 'all' && e.origin !== filterOrigin) return false;
    return true;
  });

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      timeZone: DISPLAY_TIMEZONE,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleClearServerLogs = async () => {
    try {
      await api.clearServerLogs();
      await fetchServerLogs();
    } catch (_) {}
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-medium text-desktop-text">系统日志</h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={fetchServerLogs}
            disabled={serverLoading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-desktop-muted hover:bg-white/10 hover:text-desktop-text transition-colors disabled:opacity-50"
            title="重新拉取后端日志"
          >
            <RefreshCw size={12} className={serverLoading ? 'animate-spin' : ''} />
            刷新后端
          </button>
          <button
            type="button"
            onClick={clearLogs}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-desktop-muted hover:bg-white/10 hover:text-desktop-text transition-colors"
          >
            <Trash2 size={12} />
            清空前端
          </button>
          <button
            type="button"
            onClick={handleClearServerLogs}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-desktop-muted hover:bg-white/10 hover:text-desktop-text transition-colors"
          >
            <Trash2 size={12} />
            清空后端
          </button>
        </div>
      </div>
      <p className="text-xs text-desktop-muted">
        前后端日志合并展示，便于排查写入失败等。分类/级别可筛选；可单独清空前端或后端。
      </p>
      {serverError && (
        <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
          后端日志拉取失败：{serverError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-desktop-muted">来源：</span>
        {(['all', 'frontend', 'backend'] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setFilterOrigin(o)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              filterOrigin === o ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/5 text-desktop-muted hover:bg-white/10'
            }`}
          >
            {o === 'all' ? '全部' : o === 'frontend' ? '前端' : '后端'}
          </button>
        ))}
        <span className="text-xs text-desktop-muted ml-2">分类：</span>
        {(['all', 'system', 'application'] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilterCategory(cat)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              filterCategory === cat ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/5 text-desktop-muted hover:bg-white/10'
            }`}
          >
            {cat === 'all' ? '全部' : LOG_CATEGORY_LABELS[cat]}
          </button>
        ))}
        <span className="text-xs text-desktop-muted ml-2">级别：</span>
        {(['all', 'error', 'warning', 'info', 'debug'] as const).map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => setFilterLevel(lvl)}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              filterLevel === lvl ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/5 text-desktop-muted hover:bg-white/10'
            }`}
          >
            {lvl === 'all' ? '全部' : LOG_LEVEL_LABELS[lvl]}
          </button>
        ))}
      </div>

      <div className="space-y-1 max-h-[55vh] overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="text-xs text-desktop-muted py-8 text-center">
            {merged.length === 0 ? '暂无日志' : '当前筛选无匹配项'}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const entryId = getOriginId(entry);
            const isExpanded = expandedId === entryId;
            const hasDetail = entry.detail || ('url' in entry && entry.url) || ('method' in entry && entry.method);
            const level = (entry.level ?? ((entry as { type?: string }).type === 'info' ? 'info' : 'error')) as LogLevel;
            const category = (entry.category ?? 'system') as LogCategory;
            return (
              <div
                key={entryId}
                className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden"
              >
                <button
                  type="button"
                  className="w-full flex items-start gap-2 p-3 text-left hover:bg-white/[0.04] transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : entryId)}
                >
                  <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${LEVEL_COLORS[level]}`} title={LOG_LEVEL_LABELS[level]}>
                    {LOG_LEVEL_LABELS[level].slice(0, 1)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-desktop-muted">
                        {entry.origin === 'frontend' ? '前端' : '后端'}
                      </span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${CATEGORY_COLORS[category]}`}>
                        {LOG_CATEGORY_LABELS[category]}
                      </span>
                      <span className="text-[11px] text-desktop-muted">{entry.source}</span>
                      <span className="text-xs text-desktop-muted">{formatTime(entry.timestamp)}</span>
                    </div>
                    <div className="text-xs text-desktop-text mt-1 break-words">{entry.message}</div>
                    {'url' in entry && entry.url && (
                      <div className="text-[11px] text-desktop-muted mt-1 truncate">{entry.url}</div>
                    )}
                  </div>
                  {hasDetail && (isExpanded ? <ChevronDown size={14} className="shrink-0 text-desktop-muted" /> : <ChevronRight size={14} className="shrink-0 text-desktop-muted" />)}
                </button>
                {isExpanded && hasDetail && (
                  <div className="px-3 pb-3 pt-0 border-t border-white/5">
                    {'method' in entry && entry.method && (
                      <div className="text-[11px] text-desktop-muted mt-2">方法: {entry.method}</div>
                    )}
                    {entry.detail && (
                      <pre className="mt-2 p-2 rounded bg-black/20 text-[11px] text-desktop-text overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                        {entry.detail}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── 记忆向量索引重建（AI 设置内） ─────────────────────────────

function MemoryRebuildIndexRow() {
  const { llmConfig, getProviderApiKey } = useLLMConfigStore();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    indexCount: number;
    filesInMemory: number;
    workspaceRoot: string;
    lastEmbedError?: string;
  } | null>(null);

  const loadStatus = useCallback(() => {
    api.memoryStatus().then((s) => setStatus(s)).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const vectorSel = llmConfig?.defaultByModality?.vector;
  const vectorConfig =
    vectorSel?.providerId && vectorSel?.modelId
      ? {
          providerId: vectorSel.providerId,
          modelId: vectorSel.modelId,
          baseUrl: llmConfig?.providers?.find((p: { id: string }) => p.id === vectorSel.providerId)?.baseUrl ?? '',
          apiKey: getProviderApiKey(vectorSel.providerId),
        }
      : null;

  const handleRebuild = async () => {
    if (!vectorConfig) {
      setMessage('请先在「大模型配置」中配置向量嵌入模型（如 text-embedding-3-small）');
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await api.memoryRebuildIndex(vectorConfig);
      const n = res?.indexed ?? 0;
      const found = res?.filesFound ?? 0;
      const names = res?.fileNames ?? [];
      const root = res?.workspaceRoot ?? '';
      if (res?.error) {
        setMessage(res.error);
      } else if (res?.embedError) {
        setMessage(`嵌入失败: ${res.embedError}`);
      } else if (n > 0) {
        setMessage(`已从 memory 目录重建索引，共 ${n} 条记忆。`);
      } else if (found > 0) {
        setMessage(`发现 ${found} 个文件（${names.join('、')}），但嵌入失败或无可索引内容。请检查向量模型配置与 API。`);
      } else {
        setMessage(
          `已执行，共 0 条。工作区: ${root || '(未知)'}，未发现 .md 文件。请确认记忆文件在 工作区/memory/ 下，或设置 X_COMPUTER_WORKSPACE 后重启服务。`,
        );
      }
    } catch (err: any) {
      setMessage(err?.message ?? '重建失败');
    } finally {
      setLoading(false);
      loadStatus();
    }
  };

  const [testing, setTesting] = useState(false);
  const handleTest = async () => {
    if (!vectorConfig) {
      setMessage('请先在「大模型配置」中配置向量嵌入模型');
      return;
    }
    setTesting(true);
    setMessage(null);
    try {
      const res = await api.memoryTestEmbedding(vectorConfig);
      if (res?.ok) {
        setMessage(`连接成功，向量维度: ${res?.dimensions ?? 0}`);
      } else {
        setMessage(res?.error ?? '测试失败');
      }
    } catch (err: any) {
      setMessage(err?.message ?? '测试请求失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingRow
      label="记忆向量索引"
      description="memory 目录下已有大量 .md 文件但未建向量索引时，可点击重建，将全部记忆重新加入向量库以便检索"
    >
      <div className="flex flex-col gap-1.5">
        {status != null && (
          <div className="text-[11px] text-desktop-muted mb-0.5">
            当前：索引 {status.indexCount} 条，memory 目录 {status.filesInMemory} 个 .md 文件
            {status.workspaceRoot ? ` · 工作区 ${status.workspaceRoot}` : ''}
            {status.lastEmbedError ? ` · 最近错误: ${status.lastEmbedError}` : ''}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 transition-colors disabled:opacity-50"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-desktop-accent/20 text-desktop-accent hover:bg-desktop-accent/30 transition-colors disabled:opacity-50"
            onClick={handleRebuild}
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? '重建中…' : '重建索引'}
          </button>
        </div>
        {message && <span className="text-xs text-desktop-muted">{message}</span>}
      </div>
    </SettingRow>
  );
}

// ── 大模型配置子组件 ────────────────────────────────────────

const MODALITIES: LLMModality[] = ['chat', 'text', 'video', 'image', 'image_edit', 'vector'];

const MODEL_LIST_PAGE_SIZE = 15;

type ModelRow = { providerId: string; providerName: string; modelId: string; label: string; usedBy: LLMModality[] };

function ModelListSection({
  llmConfig,
  importedModelsByProvider,
}: {
  llmConfig: import('@shared/index').LLMSystemConfig;
  importedModelsByProvider: import('@/constants/llmPresets').ImportedModelsByProvider;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  const allRows = useMemo<ModelRow[]>(() => {
    return llmConfig.providers.flatMap((p) => {
      const presetAll = MODALITIES.flatMap((mod) =>
        (MODELS_BY_PROVIDER_AND_MODALITY[p.id]?.[mod] ?? []).map((m) => ({ ...m, modality: mod })),
      );
      const byId = new Map<string, { label: string; modalities: LLMModality[] }>();
      presetAll.forEach(({ id, label, modality }) => {
        const cur = byId.get(id);
        if (!cur) byId.set(id, { label, modalities: [modality] });
        else if (!cur.modalities.includes(modality)) cur.modalities.push(modality);
      });
      const importedList = importedModelsByProvider[p.id] ?? [];
      importedList.forEach((im) => {
        if (!byId.has(im.id)) byId.set(im.id, { label: im.name ?? im.id, modalities: [] });
      });
      return Array.from(byId.entries()).map(([modelId, { label }]) => {
        const usedBy = MODALITIES.filter(
          (mod) => llmConfig.defaultByModality[mod]?.providerId === p.id && llmConfig.defaultByModality[mod]?.modelId === modelId,
        );
        return { providerId: p.id, providerName: p.name, modelId, label, usedBy };
      });
    });
  }, [llmConfig, importedModelsByProvider]);

  const filteredRows = useMemo(() => {
    let rows = allRows;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          r.providerName.toLowerCase().includes(q) ||
          r.modelId.toLowerCase().includes(q) ||
          r.label.toLowerCase().includes(q),
      );
    }
    if (providerFilter) {
      rows = rows.filter((r) => r.providerId === providerFilter);
    }
    return rows;
  }, [allRows, searchQuery, providerFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / MODEL_LIST_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = useMemo(
    () =>
      filteredRows.slice(
        (currentPage - 1) * MODEL_LIST_PAGE_SIZE,
        currentPage * MODEL_LIST_PAGE_SIZE,
      ),
    [filteredRows, currentPage],
  );

  // 筛选或搜索变化时重置到第一页
  useEffect(() => {
    setPage(1);
  }, [searchQuery, providerFilter]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-xs font-medium text-desktop-muted">模型列表</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 min-w-[120px] max-w-[200px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-desktop-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索提供商、模型 ID、显示名…"
              className="w-full pl-7 pr-2 py-1.5 bg-white/5 border border-white/10 rounded text-xs text-desktop-text placeholder:text-desktop-muted/80 outline-none focus:border-desktop-accent/50"
            />
          </div>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
          >
            <option value="">全部提供商</option>
            {llmConfig.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5 text-left text-desktop-muted">
              <th className="px-3 py-2 font-medium">提供商</th>
              <th className="px-3 py-2 font-medium">模型 ID</th>
              <th className="px-3 py-2 font-medium">显示名</th>
              <th className="px-3 py-2 font-medium">用于（默认）</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((r) => (
              <tr key={`${r.providerId}-${r.modelId}`} className="border-b border-white/5">
                <td className="px-3 py-1.5 text-desktop-text">{r.providerName}</td>
                <td className="px-3 py-1.5 text-desktop-text font-mono">{r.modelId}</td>
                <td className="px-3 py-1.5 text-desktop-muted">{r.label}</td>
                <td className="px-3 py-1.5 text-desktop-muted">
                  {r.usedBy.length > 0 ? r.usedBy.map((m) => MODALITY_LABELS[m]).join('、') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows.length > MODEL_LIST_PAGE_SIZE && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 text-desktop-muted text-xs">
            <span>
              共 {filteredRows.length} 项，第 {currentPage} / {totalPages} 页
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
      {filteredRows.length === 0 && allRows.length > 0 && (
        <p className="mt-1 text-xs text-desktop-muted">无匹配结果，请调整搜索或筛选条件</p>
      )}
    </div>
  );
}

function LLMModelsSettings() {
  const {
    llmConfig,
    importedModelsByProvider,
    configSyncStatus,
    syncToCloudNow,
    addProvider,
    removeProvider,
    updateProvider,
    setDefaultForModality,
    setProviderApiKey,
    clearProviderApiKey,
    getProviderApiKey,
    setImportedModelsForProvider,
  } = useLLMConfigStore();
  const [editingApiKeyFor, setEditingApiKeyFor] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [importingFor, setImportingFor] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<'ok' | 'fail' | null>(null);
  const [syncing, setSyncing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  // 界面修改后自动同步到云端，并提示成功/失败
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (llmConfig.providers.length === 0) return;
      setSyncing(true);
      setSyncMessage(null);
      syncToCloudNow()
        .then(() => {
          setSyncMessage('ok');
          setTimeout(() => setSyncMessage(null), 2500);
        })
        .catch(() => {
          setSyncMessage('fail');
        })
        .finally(() => setSyncing(false));
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [llmConfig, syncToCloudNow]);

  const canAddProvider = BUILTIN_PROVIDER_IDS.filter(
    (id) => !llmConfig.providers.some((p) => p.id === id),
  );

  const handleSaveApiKey = (providerId: string) => {
    setProviderApiKey(providerId, apiKeyInput);
    setApiKeyInput('');
    setEditingApiKeyFor(null);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-desktop-text">大模型提供商与模型</h3>
        {syncing && <span className="text-xs text-desktop-muted flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />同步中…</span>}
        {syncMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
        {syncMessage === 'fail' && (
          <span className="text-xs text-amber-400/90">同步失败，请检查网络与登录状态</span>
        )}
      </div>
      {configSyncStatus === 'offline' && (
        <p className="text-xs text-amber-400/90">当前使用本地配置（启动时无法连接云端）</p>
      )}
      {configSyncStatus === 'pending' && (
        <p className="text-xs text-amber-400/90">配置已保存到本地，恢复网络后将自动重试同步</p>
      )}

      {/* 提供商列表 */}
      <div>
        <div className="text-xs font-medium text-desktop-muted mb-2">提供商（API 端点与密钥）</div>
        <div className="space-y-3">
          {llmConfig.providers.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-white/[0.03] border border-white/5"
            >
              <input
                className="w-32 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
                value={p.name}
                onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                placeholder="名称"
              />
              <input
                className="flex-1 min-w-[160px] bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
                value={p.baseUrl ?? ''}
                onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value || undefined })}
                placeholder="Base URL（可选）"
              />
              {editingApiKeyFor === p.id ? (
                <>
                  <input
                    type="password"
                    className="w-40 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onBlur={() => {
                      if (apiKeyInput) handleSaveApiKey(p.id);
                      else setEditingApiKeyFor(null);
                    }}
                    placeholder="API Key（填写后自动保存）"
                    autoFocus
                  />
                  <button
                    className="px-2 py-1 rounded text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
                    onClick={() => { setEditingApiKeyFor(null); setApiKeyInput(''); }}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-desktop-muted">
                    {p.apiKeyConfigured ? '密钥已配置' : '未配置密钥'}
                  </span>
                  <button
                    className="px-2 py-1 rounded text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
                    onClick={() => setEditingApiKeyFor(p.id)}
                  >
                    {p.apiKeyConfigured ? '更换' : '填写'}
                  </button>
                  {p.apiKeyConfigured && (
                    <button
                      className="px-2 py-1 rounded text-xs text-red-400/80 hover:bg-red-500/20"
                      onClick={() => clearProviderApiKey(p.id)}
                    >
                      清除
                    </button>
                  )}
                </>
              )}
              <button
                className="px-2 py-1 rounded text-xs bg-white/10 text-desktop-muted hover:bg-white/20 disabled:opacity-50"
                title="从该提供商的 /models 或 /v1/models 拉取模型列表"
                disabled={!p.baseUrl || importingFor !== null}
                onClick={async () => {
                  setImportError(null);
                  setImportingFor(p.id);
                  try {
                    const apiKey = getProviderApiKey(p.id) || undefined;
                    const { models } = await api.importLLMModels(p.baseUrl ?? '', apiKey);
                    setImportedModelsForProvider(p.id, models);
                  } catch (e) {
                    setImportError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setImportingFor(null);
                  }
                }}
              >
                {importingFor === p.id ? '导入中…' : '从 API 导入模型'}
              </button>
              {llmConfig.providers.length > 1 && (
                <button
                  className="p-1 rounded text-desktop-muted hover:bg-red-500/20 hover:text-red-400"
                  title="移除提供商"
                  onClick={() => removeProvider(p.id)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {importError && (
          <p className="mt-1 text-xs text-red-400/90">导入失败：{importError}</p>
        )}
        {canAddProvider.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <select
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
              value=""
              onChange={(e) => {
                const id = e.target.value as typeof BUILTIN_PROVIDER_IDS[number];
                if (id) { addProvider(id); (e.target as HTMLSelectElement).value = ''; }
              }}
            >
              <option value="">添加提供商…</option>
              {canAddProvider.map((id) => (
                <option key={id} value={id}>{PROVIDER_META[id]?.name ?? id}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (canAddProvider.includes('custom' as typeof BUILTIN_PROVIDER_IDS[number])) {
                  addProvider('custom');
                } else if (canAddProvider.length > 0) {
                  addProvider(canAddProvider[0]);
                }
              }}
              title="添加提供商"
              className="p-1.5 rounded hover:bg-white/5 text-desktop-muted hover:text-desktop-text transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
      </div>

      {/* 各模态默认模型 */}
      <div>
        <div className="text-xs font-medium text-desktop-muted mb-2">各能力默认模型</div>
        <div className="space-y-3">
          {MODALITIES.map((modality) => {
            const sel = llmConfig.defaultByModality[modality];
            const providerId = sel?.providerId ?? llmConfig.providers[0]?.id ?? '';
            const presetModels = MODELS_BY_PROVIDER_AND_MODALITY[providerId]?.[modality] ?? [];
            const imported = importedModelsByProvider[providerId] ?? [];
            const mergedRaw =
              providerId === 'custom'
                ? presetModels
                : [
                    ...presetModels,
                    ...imported
                      .filter((im) => !presetModels.some((p) => p.id === im.id))
                      .map((im) => ({ id: im.id, label: im.name ?? im.id })),
                  ];
            const byId = new Map<string, { id: string; label: string }>();
            for (const m of mergedRaw) {
              if (!byId.has(m.id)) byId.set(m.id, m);
            }
            const mergedModels = Array.from(byId.values());
            const isCustomModelId =
              providerId === 'custom' ||
              sel?.modelId === '__custom__' ||
              mergedModels.length === 0 ||
              (!!sel?.modelId && !mergedModels.some((m) => m.id === sel.modelId));
            const needCustomInput = isCustomModelId;
            const customModelIdDisplay = (sel?.modelId && sel.modelId !== '__custom__') ? sel.modelId : '';
            return (
              <div
                key={modality}
                className="flex flex-wrap items-center gap-2 py-2 border-b border-white/5"
              >
                <span className="w-28 text-xs text-desktop-text">{MODALITY_LABELS[modality]}</span>
                <select
                  className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
                  value={providerId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    const list = MODELS_BY_PROVIDER_AND_MODALITY[newId]?.[modality];
                    const modelId = list?.length ? list[0].id : '__custom__';
                    setDefaultForModality(modality, { providerId: newId, modelId });
                  }}
                >
                  {llmConfig.providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {mergedModels.length > 0 ? (
                  <select
                    className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
                    value={mergedModels.some((m) => m.id === sel?.modelId) ? sel?.modelId : '__custom__'}
                    onChange={(e) => {
                      const modelId = e.target.value;
                      setDefaultForModality(modality, { providerId, modelId });
                    }}
                  >
                    <option value="__custom__">自定义模型 ID</option>
                    {mergedModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                ) : null}
                {needCustomInput && (
                  <input
                    className="w-48 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text outline-none"
                    value={customModelIdDisplay}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setDefaultForModality(modality, { providerId, modelId: v || '__custom__' });
                    }}
                    placeholder="输入模型 ID"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 模型列表（预设 + 导入）：搜索、筛选、分页 */}
      <ModelListSection
        llmConfig={llmConfig}
        importedModelsByProvider={importedModelsByProvider}
      />
    </div>
  );
}

// ── Skills 发现与配置（API Key 等，支持从 Skill 描述自动推断需配置字段）──────────────────

type SkillConfigField = { key: string; label?: string; description?: string };
type SkillConfigValue = Record<string, string | undefined>;

function SkillsSettings() {
  const userId = getUserId();
  const [recommended, setRecommended] = useState<Array<{ slug: string; name: string; description: string; category?: string; installed: boolean }>>([]);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [skills, setSkills] = useState<Array<{
    id: string;
    name: string;
    description: string;
    requiresApiKey: boolean;
    dirName: string;
    configFields?: SkillConfigField[];
  }>>([]);
  const [skillConfig, setSkillConfig] = useState<Record<string, SkillConfigValue>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [extractingLLM, setExtractingLLM] = useState(false);
  const [deletingDir, setDeletingDir] = useState<string | null>(null);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillSearchResults, setSkillSearchResults] = useState<Array<{ slug: string; version?: string; description: string }>>([]);
  const [skillSearching, setSkillSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const load = useCallback((opts?: { extractLLM?: boolean }) => {
    const snapshot = getCloudConfigSnapshot();
    const snapRaw = snapshot?.skill_config;
    if (typeof snapRaw === 'object' && snapRaw !== null && !Array.isArray(snapRaw)) {
      setSkillConfig(snapRaw as Record<string, SkillConfigValue>);
    }
    setLoading(true);
    setError(null);
    return Promise.all([
      api.getSkills(opts?.extractLLM ? { extract: 'llm' } : undefined),
      api.getUserConfig(),
      api.getRecommendedSkills().catch(() => []),
    ])
      .then(([list, config, rec]) => {
        setSkills(list);
        setRecommended(Array.isArray(rec) ? rec : []);
        const raw = config?.skill_config;
        const obj =
          typeof raw === 'object' && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, SkillConfigValue>)
            : {};
        setSkillConfig(obj);
      })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // 配置修改后自动保存并提示
  useEffect(() => {
    if (isFirstMount.current || loading) {
      if (!loading) isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true);
      setError(null);
      setSaveMessage(null);
      api.setUserConfigKey('skill_config', skillConfig)
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '同步失败');
          setSaveMessage('fail');
        })
        .finally(() => setSaveLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [skillConfig, loading]);

  const handleDeleteSkill = useCallback(async (dirName: string, skillId: string) => {
    if (!confirm(`确定要删除 Skill「${dirName}」吗？此操作不可恢复。`)) return;
    setDeletingDir(dirName);
    setError(null);
    try {
      await api.deleteSkill(dirName);
      setSkills((prev) => prev.filter((s) => s.dirName !== dirName));
      setSkillConfig((prev) => {
        const { [skillId]: _, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeletingDir(null);
    }
  }, []);

  const setSkillConfigField = useCallback((skillId: string, fieldKey: string, value: string) => {
    setSkillConfig((prev) => {
      const next = { ...prev[skillId], [fieldKey]: value.trim() || undefined };
      if (Object.keys(next).every((k) => next[k] == null)) {
        const { [skillId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [skillId]: next };
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-desktop-text">Skills</h3>
        <p className="text-desktop-muted text-xs">加载中…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-desktop-text">Skills</h3>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
        {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <h4 className="text-xs font-medium text-desktop-text flex items-center gap-1.5">
          <Search size={12} />
          从 SkillHub 搜索
        </h4>
        <p className="text-[11px] text-desktop-muted">在 SkillHub 技能市场中搜索并一键安装，或告诉 X「帮我找 xxx 相关 Skill」。</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="搜索关键词，如 crypto、搜索、calendar…"
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            value={skillSearchQuery}
            onChange={(e) => setSkillSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setSkillSearching(true);
                api.searchSkills(skillSearchQuery.trim() || 'search', 15).then((r) => {
                  if (r?.ok && r.skills) setSkillSearchResults(r.skills);
                  else setSkillSearchResults([]);
                }).catch(() => setSkillSearchResults([])).finally(() => setSkillSearching(false));
              }
            }}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-lg text-xs bg-desktop-accent/30 hover:bg-desktop-accent/50 text-desktop-text disabled:opacity-50 flex items-center gap-1.5"
            disabled={skillSearching}
            onClick={async () => {
              setSkillSearching(true);
              try {
                const r = await api.searchSkills(skillSearchQuery.trim() || 'search', 15);
                if (r?.ok && r.skills) setSkillSearchResults(r.skills);
                else setSkillSearchResults([]);
              } catch {
                setSkillSearchResults([]);
              } finally {
                setSkillSearching(false);
              }
            }}
          >
            {skillSearching ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
            搜索
          </button>
        </div>
        {skillSearchResults.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-auto">
            {skillSearchResults.map((s) => {
              const already = skills.some((x) => x.dirName === s.slug) || recommended.some((r) => r.slug === s.slug && r.installed);
              return (
                <div key={s.slug} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/5 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-desktop-text">{s.slug}</span>
                    <p className="text-[10px] text-desktop-muted line-clamp-1 mt-0.5">{s.description}</p>
                  </div>
                  {already ? (
                    <span className="text-[10px] text-green-400 shrink-0">已安装</span>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 px-2 py-1 rounded text-[10px] bg-desktop-accent/30 hover:bg-desktop-accent/50 text-desktop-text disabled:opacity-50"
                      disabled={installingSlug !== null}
                      onClick={async () => {
                        setInstallingSlug(s.slug);
                        try {
                          await api.installSkill(`skillhub:${s.slug}`);
                          setSkillSearchResults((prev) => prev.filter((x) => x.slug !== s.slug));
                          load();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '安装失败');
                        } finally {
                          setInstallingSlug(null);
                        }
                      }}
                    >
                      {installingSlug === s.slug ? '安装中…' : '安装'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {recommended.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
          <h4 className="text-xs font-medium text-desktop-text">推荐 Skill</h4>
          <p className="text-desktop-muted text-[11px]">一键安装常用 Skill，安装后可在下方配置 API Key。</p>
          <div className="flex flex-wrap gap-2">
            {recommended.map((r) => (
              <div
                key={r.slug}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/5"
              >
                <div>
                  <span className="text-xs font-medium text-desktop-text">{r.name}</span>
                  <p className="text-[10px] text-desktop-muted line-clamp-1">{r.description}</p>
                </div>
                {r.installed ? (
                  <span className="text-[10px] text-green-400 shrink-0">已安装</span>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 px-2 py-1 rounded text-[10px] bg-desktop-accent/30 hover:bg-desktop-accent/50 text-desktop-text disabled:opacity-50"
                    disabled={installingSlug !== null}
                    onClick={async () => {
                      setInstallingSlug(r.slug);
                      try {
                        await api.installSkill(`skillhub:${r.slug}`);
                        setRecommended((prev) => prev.map((x) => (x.slug === r.slug ? { ...x, installed: true } : x)));
                        load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : '安装失败');
                      } finally {
                        setInstallingSlug(null);
                      }
                    }}
                  >
                    {installingSlug === r.slug ? '安装中…' : '安装'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-desktop-muted text-xs">
        从项目 <code className="bg-white/10 px-1 rounded">skills/</code> 目录发现的 Skill，与 OpenClaw/OpenCode 格式一致。需要 API Key 的 Skill 可在下方配置，修改后自动保存。
      </p>
      {error && (
        <p className="text-red-400 text-xs">{error}</p>
      )}
      {skills.length === 0 ? (
        <p className="text-desktop-muted text-xs">未发现 Skill。请在项目根下创建 <code className="bg-white/10 px-1 rounded">skills/&lt;名称&gt;/SKILL.md</code>，frontmatter 含 name、description，需 API Key 时设 metadata.requiresApiKey: true。</p>
      ) : (
        <div className="space-y-4">
          {skills.map((s) => (
            <div key={s.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-desktop-text font-medium">{s.name}</span>
                  {s.requiresApiKey && (
                    <span className="text-xs text-amber-500/90">需配置 API Key 或环境变量</span>
                  )}
                </div>
                <button
                  type="button"
                  className="px-2 py-1 rounded text-xs text-red-400/90 hover:bg-red-500/10 disabled:opacity-50"
                  disabled={deletingDir === s.dirName}
                  onClick={() => handleDeleteSkill(s.dirName, s.id)}
                  title="删除此 Skill"
                >
                  {deletingDir === s.dirName ? '删除中…' : '删除'}
                </button>
              </div>
              <p className="text-desktop-muted text-xs">{s.description}</p>
              {s.requiresApiKey && (
                <div className="pt-2 space-y-3">
                  {s.configFields && s.configFields.length > 0 ? (
                    s.configFields.map((f) => (
                      <div key={f.key}>
                        <label className="block text-xs text-desktop-muted mb-1">
                          {f.label ?? f.key}
                        </label>
                        <input
                          type="password"
                          className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none"
                          placeholder={`${f.key}（修改后自动保存）`}
                          value={skillConfig[s.id]?.[f.key] ?? ''}
                          onChange={(e) => setSkillConfigField(s.id, f.key, e.target.value)}
                        />
                        {f.description && (
                          <p className="text-desktop-muted/80 text-[10px] mt-0.5">{f.description}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div>
                      <label className="block text-xs text-desktop-muted mb-1">API Key</label>
                      <input
                        type="password"
                        className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none"
                        placeholder="修改后自动保存"
                        value={skillConfig[s.id]?.apiKey ?? ''}
                        onChange={(e) => setSkillConfigField(s.id, 'apiKey', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-2 flex-wrap items-center">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15"
              onClick={() => load()}
            >
              刷新
            </button>
            {skills.some((s) => s.requiresApiKey && !s.configFields?.length) && (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                disabled={extractingLLM}
                onClick={() => {
                  setExtractingLLM(true);
                  load({ extractLLM: true })?.finally(() => setExtractingLLM(false));
                }}
              >
                {extractingLLM ? '提取中…' : '用大模型提取配置字段'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 多媒体 API（音乐/音效生成）配置 ───────────────────────────────────────────

const AUDIO_API_CONFIG_KEY = 'audio_api_config';

const FAL_MUSIC_MODEL_OPTIONS = [
  { value: 'cassetteai/music-generator', label: 'CassetteAI（默认，速度快）' },
  { value: 'fal-ai/musicgen', label: 'MusicGen（Meta，质量较好）' },
  { value: 'fal-ai/stable-audio', label: 'Stable Audio Open（开源可商用）' },
];

export interface AudioApiConfig {
  falKey?: string;
  musicApiKey?: string;
  elevenLabsKey?: string;
  falMusicModel?: string;
  /** 为 true 时 llm.generate_image 使用 fal FLUX 生成（游戏形象、图标等） */
  useFalForImage?: boolean;
}

function MediaApiSettings() {
  const userId = getUserId();
  const [falKey, setFalKey] = useState('');
  const [musicApiKey, setMusicApiKey] = useState('');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [falMusicModel, setFalMusicModel] = useState(FAL_MUSIC_MODEL_OPTIONS[0].value);
  const [useFalForImage, setUseFalForImage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const load = useCallback(() => {
    const snapshot = getCloudConfigSnapshot();
    const v = snapshot?.audio_api_config as AudioApiConfig | undefined;
    if (v && typeof v === 'object') {
      setFalKey(v.falKey ?? '');
      setMusicApiKey(v.musicApiKey ?? '');
      setElevenLabsKey(v.elevenLabsKey ?? '');
      setFalMusicModel(v.falMusicModel && FAL_MUSIC_MODEL_OPTIONS.some((o) => o.value === v.falMusicModel) ? v.falMusicModel : FAL_MUSIC_MODEL_OPTIONS[0].value);
      setUseFalForImage(!!v.useFalForImage);
    }
    setLoading(true);
    setError(null);
    api
      .getUserConfigKey(AUDIO_API_CONFIG_KEY)
      .then((res) => {
        const val = res?.value as AudioApiConfig | undefined;
        if (val && typeof val === 'object') {
          setFalKey(val.falKey ?? '');
          setMusicApiKey(val.musicApiKey ?? '');
          setElevenLabsKey(val.elevenLabsKey ?? '');
          setFalMusicModel(val.falMusicModel && FAL_MUSIC_MODEL_OPTIONS.some((o) => o.value === val.falMusicModel) ? val.falMusicModel : FAL_MUSIC_MODEL_OPTIONS[0].value);
          setUseFalForImage(!!val.useFalForImage);
        }
      })
      .catch(() => {
        setFalKey('');
        setMusicApiKey('');
        setElevenLabsKey('');
        setFalMusicModel(FAL_MUSIC_MODEL_OPTIONS[0].value);
        setUseFalForImage(false);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // 修改后自动保存并提示
  useEffect(() => {
    if (isFirstMount.current || loading) {
      if (!loading) isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true);
      setError(null);
      setSaveMessage(null);
      api.setUserConfigKey(AUDIO_API_CONFIG_KEY, {
        falKey: falKey.trim() || undefined,
        musicApiKey: musicApiKey.trim() || undefined,
        elevenLabsKey: elevenLabsKey.trim() || undefined,
        falMusicModel: falMusicModel || undefined,
        useFalForImage: useFalForImage || undefined,
      })
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '同步失败');
          setSaveMessage('fail');
        })
        .finally(() => setSaveLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [falKey, musicApiKey, elevenLabsKey, falMusicModel, useFalForImage, loading]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-desktop-text">多媒体 API</h3>
        <div className="text-xs text-desktop-muted py-4">加载中…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-desktop-text">多媒体 API</h3>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
        {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
      </div>
      <p className="text-xs text-desktop-muted">
        用于应用/游戏资源生成：音效（SFX）、背景音乐（BGM）。配置后 X 可通过工具 llm.generate_sound_effect、llm.generate_music 自动生成并保存到沙箱。修改后自动保存。获取 Key 见项目 docs/AUDIO_API_KEYS_PLAN.md。
      </p>
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
      )}
      <div className="space-y-4">
        <SettingRow
          label="fal.ai Key"
          description="音效与音乐生成。llm.generate_sound_effect、llm.generate_music 均使用此 Key。"
        >
          <input
            type="password"
            autoComplete="off"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="FAL_KEY"
            value={falKey}
            onChange={(e) => setFalKey(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="游戏开发时图片使用 fal FLUX"
          description="仅当保存路径在 apps/ 下（小程序/游戏资源）时，llm.generate_image 使用 fal FLUX.1 [schnell]；其他场景使用大模型配置中的图像模型。与音效/音乐共用上方 fal Key。"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useFalForImage}
              onChange={(e) => setUseFalForImage(e.target.checked)}
              className="rounded border-white/20 bg-white/5 text-desktop-accent focus:ring-desktop-accent"
            />
            <span className="text-xs text-desktop-text">apps/ 下资源用 fal 生成</span>
          </label>
        </SettingRow>
        <SettingRow
          label="fal 音乐模型"
          description="BGM 生成用哪个模型：CassetteAI 快、MusicGen/Stable Audio 质量更好。"
        >
          <select
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
            value={falMusicModel}
            onChange={(e) => setFalMusicModel(e.target.value)}
          >
            {FAL_MUSIC_MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="MusicAPI.ai Key"
          description="背景音乐生成（可选）。有免费额度。"
        >
          <input
            type="password"
            autoComplete="off"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="MUSICAPI_KEY"
            value={musicApiKey}
            onChange={(e) => setMusicApiKey(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="ElevenLabs API Key"
          description="高品质音效（可选）。"
        >
          <input
            type="password"
            autoComplete="off"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="ELEVENLABS_API_KEY"
            value={elevenLabsKey}
            onChange={(e) => setElevenLabsKey(e.target.value)}
          />
        </SettingRow>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15"
          onClick={load}
        >
          刷新
        </button>
      </div>
    </div>
  );
}

// ── 渠道设置（Tab 容器） ─────────────────────────────────────────────────────

type ChannelTab = 'email' | 'whatsapp' | 'qq' | 'telegram' | 'discord' | 'slack';

const CHANNEL_TABS: { id: ChannelTab; label: string }[] = [
  { id: 'email', label: '邮件' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'qq', label: 'QQ' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'discord', label: 'Discord' },
  { id: 'slack', label: 'Slack' },
];

function ChannelsSettings() {
  const [channelTab, setChannelTab] = useState<ChannelTab>('email');
  return (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-desktop-text">渠道</h3>
      <div className="flex gap-1 border-b border-white/10 pb-px overflow-x-auto">
        {CHANNEL_TABS.map((ct) => (
          <button
            key={ct.id}
            type="button"
            className={`px-3 py-1.5 text-xs rounded-t-lg transition-colors whitespace-nowrap ${
              channelTab === ct.id
                ? 'bg-white/10 text-desktop-text border-b-2 border-desktop-accent'
                : 'text-desktop-muted hover:text-desktop-text hover:bg-white/5'
            }`}
            onClick={() => setChannelTab(ct.id)}
          >
            {ct.label}
          </button>
        ))}
      </div>
      <div>
        {channelTab === 'email' && <EmailSmtpSettings />}
        {channelTab === 'whatsapp' && <WhatsAppSettingsStandalone />}
        {channelTab === 'qq' && <QQSettingsStandalone />}
        {channelTab === 'telegram' && <TelegramSettingsStandalone />}
        {channelTab === 'discord' && <DiscordSettingsStandalone />}
        {channelTab === 'slack' && <SlackSettingsStandalone />}
      </div>
    </div>
  );
}

// ── 邮件（SMTP）配置 ─────────────────────────────────────────────────────

const EMAIL_SMTP_CONFIG_KEY = 'email_smtp_config';

interface EmailSmtpConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

function EmailSmtpSettings() {
  const userId = getUserId();
  const [host, setHost] = useState('smtp.qq.com');
  const [port, setPort] = useState(465);
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const load = useCallback(() => {
    const snapshot = getCloudConfigSnapshot();
    const v = snapshot?.[EMAIL_SMTP_CONFIG_KEY] as EmailSmtpConfig | undefined;
    if (v && typeof v === 'object') {
      setHost(v.host ?? 'smtp.qq.com');
      setPort(typeof v.port === 'number' ? v.port : 465);
      setSecure(v.secure !== false);
      setUser(v.user ?? '');
      setPass(v.pass ?? '');
      setFrom(v.from ?? '');
    }
    setLoading(true);
    setError(null);
    api
      .getUserConfigKey(EMAIL_SMTP_CONFIG_KEY)
      .then((res) => {
        const val = res?.value as EmailSmtpConfig | undefined;
        if (val && typeof val === 'object') {
          setHost(val.host ?? 'smtp.qq.com');
          setPort(typeof val.port === 'number' ? val.port : 465);
          setSecure(val.secure !== false);
          setUser(val.user ?? '');
          setPass(val.pass ?? '');
          setFrom(val.from ?? '');
        }
      })
      .catch(() => {
        setHost('smtp.qq.com');
        setPort(465);
        setSecure(true);
        setUser('');
        setPass('');
        setFrom('');
      })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isFirstMount.current || loading) {
      if (!loading) isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true);
      setError(null);
      setSaveMessage(null);
      api.setUserConfigKey(EMAIL_SMTP_CONFIG_KEY, {
        host: host.trim() || undefined,
        port: port || 465,
        secure,
        user: user.trim() || undefined,
        pass: pass ? pass : undefined,
        from: from.trim() || undefined,
      })
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : '同步失败');
          setSaveMessage('fail');
        })
        .finally(() => setSaveLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [host, port, secure, user, pass, from, loading]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h4 className="text-xs font-medium text-desktop-text">邮件</h4>
        <div className="text-xs text-desktop-muted py-4">加载中…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-xs font-medium text-desktop-text">SMTP 发信</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
        {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
      </div>
      <p className="text-xs text-desktop-muted">
        配置 SMTP 后，X 可通过 x.send_email 工具向您发送邮件（用户不在线时也能触达）。QQ 邮箱：host 填 smtp.qq.com，port 填 465（SSL）或 587（TLS），user 为完整邮箱，pass 为 QQ 邮箱授权码（非登录密码，需在 QQ 邮箱设置中开启 SMTP 并生成）。修改后自动保存。
      </p>
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
      )}
      <div className="space-y-4">
        <SettingRow
          label="SMTP Host"
          description="QQ 邮箱填 smtp.qq.com"
        >
          <input
            type="text"
            autoComplete="off"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="smtp.qq.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="端口"
          description="465（SSL）或 587（TLS）"
        >
          <input
            type="number"
            className="w-full max-w-[120px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 465)}
            min={1}
            max={65535}
          />
        </SettingRow>
        <SettingRow
          label="使用 SSL (secure)"
          description="465 端口一般为 true"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={secure}
              onChange={(e) => setSecure(e.target.checked)}
              className="rounded border-white/20 bg-white/5 text-desktop-accent focus:ring-desktop-accent"
            />
            <span className="text-xs text-desktop-text">启用 SSL</span>
          </label>
        </SettingRow>
        <SettingRow
          label="邮箱账号"
          description="发件邮箱，如 xxx@qq.com"
        >
          <input
            type="email"
            autoComplete="off"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="xxx@qq.com"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="授权码"
          description="QQ 邮箱需在设置→账户中开启 SMTP 并生成授权码"
        >
          <input
            type="password"
            autoComplete="off"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="授权码（非登录密码）"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="发件人显示名（可选）"
          description="如 X Computer &lt;xxx@qq.com&gt;"
        >
          <input
            type="text"
            autoComplete="off"
            className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="X Computer <xxx@qq.com>"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </SettingRow>
      </div>
      <EmailImapSettings />
    </div>
  );
}

// IMAP 收信配置（R042 邮件渠道双向通信）
const EMAIL_IMAP_CONFIG_KEY = 'email_imap_config';

interface EmailImapConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}

function EmailImapSettings() {
  const userId = getUserId();
  const [imapHost, setImapHost] = useState('imap.qq.com');
  const [imapPort, setImapPort] = useState(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUser, setImapUser] = useState('');
  const [imapPass, setImapPass] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const load = useCallback(() => {
    const snapshot = getCloudConfigSnapshot();
    const v = snapshot?.[EMAIL_IMAP_CONFIG_KEY] as EmailImapConfig | undefined;
    if (v && typeof v === 'object') {
      setImapHost(v.host ?? 'imap.qq.com');
      setImapPort(typeof v.port === 'number' ? v.port : 993);
      setImapSecure(v.secure !== false);
      setImapUser(v.user ?? '');
      setImapPass(v.pass ?? '');
    }
    setLoading(true);
    api
      .getUserConfigKey(EMAIL_IMAP_CONFIG_KEY)
      .then((res) => {
        const val = res?.value as EmailImapConfig | undefined;
        if (val && typeof val === 'object') {
          setImapHost(val.host ?? 'imap.qq.com');
          setImapPort(typeof val.port === 'number' ? val.port : 993);
          setImapSecure(val.secure !== false);
          setImapUser(val.user ?? '');
          setImapPass(val.pass ?? '');
        }
      })
      .catch(() => {
        setImapHost('imap.qq.com');
        setImapPort(993);
        setImapSecure(true);
        setImapUser('');
        setImapPass('');
      })
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isFirstMount.current || loading) {
      if (!loading) isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true);
      setSaveMessage(null);
      api.setUserConfigKey(EMAIL_IMAP_CONFIG_KEY, {
        host: imapHost.trim() || undefined,
        port: imapPort || 993,
        secure: imapSecure,
        user: imapUser.trim() || undefined,
        pass: imapPass ? imapPass : undefined,
      })
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch(() => setSaveMessage('fail'))
        .finally(() => setSaveLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [imapHost, imapPort, imapSecure, imapUser, imapPass, loading]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-desktop-text">IMAP 收信（R042 邮件渠道）</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
      </div>
      <p className="text-xs text-desktop-muted">
        配置 IMAP 后，X 可通过 x.check_email 拉取收件箱，收到用户回复后可用 x.send_email 回信。QQ 邮箱：imap.qq.com、993，user/pass 与 SMTP 相同。
      </p>
      <SettingRow label="IMAP Host" description="QQ 邮箱填 imap.qq.com">
        <input
          type="text"
          autoComplete="off"
          className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
          placeholder="imap.qq.com"
          value={imapHost}
          onChange={(e) => setImapHost(e.target.value)}
        />
      </SettingRow>
      <SettingRow label="端口" description="通常 993">
        <input
          type="number"
          className="w-full max-w-[120px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent"
          value={imapPort}
          onChange={(e) => setImapPort(parseInt(e.target.value, 10) || 993)}
          min={1}
          max={65535}
        />
      </SettingRow>
      <SettingRow label="启用 SSL" description="IMAP 连接使用 SSL/TLS">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={imapSecure}
            onChange={(e) => setImapSecure(e.target.checked)}
            className="rounded border-white/20 bg-white/5 text-desktop-accent focus:ring-desktop-accent"
          />
          <span className="text-xs text-desktop-text">是</span>
        </label>
      </SettingRow>
      <SettingRow label="邮箱账号" description="与 SMTP 相同">
        <input
          type="email"
          autoComplete="off"
          className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
          placeholder="xxx@qq.com"
          value={imapUser}
          onChange={(e) => setImapUser(e.target.value)}
        />
      </SettingRow>
      <SettingRow label="授权码" description="与 SMTP 相同">
        <input
          type="password"
          autoComplete="off"
          className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
          placeholder="授权码"
          value={imapPass}
          onChange={(e) => setImapPass(e.target.value)}
        />
      </SettingRow>
    </div>
  );
}

// ── WhatsApp 配置（R052）──────────────────────────────────────────────────────

const WHATSAPP_CONFIG_KEY = 'whatsapp_config';

interface WhatsAppConfig {
  enabled?: boolean;
  dmPolicy?: 'allowlist' | 'open' | 'disabled';
  allowFrom?: string[];
  allowSelfChat?: boolean;
  groupPolicy?: 'allowlist' | 'disabled';
  proxy?: string;
}

function WhatsAppSettings() {
  const [status, setStatus] = useState<{ enabled: boolean; status: string; allowFrom: string[]; allowSelfChat?: boolean } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [allowSelfChat, setAllowSelfChat] = useState(false);
  const [allowFrom, setAllowFrom] = useState('');
  const [proxy, setProxy] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const loadStatus = useCallback(() => {
    setLoading(true);
      api
      .getWhatsAppStatus()
      .then((res) => {
        setStatus(res);
        setEnabled(res.enabled);
        setAllowSelfChat(res.allowSelfChat ?? false);
        setAllowFrom((res.allowFrom ?? []).join(', '));
        setProxy(res.proxy ?? '');
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  /** 显示 QR 时轮询状态：扫码后可能经历 515 重连，需轮询才能检测到已连接并更新 UI */
  useEffect(() => {
    if (!qr) return;
    const id = setInterval(() => {
      api.getWhatsAppStatus().then((res) => {
        if (res?.status === 'connected') {
          setQr(null);
          setLoginError(null);
          loadStatus();
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [qr, loadStatus]);

  useEffect(() => {
    if (isFirstMount.current || loading) {
      if (!loading) isFirstMount.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true);
      setSaveMessage(null);
      const config: WhatsAppConfig = {
        enabled,
        dmPolicy: 'allowlist',
        allowSelfChat: allowSelfChat || undefined,
        allowFrom: allowFrom
          .split(/[,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        proxy: proxy.trim() || undefined,
      };
      api
        .setUserConfigKey(WHATSAPP_CONFIG_KEY, config)
        .then(() => {
          setSaveMessage('ok');
          setTimeout(() => setSaveMessage(null), 2500);
        })
        .catch(() => setSaveMessage('fail'))
        .finally(() => setSaveLoading(false));
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, allowSelfChat, allowFrom, proxy, loading]);

  const handleLogin = async () => {
    setLoginLoading(true);
    setQr(null);
    setLoginError(null);
    try {
      const res = await api.whatsAppLogin(proxy.trim() || undefined);
      if (res.alreadyConnected) {
        setQr(null);
        loadStatus();
      } else if (res.qr) {
        setQr(res.qr);
      } else if (res.error) {
        setLoginError(res.error);
      }
    } catch (e) {
      setQr(null);
      setLoginError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await api.whatsAppLogout();
      setQr(null);
      loadStatus();
    } finally {
      setLogoutLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h4 className="text-xs font-medium text-desktop-text">WhatsApp（R052）</h4>
        <div className="text-xs text-desktop-muted py-4">加载中…</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-desktop-text">WhatsApp（R052）</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
      </div>
      <p className="text-xs text-desktop-muted">
        配置 WhatsApp 后，X 可通过 x.send_whatsapp 工具发送消息。需扫码登录（WhatsApp Web）。白名单外的号码发来的消息将被忽略。
      </p>
      <div className="space-y-2">
        <p className="text-xs text-amber-400/80">
          <strong>国内用户必读：</strong>访问 WhatsApp 需要代理。请在下方配置代理地址，或开启代理软件的「设置为系统代理」后点击「检测系统代理」。
        </p>
        <details className="text-xs text-desktop-muted">
          <summary className="cursor-pointer hover:text-desktop-text">如何查看代理端口？</summary>
          <ul className="mt-2 ml-4 space-y-1 list-disc">
            <li><strong>V2Box（Xray 内核）</strong>：打开应用 → 设置/偏好设置 → 查看「本地监听端口」。常见端口：HTTP 10809 或 8080，SOCKS5 10808</li>
            <li><strong>Clash/ClashX</strong>：菜单栏图标 → 设置 → 端口设置（HTTP 通常为 7890，SOCKS5 为 7891）</li>
            <li><strong>Quantumult X</strong>：设置 → HTTP 代理服务器（通常为 http://127.0.0.1:端口）</li>
            <li><strong>推荐使用 HTTP 代理</strong>（如 http://127.0.0.1:10809 或 http://127.0.0.1:7890），比 SOCKS5 更稳定</li>
            <li><strong>快速测试</strong>：开启代理软件的「设置为系统代理」，然后点击上方「检测系统代理」按钮自动填入</li>
          </ul>
        </details>
      </div>
      <SettingRow label="启用" description="启用 WhatsApp 渠道">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-white/20 bg-white/5 text-desktop-accent focus:ring-desktop-accent"
          />
          <span className="text-xs text-desktop-text">启用</span>
        </label>
      </SettingRow>
      <SettingRow label="发给自己" description="接收「与自己的对话」中的消息，手机发给自己后 X 可处理并回复">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allowSelfChat}
            onChange={(e) => setAllowSelfChat(e.target.checked)}
            className="rounded border-white/20 bg-white/5 text-desktop-accent focus:ring-desktop-accent"
          />
          <span className="text-xs text-desktop-text">接收自己发来的消息</span>
        </label>
      </SettingRow>
      <SettingRow label="白名单" description="允许接收消息的号码，E.164 格式（如 +8613800138000），逗号分隔">
        <input
          type="text"
          autoComplete="off"
          className="w-full max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
          placeholder="+8613800138000, +14155552671"
          value={allowFrom}
          onChange={(e) => setAllowFrom(e.target.value)}
        />
      </SettingRow>
      <SettingRow label="代理" description="常见端口：V2Box/Xray HTTP 10809，Clash HTTP 7890。填写后点击「登录」即时生效">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            autoComplete="off"
            className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
            placeholder="http://127.0.0.1:10809 或 http://127.0.0.1:7890"
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
          />
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 disabled:opacity-50"
            onClick={async () => {
              try {
                const res = await api.getWhatsAppSystemProxy();
                if (res.ok && res.proxy) setProxy(res.proxy);
              } catch {}
            }}
          >
            检测系统代理
          </button>
        </div>
      </SettingRow>
      {loginError && (
        <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
          {loginError}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-desktop-muted">状态：</span>
        <span className={`text-xs ${status?.status === 'connected' ? 'text-green-400' : 'text-desktop-muted'}`}>
          {status?.status === 'connected' ? '已连接' : '未连接'}
        </span>
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 disabled:opacity-50"
          onClick={handleLogin}
          disabled={loginLoading}
        >
          {loginLoading ? '连接中…' : '扫码登录'}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
          onClick={handleLogout}
          disabled={logoutLoading}
        >
          登出
        </button>
      </div>
      {qr && (
        <div className="flex flex-col items-start gap-2">
          <span className="text-xs text-desktop-muted">请用 WhatsApp 扫码：</span>
          <img src={qr} alt="QR Code" className="w-48 h-48 rounded-lg border border-white/10" />
        </div>
      )}
    </div>
  );
}

// ── Telegram 设置 ────────────────────────────────────────────────────────────

const TELEGRAM_CONFIG_KEY = 'telegram_config';

function TelegramSettings() {
  const [status, setStatus] = useState<{ enabled: boolean; status: string; botInfo?: { username?: string } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [allowFrom, setAllowFrom] = useState('');
  const [dmPolicy, setDmPolicy] = useState<'allowlist' | 'open'>('allowlist');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const loadStatus = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getTelegramStatus().catch(() => null),
      api.getUserConfigKey(TELEGRAM_CONFIG_KEY).catch(() => null),
    ]).then(([statusRes, configRes]) => {
      if (statusRes) {
        setStatus(statusRes);
        setEnabled(statusRes.enabled);
        setDmPolicy((statusRes.dmPolicy as 'allowlist' | 'open') ?? 'allowlist');
      }
      const cfg = configRes?.value as Record<string, unknown> | undefined;
      if (cfg) {
        if (cfg.botToken) setBotToken(String(cfg.botToken));
        if (cfg.dmPolicy) setDmPolicy(cfg.dmPolicy as 'allowlist' | 'open');
        if (Array.isArray(cfg.allowFrom)) setAllowFrom(cfg.allowFrom.join(', '));
      }
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (isFirstMount.current || loading) { if (!loading) isFirstMount.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true); setSaveMessage(null);
      const config = { enabled, botToken: botToken.trim() || undefined, dmPolicy, allowFrom: allowFrom.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) };
      api.setUserConfigKey(TELEGRAM_CONFIG_KEY, config).then(() => { setSaveMessage('ok'); setTimeout(() => setSaveMessage(null), 2500); }).catch(() => setSaveMessage('fail')).finally(() => setSaveLoading(false));
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [enabled, botToken, allowFrom, dmPolicy, loading]);

  if (loading) return <div className="space-y-4"><h4 className="text-xs font-medium text-desktop-text">Telegram</h4><div className="text-xs text-desktop-muted py-4">加载中…</div></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-desktop-text">Telegram</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
      </div>
      <p className="text-xs text-desktop-muted">通过 @BotFather 创建 Bot，获取 Token，X 即可收发 Telegram 消息。</p>
      <SettingRow label="启用" description="开启后 X 可收发 Telegram 消息">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-desktop-accent" />
      </SettingRow>
      <SettingRow label="Bot Token" description="从 @BotFather 获取">
        <input type="password" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent" placeholder="123456:ABC-DEF..." value={botToken} onChange={(e) => setBotToken(e.target.value)} />
      </SettingRow>
      <SettingRow label="DM 策略" description="allowlist=仅白名单，open=所有人">
        <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text" value={dmPolicy} onChange={(e) => setDmPolicy(e.target.value as 'allowlist' | 'open')}>
          <option value="allowlist">白名单</option><option value="open">所有人</option>
        </select>
      </SettingRow>
      <SettingRow label="白名单" description="Telegram User ID，逗号分隔">
        <input type="text" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none" placeholder="123456789, 987654321" value={allowFrom} onChange={(e) => setAllowFrom(e.target.value)} />
      </SettingRow>
      {connectError && <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">{connectError}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-desktop-muted">状态：</span>
        <span className={`text-xs ${status?.status === 'connected' ? 'text-green-400' : 'text-desktop-muted'}`}>{status?.status === 'connected' ? `已连接${status.botInfo?.username ? ` (@${status.botInfo.username})` : ''}` : '未连接'}</span>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 disabled:opacity-50" disabled={connectLoading} onClick={async () => {
          setConnectLoading(true); setConnectError(null);
          try { const r = await api.telegramConnect(); if (!r.ok) setConnectError(r.error ?? '连接失败'); loadStatus(); } catch (e) { setConnectError(e instanceof Error ? e.message : '连接失败'); } finally { setConnectLoading(false); }
        }}>{connectLoading ? '连接中…' : '连接'}</button>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50" onClick={async () => { await api.telegramDisconnect(); loadStatus(); }}>断开</button>
      </div>
    </div>
  );
}

// ── Discord 设置 ─────────────────────────────────────────────────────────────

const DISCORD_CONFIG_KEY = 'discord_config';

function DiscordSettings() {
  const [status, setStatus] = useState<{ enabled: boolean; status: string; botInfo?: { username?: string } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [allowGuilds, setAllowGuilds] = useState('');
  const [dmPolicy, setDmPolicy] = useState<'allowlist' | 'open' | 'disabled'>('open');
  const [guildPolicy, setGuildPolicy] = useState<'allowlist' | 'open' | 'disabled'>('open');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const loadStatus = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getDiscordStatus().catch(() => null),
      api.getUserConfigKey(DISCORD_CONFIG_KEY).catch(() => null),
    ]).then(([statusRes, configRes]) => {
      if (statusRes) {
        setStatus(statusRes);
        setEnabled(statusRes.enabled);
        setDmPolicy((statusRes.dmPolicy as 'allowlist' | 'open' | 'disabled') ?? 'open');
      }
      const cfg = configRes?.value as Record<string, unknown> | undefined;
      if (cfg) {
        if (cfg.botToken) setBotToken(String(cfg.botToken));
        if (cfg.dmPolicy) setDmPolicy(cfg.dmPolicy as 'allowlist' | 'open' | 'disabled');
        if (cfg.guildPolicy) setGuildPolicy(cfg.guildPolicy as 'allowlist' | 'open' | 'disabled');
        if (Array.isArray(cfg.allowGuilds)) setAllowGuilds(cfg.allowGuilds.join(', '));
      }
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (isFirstMount.current || loading) { if (!loading) isFirstMount.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true); setSaveMessage(null);
      const config = { enabled, botToken: botToken.trim() || undefined, dmPolicy, guildPolicy, allowGuilds: allowGuilds.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) };
      api.setUserConfigKey(DISCORD_CONFIG_KEY, config).then(() => { setSaveMessage('ok'); setTimeout(() => setSaveMessage(null), 2500); }).catch(() => setSaveMessage('fail')).finally(() => setSaveLoading(false));
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [enabled, botToken, allowGuilds, dmPolicy, guildPolicy, loading]);

  if (loading) return <div className="space-y-4"><h4 className="text-xs font-medium text-desktop-text">Discord</h4><div className="text-xs text-desktop-muted py-4">加载中…</div></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-desktop-text">Discord</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
      </div>
      <p className="text-xs text-desktop-muted">在 Discord Developer Portal 创建 Application → Bot，获取 Token。需开启 Message Content Intent。</p>
      <SettingRow label="启用" description="开启后 X 可收发 Discord 消息">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-desktop-accent" />
      </SettingRow>
      <SettingRow label="Bot Token" description="从 Discord Developer Portal 获取">
        <input type="password" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent" value={botToken} onChange={(e) => setBotToken(e.target.value)} />
      </SettingRow>
      <SettingRow label="DM 策略" description="allowlist/open/disabled">
        <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text" value={dmPolicy} onChange={(e) => setDmPolicy(e.target.value as any)}>
          <option value="open">所有人</option><option value="allowlist">白名单</option><option value="disabled">禁用</option>
        </select>
      </SettingRow>
      <SettingRow label="服务器策略" description="allowlist/open/disabled">
        <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text" value={guildPolicy} onChange={(e) => setGuildPolicy(e.target.value as any)}>
          <option value="open">所有服务器</option><option value="allowlist">白名单</option><option value="disabled">禁用</option>
        </select>
      </SettingRow>
      <SettingRow label="服务器白名单" description="Guild ID，逗号分隔">
        <input type="text" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none" placeholder="1234567890" value={allowGuilds} onChange={(e) => setAllowGuilds(e.target.value)} />
      </SettingRow>
      {connectError && <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">{connectError}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-desktop-muted">状态：</span>
        <span className={`text-xs ${status?.status === 'connected' ? 'text-green-400' : 'text-desktop-muted'}`}>{status?.status === 'connected' ? `已连接${status.botInfo?.username ? ` (${status.botInfo.username})` : ''}` : '未连接'}</span>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 disabled:opacity-50" disabled={connectLoading} onClick={async () => {
          setConnectLoading(true); setConnectError(null);
          try { const r = await api.discordConnect(); if (!r.ok) setConnectError(r.error ?? '连接失败'); loadStatus(); } catch (e) { setConnectError(e instanceof Error ? e.message : '连接失败'); } finally { setConnectLoading(false); }
        }}>{connectLoading ? '连接中…' : '连接'}</button>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50" onClick={async () => { await api.discordDisconnect(); loadStatus(); }}>断开</button>
      </div>
    </div>
  );
}

// ── Slack 设置 ───────────────────────────────────────────────────────────────

const SLACK_CONFIG_KEY = 'slack_config';

function SlackSettings() {
  const [status, setStatus] = useState<{ enabled: boolean; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [allowChannels, setAllowChannels] = useState('');
  const [dmPolicy, setDmPolicy] = useState<'allowlist' | 'open' | 'disabled'>('open');
  const [channelPolicy, setChannelPolicy] = useState<'allowlist' | 'open' | 'disabled'>('open');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const loadStatus = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getSlackStatus().catch(() => null),
      api.getUserConfigKey(SLACK_CONFIG_KEY).catch(() => null),
    ]).then(([statusRes, configRes]) => {
      if (statusRes) {
        setStatus(statusRes);
        setEnabled(statusRes.enabled);
        setDmPolicy((statusRes.dmPolicy as 'allowlist' | 'open' | 'disabled') ?? 'open');
      }
      const cfg = configRes?.value as Record<string, unknown> | undefined;
      if (cfg) {
        if (cfg.botToken) setBotToken(String(cfg.botToken));
        if (cfg.appToken) setAppToken(String(cfg.appToken));
        if (cfg.dmPolicy) setDmPolicy(cfg.dmPolicy as 'allowlist' | 'open' | 'disabled');
        if (cfg.channelPolicy) setChannelPolicy(cfg.channelPolicy as 'allowlist' | 'open' | 'disabled');
        if (Array.isArray(cfg.allowChannels)) setAllowChannels(cfg.allowChannels.join(', '));
      }
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (isFirstMount.current || loading) { if (!loading) isFirstMount.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true); setSaveMessage(null);
      const config = { enabled, botToken: botToken.trim() || undefined, appToken: appToken.trim() || undefined, dmPolicy, channelPolicy, allowChannels: allowChannels.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) };
      api.setUserConfigKey(SLACK_CONFIG_KEY, config).then(() => { setSaveMessage('ok'); setTimeout(() => setSaveMessage(null), 2500); }).catch(() => setSaveMessage('fail')).finally(() => setSaveLoading(false));
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [enabled, botToken, appToken, allowChannels, dmPolicy, channelPolicy, loading]);

  if (loading) return <div className="space-y-4"><h4 className="text-xs font-medium text-desktop-text">Slack</h4><div className="text-xs text-desktop-muted py-4">加载中…</div></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-desktop-text">Slack</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
      </div>
      <p className="text-xs text-desktop-muted">在 api.slack.com 创建 App，启用 Socket Mode，配置 OAuth Scopes（chat:write、channels:read、im:read、im:write）。</p>
      <SettingRow label="启用" description="开启后 X 可收发 Slack 消息">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-desktop-accent" />
      </SettingRow>
      <SettingRow label="Bot Token" description="xoxb-... 格式">
        <input type="password" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent" placeholder="xoxb-..." value={botToken} onChange={(e) => setBotToken(e.target.value)} />
      </SettingRow>
      <SettingRow label="App Token" description="xapp-... 格式（Socket Mode 需要）">
        <input type="password" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent" placeholder="xapp-..." value={appToken} onChange={(e) => setAppToken(e.target.value)} />
      </SettingRow>
      <SettingRow label="DM 策略" description="allowlist/open/disabled">
        <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text" value={dmPolicy} onChange={(e) => setDmPolicy(e.target.value as any)}>
          <option value="open">所有人</option><option value="allowlist">白名单</option><option value="disabled">禁用</option>
        </select>
      </SettingRow>
      <SettingRow label="频道策略" description="allowlist/open/disabled">
        <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text" value={channelPolicy} onChange={(e) => setChannelPolicy(e.target.value as any)}>
          <option value="open">所有频道</option><option value="allowlist">白名单</option><option value="disabled">禁用</option>
        </select>
      </SettingRow>
      <SettingRow label="频道白名单" description="Channel ID，逗号分隔">
        <input type="text" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none" value={allowChannels} onChange={(e) => setAllowChannels(e.target.value)} />
      </SettingRow>
      {connectError && <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">{connectError}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-desktop-muted">状态：</span>
        <span className={`text-xs ${status?.status === 'connected' ? 'text-green-400' : 'text-desktop-muted'}`}>{status?.status === 'connected' ? '已连接' : '未连接'}</span>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 disabled:opacity-50" disabled={connectLoading} onClick={async () => {
          setConnectLoading(true); setConnectError(null);
          try { const r = await api.slackConnect(); if (!r.ok) setConnectError(r.error ?? '连接失败'); loadStatus(); } catch (e) { setConnectError(e instanceof Error ? e.message : '连接失败'); } finally { setConnectLoading(false); }
        }}>{connectLoading ? '连接中…' : '连接'}</button>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50" onClick={async () => { await api.slackDisconnect(); loadStatus(); }}>断开</button>
      </div>
    </div>
  );
}

// ── QQ 渠道设置 ─────────────────────────────────────────────────────────────

const QQ_CONFIG_KEY = 'qq_config';

function QQSettings() {
  const [status, setStatus] = useState<{ enabled: boolean; status: string; botInfo?: { id?: string; username?: string }; dmPolicy?: string; groupPolicy?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [dmPolicy, setDmPolicy] = useState<'allowlist' | 'open' | 'disabled'>('open');
  const [groupPolicy, setGroupPolicy] = useState<'allowlist' | 'open' | 'disabled'>('open');
  const [allowFrom, setAllowFrom] = useState('');
  const [allowGroups, setAllowGroups] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMount = useRef(true);

  const loadStatus = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getQQStatus().catch(() => null),
      api.getUserConfigKey(QQ_CONFIG_KEY).catch(() => null),
    ]).then(([statusRes, configRes]) => {
      if (statusRes) {
        setStatus(statusRes);
        setEnabled(statusRes.enabled);
        setDmPolicy((statusRes.dmPolicy as 'allowlist' | 'open' | 'disabled') ?? 'open');
        setGroupPolicy((statusRes.groupPolicy as 'allowlist' | 'open' | 'disabled') ?? 'open');
      }
      const cfg = configRes?.value as Record<string, unknown> | undefined;
      if (cfg) {
        if (cfg.appId) setAppId(String(cfg.appId));
        if (cfg.secret) setSecret(String(cfg.secret));
        if (typeof cfg.sandbox === 'boolean') setSandbox(cfg.sandbox);
        if (cfg.dmPolicy) setDmPolicy(cfg.dmPolicy as 'allowlist' | 'open' | 'disabled');
        if (cfg.groupPolicy) setGroupPolicy(cfg.groupPolicy as 'allowlist' | 'open' | 'disabled');
        if (Array.isArray(cfg.allowFrom)) setAllowFrom(cfg.allowFrom.join(', '));
        if (Array.isArray(cfg.allowGroups)) setAllowGroups(cfg.allowGroups.join(', '));
      }
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (isFirstMount.current || loading) { if (!loading) isFirstMount.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setSaveLoading(true); setSaveMessage(null);
      const config = {
        enabled,
        appId: appId.trim() || undefined,
        secret: secret.trim() || undefined,
        sandbox,
        dmPolicy,
        groupPolicy,
        allowFrom: allowFrom.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean),
        allowGroups: allowGroups.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean),
      };
      api.setUserConfigKey(QQ_CONFIG_KEY, config).then(() => { setSaveMessage('ok'); setTimeout(() => setSaveMessage(null), 2500); }).catch(() => setSaveMessage('fail')).finally(() => setSaveLoading(false));
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [enabled, appId, secret, sandbox, dmPolicy, groupPolicy, allowFrom, allowGroups, loading]);

  if (loading) return <div className="space-y-4"><h4 className="text-xs font-medium text-desktop-text">QQ</h4><div className="text-xs text-desktop-muted py-4">加载中…</div></div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-desktop-text">QQ</h4>
        {saveLoading && <span className="text-xs text-desktop-muted">保存中…</span>}
        {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
      </div>
      <p className="text-xs text-desktop-muted">在 q.qq.com 创建机器人，获取 AppID 和 AppSecret。支持私聊（C2C）、群聊（@机器人）和频道消息。</p>
      <SettingRow label="启用" description="开启后 X 可收发 QQ 消息">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-desktop-accent" />
      </SettingRow>
      <SettingRow label="AppID" description="QQ 开放平台的 AppID">
        <input type="text" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent" placeholder="10xxxx" value={appId} onChange={(e) => setAppId(e.target.value)} />
      </SettingRow>
      <SettingRow label="AppSecret" description="应用密钥">
        <input type="password" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-accent" placeholder="Secret..." value={secret} onChange={(e) => setSecret(e.target.value)} />
      </SettingRow>
      <SettingRow label="沙箱模式" description="用于测试环境">
        <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} className="accent-desktop-accent" />
      </SettingRow>
      <SettingRow label="私聊策略" description="allowlist/open/disabled">
        <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text" value={dmPolicy} onChange={(e) => setDmPolicy(e.target.value as any)}>
          <option value="open">所有人</option><option value="allowlist">白名单</option><option value="disabled">禁用</option>
        </select>
      </SettingRow>
      <SettingRow label="群聊策略" description="allowlist/open/disabled">
        <select className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text" value={groupPolicy} onChange={(e) => setGroupPolicy(e.target.value as any)}>
          <option value="open">所有群</option><option value="allowlist">白名单</option><option value="disabled">禁用</option>
        </select>
      </SettingRow>
      <SettingRow label="私聊白名单" description="用户 openid，逗号分隔">
        <input type="text" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none" value={allowFrom} onChange={(e) => setAllowFrom(e.target.value)} />
      </SettingRow>
      <SettingRow label="群聊白名单" description="群 openid，逗号分隔">
        <input type="text" className="flex-1 min-w-[200px] max-w-md bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none" value={allowGroups} onChange={(e) => setAllowGroups(e.target.value)} />
      </SettingRow>
      {connectError && <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">{connectError}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-desktop-muted">状态：</span>
        <span className={`text-xs ${status?.status === 'connected' ? 'text-green-400' : 'text-desktop-muted'}`}>{status?.status === 'connected' ? '已连接' : '未连接'}</span>
        {status?.botInfo?.username && <span className="text-xs text-desktop-muted">({status.botInfo.username})</span>}
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-text hover:bg-white/15 disabled:opacity-50" disabled={connectLoading} onClick={async () => {
          setConnectLoading(true); setConnectError(null);
          try { const r = await api.qqConnect(); if (!r.ok) setConnectError(r.error ?? '连接失败'); loadStatus(); } catch (e) { setConnectError(e instanceof Error ? e.message : '连接失败'); } finally { setConnectLoading(false); }
        }}>{connectLoading ? '连接中…' : '连接'}</button>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50" onClick={async () => { await api.qqDisconnect(); loadStatus(); }}>断开</button>
      </div>
    </div>
  );
}

const WhatsAppSettingsStandalone = WhatsAppSettings;
const QQSettingsStandalone = QQSettings;
const TelegramSettingsStandalone = TelegramSettings;
const DiscordSettingsStandalone = DiscordSettings;
const SlackSettingsStandalone = SlackSettings;

// ── MCP 扩展配置 ─────────────────────────────────────────────────────────────

function McpSettings() {
  const userId = getUserId();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [configPath, setConfigPath] = useState('');
  const [fromEnv, setFromEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newTransport, setNewTransport] = useState<'http' | 'stdio'>('stdio');
  const [newServer, setNewServer] = useState<McpServerConfig>({ id: '', name: '' });
  const [headersJson, setHeadersJson] = useState('{}');
  const [argsJson, setArgsJson] = useState('["bing-cn-mcp"]');
  const [jsonImport, setJsonImport] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  /** 最近一次测试成功的服务器 id，用于在该行显示 testResult */
  const [lastTestedServerId, setLastTestedServerId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ servers: { id: string; toolsCount: number; error?: string }[]; totalTools: number } | null>(null);
  /** 每个服务器测试成功后缓存的工具列表（名称、描述、参数） */
  const [serverTools, setServerTools] = useState<Record<string, McpToolSchema[]>>({});
  /** 当前展开查看工具列表的服务器 id */
  const [expandedToolsServerId, setExpandedToolsServerId] = useState<string | null>(null);
  const [showCurrentJson, setShowCurrentJson] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<'ok' | 'fail' | null>(null);
  /** 当前编辑的服务器 id */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTransport, setEditTransport] = useState<'http' | 'stdio'>('stdio');
  const [editServer, setEditServer] = useState<McpServerConfig>({ id: '', name: '' });
  const [editHeadersJson, setEditHeadersJson] = useState('{}');
  const [editArgsJson, setEditArgsJson] = useState('["bing-cn-mcp"]');
  /** MCP 市场搜索：registry.modelcontextprotocol.io */
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [mcpSearchResults, setMcpSearchResults] = useState<Array<{ name: string; title?: string; description?: string; version?: string; websiteUrl?: string; config: { id: string; name?: string; url?: string; command?: string; args?: string[] } }>>([]);
  const [mcpSearching, setMcpSearching] = useState(false);
  const [mcpAddingId, setMcpAddingId] = useState<string | null>(null);

  /** 将当前 servers 转为 mcpServers 风格 JSON（便于查看与复制） */
  const currentConfigJson = (() => {
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const s of servers) {
      const entry: Record<string, unknown> = { id: s.id };
      if (s.name && s.name !== s.id) entry.name = s.name;
      if (s.url) entry.url = s.url;
      if (s.headers && Object.keys(s.headers).length > 0) entry.headers = s.headers;
      if (s.env && Object.keys(s.env).length > 0) entry.env = s.env;
      const sAny = s as unknown as Record<string, unknown>;
      if (sAny.type) entry.type = sAny.type;
      if (s.command) entry.command = s.command;
      if (s.args && s.args.length > 0) entry.args = s.args;
      mcpServers[s.id] = entry;
    }
    return JSON.stringify({ mcpServers }, null, 2);
  })();

  const handleCopyCurrentJson = useCallback(() => {
    navigator.clipboard.writeText(currentConfigJson).then(
      () => {
        setCopyFeedback('已复制');
        setTimeout(() => setCopyFeedback(null), 2000);
      },
      () => setCopyFeedback('复制失败'),
    );
  }, [currentConfigJson]);

  const loadConfig = useCallback(() => {
    const snapshot = getCloudConfigSnapshot();
    const raw = snapshot?.mcp_config;
    if (raw != null) {
      const list = normalizeMcpConfig(Array.isArray(raw) ? { servers: raw } : raw);
      if (list.length > 0) {
        setServers(list);
      }
    }
    setLoading(true);
    setError(null);
    Promise.all([api.mcpGetConfig(), api.mcpStatus()])
      .then(([config, st]) => {
        setServers(config.servers);
        setConfigPath(config.configPath);
        setFromEnv(config.fromEnv);
        setStatus(st);
      })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const saveServers = async (toSave: McpServerConfig[]) => {
    setSaveLoading(true);
    setError(null);
    setSaveMessage(null);
    try {
      await api.mcpSaveConfig({ servers: toSave });
      setServers(toSave);
      loadConfig();
      setSaveMessage('ok');
      setTimeout(() => setSaveMessage(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失败');
      setSaveMessage('fail');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTest = async (server: McpServerConfig) => {
    setTestingId(server.id);
    setTestResult(null);
    try {
      const res = await api.mcpTest(server);
      if (res.ok) {
        const list = res.tools ?? [];
        setServerTools((prev) => ({ ...prev, [server.id]: list }));
        setTestResult(`成功，发现 ${res.toolsCount ?? list.length} 个工具`);
        setLastTestedServerId(server.id);
        setExpandedToolsServerId(server.id);
      } else {
        setServerTools((prev) => {
          const next = { ...prev };
          delete next[server.id];
          return next;
        });
        setTestResult(`失败: ${res.error ?? '未知错误'}`);
        setLastTestedServerId(server.id);
      }
    } catch (e) {
      setServerTools((prev) => {
        const next = { ...prev };
        delete next[server.id];
        return next;
      });
      setTestResult(`失败: ${e instanceof Error ? e.message : '请求异常'}`);
      setLastTestedServerId(server.id);
    } finally {
      setTestingId(null);
    }
  };

  const handleAdd = () => {
    if (!newServer.id?.trim()) {
      setError('id 为必填');
      return;
    }
    if (servers.some((x) => x.id === newServer.id)) {
      setError(`id "${newServer.id}" 已存在`);
      return;
    }
    let s: McpServerConfig;
    if (newTransport === 'http') {
      let headers: Record<string, string> | undefined;
      try {
        const parsed = JSON.parse(headersJson || '{}');
        if (parsed && typeof parsed === 'object') {
          headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
        }
      } catch {
        setError('headers 格式无效，需为 JSON 对象');
        return;
      }
      if (!newServer.url?.trim()) {
        setError('URL 为必填');
        return;
      }
      s = { ...newServer, url: newServer.url, headers: headers && Object.keys(headers).length ? headers : undefined };
    } else {
      let args: string[];
      try {
        const parsed = JSON.parse(argsJson || '[]');
        args = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        setError('args 格式无效，需为 JSON 数组，如 ["bing-cn-mcp"]');
        return;
      }
      if (!newServer.command?.trim()) {
        setError('command 为必填，如 npx');
        return;
      }
      s = { ...newServer, command: newServer.command, args: args.length ? args : undefined };
    }
    const merged = [...servers, s];
    setServers(merged);
    setShowAdd(false);
    setEditingId(null);
    setNewServer({ id: '', name: '' });
    setHeadersJson('{}');
    setArgsJson('["bing-cn-mcp"]');
    setError(null);
    saveServers(merged);
  };

  const handleRemove = (id: string) => {
    const next = servers.filter((s) => s.id !== id);
    setServers(next);
    setEditingId(null);
    saveServers(next);
  };

  const handleStartEdit = (s: McpServerConfig) => {
    setShowAdd(false);
    setEditingId(s.id);
    setEditTransport(s.url ? 'http' : 'stdio');
    setEditServer({ ...s });
    setEditHeadersJson(JSON.stringify(s.headers ?? {}, null, 2));
    setEditArgsJson(JSON.stringify(s.args ?? ['bing-cn-mcp'], null, 2));
    setError(null);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    let s: McpServerConfig;
    if (editTransport === 'http') {
      let headers: Record<string, string> | undefined;
      try {
        const parsed = JSON.parse(editHeadersJson || '{}');
        if (parsed && typeof parsed === 'object') {
          headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
        }
      } catch {
        setError('headers 格式无效，需为 JSON 对象');
        return;
      }
      if (!editServer.url?.trim()) {
        setError('URL 为必填');
        return;
      }
      s = { ...editServer, id: editingId, url: editServer.url, headers: headers && Object.keys(headers).length ? headers : undefined };
    } else {
      let args: string[];
      try {
        const parsed = JSON.parse(editArgsJson || '[]');
        args = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        setError('args 格式无效，需为 JSON 数组');
        return;
      }
      if (!editServer.command?.trim()) {
        setError('command 为必填');
        return;
      }
      s = { ...editServer, id: editingId, command: editServer.command, args: args.length ? args : undefined };
    }
    const merged = servers.map((x) => (x.id === editingId ? s : x));
    setServers(merged);
    setEditingId(null);
    setError(null);
    saveServers(merged);
  };

  const handleImportJson = async () => {
    setImportMsg(null);
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonImport.trim());
    } catch {
      setError('JSON 格式无效');
      return;
    }
    const normalized = normalizeMcpConfig(parsed);
    if (normalized.length === 0) {
      setError('未解析到有效配置。支持格式：{ "servers": [...] } 或 { "mcpServers": { "id": { "url" 或 "command","args" } } }');
      return;
    }
    const merged = [...servers];
    for (const s of normalized) {
      if (!merged.some((x) => x.id === s.id)) merged.push(s);
    }
    setServers(merged);
    setJsonImport('');
    setImportMsg(`已导入 ${normalized.length} 个服务器，共 ${merged.length} 个`);
    // 已登录用户：导入后立即持久化到云端，避免刷新后丢失
    await saveServers(merged);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-desktop-text">MCP 扩展</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-desktop-accent/20 text-desktop-accent hover:bg-desktop-accent/30 transition-colors"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={12} />
            添加服务器
          </button>
          {saveLoading && <span className="text-xs text-desktop-muted flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />保存中…</span>}
          {saveMessage === 'ok' && <span className="text-xs text-green-400">已保存</span>}
          {saveMessage === 'fail' && <span className="text-xs text-amber-400/90">同步失败</span>}
        </div>
      </div>

      {fromEnv && (
        <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
          当前配置来自环境变量，保存将写入文件
        </div>
      )}

      {/* 搜索添加区域 */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="搜索 MCP 市场..."
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted outline-none focus:ring-1 focus:ring-desktop-accent"
          value={mcpSearchQuery}
          onChange={(e) => setMcpSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), api.mcpRegistrySearch(mcpSearchQuery, 8).then((r) => { if (r?.ok && r.servers) setMcpSearchResults(r.servers); else setMcpSearchResults([]); }).catch(() => setMcpSearchResults([])).finally(() => setMcpSearching(false)))}
        />
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-desktop-muted flex items-center gap-1.5"
          disabled={mcpSearching}
          onClick={async () => {
            setMcpSearching(true);
            try {
              const r = await api.mcpRegistrySearch(mcpSearchQuery || ' ', 8);
              if (r?.ok && r.servers) setMcpSearchResults(r.servers);
              else setMcpSearchResults([]);
            } catch {
              setMcpSearchResults([]);
            } finally {
              setMcpSearching(false);
            }
          }}
        >
          {mcpSearching ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
          搜索
        </button>
      </div>

      {/* 搜索结果 */}
      {mcpSearchResults.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {mcpSearchResults.map((s) => {
            const cfg = s.config;
            const already = servers.some((x) => x.id === cfg.id);
            return (
              <div key={s.name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-xs">
                <span className="text-desktop-text">{s.title ?? s.name}</span>
                {already ? (
                  <span className="text-[10px] text-green-400">已添加</span>
                ) : (
                  <button
                    type="button"
                    className="text-[10px] text-desktop-accent hover:underline"
                    disabled={mcpAddingId !== null}
                    onClick={async () => {
                      setMcpAddingId(cfg.id);
                      try {
                        const entry: McpServerConfig = { id: cfg.id, name: cfg.name ?? s.title ?? s.name, url: cfg.url, command: cfg.command, args: cfg.args };
                        await saveServers([...servers, entry]);
                        setMcpSearchResults((prev) => prev.filter((x) => x.config.id !== cfg.id));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : '添加失败');
                      } finally {
                        setMcpAddingId(null);
                      }
                    }}
                  >
                    {mcpAddingId === cfg.id ? '添加中…' : '添加'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {status && <div className="text-[11px] text-desktop-muted">已加载 {status.totalTools} 个工具</div>}

      {/* JSON配置区域 */}
      <details className="group">
        <summary className="text-xs text-desktop-muted cursor-pointer hover:text-desktop-text list-none flex items-center gap-1.5">
          <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
          查看/导入 JSON 配置
        </summary>
        <div className="mt-2 space-y-2">
          <textarea
            className="w-full h-16 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-desktop-text font-mono outline-none resize-y"
            value={jsonImport}
            onChange={(e) => { setJsonImport(e.target.value); setImportMsg(null); setError(null); }}
            placeholder='{"mcpServers":{"id":{"url":"https://..."}}}'
            spellCheck={false}
          />
          <button
            type="button"
            className="px-2.5 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
            onClick={handleImportJson}
          >
            导入
          </button>
          {importMsg && <span className="text-xs text-green-400/90">{importMsg}</span>}
        </div>
      </details>

      {loading ? (
        <div className="py-12 text-center text-xs text-desktop-muted">加载中...</div>
      ) : servers.length === 0 ? (
        <div className="py-6 rounded-xl bg-white/[0.02] border border-white/5 text-center text-xs text-desktop-muted">
          暂无 MCP 服务器。点击「添加服务器」开始配置。
        </div>
      ) : (
        <div className="space-y-2">
        <ul className="space-y-2">
          {servers.map((s) => {
            const tools = serverTools[s.id];
            const hasTools = tools && tools.length > 0;
            const isExpanded = expandedToolsServerId === s.id;
            const statusEntry = status?.servers.find((x) => x.id === s.id);
            return (
              <li
                key={s.id}
                className="rounded-lg bg-white/[0.03] border border-white/5 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 py-2.5 px-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-desktop-text truncate">{s.name || s.id}</div>
                    <div className="text-[11px] text-desktop-muted truncate">
                      {s.url ?? (s.command ? [s.command, ...(s.args ?? [])].join(' ') : '—')}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {statusEntry && (
                        <span className="text-[10px] text-desktop-muted">
                          {statusEntry.error
                            ? `错误: ${statusEntry.error}`
                            : `${statusEntry.toolsCount ?? 0} 个工具`}
                        </span>
                      )}
                      {testingId === s.id && <span className="text-[10px] text-desktop-muted">测试中…</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="p-1 rounded text-desktop-muted hover:bg-white/10 hover:text-desktop-text"
                      title="编辑"
                      onClick={() => handleStartEdit(s)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded text-desktop-muted hover:bg-red-500/20 hover:text-red-400"
                      title="删除"
                      onClick={() => handleRemove(s.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
            {editingId && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                <div className="text-xs font-medium text-desktop-text">编辑 MCP 服务器</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${editTransport === 'http' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                    onClick={() => setEditTransport('http')}
                  >
                    HTTP
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${editTransport === 'stdio' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                    onClick={() => setEditTransport('stdio')}
                  >
                    Stdio
                  </button>
                </div>
                <div className="grid gap-2 text-xs">
                  <div>
                    <label className="text-desktop-muted block mb-0.5">ID（不可修改）</label>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-muted outline-none"
                      value={editServer.id}
                      readOnly
                      disabled
                    />
                  </div>
                  {editTransport === 'http' ? (
                    <>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">URL（JSON-RPC 端点）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                          value={editServer.url ?? ''}
                          onChange={(e) => setEditServer({ ...editServer, url: e.target.value.trim() || undefined })}
                          placeholder="https://mcp.exa.ai/mcp"
                        />
                      </div>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">Headers（JSON，可选）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                          value={editHeadersJson}
                          onChange={(e) => setEditHeadersJson(e.target.value)}
                          placeholder='{"Authorization":"Bearer YOUR_KEY"}'
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">command（启动命令）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                          value={editServer.command ?? ''}
                          onChange={(e) => setEditServer({ ...editServer, command: e.target.value.trim() || undefined })}
                          placeholder="npx"
                        />
                      </div>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">args（JSON 数组）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                          value={editArgsJson}
                          onChange={(e) => setEditArgsJson(e.target.value)}
                          placeholder='["bing-cn-mcp"]'
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-desktop-muted block mb-0.5">名称（可选）</label>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                      value={editServer.name ?? ''}
                      onChange={(e) => setEditServer({ ...editServer, name: e.target.value || undefined })}
                      placeholder="Bing CN 搜索"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80"
                    onClick={handleSaveEdit}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
                    onClick={() => { setEditingId(null); setError(null); }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {showAdd && (
              <div className="rounded-xl border border-desktop-accent/30 bg-desktop-accent/5 p-4 space-y-3">
                <div className="text-xs font-medium text-desktop-text">添加 MCP 服务器</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${newTransport === 'http' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                    onClick={() => setNewTransport('http')}
                  >
                    HTTP
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${newTransport === 'stdio' ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/10 text-desktop-muted hover:bg-white/20'}`}
                    onClick={() => setNewTransport('stdio')}
                  >
                    Stdio
                  </button>
                </div>
                <div className="grid gap-2 text-xs">
                  <div>
                    <label className="text-desktop-muted block mb-0.5">ID（唯一标识）</label>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                      value={newServer.id}
                      onChange={(e) => setNewServer({ ...newServer, id: e.target.value.trim() })}
                      placeholder="e.g. bingcn"
                    />
                  </div>
                  {newTransport === 'http' ? (
                    <>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">URL（JSON-RPC 端点）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                          value={newServer.url ?? ''}
                          onChange={(e) => setNewServer({ ...newServer, url: e.target.value.trim() || undefined })}
                          placeholder="https://mcp.exa.ai/mcp"
                        />
                      </div>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">Headers（JSON，可选）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                          value={headersJson}
                          onChange={(e) => setHeadersJson(e.target.value)}
                          placeholder='{"Authorization":"Bearer YOUR_KEY"}'
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">command（启动命令）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                          value={newServer.command ?? ''}
                          onChange={(e) => setNewServer({ ...newServer, command: e.target.value.trim() || undefined })}
                          placeholder="npx"
                        />
                      </div>
                      <div>
                        <label className="text-desktop-muted block mb-0.5">args（JSON 数组）</label>
                        <input
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text font-mono outline-none"
                          value={argsJson}
                          onChange={(e) => setArgsJson(e.target.value)}
                          placeholder='["bing-cn-mcp"]'
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-desktop-muted block mb-0.5">名称（可选）</label>
                    <input
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-desktop-text outline-none"
                      value={newServer.name ?? ''}
                      onChange={(e) => setNewServer({ ...newServer, name: e.target.value || undefined })}
                      placeholder="Bing CN 搜索"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80"
                    onClick={handleAdd}
                  >
                    添加
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20"
                    onClick={() => { setShowAdd(false); setError(null); }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {error && <div className="text-xs text-red-400/90">{error}</div>}
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/5">
      <div>
        <div className="text-xs font-medium text-desktop-text">{label}</div>
        <div className="text-[11px] text-desktop-muted mt-0.5">{description}</div>
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({ defaultOn = false, value, onToggle }: { defaultOn?: boolean; value?: boolean; onToggle?: (on: boolean) => void }) {
  const [internalOn, setInternalOn] = useState(defaultOn);
  const isControlled = value !== undefined;
  const on = isControlled ? value : internalOn;
  const handleClick = () => {
    const next = !on;
    if (!isControlled) setInternalOn(next);
    onToggle?.(next);
  };
  return (
    <button
      type="button"
      className={`relative w-10 h-5 rounded-full transition-colors ${on ? 'bg-green-500/40' : 'bg-white/10'}`}
      onClick={handleClick}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
          on ? 'left-5.5 bg-green-400' : 'left-0.5 bg-desktop-muted'
        }`}
        style={{ left: on ? 22 : 2 }}
      />
    </button>
  );
}

// ── 应用管理 ─────────────────────────────────────────────────────────────

const EXAMPLE_ALIAS_MANIFEST = {
  id: 'com.example.quick-terminal',
  name: '快捷终端',
  description: '快速打开终端的快捷方式',
  source: 'installed' as const,
  icon: 'Terminal',
  aliasBuiltin: 'terminal' as const,
};

function AppManagementSettings() {
  const [installed, setInstalled] = useState(() => getInstalledApps());
  const [manifestJson, setManifestJson] = useState('');
  const [installError, setInstallError] = useState<string | null>(null);
  const [installSuccess, setInstallSuccess] = useState(false);

  const refreshInstalled = () => setInstalled(getInstalledApps());

  const handleInstall = () => {
    setInstallError(null);
    setInstallSuccess(false);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestJson.trim());
    } catch {
      setInstallError('JSON 格式无效');
      return;
    }
    if (!manifest || typeof manifest !== 'object' || !('id' in manifest) || !('name' in manifest)) {
      setInstallError('缺少 id 或 name 字段');
      return;
    }
    const m = manifest as AppManifest;
    if (m.source !== 'installed') {
      setInstallError('source 必须为 "installed"');
      return;
    }
    const result = installApp(m);
    if (result.ok) {
      setInstallSuccess(true);
      setManifestJson('');
      refreshInstalled();
    } else {
      setInstallError(result.error ?? '安装失败');
    }
  };

  const handleInstallExample = () => {
    setInstallError(null);
    setInstallSuccess(false);
    const result = installApp(EXAMPLE_ALIAS_MANIFEST);
    if (result.ok) {
      setInstallSuccess(true);
      refreshInstalled();
    } else {
      setInstallError(result.error ?? '安装失败');
    }
  };

  const handleUninstall = (id: string) => {
    const result = uninstallApp(id);
    if (result.ok) refreshInstalled();
  };

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-desktop-text">应用管理</h3>

      <div>
        <div className="text-xs font-medium text-desktop-muted mb-2">内置应用</div>
        <p className="text-[11px] text-desktop-muted mb-2">
          以下为系统预装应用；标注「演示」的为占位功能，数据不持久或未对接真实服务。
        </p>
        <ul className="space-y-1.5 mb-4">
          {BUILTIN_MANIFESTS.map((app) => (
            <li key={app.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded text-xs text-desktop-text">
              <span>{app.name}</span>
              {app.availability === 'demo' ? (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400/90 text-[10px]">演示</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-white/10 text-desktop-muted text-[10px]">可用</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-xs font-medium text-desktop-muted mb-2">已安装应用</div>
        <p className="text-[11px] text-desktop-muted mb-3">
          以下为通过「安装应用」添加的应用，可与内置应用一起在桌面、任务栏和搜索中使用。
        </p>
        {installed.length === 0 ? (
          <div className="py-6 rounded-xl bg-white/[0.02] border border-white/5 text-center text-xs text-desktop-muted">
            暂无已安装应用。可在下方粘贴清单 JSON 安装，或添加示例快捷方式。
          </div>
        ) : (
          <ul className="space-y-2">
            {installed.map((app) => (
              <li
                key={app.id}
                className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-white/[0.03] border border-white/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-desktop-text truncate">{app.name}</div>
                  <div className="text-[11px] text-desktop-muted truncate">{app.description ?? app.id}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 px-2.5 py-1 rounded text-xs text-red-400/90 hover:bg-red-500/20 transition-colors"
                  onClick={() => handleUninstall(app.id)}
                >
                  卸载
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-desktop-muted mb-2">安装应用</div>
        <p className="text-[11px] text-desktop-muted mb-2">
          粘贴符合规范的 AppManifest JSON（<code className="text-desktop-text/70">source: &quot;installed&quot;</code>，可选
          <code className="text-desktop-text/70 ml-1">aliasBuiltin</code> 指向内置应用作为快捷方式）。
        </p>
        <textarea
          className="w-full h-28 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text font-mono outline-none focus:ring-1 focus:ring-desktop-highlight/50 resize-y"
          value={manifestJson}
          onChange={(e) => { setManifestJson(e.target.value); setInstallError(null); }}
          placeholder='{"id":"com.myapp.shortcut","name":"我的应用","source":"installed","icon":"Terminal","aliasBuiltin":"terminal"}'
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80 transition-colors"
            onClick={handleInstall}
          >
            安装
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-xs bg-white/10 text-desktop-muted hover:bg-white/20 transition-colors"
            onClick={handleInstallExample}
          >
            添加示例：快捷终端
          </button>
        </div>
        {installError && <p className="mt-1.5 text-xs text-red-400/90">{installError}</p>}
        {installSuccess && <p className="mt-1.5 text-xs text-green-400/90">安装成功，已出现在桌面与搜索中。</p>}
      </div>
    </div>
  );
}

function ServerManagementSettings() {
  const [servers, setServers] = useState<Array<{
    serverId: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'privateKey';
    description?: string;
    tags?: string[];
    createdAt: string;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password' as 'password' | 'privateKey',
    password: '',
    privateKey: '',
    passphrase: '',
    description: '',
    tags: '',
  });

  const loadServers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.listServers();
      setServers(result.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const resetForm = () => {
    setFormData({
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKey: '',
      passphrase: '',
      description: '',
      tags: '',
    });
    setEditingServer(null);
  };

  const handleEdit = (server: typeof servers[0]) => {
    setEditingServer(server.serverId);
    setFormData({
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      password: '',
      privateKey: '',
      passphrase: '',
      description: server.description || '',
      tags: server.tags?.join(', ') || '',
    });
    setShowAddDialog(true);
  };

  const handleAdd = async () => {
    try {
      setError(null);
      const tags = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      await api.addServer({
        name: formData.name,
        host: formData.host,
        port: formData.port,
        username: formData.username,
        authType: formData.authType,
        password: formData.authType === 'password' ? formData.password : undefined,
        privateKey: formData.authType === 'privateKey' ? formData.privateKey : undefined,
        passphrase: formData.passphrase || undefined,
        description: formData.description || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      setShowAddDialog(false);
      resetForm();
      loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    }
  };

  const handleUpdate = async () => {
    if (!editingServer) return;
    try {
      setError(null);
      const tags = formData.tags.split(',').map(t => t.trim()).filter(Boolean);
      const updates: any = {
        name: formData.name,
        host: formData.host,
        port: formData.port,
        username: formData.username,
        authType: formData.authType,
        description: formData.description || undefined,
        tags: tags.length > 0 ? tags : undefined,
      };
      
      // 只有在填写了新密码/私钥时才更新
      if (formData.authType === 'password' && formData.password) {
        updates.password = formData.password;
      }
      if (formData.authType === 'privateKey' && formData.privateKey) {
        updates.privateKey = formData.privateKey;
        if (formData.passphrase) {
          updates.passphrase = formData.passphrase;
        }
      }

      await api.updateServer(editingServer, updates);
      setShowAddDialog(false);
      resetForm();
      loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    }
  };

  const handleDelete = async (serverId: string) => {
    if (!confirm('确定要删除这个服务器吗？')) return;
    try {
      setError(null);
      await api.deleteServer(serverId);
      loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleTest = async (serverId: string) => {
    try {
      setTestingServer(serverId);
      setError(null);
      const result = await api.testServerConnection(serverId);
      if (result.success) {
        alert(`连接成功！耗时 ${result.duration}ms`);
      } else {
        alert(`连接失败：${result.message}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTestingServer(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-desktop-text">服务器管理</h3>
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg text-xs bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80 transition-colors flex items-center gap-1.5"
          onClick={() => setShowAddDialog(true)}
        >
          <Plus className="w-3.5 h-3.5" />
          添加服务器
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-desktop-muted">加载中...</div>
      ) : servers.length === 0 ? (
        <div className="py-12 rounded-xl bg-white/[0.02] border border-white/5 text-center">
          <Server className="w-8 h-8 mx-auto mb-3 text-desktop-muted/50" />
          <div className="text-xs text-desktop-muted mb-2">暂无服务器</div>
          <div className="text-[11px] text-desktop-muted/70">点击右上角「添加服务器」开始</div>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.serverId}
              className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium text-desktop-text">{server.name}</h4>
                    {server.tags && server.tags.length > 0 && (
                      <div className="flex gap-1">
                        {server.tags.map((tag, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-desktop-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-desktop-muted space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Globe className="w-3 h-3" />
                      <span>{server.host}:{server.port}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="w-3 h-3" />
                      <span>{server.username}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5">
                        {server.authType === 'password' ? '密码' : '密钥'}
                      </span>
                    </div>
                    {server.description && (
                      <div className="text-[11px] text-desktop-muted/70 mt-1">{server.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-white/10 transition-colors text-desktop-muted hover:text-desktop-text"
                    onClick={() => handleTest(server.serverId)}
                    disabled={testingServer === server.serverId}
                    title="测试连接"
                  >
                    {testingServer === server.serverId ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <TestTube className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-white/10 transition-colors text-desktop-muted hover:text-desktop-text"
                    onClick={() => handleEdit(server)}
                    title="编辑"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-white/10 transition-colors text-desktop-muted hover:text-desktop-text"
                    onClick={() => handleDelete(server.serverId)}
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-desktop-muted/50">
                添加于 {new Date(server.createdAt).toLocaleString('zh-CN', { timeZone: DISPLAY_TIMEZONE })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 bg-[#1a1a1a] rounded-2xl border border-white/10 shadow-2xl">
            <div className="px-6 py-4 border-b border-white/10">
              <h3 className="text-sm font-medium text-desktop-text">
                {editingServer ? '编辑服务器' : '添加服务器'}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs text-desktop-muted mb-1.5">服务器名称 *</label>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="生产服务器"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-desktop-muted mb-1.5">主机地址 *</label>
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                    value={formData.host}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-desktop-muted mb-1.5">端口</label>
                  <input
                    type="number"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 22 })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-desktop-muted mb-1.5">用户名 *</label>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="root"
                />
              </div>
              <div>
                <label className="block text-xs text-desktop-muted mb-1.5">认证方式 *</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                  value={formData.authType}
                  onChange={(e) => setFormData({ ...formData, authType: e.target.value as 'password' | 'privateKey' })}
                >
                  <option value="password">密码认证</option>
                  <option value="privateKey">密钥认证（推荐）</option>
                </select>
              </div>
              {formData.authType === 'password' ? (
                <div>
                  <label className="block text-xs text-desktop-muted mb-1.5">
                    密码 {editingServer ? '（留空则不修改）' : '*'}
                  </label>
                  <input
                    type="password"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder={editingServer ? '留空则不修改' : ''}
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-desktop-muted mb-1.5">
                      私钥 {editingServer ? '（留空则不修改）' : '*'}
                    </label>
                    <textarea
                      className="w-full h-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text font-mono outline-none focus:ring-1 focus:ring-desktop-highlight/50 resize-y"
                      value={formData.privateKey}
                      onChange={(e) => setFormData({ ...formData, privateKey: e.target.value })}
                      placeholder={editingServer ? '留空则不修改' : "-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-desktop-muted mb-1.5">私钥密码（可选）</label>
                    <input
                      type="password"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                      value={formData.passphrase}
                      onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs text-desktop-muted mb-1.5">描述（可选）</label>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="主要 Web 服务器"
                />
              </div>
              <div>
                <label className="block text-xs text-desktop-muted mb-1.5">标签（可选，逗号分隔）</label>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="生产, Web, 前端"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-xs text-desktop-muted hover:bg-white/10 transition-colors"
                onClick={() => {
                  setShowAddDialog(false);
                  resetForm();
                  setError(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-xs bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80 transition-colors"
                onClick={editingServer ? handleUpdate : handleAdd}
              >
                {editingServer ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
