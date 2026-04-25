import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Shield, Zap, Monitor, Bot, Info, Plus, Trash2, Key, Package, FileText, ChevronDown, ChevronRight, RefreshCw, Plug, Globe, Terminal, Copy, ChevronUp, Sparkles, Music2, User, Mail, MessageSquare, Pencil, Search, Server, Edit, TestTube, CreditCard, ExternalLink, Wrench, CheckCircle, ToggleRight, BarChart2, Webhook as WebhookIcon, Clock, Activity, Link, Users, ShieldAlert, Bell, Send, Brain, Keyboard, Code } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTranslation } from 'react-i18next';
import { useDesktopStore } from '@/store/desktopStore';
import { useLLMConfigStore } from '@/store/llmConfigStore';
import { useAdminStore } from '@/store/adminStore';
import type { LLMModality, ToolDefinition } from '@shared/index';
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

type SettingsTab = 'general' | 'account' | 'profile' | 'apps' | 'about' | 'ai' | 'models' | 'mcp' | 'skills' | 'shortcuts' | 'tools' | 'media' | 'channels' | 'security' | 'servers' | 'logs' | 'flags' | 'usage' | 'webhooks' | 'schedules' | 'health' | 'hooks' | 'council' | 'auditlog' | 'templates' | 'announcements' | 'systemprompts' | 'snippets';

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

/** X 主脑主动心跳设置：配置定时主动检查和通知 */
function NotificationPreferencesSettings() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState({
    inApp: true,
    email: false,
    taskEvents: true,
    approval: true,
    heartbeat: true,
    heartbeatDaily: true,
    webhook: true,
    system: true,
    skill: true,
    quietHoursEnabled: false,
    quietHoursStart: null as string | null,
    quietHoursEnd: null as string | null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.notificationPreferencesGet().then((p) => {
      setPrefs(p);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.notificationPreferencesUpdate(prefs);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const set = (key: keyof typeof prefs, value: typeof prefs[keyof typeof prefs]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  if (loading) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-desktop-text">{t('settings.notificationPreferences', '通知偏好')}</h3>
      </div>

      {/* 通知渠道 */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-desktop-muted/60 uppercase tracking-wide">{t('settings.notificationChannels', '通知渠道')}</div>
        <SettingRow label={t('settings.inAppNotifications', '应用内通知')} description={t('settings.inAppNotificationsDesc', '在 X 主脑内显示通知')}>
          <ToggleSwitch value={prefs.inApp} onToggle={(v) => set('inApp', v)} />
        </SettingRow>
        <SettingRow label={t('settings.emailNotifications', '邮件通知')} description={t('settings.emailNotificationsDesc', '接收邮件通知')}>
          <ToggleSwitch value={prefs.email} onToggle={(v) => set('email', v)} />
        </SettingRow>
      </div>

      {/* 通知类型 */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-desktop-muted/60 uppercase tracking-wide">{t('settings.notificationTypes', '通知类型')}</div>
        <SettingRow label={t('settings.taskEvents', '任务事件')} description={t('settings.taskEventsDesc', '任务完成/失败时通知')}>
          <ToggleSwitch value={prefs.taskEvents} onToggle={(v) => set('taskEvents', v)} />
        </SettingRow>
        <SettingRow label={t('settings.approvalRequests', '审批请求')} description={t('settings.approvalRequestsDesc', '高风险操作需审批时通知')}>
          <ToggleSwitch value={prefs.approval} onToggle={(v) => set('approval', v)} />
        </SettingRow>
        <SettingRow label={t('settings.heartbeatAlerts', '心跳告警')} description={t('settings.heartbeatAlertsDesc', '配额告警、任务异常等')}>
          <ToggleSwitch value={prefs.heartbeat} onToggle={(v) => set('heartbeat', v)} />
        </SettingRow>
        <SettingRow label={t('settings.dailySummary', '每日摘要')} description={t('settings.dailySummaryDesc', '每日任务汇总通知')}>
          <ToggleSwitch value={prefs.heartbeatDaily} onToggle={(v) => set('heartbeatDaily', v)} />
        </SettingRow>
        <SettingRow label={t('settings.webhookTriggers', 'Webhook 触发')} description={t('settings.webhookTriggersDesc', 'Webhook 触发任务时通知')}>
          <ToggleSwitch value={prefs.webhook} onToggle={(v) => set('webhook', v)} />
        </SettingRow>
        <SettingRow label={t('settings.systemAnnouncements', '系统公告')} description={t('settings.systemAnnouncementsDesc', '系统更新、维护公告')}>
          <ToggleSwitch value={prefs.system} onToggle={(v) => set('system', v)} />
        </SettingRow>
        <SettingRow label={t('settings.skillsUpdates', 'Skills 更新')} description={t('settings.skillsUpdatesDesc', 'Skills 新版本或可用更新')}>
          <ToggleSwitch value={prefs.skill} onToggle={(v) => set('skill', v)} />
        </SettingRow>
      </div>

      {/* 免打扰时间 */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-desktop-muted/60 uppercase tracking-wide">{t('settings.quietHours', '免打扰时间')}</div>
        <SettingRow label={t('settings.enableQuietHours', '启用免打扰')} description={t('settings.enableQuietHoursDesc', '在指定时间段内静默所有通知')}>
          <ToggleSwitch value={prefs.quietHoursEnabled} onToggle={(v) => set('quietHoursEnabled', v)} />
        </SettingRow>
        {prefs.quietHoursEnabled && (
          <div className="flex items-center gap-2 pl-4">
            <input
              type="time"
              value={prefs.quietHoursStart ?? '22:00'}
              onChange={(e) => set('quietHoursStart', e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none"
            />
            <span className="text-desktop-muted text-xs">—</span>
            <input
              type="time"
              value={prefs.quietHoursEnd ?? '08:00'}
              onChange={(e) => set('quietHoursEnd', e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-desktop-text outline-none"
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 disabled:opacity-50 text-xs text-desktop-text transition-colors"
      >
        {saving ? t('settings.saving', '保存中…') : saved ? t('settings.saved', '已保存 ✓') : t('settings.save', '保存设置')}
      </button>
    </div>
  );
}

/** 用户资料设置：昵称、个人简介、时区、语言 */
function ProfileSettings() {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [timezone, setTimezone] = useState('');
  const [language, setLanguage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getUserProfile().then((p) => {
      setDisplayName(p.displayName ?? '');
      setBio(p.bio ?? '');
      setTimezone(p.timezone ?? '');
      setLanguage(p.language ?? '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await api.updateUserProfile({
        displayName: displayName.trim(),
        bio: bio.trim() || null,
        timezone: timezone.trim() || null,
        language: language.trim() || null,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const TIMEZONES = [
    'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul',
    'America/New_York', 'America/Los_Angeles', 'America/Chicago',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'Asia/Singapore', 'Australia/Sydney',
  ];
  const LANGUAGES = [
    { value: 'zh-CN', label: '简体中文' },
    { value: 'zh-TW', label: '繁體中文' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
  ];

  if (loading) {
    return <div className="text-xs text-desktop-muted">{t('common.loading', '加载中...')}</div>;
  }

  return (
    <div className="space-y-6 max-w-lg">
      <h3 className="text-sm font-medium text-desktop-text">{t('settings.profile', '个人资料')}</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-desktop-muted mb-1">{t('settings.displayName', '昵称')}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
            placeholder={t('settings.displayNamePlaceholder', '给自己起个名字')}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted/40 outline-none focus:border-desktop-accent/50"
          />
        </div>

        <div>
          <label className="block text-xs text-desktop-muted mb-1">
            {t('settings.bio', '个人简介')}
            <span className="ml-1 text-desktop-muted/40">({bio.length}/500)</span>
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 500))}
            rows={3}
            placeholder={t('settings.bioPlaceholder', '告诉 AI 你的一些基本情况，帮助它更好地帮助你')}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text placeholder:text-desktop-muted/40 outline-none focus:border-desktop-accent/50 resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-desktop-muted mb-1">{t('settings.timezone', '时区')}</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:border-desktop-accent/50"
          >
            <option value="">—</option>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-desktop-muted mb-1">{t('settings.language', '界面语言')}</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none focus:border-desktop-accent/50"
          >
            <option value="">—</option>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
      )}
      {success && (
        <div className="text-xs text-green-400 bg-green-500/10 rounded-lg px-3 py-2">{t('settings.saved', '已保存')}</div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 rounded-lg text-xs bg-desktop-accent hover:bg-desktop-accent/80 text-white transition-colors disabled:opacity-50"
      >
        {saving ? t('common.saving', '保存中...') : t('common.save', '保存')}
      </button>
    </div>
  );
}

function HeartbeatSettings() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [quotaThreshold, setQuotaThreshold] = useState(0.8);
  const [taskAlert, setTaskAlert] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.heartbeatGetConfig().then((cfg) => {
      setEnabled(cfg.enabled);
      setIntervalMinutes(cfg.intervalMinutes);
      setQuotaThreshold(cfg.quotaAlertThreshold);
      setTaskAlert(cfg.taskAlertEnabled);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      await api.heartbeatSetConfig({
        enabled,
        intervalMinutes,
        quotaAlertThreshold: quotaThreshold,
        taskAlertEnabled: taskAlert,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-desktop-text">{t('settings.heartbeatTitle', 'X 主脑主动通知')}</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-desktop-accent/20 text-desktop-muted">Beta</span>
      </div>
      <p className="text-[11px] text-desktop-muted leading-relaxed">
        {t('settings.heartbeatDescription', 'X 主脑会定期主动检查你的使用情况，并在必要时提醒你。')}
      </p>

      <SettingRow label={t('settings.heartbeatEnabled', '启用心跳通知')} description={t('settings.heartbeatEnabledDesc', '关闭后不再收到 X 主脑的主动提醒')}>
        <ToggleSwitch value={enabled} onToggle={(v) => setEnabled(v)} />
      </SettingRow>

      {enabled && (
        <>
          <SettingRow label={t('settings.heartbeatInterval', '检查间隔')} description={t('settings.heartbeatIntervalDesc', '多久检查一次使用情况')}>
            <select
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-desktop-text outline-none"
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            >
              <option value={15}>15 {t('settings.minutes', '分钟')}</option>
              <option value={30}>30 {t('settings.minutes', '分钟')}</option>
              <option value={60}>1 {t('settings.hour', '小时')}</option>
              <option value={120}>2 {t('settings.hours', '小时')}</option>
              <option value={360}>6 {t('settings.hours', '小时')}</option>
              <option value={720}>12 {t('settings.hours', '小时')}</option>
              <option value={1440}>24 {t('settings.hours', '小时')}</option>
            </select>
          </SettingRow>

          <SettingRow label={t('settings.heartbeatQuotaThreshold', '配额告警阈值')} description={t('settings.heartbeatQuotaThresholdDesc', '配额使用超过此比例时提醒')}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={50}
                max={100}
                value={Math.round(quotaThreshold * 100)}
                onChange={(e) => setQuotaThreshold(Number(e.target.value) / 100)}
                className="w-24 accent-desktop-accent"
              />
              <span className="text-xs text-desktop-muted w-10">{Math.round(quotaThreshold * 100)}%</span>
            </div>
          </SettingRow>

          <SettingRow label={t('settings.heartbeatTaskAlert', '任务状态提醒')} description={t('settings.heartbeatTaskAlertDesc', '任务长时间运行或失败时提醒')}>
            <ToggleSwitch value={taskAlert} onToggle={(v) => setTaskAlert(v)} />
          </SettingRow>
        </>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={loading}
        className="px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 disabled:opacity-50 text-xs text-desktop-text transition-colors"
      >
        {loading ? t('settings.saving', '保存中…') : saved ? t('settings.saved', '已保存 ✓') : t('settings.save', '保存设置')}
      </button>
    </div>
  );
}

function ShortcutsSettings() {
  const { t } = useTranslation();
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const SHORTCUTS_STORAGE_KEY = 'x-computer-shortcuts';

  useEffect(() => {
    api.getUserConfig().then((cfg) => {
      const sc = cfg['shortcuts'];
      if (sc && typeof sc === 'object') {
        setShortcuts(sc as Record<string, string>);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const DEFAULTS: Record<string, string> = {
    searchLauncher: '⌘K',
    lockScreen: '⌘L',
    closeWindow: '⌘W',
    minimizeWindow: '⌘M',
    maximizeWindow: '⌘⇧F',
    focusWindow1: '⌘1',
    focusWindow2: '⌘2',
    focusWindow3: '⌘3',
    focusWindow4: '⌘4',
    focusWindow5: '⌘5',
    focusWindow6: '⌘6',
    focusWindow7: '⌘7',
    focusWindow8: '⌘8',
    focusWindow9: '⌘9',
    openTerminal: '⌘T',
    openChat: '⌘N',
  };

  const ACTIONS: Array<{ key: string; labelKey: string }> = [
    { key: 'searchLauncher', labelKey: 'settings.shortcutSearchLauncher' },
    { key: 'openChat', labelKey: 'settings.shortcutOpenChat' },
    { key: 'newChat', labelKey: 'settings.shortcutNewChat' },
    { key: 'stopGenerating', labelKey: 'settings.shortcutStopGenerating' },
    { key: 'toggleSidebar', labelKey: 'settings.shortcutToggleSidebar' },
    { key: 'openTerminal', labelKey: 'settings.shortcutOpenTerminal' },
    { key: 'lockScreen', labelKey: 'settings.shortcutLockScreen' },
    { key: 'closeWindow', labelKey: 'settings.shortcutCloseWindow' },
    { key: 'minimizeWindow', labelKey: 'settings.shortcutMinimizeWindow' },
    { key: 'maximizeWindow', labelKey: 'settings.shortcutMaximizeWindow' },
    { key: 'focusWindow1', labelKey: 'settings.shortcutFocusWindow1' },
    { key: 'focusWindow2', labelKey: 'settings.shortcutFocusWindow2' },
    { key: 'focusWindow3', labelKey: 'settings.shortcutFocusWindow3' },
    { key: 'focusWindow4', labelKey: 'settings.shortcutFocusWindow4' },
    { key: 'focusWindow5', labelKey: 'settings.shortcutFocusWindow5' },
    { key: 'focusWindow6', labelKey: 'settings.shortcutFocusWindow6' },
    { key: 'focusWindow7', labelKey: 'settings.shortcutFocusWindow7' },
    { key: 'focusWindow8', labelKey: 'settings.shortcutFocusWindow8' },
    { key: 'focusWindow9', labelKey: 'settings.shortcutFocusWindow9' },
  ];

  const formatShortcut = (action: string, value: string): string => {
    if (!value) return t('settings.shortcutDefault', DEFAULTS[action] || '—');
    return value;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, action: string) => {
    e.preventDefault();
    if (!recordingAction) return;

    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push('⌘');
    if (e.altKey) parts.push('⌥');
    if (e.shiftKey) parts.push('⇧');
    const key = e.key;
    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key);
    }

    if (parts.length === 0 || (parts.length === 1 && ['Meta', 'Control', 'Alt', 'Shift'].includes(key))) return;

    const shortcut = parts.join('');
    const existing = Object.entries(shortcuts).find(([a, v]) => a !== action && v === shortcut && DEFAULTS[a] !== shortcut);
    if (existing) {
      setConflict(t('settings.shortcutConflict'));
      setTimeout(() => setConflict(null), 2000);
      return;
    }

    const updated = { ...shortcuts, [action]: shortcut };
    setShortcuts(updated);
    setRecordingAction(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to server user config for cross-device sync
      await api.setUserConfig({ shortcuts });
      // Save to localStorage so the keyboard shortcut hook picks up changes immediately
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  // Sync shortcuts to localStorage on every change so the hook picks them up immediately
  useEffect(() => {
    if (!loading) {
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));
    }
  }, [shortcuts, loading]);

  const handleReset = (action: string) => {
    const updated = { ...shortcuts };
    delete updated[action];
    setShortcuts(updated);
  };

  const handleResetAll = () => {
    setShortcuts({});
  };

  if (loading) {
    return <div className="text-xs text-desktop-muted p-4">{t('common.loading', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-desktop-text">{t('settings.shortcuts')}</h3>
          <p className="text-[11px] text-desktop-muted mt-1">{t('settings.shortcutsDesc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetAll}
            className="text-[11px] px-2 py-1 rounded text-desktop-muted hover:text-desktop-text hover:bg-white/5 transition-colors"
          >
            {t('settings.shortcutResetAll')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-[11px] px-3 py-1 rounded bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80 transition-colors disabled:opacity-50"
          >
            {saved ? t('settings.shortcutSaved') : saving ? t('settings.testing', '…') : t('common.save', 'Save')}
          </button>
        </div>
      </div>

      {conflict && (
        <div className="text-[11px] px-3 py-2 rounded bg-red-500/20 text-red-400">{conflict}</div>
      )}

      <div className="space-y-1">
        {ACTIONS.map(({ key, labelKey }) => {
          const current = shortcuts[key];
          const isDefault = !current;
          const displayValue = current || DEFAULTS[key] || '—';
          const isRecording = recordingAction === key;

          return (
            <div key={key} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/5 group">
              <span className="text-xs text-desktop-muted w-48 shrink-0">{t(labelKey)}</span>

              <div className="flex items-center gap-1.5 flex-1">
                <div
                  tabIndex={0}
                  onClick={() => setRecordingAction(isRecording ? null : key)}
                  onKeyDown={(e) => { if (isRecording) handleKeyDown(e, key); }}
                  className={`text-xs px-2 py-1 rounded border cursor-pointer select-none min-w-[80px] text-center transition-colors ${
                    isRecording
                      ? 'border-desktop-accent bg-desktop-accent/20 text-desktop-accent'
                      : isDefault
                      ? 'border-white/10 text-desktop-muted'
                      : 'border-white/20 text-desktop-text bg-desktop-accent/10'
                  }`}
                >
                  {isRecording ? t('settings.shortcutRecord') : formatShortcut(key, current ?? '')}
                </div>

                {isRecording && (
                  <button
                    type="button"
                    onClick={() => {
                      const updated = { ...shortcuts, [key]: '' };
                      setShortcuts(updated);
                      setRecordingAction(null);
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded text-desktop-muted hover:text-desktop-text hover:bg-white/10"
                    title={t('settings.shortcutClear')}
                  >
                    ✕
                  </button>
                )}

                {!isDefault && (
                  <button
                    type="button"
                    onClick={() => handleReset(key)}
                    className="text-[10px] px-1.5 py-0.5 rounded text-desktop-muted hover:text-desktop-text hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t('settings.shortcutReset')}
                  >
                    ↩
                  </button>
                )}
              </div>

              {!isDefault && (
                <span className="text-[10px] text-desktop-accent/60">{t('settings.shortcutCustom')}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScheduledJobsSettings() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<Array<{
    id: string; userId: string; name: string; intent: string;
    cron: string | null; enabled: boolean; nextRun: number; createdAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', intent: '', cron: '' });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.scheduledJobsList();
      setJobs(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleCreate = async () => {
    if (!createForm.intent) return;
    setCreating(true);
    try {
      const result = await api.scheduledJobsCreate({
        name: createForm.name || undefined,
        intent: createForm.intent,
        cron: createForm.cron || undefined,
      });
      setJobs((prev) => [result, ...prev]);
      setShowCreate(false);
      setCreateForm({ name: '', intent: '', cron: '' });
    } catch { /* ignore */ }
    finally { setCreating(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此定时任务？')) return;
    setDeleting(id);
    try {
      await api.scheduledJobsDelete(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch { /* ignore */ }
    finally { setDeleting(null); }
  };

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    setToggling(id);
    try {
      const result = await api.scheduledJobsToggle(id);
      setJobs((prev) => prev.map((j) => j.id === id ? { ...j, enabled: result.enabled } : j));
    } catch { /* ignore */ }
    finally { setToggling(null); }
  };

  const formatNextRun = (nextRun: number) => {
    const d = new Date(nextRun);
    const now = Date.now();
    if (nextRun < now) return t('settings.overdue', '已超时');
    const diff = nextRun - now;
    if (diff < 60000) return t('settings.soon', '即将执行');
    if (diff < 3600000) return `${Math.floor(diff / 60000)}${t('settings.minutesLater', '分钟后')}`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}${t('settings.hoursLater', '小时后')}`;
    return d.toLocaleDateString();
  };

  const CRON_PRESETS = [
    { label: t('settings.every5min', '每5分钟'), value: '*/5 * * * *' },
    { label: t('settings.hourly', '每小时'), value: '0 * * * *' },
    { label: t('settings.daily', '每天'), value: '0 9 * * *' },
    { label: t('settings.weekly', '每周'), value: '0 9 * * 1' },
    { label: t('settings.monthly', '每月'), value: '0 9 1 * *' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-desktop-text">{t('settings.scheduledJobs', '定时任务')}</h3>
          <p className="text-[11px] text-desktop-muted mt-0.5">
            {t('settings.scheduledJobsDesc', '管理 X 主脑定时执行的任务')}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs text-desktop-text transition-colors flex items-center gap-1"
        >
          <Plus size={12} /> {t('settings.add', '添加')}
        </button>
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <div className="bg-white/[0.03] rounded-xl p-4 border border-desktop-accent/30 space-y-3">
          <h4 className="text-xs font-medium text-desktop-text">{t('settings.createScheduledJob', '创建定时任务')}</h4>
          <input
            type="text"
            placeholder={t('settings.jobNameOptional', '任务名称（可选）')}
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
          />
          <textarea
            placeholder={t('settings.taskDescription', '任务描述（X 主脑 将执行的操作）')}
            value={createForm.intent}
            onChange={(e) => setCreateForm((f) => ({ ...f, intent: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none resize-none h-20"
          />
          <div>
            <div className="text-[10px] text-desktop-muted mb-1">{t('settings.cronExpression', 'Cron 表达式')}</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setCreateForm((f) => ({ ...f, cron: p.value }))}
                  className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                    createForm.cron === p.value
                      ? 'bg-desktop-accent/40 text-desktop-text'
                      : 'bg-white/5 text-desktop-muted hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="*/5 * * * *"
              value={createForm.cron}
              onChange={(e) => setCreateForm((f) => ({ ...f, cron: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none font-mono"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !createForm.intent}
              className="px-3 py-1.5 rounded-lg bg-desktop-accent/50 hover:bg-desktop-accent/70 disabled:opacity-40 text-xs text-desktop-text transition-colors"
            >
              {creating ? t('settings.creating', '创建中…') : t('settings.create', '创建')}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateForm({ name: '', intent: '', cron: '' }); }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-desktop-muted transition-colors"
            >
              {t('settings.cancel', '取消')}
            </button>
          </div>
        </div>
      )}

      {/* 任务列表 */}
      {loading ? (
        <div className="text-xs text-desktop-muted py-8 text-center">{t('settings.loading', '加载中…')}</div>
      ) : jobs.length === 0 ? (
        <div className="text-xs text-desktop-muted py-8 text-center">
          {t('settings.noScheduledJobs', '暂无定时任务')}
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              <div className="px-3 py-2.5 flex items-center gap-2">
                <button
                  onClick={() => handleToggle(job.id, job.enabled)}
                  disabled={toggling === job.id}
                  className={`shrink-0 transition-colors ${job.enabled ? 'text-green-400' : 'text-desktop-muted/30'}`}
                >
                  <ToggleRight size={18} fill={job.enabled ? 'currentColor' : 'none'} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-desktop-text font-medium truncate">{job.name || job.intent}</div>
                  {job.name && (
                    <div className="text-[10px] text-desktop-muted/60 truncate mt-0.5">{job.intent}</div>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    {job.cron && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-desktop-accent/15 text-desktop-muted font-mono">
                        {job.cron}
                      </span>
                    )}
                    <span className="text-[9px] text-desktop-muted/40">
                      → {formatNextRun(job.nextRun)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(job.id)}
                  disabled={deleting === job.id}
                  className="p-1 rounded hover:bg-red-500/10 text-desktop-muted/40 hover:text-red-400 transition-colors shrink-0"
                >
                  {deleting === job.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebhooksSettings() {
  const { t } = useTranslation();
  const [webhooks, setWebhooks] = useState<Array<{
    id: string; userId: string; name: string; description: string | null;
    urlPath: string; events: string[]; enabled: boolean; createdAt: number; updatedAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', events: [] as string[] });
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.webhooksList();
      setWebhooks(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const handleCreate = async () => {
    if (!createForm.name || createForm.events.length === 0) return;
    setCreating(true);
    try {
      const result = await api.webhooksCreate({
        name: createForm.name,
        description: createForm.description || undefined,
        events: createForm.events,
      });
      setNewSecret(result.secret);
      setShowCreate(false);
      setCreateForm({ name: '', description: '', events: [] });
      await fetchWebhooks();
    } catch { /* ignore */ }
    finally { setCreating(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此 Webhook？')) return;
    try {
      await api.webhooksDelete(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      if (selectedWebhook === id) setSelectedWebhook(null);
    } catch { /* ignore */ }
  };

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    try {
      await api.webhooksUpdate(id, { enabled: !currentEnabled });
      setWebhooks((prev) => prev.map((w) => w.id === id ? { ...w, enabled: !currentEnabled } : w));
    } catch { /* ignore */ }
  };

  const handleRegenerate = async (id: string) => {
    try {
      const result = await api.webhooksRegenerateSecret(id);
      setNewSecret(result.secret);
    } catch { /* ignore */ }
  };

  const handleViewLogs = async (id: string) => {
    if (selectedWebhook === id) { setSelectedWebhook(null); return; }
    setSelectedWebhook(id);
    setLoadingLogs(true);
    try {
      const data = await api.webhooksGetLogs(id, 30);
      setLogs(data);
    } catch { setLogs([]); }
    finally { setLoadingLogs(false); }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const EVENT_OPTIONS = [
    { value: 'task.trigger', label: '任务触发 (task.trigger)' },
    { value: 'github.push', label: 'GitHub Push (github.push)' },
    { value: 'github.pull_request', label: 'GitHub PR (github.pull_request)' },
    { value: 'github.issue_comment', label: 'GitHub Issue Comment' },
    { value: 'schedule', label: '定时触发 (schedule)' },
    { value: 'manual', label: '手动触发 (manual)' },
  ];

  const eventLabel = (ev: string) => EVENT_OPTIONS.find((o) => o.value === ev)?.label ?? ev;

  const webhookBaseUrl = window.location.origin;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-desktop-text">{t('settings.webhooks', 'Webhook 管理')}</h3>
          <p className="text-[11px] text-desktop-muted mt-0.5">
            {t('settings.webhooksDesc', '配置 Webhook 让外部服务触发 X 主脑任务')}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs text-desktop-text transition-colors flex items-center gap-1"
        >
          <Plus size={12} /> {t('settings.addWebhook', '添加')}
        </button>
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <div className="bg-white/[0.03] rounded-xl p-4 border border-desktop-accent/30 space-y-3">
          <h4 className="text-xs font-medium text-desktop-text">{t('settings.createWebhook', '创建 Webhook')}</h4>
          <input
            type="text"
            placeholder={t('settings.webhookName', 'Webhook 名称')}
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
          />
          <input
            type="text"
            placeholder={t('settings.webhookDescOptional', '描述（可选）')}
            value={createForm.description}
            onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
          />
          <div className="space-y-1">
            <div className="text-[10px] text-desktop-muted">{t('settings.triggerEvents', '触发事件')}（{t('settings.selectAtLeastOne', '至少选一个')}）</div>
            {EVENT_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.events.includes(opt.value)}
                  onChange={(e) => {
                    setCreateForm((f) => ({
                      ...f,
                      events: e.target.checked
                        ? [...f.events, opt.value]
                        : f.events.filter((ev) => ev !== opt.value),
                    }));
                  }}
                  className="accent-desktop-accent"
                />
                <span className="text-[11px] text-desktop-muted">{opt.label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !createForm.name || createForm.events.length === 0}
              className="px-3 py-1.5 rounded-lg bg-desktop-accent/50 hover:bg-desktop-accent/70 disabled:opacity-40 text-xs text-desktop-text transition-colors"
            >
              {creating ? t('settings.creating', '创建中…') : t('settings.create', '创建')}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateForm({ name: '', description: '', events: [] }); }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-desktop-muted transition-colors"
            >
              {t('settings.cancel', '取消')}
            </button>
          </div>
        </div>
      )}

      {/* 新密钥提示 */}
      {newSecret && (
        <div className="bg-yellow-500/10 rounded-xl p-3 border border-yellow-500/30 space-y-2">
          <div className="text-xs text-yellow-400 font-medium">{t('settings.webhookSecretCreated', 'Webhook 已创建！请保存密钥（仅显示一次）：')}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[10px] text-yellow-200 bg-black/30 rounded px-2 py-1 font-mono break-all">{newSecret}</code>
            <button
              onClick={() => handleCopy(newSecret, 'secret')}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] text-desktop-muted shrink-0"
            >
              {copiedId === 'secret' ? '✓' : <Copy size={10} />}
            </button>
          </div>
          <button onClick={() => setNewSecret(null)} className="text-[10px] text-desktop-muted/60 hover:text-desktop-muted">
            {t('settings.dismiss', '知道了')}
          </button>
        </div>
      )}

      {/* Webhook 列表 */}
      {loading ? (
        <div className="text-xs text-desktop-muted py-8 text-center">{t('settings.loading', '加载中…')}</div>
      ) : webhooks.length === 0 ? (
        <div className="text-xs text-desktop-muted py-8 text-center">
          {t('settings.noWebhooks', '暂无 Webhook，点击上方添加创建一个')}
        </div>
      ) : (
        <div className="space-y-2">
          {webhooks.map((wh) => (
            <div key={wh.id} className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              <div className="px-3 py-2.5 flex items-center gap-2">
                <button
                  onClick={() => handleToggle(wh.id, wh.enabled)}
                  className={`shrink-0 transition-colors ${wh.enabled ? 'text-green-400' : 'text-desktop-muted/30'}`}
                >
                  <ToggleRight size={18} fill={wh.enabled ? 'currentColor' : 'none'} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-desktop-text font-medium truncate">{wh.name}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <code className="text-[9px] text-desktop-muted/60 font-mono">
                      {webhookBaseUrl}{wh.urlPath}
                    </code>
                    <button
                      onClick={() => handleCopy(`${webhookBaseUrl}${wh.urlPath}`, wh.id)}
                      className="text-desktop-muted/40 hover:text-desktop-muted"
                    >
                      {copiedId === wh.id ? <CheckCircle size={9} className="text-green-400" /> : <Copy size={9} />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleViewLogs(wh.id)}
                    className="p-1 rounded hover:bg-white/10 text-desktop-muted/50 hover:text-desktop-muted"
                    title="查看日志"
                  >
                    <FileText size={13} />
                  </button>
                  <button
                    onClick={() => handleRegenerate(wh.id)}
                    className="p-1 rounded hover:bg-white/10 text-desktop-muted/50 hover:text-desktop-muted"
                    title="重新生成密钥"
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(wh.id)}
                    className="p-1 rounded hover:bg-red-500/10 text-desktop-muted/50 hover:text-red-400"
                    title="删除"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {/* 事件标签 */}
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {wh.events.map((ev) => (
                  <span key={ev} className="text-[9px] px-1.5 py-0.5 rounded bg-desktop-accent/15 text-desktop-muted font-mono">
                    {ev}
                  </span>
                ))}
              </div>
              {/* 日志展开 */}
              {selectedWebhook === wh.id && (
                <div className="border-t border-white/5 px-3 py-2 max-h-48 overflow-y-auto space-y-1.5">
                  <div className="text-[10px] text-desktop-muted/60 mb-1">{t('settings.webhookLogs', '调用日志')}</div>
                  {loadingLogs ? (
                    <div className="text-[10px] text-desktop-muted">{t('settings.loading', '加载中…')}</div>
                  ) : logs.length === 0 ? (
                    <div className="text-[10px] text-desktop-muted">{t('settings.noLogs', '暂无调用记录')}</div>
                  ) : logs.map((log) => (
                    <div key={log.id} className="text-[10px] bg-white/[0.02] rounded px-2 py-1.5 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.signatureValid ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span className="text-desktop-text/80 font-mono">{log.event}</span>
                        <span className="text-desktop-muted/50 ml-auto">{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                      {log.triggeredTaskId && (
                        <div className="text-desktop-muted/40">→ 任务: {log.triggeredTaskId}</div>
                      )}
                      {log.ipAddress && (
                        <div className="text-desktop-muted/40">IP: {log.ipAddress}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <WebhookTester />
    </div>
  );
}

// ── Webhook Testing Tool ────────────────────────────────────

function WebhookTester() {
  const { t } = useTranslation();
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>('POST');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('Content-Type: application/json\nAuthorization: Bearer ');
  const [body, setBody] = useState('{\n  "event": "test",\n  "data": {}\n}');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    status: number; statusText: string;
    headers: Record<string, string>; body: string; time: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!url.trim()) return;
    setTesting(true);
    setResult(null);
    setError(null);
    const start = Date.now();
    try {
      const headerMap: Record<string, string> = {};
      for (const line of headers.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          if (key) headerMap[key] = val;
        }
      }
      const opts: RequestInit = { method, headers: headerMap };
      if (!['GET', 'HEAD'].includes(method) && body.trim()) {
        opts.body = body;
      }
      const resp = await fetch(url, opts);
      const respBody = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((val, key) => { respHeaders[key] = val; });
      setResult({ status: resp.status, statusText: resp.statusText, headers: respHeaders, body: respBody, time: Date.now() - start });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setTesting(false);
    }
  };

  const METHOD_COLORS: Record<string, string> = {
    GET: 'bg-green-500/20 text-green-400',
    POST: 'bg-blue-500/20 text-blue-400',
    PUT: 'bg-yellow-500/20 text-yellow-400',
    PATCH: 'bg-orange-500/20 text-orange-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };

  return (
    <div className="space-y-4 mt-6 pt-6 border-t border-white/5">
      <div>
        <h3 className="text-sm font-medium text-desktop-text">{t('settings.webhookTester', 'Webhook 测试工具')}</h3>
        <p className="text-[11px] text-desktop-muted mt-0.5">
          {t('settings.webhookTesterDesc', '发送 HTTP 请求测试任意端点')}
        </p>
      </div>

      <div className="flex gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          className={`px-2 py-1.5 rounded-lg text-xs font-medium ${METHOD_COLORS[method]} border border-white/10`}
        >
          {Object.keys(METHOD_COLORS).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
        />
        <button
          onClick={handleTest}
          disabled={testing || !url.trim()}
          className="px-4 py-1.5 rounded-lg bg-desktop-accent/60 hover:bg-desktop-accent/80 text-xs disabled:opacity-50 flex items-center gap-1"
        >
          {testing ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
          {testing ? t('settings.testing', '测试中…') : t('settings.send', '发送')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-desktop-muted mb-1">{t('settings.headers', '请求头')}（每行 Key: Value）</div>
          <textarea
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none resize-none h-20 font-mono"
            placeholder="Content-Type: application/json"
          />
        </div>
        <div>
          <div className="text-[10px] text-desktop-muted mb-1">{t('settings.requestBody', '请求体')}</div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none resize-none h-20 font-mono"
            placeholder='{"key": "value"}'
          />
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-white/[0.02] rounded-xl border border-white/5 overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-3 border-b border-white/5">
            <span className={`text-xs font-medium ${result.status >= 200 && result.status < 300 ? 'text-green-400' : result.status >= 400 ? 'text-red-400' : 'text-yellow-400'}`}>
              {result.status} {result.statusText}
            </span>
            <span className="text-xs text-desktop-muted font-mono">{result.time}ms</span>
          </div>
          <div className="px-3 py-2 max-h-64 overflow-auto">
            <div className="text-[10px] text-desktop-muted mb-1">{t('settings.responseBody', '响应体')}</div>
            <pre className="text-xs text-desktop-text whitespace-pre-wrap break-all font-mono bg-white/5 rounded p-2 max-h-48 overflow-auto">
              {(() => {
                try { return JSON.stringify(JSON.parse(result.body), null, 2); }
                catch { return result.body; }
              })()}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function UsageAnalyticsSettings() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<{
    period: { days: number; start: number; end: number };
    aiCalls: number;
    tasks: { total: number; completed: number; failed: number };
    byResourceType: Array<{ type: string; total: number }>;
    dailyApiCalls: Array<{ date: string; count: number }>;
    dailyTaskCounts: Array<{ date: string; count: number; status: string }>;
    recentTasks: Array<{ id: string; title: string; status: string; createdAt: string; updatedAt: string }>;
  } | null>(null);
  const [summary, setSummary] = useState<{
    period: { days: number; label: string };
    current: { aiCalls: number; tasks: number; completedTasks: number };
    previous: { aiCalls: number; tasks: number; completedTasks: number };
    trends: { aiCalls: number; tasks: number; completedTasks: number };
  } | null>(null);
  const [daily, setDaily] = useState<Array<{
    date: string;
    aiCalls: number;
    tasks: number;
    completedTasks: number;
    failedTasks: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const [ov, sum, dailyData] = await Promise.all([
        api.usageGetOverview(d),
        api.usageGetSummary(d),
        api.usageGetDaily(d),
      ]);
      setOverview(ov);
      setSummary(sum);
      setDaily(dailyData.daily);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(days);
  }, [days, fetchData]);

  const trendColor = (v: number) => v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-desktop-muted';
  const trendSign = (v: number) => v > 0 ? '+' : '';

  const maxApiCalls = Math.max(...daily.map((d) => d.aiCalls), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-desktop-text">{t('settings.usageAnalytics', '使用量分析')}</h3>
          <p className="text-[11px] text-desktop-muted mt-0.5">
            {t('settings.usageAnalyticsDesc', '查看 AI 调用、任务统计和每日趋势')}
          </p>
        </div>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-desktop-text outline-none"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>{t('settings.days7', '7天')}</option>
          <option value={14}>{t('settings.days14', '14天')}</option>
          <option value={30}>{t('settings.days30', '30天')}</option>
          <option value={90}>{t('settings.days90', '90天')}</option>
        </select>
      </div>

      {loading ? (
        <div className="text-xs text-desktop-muted py-8 text-center">{t('settings.loading', '加载中…')}</div>
      ) : (
        <>
          {/* KPI Cards */}
          {summary && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t('settings.aiCalls', 'AI 调用'), value: summary.current.aiCalls, trend: summary.trends.aiCalls },
                { label: t('settings.totalTasks', '任务总数'), value: summary.current.tasks, trend: summary.trends.tasks },
                { label: t('settings.completedTasks', '已完成'), value: summary.current.completedTasks, trend: summary.trends.completedTasks },
              ].map((card) => (
                <div key={card.label} className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                  <div className="text-[10px] text-desktop-muted mb-1">{card.label}</div>
                  <div className="text-lg font-bold text-desktop-text">{card.value.toLocaleString()}</div>
                  <div className={`text-[10px] mt-0.5 ${trendColor(card.trend)}`}>
                    {trendSign(card.trend)}{card.trend}% {t('settings.vsLastPeriod', 'vs上周期')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Daily API Calls Chart */}
          {daily.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-desktop-text mb-2">{t('settings.dailyApiCalls', '每日 AI 调用')}</h4>
              <div className="flex items-end gap-0.5 h-24">
                {daily.map((d, i) => {
                  const height = Math.max(Math.round((d.aiCalls / maxApiCalls) * 80), d.aiCalls > 0 ? 4 : 0);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                      <div
                        className="w-full bg-desktop-accent/60 hover:bg-desktop-accent rounded-sm transition-colors"
                        style={{ height: `${height}px` }}
                        title={`${d.date}: ${d.aiCalls} 调用`}
                      />
                      {i % Math.ceil(daily.length / 7) === 0 && (
                        <span className="text-[9px] text-desktop-muted/60 absolute -bottom-4 left-0">{d.date.slice(5)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task Status Breakdown */}
          {overview && (
            <div>
              <h4 className="text-xs font-medium text-desktop-text mb-2">{t('settings.taskBreakdown', '任务状态分布')}</h4>
              <div className="space-y-2">
                {[
                  { label: t('settings.total', '总计'), count: overview.tasks.total, color: 'bg-blue-500/60' },
                  { label: t('settings.completed', '已完成'), count: overview.tasks.completed, color: 'bg-green-500/60' },
                  { label: t('settings.failed', '失败'), count: overview.tasks.failed, color: 'bg-red-500/60' },
                ].map((item) => {
                  const pct = overview.tasks.total > 0 ? (item.count / overview.tasks.total) * 100 : 0;
                  return (
                    <div key={item.label} className="flex items-center gap-2">
                      <span className="text-[11px] text-desktop-muted w-12">{item.label}</span>
                      <div className="flex-1 bg-white/5 rounded-full h-1.5">
                        <div className={`${item.color} rounded-full h-1.5 transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-desktop-text w-10 text-right">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Tasks */}
          {overview && overview.recentTasks.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-desktop-text mb-2">{t('settings.recentTasks', '最近任务')}</h4>
              <div className="space-y-1.5">
                {overview.recentTasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      task.status === 'completed' ? 'bg-green-400' :
                      task.status === 'failed' ? 'bg-red-400' :
                      task.status === 'running' ? 'bg-blue-400' : 'bg-desktop-muted/40'
                    }`} />
                    <span className="text-[11px] text-desktop-text truncate flex-1">{task.title}</span>
                    <span className="text-[10px] text-desktop-muted/60 shrink-0">
                      {new Date(task.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resource Type Breakdown */}
          {overview && overview.byResourceType.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-desktop-text mb-2">{t('settings.resourceBreakdown', '资源类型分布')}</h4>
              <div className="grid grid-cols-2 gap-2">
                {overview.byResourceType.map((r) => (
                  <div key={r.type} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-[11px] text-desktop-muted">{r.type}</span>
                    <span className="text-[11px] text-desktop-text font-medium">{r.total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => fetchData(days)}
            className="w-full px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs text-desktop-text transition-colors"
          >
            {t('settings.refresh', '刷新')}
          </button>
        </>
      )}
    </div>
  );
}

function FeatureFlagsSettings() {
  const { t } = useTranslation();
  const [flags, setFlags] = useState<Array<{
    key: string;
    name: string;
    description: string;
    defaultValue: boolean;
    category: string;
    envVar: string;
    enabled: boolean;
  }>>([]);
  const [stats, setStats] = useState<{ total: number; enabled: number; disabled: number; byCategory: Record<string, { total: number; enabled: number }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const categories = useMemo(() => {
    const cats = new Set(flags.map((f) => f.category));
    return ['all', ...Array.from(cats)];
  }, [flags]);

  useEffect(() => {
    api.featureFlagsGetAll().then((res) => {
      setFlags(res.flags);
      setStats(res.stats);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleToggle = async (key: string, currentEnabled: boolean) => {
    setOverriding(key);
    try {
      await api.featureFlagsOverride(key, !currentEnabled);
      setFlags((prev) => prev.map((f) => f.key === key ? { ...f, enabled: !currentEnabled } : f));
    } catch {
      // ignore
    } finally {
      setOverriding(null);
    }
  };

  const handleReset = async () => {
    try {
      await api.featureFlagsReset();
      api.featureFlagsGetAll().then((res) => {
        setFlags(res.flags);
        setStats(res.stats);
      });
    } catch {
      // ignore
    }
  };

  const filteredFlags = activeCategory === 'all' ? flags : flags.filter((f) => f.category === activeCategory);

  const categoryLabel: Record<string, string> = {
    all: '全部',
    core: '核心功能',
    experimental: '实验性功能',
    admin: '管理功能',
    integrations: '集成功能',
  };

  if (loading) {
    return <div className="text-xs text-desktop-muted py-4">{t('settings.loading', '加载中…')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-desktop-text">{t('settings.featureFlags', '功能开关')}</h3>
        {stats && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
            {stats.enabled}/{stats.total} {t('settings.enabled', '已启用')}
          </span>
        )}
      </div>
      <p className="text-[11px] text-desktop-muted leading-relaxed">
        {t('settings.featureFlagsDesc', '运行时功能开关，修改仅在当前会话生效，重启后恢复环境变量配置。')}
      </p>

      {/* 分类筛选 */}
      <div className="flex flex-wrap gap-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
              activeCategory === cat
                ? 'bg-desktop-accent/40 text-desktop-text'
                : 'bg-white/5 text-desktop-muted hover:bg-white/10'
            }`}
          >
            {categoryLabel[cat] ?? cat}
            {stats && cat !== 'all' && stats.byCategory[cat] && (
              <span className="ml-1 opacity-60">{stats.byCategory[cat].enabled}/{stats.byCategory[cat].total}</span>
            )}
          </button>
        ))}
      </div>

      {/* 功能列表 */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredFlags.map((flag) => (
          <div key={flag.key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5">
            <div className="min-w-0">
              <div className="text-xs text-desktop-text font-medium truncate">{flag.name}</div>
              <div className="text-[10px] text-desktop-muted truncate">{flag.description}</div>
              <div className="text-[9px] text-desktop-muted/50 mt-0.5">
                <span className="font-mono">{flag.envVar}</span>
                {flag.defaultValue !== flag.enabled && (
                  <span className="ml-2 text-yellow-400/60">（默认值: {flag.defaultValue ? '开' : '关'}）</span>
                )}
              </div>
            </div>
            <button
              onClick={() => handleToggle(flag.key, flag.enabled)}
              disabled={overriding === flag.key}
              className={`shrink-0 transition-colors ${
                flag.enabled ? 'text-green-400' : 'text-desktop-muted/40'
              }`}
              title={flag.enabled ? '点击关闭' : '点击开启'}
            >
              {overriding === flag.key ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <ToggleRight size={20} fill={flag.enabled ? 'currentColor' : 'none'} />
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-desktop-muted transition-colors"
        >
          {t('settings.resetFlags', '重置所有覆盖')}
        </button>
        <button
          type="button"
          onClick={() => {
            api.featureFlagsGetAll().then((res) => {
              setFlags(res.flags);
              setStats(res.stats);
            });
          }}
          className="px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs text-desktop-text transition-colors"
        >
          {t('settings.refreshFlags', '刷新')}
        </button>
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

export function SettingsApp({ windowId }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('general');
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

  // 基础tab，普通用户和管理员都可见
  const basicTabs: { id: SettingsTab; labelKey: string; icon: React.ElementType }[] = [
    { id: 'general', labelKey: 'settings.general', icon: Monitor },
    { id: 'account', labelKey: 'settings.account', icon: User },
    { id: 'profile', labelKey: 'settings.profile', icon: User },
    { id: 'apps', labelKey: 'settings.apps', icon: Package },
    { id: 'skills', labelKey: 'settings.skills', icon: Sparkles },
    { id: 'shortcuts', labelKey: 'settings.shortcuts', icon: Keyboard },
    { id: 'tools', labelKey: 'settings.tools', icon: Wrench },
    { id: 'channels', labelKey: 'settings.channels', icon: MessageSquare },
    { id: 'about', labelKey: 'settings.about', icon: Info },
  ];

  // 高级tab，仅管理员可见
  const adminTabs: { id: SettingsTab; labelKey: string; icon: React.ElementType }[] = [
    { id: 'ai', labelKey: 'settings.ai', icon: Bot },
    { id: 'models', labelKey: 'settings.models', icon: Key },
    { id: 'mcp', labelKey: 'settings.mcp', icon: Plug },
    { id: 'media', labelKey: 'settings.media', icon: Music2 },
    { id: 'servers', labelKey: 'settings.servers', icon: Server },
    { id: 'security', labelKey: 'settings.security', icon: Shield },
    { id: 'logs', labelKey: 'settings.logs', icon: FileText },
    { id: 'flags', labelKey: 'settings.featureFlags', icon: ToggleRight },
    { id: 'usage', labelKey: 'settings.usageAnalytics', icon: BarChart2 },
    { id: 'webhooks', labelKey: 'settings.webhooks', icon: WebhookIcon },
    { id: 'schedules', labelKey: 'settings.scheduledJobs', icon: Clock },
    { id: 'health', labelKey: 'settings.systemHealth', icon: Activity },
    { id: 'hooks', labelKey: 'settings.lifecycleHooks', icon: Link },
    { id: 'council', labelKey: 'settings.llmCouncil', icon: Users },
    { id: 'auditlog', labelKey: 'settings.auditLog', icon: ShieldAlert },
    { id: 'templates', labelKey: 'settings.promptTemplates', icon: FileText },
    { id: 'announcements', labelKey: 'settings.announcements', icon: Bell },
    { id: 'systemprompts', labelKey: 'settings.systemPrompts', icon: Brain },
    { id: 'snippets', labelKey: 'settings.snippets', icon: Code },
  ];

  const isAdmin = useAdminStore((s) => s.isAdmin);
  const tabs = useMemo(() => {
    return isAdmin ? [...basicTabs, ...adminTabs] : basicTabs;
  }, [isAdmin]);

  return (
    <div className="h-full flex text-sm min-h-0">
      {/* Sidebar - 移动端隐藏，PC端显示 */}
      <div className="w-40 sm:w-48 shrink-0 border-r border-white/5 bg-white/[0.01] p-2 overflow-y-auto hidden sm:block">
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

      {/* 移动端：顶部 Tab 切换 */}
      <div className="sm:hidden flex border-b border-white/5 bg-white/[0.01] overflow-x-auto shrink-0">
        {tabs.map((tabItem) => {
          const Icon = tabItem.icon;
          return (
            <button
              key={tabItem.id}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs transition-colors whitespace-nowrap ${
                tab === tabItem.id
                  ? 'bg-desktop-accent/40 text-desktop-text border-b-2 border-desktop-highlight'
                  : 'text-desktop-muted hover:text-desktop-text'
              }`}
              onClick={() => setTab(tabItem.id)}
            >
              <Icon size={12} />
              {t(tabItem.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 sm:p-5">
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

        {tab === 'profile' && <ProfileSettings />}

        {tab === 'general' && (
          <div className="space-y-6">
            <h3 className="text-sm font-medium text-desktop-text">{t('settings.general')}</h3>
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
            <NotificationPreferencesSettings />
            <HeartbeatSettings />
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

        {tab === 'tools' && (
          <ToolsSettings />
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

        {tab === 'flags' && (
          <FeatureFlagsSettings />
        )}

        {tab === 'usage' && (
          <UsageAnalyticsSettings />
        )}

        {tab === 'webhooks' && (
          <WebhooksSettings />
        )}

        {tab === 'schedules' && (
          <ScheduledJobsSettings />
        )}

        {tab === 'health' && (
          <SystemHealthSettings />
        )}

        {tab === 'hooks' && (
          <HooksSettings />
        )}

        {tab === 'council' && (
          <CouncilSettings />
        )}

        {tab === 'auditlog' && (
          <AuditLogSettings />
        )}

        {tab === 'templates' && (
          <PromptTemplatesSettings />
        )}

        {tab === 'shortcuts' && (
          <ShortcutsSettings />
        )}

        {tab === 'announcements' && (
          <AnnouncementsSettings />
        )}

        {tab === 'systemprompts' && (
          <SystemPromptsSettings />
        )}

        {tab === 'snippets' && (
          <SnippetsSettings />
        )}
      </div>
    </div>
  );
}

// ── System Prompts Editor ───────────────────────────────────

const PROMPT_MODES = [
  { value: 'x_brain', label: 'X Brain', description: 'The main AI brain agent that can execute tasks autonomously' },
  { value: 'ai_assistant', label: 'AI Assistant', description: 'Chat assistant mode for interactive conversations' },
  { value: 'workflow', label: 'Workflow Agent', description: 'Used for executing workflow tasks' },
];

function SystemPromptsSettings() {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<Record<string, {
    id: string; mode: string; content: string; enabled: boolean; createdAt: number; updatedAt: number;
  }>>({});
  const [loading, setLoading] = useState(true);
  const [editingMode, setEditingMode] = useState<string | null>(null);
  const [formContent, setFormContent] = useState('');
  const [formEnabled, setFormEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.systemPromptsList();
      const byMode: typeof prompts = {};
      for (const p of data.data) {
        byMode[p.mode] = p;
      }
      setPrompts(byMode);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPrompts(); }, [fetchPrompts]);

  const startEdit = (mode: string) => {
    const p = prompts[mode];
    setEditingMode(mode);
    setFormContent(p?.content || '');
    setFormEnabled(p?.enabled ?? false);
  };

  const handleSave = async () => {
    if (!editingMode || !formContent.trim()) return;
    setSaving(true);
    try {
      const result = await api.systemPromptsUpdate(editingMode, { content: formContent, enabled: formEnabled });
      setPrompts((prev) => ({ ...prev, [editingMode]: result.data }));
      setEditingMode(null);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (mode: string) => {
    const p = prompts[mode];
    if (!p || !confirm('Delete this system prompt?')) return;
    try {
      await api.systemPromptsDelete(p.id);
      const next = { ...prompts };
      delete next[mode];
      setPrompts(next);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-desktop-text">{t('settings.systemPrompts', 'System Prompts')}</h3>
        <p className="text-[11px] text-desktop-muted mt-0.5">
          {t('settings.systemPromptsDesc', 'Customize AI behavior by mode. Changes apply immediately.')}
        </p>
      </div>

      {loading ? (
        <div className="text-xs text-desktop-muted py-8 text-center">{t('settings.loading', 'Loading…')}</div>
      ) : (
        <div className="space-y-3">
          {PROMPT_MODES.map((m) => {
            const p = prompts[m.value];
            const isEditing = editingMode === m.value;
            return (
              <div key={m.value} className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
                <div className="px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-desktop-text">{m.label}</span>
                      {p?.enabled ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">ENABLED</span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-desktop-muted/40">DISABLED</span>
                      )}
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(m.value)}
                          className="px-2 py-1 rounded text-[10px] bg-white/10 hover:bg-white/20 text-desktop-muted transition-colors"
                        >
                          {p ? 'Edit' : 'Create'}
                        </button>
                        {p && (
                          <button
                            onClick={() => handleDelete(m.value)}
                            className="p-1 rounded hover:bg-red-500/10 text-desktop-muted/40 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-desktop-muted">{m.description}</p>
                  {p?.content && !isEditing && (
                    <div className="mt-2 text-[10px] text-desktop-muted/60 font-mono bg-white/5 rounded p-2 max-h-16 overflow-hidden">
                      {p.content.slice(0, 300)}{p.content.length > 300 ? '…' : ''}
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-3">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="flex items-center gap-1.5 text-xs text-desktop-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formEnabled}
                          onChange={(e) => setFormEnabled(e.target.checked)}
                          className="accent-desktop-accent"
                        />
                        {t('settings.enabled', 'Enabled')}
                      </label>
                    </div>
                    <textarea
                      value={formContent}
                      onChange={(e) => setFormContent(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-desktop-text outline-none resize-none h-40 font-mono"
                      placeholder={t('settings.enterSystemPrompt', 'Enter system prompt here...')}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSave}
                        disabled={saving || !formContent.trim()}
                        className="px-3 py-1.5 rounded-lg bg-desktop-accent/50 hover:bg-desktop-accent/70 disabled:opacity-40 text-xs text-desktop-text transition-colors"
                      >
                        {saving ? t('settings.saving', 'Saving…') : t('settings.save', 'Save')}
                      </button>
                      <button
                        onClick={() => setEditingMode(null)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-desktop-muted transition-colors"
                      >
                        {t('settings.cancel', 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 系统健康仪表板 ────────────────────────────────────────────

// ── 提示词模板 ────────────────────────────────────────────────

function PromptTemplatesSettings() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<Array<{
    id: string; userId: string; name: string; content: string;
    category: string | null; description: string | null; variables: string[] | null;
    createdAt: number; updatedAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', content: '', category: '', description: '', variables: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('');

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.promptTemplatesList(filterCategory ? { category: filterCategory } : undefined);
      setTemplates(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterCategory]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const categories = useMemo(() => {
    const cats = new Set(templates.map((t) => t.category).filter(Boolean) as string[]);
    return Array.from(cats).sort();
  }, [templates]);

  const handleCreate = async () => {
    if (!form.name || !form.content) return;
    setSaving(true);
    try {
      const vars = form.variables ? form.variables.split(',').map((v) => v.trim()).filter(Boolean) : undefined;
      const result = await api.promptTemplatesCreate({
        name: form.name,
        content: form.content,
        category: form.category || undefined,
        description: form.description || undefined,
        variables: vars,
      });
      setTemplates((prev) => [result, ...prev]);
      setShowCreate(false);
      setForm({ name: '', content: '', category: '', description: '', variables: '' });
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleUpdate = async (id: string) => {
    if (!form.name || !form.content) return;
    setSaving(true);
    try {
      const vars = form.variables ? form.variables.split(',').map((v) => v.trim()).filter(Boolean) : undefined;
      const result = await api.promptTemplatesUpdate(id, {
        name: form.name,
        content: form.content,
        category: form.category || null,
        description: form.description || null,
        variables: vars || null,
      });
      setTemplates((prev) => prev.map((t) => t.id === id ? result : t));
      setEditingId(null);
      setForm({ name: '', content: '', category: '', description: '', variables: '' });
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('settings.confirmDeleteTemplate', '确定删除此模板？'))) return;
    setDeleting(id);
    try {
      await api.promptTemplatesDelete(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch { /* ignore */ }
    finally { setDeleting(null); }
  };

  const startEdit = (tpl: typeof templates[0]) => {
    setEditingId(tpl.id);
    setForm({
      name: tpl.name,
      content: tpl.content,
      category: tpl.category || '',
      description: tpl.description || '',
      variables: tpl.variables?.join(', ') || '',
    });
  };

  const startCreate = () => {
    setEditingId(null);
    setForm({ name: '', content: '', category: '', description: '', variables: '' });
    setShowCreate(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-desktop-text">{t('settings.promptTemplates', '提示词模板')}</h3>
          <p className="text-[11px] text-desktop-muted mt-0.5">
            {t('settings.promptTemplatesDesc', '保存和复用常用提示词，支持变量替换')}
          </p>
        </div>
        <button
          onClick={startCreate}
          className="px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs text-desktop-text transition-colors flex items-center gap-1"
        >
          <Plus size={12} /> {t('settings.add', '添加')}
        </button>
      </div>

      {categories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-desktop-muted">{t('settings.filterByCategory', '分类筛选')}:</span>
          <button
            onClick={() => setFilterCategory('')}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${!filterCategory ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/5 text-desktop-muted hover:bg-white/10'}`}
          >
            {t('settings.all', '全部')}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${filterCategory === cat ? 'bg-desktop-accent/40 text-desktop-text' : 'bg-white/5 text-desktop-muted hover:bg-white/10'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 创建表单 */}
      {showCreate && (
        <div className="bg-white/[0.03] rounded-xl p-4 border border-desktop-accent/30 space-y-3">
          <h4 className="text-xs font-medium text-desktop-text">{t('settings.createTemplate', '创建模板')}</h4>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t('settings.templateName', '模板名称')}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            />
            <input
              type="text"
              placeholder={t('settings.templateCategoryOptional', '分类（可选）')}
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            />
          </div>
          <textarea
            placeholder={t('settings.templateContent', '提示词内容')}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none resize-none h-24"
          />
          <input
            type="text"
            placeholder={t('settings.templateVariablesHint', '变量（逗号分隔，可选）如 {{topic}}, {{format}}')}
            value={form.variables}
            onChange={(e) => setForm((f) => ({ ...f, variables: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
          />
          <input
            type="text"
            placeholder={t('settings.templateDescriptionOptional', '描述（可选）')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving || !form.name || !form.content}
              className="px-3 py-1.5 rounded-lg bg-desktop-accent/50 hover:bg-desktop-accent/70 disabled:opacity-40 text-xs text-desktop-text transition-colors"
            >
              {saving ? t('settings.saving', '保存中…') : t('settings.create', '创建')}
            </button>
            <button
              onClick={() => { setShowCreate(false); setForm({ name: '', content: '', category: '', description: '', variables: '' }); }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-desktop-muted transition-colors"
            >
              {t('settings.cancel', '取消')}
            </button>
          </div>
        </div>
      )}

      {/* 模板列表 */}
      {loading ? (
        <div className="text-xs text-desktop-muted py-8 text-center">{t('settings.loading', '加载中…')}</div>
      ) : templates.length === 0 ? (
        <div className="text-xs text-desktop-muted py-8 text-center">
          {t('settings.noTemplates', '暂无模板')}
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <div key={tpl.id} className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              {editingId === tpl.id ? (
                <div className="p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
                    />
                    <input
                      type="text"
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
                    />
                  </div>
                  <textarea
                    value={form.content}
                    onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none resize-none h-20"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(tpl.id)}
                      disabled={saving}
                      className="px-3 py-1 rounded bg-desktop-accent/50 hover:bg-desktop-accent/70 text-xs text-desktop-text"
                    >
                      {saving ? t('settings.saving', '保存中…') : t('settings.save', '保存')}
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setForm({ name: '', content: '', category: '', description: '', variables: '' }); }}
                      className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-desktop-muted"
                    >
                      {t('settings.cancel', '取消')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-desktop-text font-medium">{tpl.name}</span>
                        {tpl.category && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-desktop-accent/15 text-desktop-muted">
                            {tpl.category}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-desktop-muted/60 mt-0.5 line-clamp-2">{tpl.content}</div>
                      {tpl.variables && tpl.variables.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {tpl.variables.map((v) => (
                            <span key={v} className="text-[9px] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-400/60 font-mono">
                              {v}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-[9px] text-desktop-muted/30 mt-1">
                        {new Date(tpl.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => copyToClipboard(tpl.content)}
                        className="p-1 rounded hover:bg-white/10 text-desktop-muted/40 hover:text-desktop-muted transition-colors"
                        title={t('settings.copy', '复制')}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        onClick={() => startEdit(tpl)}
                        className="p-1 rounded hover:bg-white/10 text-desktop-muted/40 hover:text-desktop-muted transition-colors"
                        title={t('settings.edit', '编辑')}
                      >
                        <Edit size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(tpl.id)}
                        disabled={deleting === tpl.id}
                        className="p-1 rounded hover:bg-red-500/10 text-desktop-muted/40 hover:text-red-400 transition-colors"
                        title={t('settings.delete', '删除')}
                      >
                        {deleting === tpl.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 公告管理 ────────────────────────────────────────────────

function AnnouncementsSettings() {
  const { t } = useTranslation();
  const [announcements, setAnnouncements] = useState<Array<{
    id: string; title: string; title_en: string | null;
    content: string; content_en: string | null; type: string;
    target: string; priority: number; is_active: number;
    start_at: number | null; end_at: number | null;
    created_by: string | null; created_at: number; updated_at: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', title_en: '', content: '', content_en: '',
    type: 'info', target: 'all', priority: 0,
    start_at: '', end_at: '',
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.announcementsList();
      setAnnouncements(data.announcements);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAnnouncements(); }, [fetchAnnouncements]);

  const resetForm = () => {
    setForm({ title: '', title_en: '', content: '', content_en: '', type: 'info', target: 'all', priority: 0, start_at: '', end_at: '', is_active: true });
  };

  const parseTs = (v: string) => v ? new Date(v).getTime() : null;

  const handleCreate = async () => {
    if (!form.title || !form.content) return;
    setSaving(true);
    try {
      await api.announcementsCreate({
        title: form.title,
        title_en: form.title_en || undefined,
        content: form.content,
        content_en: form.content_en || undefined,
        type: form.type,
        target: form.target,
        priority: form.priority,
        start_at: parseTs(form.start_at),
        end_at: parseTs(form.end_at),
      });
      setShowCreate(false);
      resetForm();
      await fetchAnnouncements();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleUpdate = async (id: string) => {
    if (!form.title || !form.content) return;
    setSaving(true);
    try {
      await api.announcementsUpdate(id, {
        title: form.title,
        title_en: form.title_en || undefined,
        content: form.content,
        content_en: form.content_en || undefined,
        type: form.type,
        target: form.target,
        priority: form.priority,
        is_active: form.is_active,
        start_at: parseTs(form.start_at),
        end_at: parseTs(form.end_at),
      });
      setEditing(null);
      resetForm();
      await fetchAnnouncements();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    setDeleting(id);
    try {
      await api.announcementsDelete(id);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    } catch { /* ignore */ }
    finally { setDeleting(null); }
  };

  const startEdit = (a: typeof announcements[0]) => {
    setEditing(a.id);
    setForm({
      title: a.title,
      title_en: a.title_en || '',
      content: a.content,
      content_en: a.content_en || '',
      type: a.type,
      target: a.target,
      priority: a.priority,
      is_active: !!a.is_active,
      start_at: a.start_at ? new Date(a.start_at).toISOString().slice(0, 16) : '',
      end_at: a.end_at ? new Date(a.end_at).toISOString().slice(0, 16) : '',
    });
    setShowCreate(false);
  };

  const TYPE_COLORS: Record<string, string> = {
    info: 'bg-blue-500/20 text-blue-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    error: 'bg-red-500/20 text-red-400',
    success: 'bg-green-500/20 text-green-400',
  };

  const TYPE_OPTIONS = [
    { value: 'info', label: 'Info' },
    { value: 'warning', label: 'Warning' },
    { value: 'error', label: 'Error' },
    { value: 'success', label: 'Success' },
  ];

  const TARGET_OPTIONS = [
    { value: 'all', label: 'All Users' },
    { value: 'free', label: 'Free Users' },
    { value: 'pro', label: 'Pro Users' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-desktop-text">{t('settings.announcements', 'Announcements')}</h3>
          <p className="text-[11px] text-desktop-muted mt-0.5">
            {t('settings.announcementsDesc', 'Create and manage system-wide announcements')}
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setEditing(null); resetForm(); }}
          className="px-3 py-1.5 rounded-lg bg-desktop-accent/30 hover:bg-desktop-accent/50 text-xs text-desktop-text transition-colors flex items-center gap-1"
        >
          <Plus size={12} /> {t('settings.create', 'Create')}
        </button>
      </div>

      {/* Create/Edit Form */}
      {(showCreate || editing) && (
        <div className="bg-white/[0.03] rounded-xl p-4 border border-desktop-accent/30 space-y-3">
          <h4 className="text-xs font-medium text-desktop-text">
            {editing ? t('settings.editAnnouncement', 'Edit Announcement') : t('settings.createAnnouncement', 'Create Announcement')}
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t('settings.titleZh', 'Title (Chinese)')}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            />
            <input
              type="text"
              placeholder={t('settings.titleEn', 'Title (English)')}
              value={form.title_en}
              onChange={(e) => setForm((f) => ({ ...f, title_en: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            >
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={form.target}
              onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            >
              {TARGET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="number"
              placeholder={t('settings.priority', 'Priority')}
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            />
          </div>
          <textarea
            placeholder={t('settings.contentZh', 'Content (Chinese)')}
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none resize-none h-20"
          />
          <textarea
            placeholder={t('settings.contentEn', 'Content (English)')}
            value={form.content_en}
            onChange={(e) => setForm((f) => ({ ...f, content_en: e.target.value }))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none resize-none h-16"
          />
          <div className="grid grid-cols-3 gap-2 items-center">
            <label className="flex items-center gap-2 text-xs text-desktop-muted">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="accent-desktop-accent"
              />
              Active
            </label>
            <input
              type="datetime-local"
              value={form.start_at}
              onChange={(e) => setForm((f) => ({ ...f, start_at: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-desktop-text outline-none"
            />
            <input
              type="datetime-local"
              value={form.end_at}
              onChange={(e) => setForm((f) => ({ ...f, end_at: e.target.value }))}
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-desktop-text outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => editing ? handleUpdate(editing) : handleCreate()}
              disabled={saving || !form.title || !form.content}
              className="px-3 py-1.5 rounded-lg bg-desktop-accent/50 hover:bg-desktop-accent/70 disabled:opacity-40 text-xs text-desktop-text transition-colors"
            >
              {saving ? t('settings.saving', 'Saving…') : t('settings.save', 'Save')}
            </button>
            <button
              onClick={() => { setShowCreate(false); setEditing(null); resetForm(); }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-desktop-muted transition-colors"
            >
              {t('settings.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-xs text-desktop-muted py-8 text-center">{t('settings.loading', 'Loading…')}</div>
      ) : announcements.length === 0 ? (
        <div className="text-xs text-desktop-muted py-8 text-center">{t('settings.noAnnouncements', 'No announcements')}</div>
      ) : (
        <div className="space-y-2">
          {announcements.map((a) => (
            <div key={a.id} className={`rounded-xl border ${a.is_active ? 'border-white/10' : 'border-white/5 opacity-60'} bg-white/[0.02] overflow-hidden`}>
              <div className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[a.type] ?? TYPE_COLORS.info}`}>
                        {a.type.toUpperCase()}
                      </span>
                      {a.is_active ? (
                        <span className="text-[9px] text-green-400">ACTIVE</span>
                      ) : (
                        <span className="text-[9px] text-desktop-muted/40">INACTIVE</span>
                      )}
                      <span className="text-[9px] text-desktop-muted/40">{TARGET_OPTIONS.find((o) => o.value === a.target)?.label ?? a.target}</span>
                    </div>
                    <div className="text-xs text-desktop-text font-medium">{a.title}</div>
                    {a.title_en && <div className="text-[10px] text-desktop-muted/60 mt-0.5">{a.title_en}</div>}
                    <div className="text-[10px] text-desktop-muted/60 mt-1 line-clamp-2">{a.content}</div>
                    <div className="text-[9px] text-desktop-muted/30 mt-1">
                      {a.start_at ? `From ${new Date(a.start_at).toLocaleDateString()}` : ''}
                      {a.end_at ? ` Until ${new Date(a.end_at).toLocaleDateString()}` : ''}
                      {' · '}{new Date(a.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(a)}
                      className="p-1 rounded hover:bg-white/10 text-desktop-muted/40 hover:text-desktop-muted transition-colors"
                      title={t('settings.edit', 'Edit')}
                    >
                      <Edit size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(a.id)}
                      disabled={deleting === a.id}
                      className="p-1 rounded hover:bg-red-500/10 text-desktop-muted/40 hover:text-red-400 transition-colors"
                      title={t('settings.delete', 'Delete')}
                    >
                      {deleting === a.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 系统健康仪表板 ────────────────────────────────────────────

function SystemHealthSettings() {
  const { t } = useTranslation();
  const [data, setData] = useState<{
    uptime: number;
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      systemTotal: number;
      systemFree: number;
      systemUsedPercent: number;
      heapUsedPercent: number;
    };
    cpu: { loadavg: number[]; cores: number };
    tasks: { total: number; pending: number; running: number; completed: number; failed: number };
    database: { dialect: string; status: string; error?: string };
    version: string;
    pid: number;
    timestamp: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.systemHealthGet();
      setData(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const fmtBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const fmtUptime = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const dbOk = data?.database.status === 'ok';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('settings.systemHealth')}</h2>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-desktop-muted hover:text-desktop-text transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh')}
        </button>
      </div>

      {loading && !data && (
        <div className="text-center text-desktop-muted py-8">{t('common.loading')}</div>
      )}

      {data && (
        <div>
          {/* 概览卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-xs text-desktop-muted mb-1">运行时间</div>
              <div className="text-xl font-mono">{fmtUptime(data.uptime)}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-xs text-desktop-muted mb-1">内存使用</div>
              <div className="text-xl font-mono">{data.memory.systemUsedPercent}%</div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-xs text-desktop-muted mb-1">CPU 负载</div>
              <div className="text-xl font-mono">{data.cpu.loadavg[0].toFixed(2)}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-xs text-desktop-muted mb-1">数据库</div>
              <div className={`text-xl font-mono ${dbOk ? 'text-green-400' : 'text-red-400'}`}>
                {dbOk ? 'OK' : 'ERROR'}
              </div>
            </div>
          </div>

          {/* 详细指标 */}
          <div className="space-y-3">
            {/* 内存详情 */}
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm font-medium mb-3">内存</div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-desktop-muted">堆内存</span>
                  <span>{fmtBytes(data.memory.heapUsed)} / {fmtBytes(data.memory.heapTotal)} ({data.memory.heapUsedPercent}%)</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full" style={{ width: `${data.memory.heapUsedPercent}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-desktop-muted">RSS</span>
                  <span>{fmtBytes(data.memory.rss)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-desktop-muted">系统内存</span>
                  <span>{fmtBytes(data.memory.systemTotal - data.memory.systemFree)} / {fmtBytes(data.memory.systemTotal)} ({data.memory.systemUsedPercent}%)</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-400 rounded-full" style={{ width: `${data.memory.systemUsedPercent}%` }} />
                </div>
              </div>
            </div>

            {/* CPU 详情 */}
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm font-medium mb-3">CPU</div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-desktop-muted">核心数</span>
                  <span>{data.cpu.cores}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-desktop-muted">1 分钟负载</span>
                  <span>{data.cpu.loadavg[0].toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-desktop-muted">5 分钟负载</span>
                  <span>{data.cpu.loadavg[1].toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-desktop-muted">15 分钟负载</span>
                  <span>{data.cpu.loadavg[2].toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* 任务统计 */}
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm font-medium mb-3">任务统计</div>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div>
                  <div className="text-lg font-mono">{data.tasks.total}</div>
                  <div className="text-xs text-desktop-muted">总计</div>
                </div>
                <div>
                  <div className="text-lg font-mono text-yellow-400">{data.tasks.pending}</div>
                  <div className="text-xs text-desktop-muted">等待中</div>
                </div>
                <div>
                  <div className="text-lg font-mono text-blue-400">{data.tasks.running}</div>
                  <div className="text-xs text-desktop-muted">运行中</div>
                </div>
                <div>
                  <div className="text-lg font-mono text-green-400">{data.tasks.completed}</div>
                  <div className="text-xs text-desktop-muted">已完成</div>
                </div>
                <div>
                  <div className="text-lg font-mono text-red-400">{data.tasks.failed}</div>
                  <div className="text-xs text-desktop-muted">失败</div>
                </div>
              </div>
            </div>

            {/* 数据库 */}
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm font-medium mb-3">数据库</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-desktop-muted">类型</span>
                  <span>{data.database.dialect.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-desktop-muted">状态</span>
                  <span className={dbOk ? 'text-green-400' : 'text-red-400'}>
                    {dbOk ? 'Connected' : data.database.error ?? 'Error'}
                  </span>
                </div>
              </div>
            </div>

            {/* 系统信息 */}
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm font-medium mb-3">系统信息</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-desktop-muted">Node.js 版本</span>
                  <span>{data.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-desktop-muted">进程 PID</span>
                  <span>{data.pid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-desktop-muted">最后更新</span>
                  <span>{new Date(data.timestamp).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}
    </div>
  );
}

// ── Lifecycle Hooks ─────────────────────────────────────────────

const HOOK_POINTS = [
  { value: 'beforeInbound', label: 'Before Inbound Message' },
  { value: 'beforeToolCall', label: 'Before Tool Call' },
  { value: 'beforeOutbound', label: 'Before Outbound Response' },
  { value: 'onSessionStart', label: 'On Session Start' },
  { value: 'onSessionEnd', label: 'On Session End' },
  { value: 'transformResponse', label: 'Transform Response' },
];

function HooksSettings() {
  const { t } = useTranslation();
  const [hooks, setHooks] = useState<Array<{
    id: string; name: string; hookPoint: string; url: string;
    enabled: boolean; failureMode: string; timeoutMs: number;
    headers: Record<string, string>; priority: number;
    createdAt: number; updatedAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', hookPoint: 'beforeInbound', url: '',
    enabled: true, failureMode: 'failOpen', timeoutMs: 5000, priority: 100,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchHooks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.hooksList();
      setHooks(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHooks(); }, [fetchHooks]);

  const resetForm = () => {
    setForm({ name: '', hookPoint: 'beforeInbound', url: '', enabled: true, failureMode: 'failOpen', timeoutMs: 5000, priority: 100 });
    setError(null);
  };

  const handleAdd = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      setError('Name and URL are required');
      return;
    }
    setSaving(true);
    try {
      await api.hooksCreate({ name: form.name.trim(), hookPoint: form.hookPoint, url: form.url, enabled: form.enabled, failureMode: form.failureMode, timeoutMs: form.timeoutMs, priority: form.priority });
      setShowAdd(false);
      resetForm();
      await fetchHooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hook');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing || !form.name.trim() || !form.url.trim()) {
      setError('Name and URL are required');
      return;
    }
    setSaving(true);
    try {
      await api.hooksUpdate(editing, { name: form.name.trim(), hookPoint: form.hookPoint, url: form.url, enabled: form.enabled, failureMode: form.failureMode, timeoutMs: form.timeoutMs, priority: form.priority });
      setEditing(null);
      resetForm();
      await fetchHooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update hook');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this hook?')) return;
    try {
      await api.hooksDelete(id);
      setHooks((prev) => prev.filter((h) => h.id !== id));
    } catch {
      // ignore
    }
  };

  const startEdit = (hook: typeof hooks[0]) => {
    setEditing(hook.id);
    setForm({ name: hook.name, hookPoint: hook.hookPoint, url: hook.url, enabled: hook.enabled, failureMode: hook.failureMode, timeoutMs: hook.timeoutMs, priority: hook.priority });
    setShowAdd(false);
    setError(null);
  };

  const hookPointLabel = (pt: string) => HOOK_POINTS.find((p) => p.value === pt)?.label ?? pt;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('settings.lifecycleHooks')}</h2>
        <button
          onClick={() => { setShowAdd(true); setEditing(null); resetForm(); }}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-desktop-accent/60 hover:bg-desktop-accent/80 transition-colors"
        >
          <Plus size={14} />
          添加 Hook
        </button>
      </div>

      <p className="text-xs text-desktop-muted">
        Lifecycle Hooks let you intercept and modify agent behavior at key points. Each hook receives an HTTP POST request with event data and can return modifications or reject the operation.
      </p>

      {/* Add/Edit Form */}
      {(showAdd || editing) && (
        <div className="bg-white/5 rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium">{editing ? '编辑 Hook' : '添加新 Hook'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-desktop-muted mb-1">名称 *</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Hook"
              />
            </div>
            <div>
              <label className="block text-xs text-desktop-muted mb-1">Hook 点 *</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                value={form.hookPoint} onChange={(e) => setForm({ ...form, hookPoint: e.target.value })}
              >
                {HOOK_POINTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-desktop-muted mb-1">URL *</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hook"
              />
            </div>
            <div>
              <label className="block text-xs text-desktop-muted mb-1">失败模式</label>
              <select
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                value={form.failureMode} onChange={(e) => setForm({ ...form, failureMode: e.target.value })}
              >
                <option value="failOpen">Fail Open (继续处理)</option>
                <option value="failClosed">Fail Closed (拒绝操作)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-desktop-muted mb-1">超时 (ms)</label>
              <input
                type="number"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: parseInt(e.target.value) || 5000 })} min={500} max={30000}
              />
            </div>
            <div>
              <label className="block text-xs text-desktop-muted mb-1">优先级</label>
              <input
                type="number"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
                value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 100 })} min={1} max={1000}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hook-enabled"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="accent-desktop-accent"
              />
              <label htmlFor="hook-enabled" className="text-xs text-desktop-text">启用</label>
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowAdd(false); setEditing(null); resetForm(); }}
              className="px-4 py-2 rounded-lg text-xs text-desktop-muted hover:bg-white/10 transition-colors"
            >
              取消
            </button>
            <button
              onClick={editing ? handleUpdate : handleAdd}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-xs bg-desktop-accent/60 hover:bg-desktop-accent/80 transition-colors disabled:opacity-50"
            >
              {saving ? '保存中...' : editing ? '保存' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* Hooks List */}
      {loading && hooks.length === 0 && (
        <div className="text-center text-desktop-muted py-8">{t('common.loading')}</div>
      )}

      {!loading && hooks.length === 0 && !showAdd && (
        <div className="text-center text-desktop-muted py-8">
          No lifecycle hooks configured yet.
        </div>
      )}

      {hooks.length > 0 && (
        <div className="space-y-2">
          {hooks.map((hook) => (
            <div key={hook.id} className={`bg-white/5 rounded-lg p-4 ${!hook.enabled ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{hook.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${hook.enabled ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-desktop-muted'}`}>
                      {hook.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-desktop-muted font-mono">
                      {hookPointLabel(hook.hookPoint)}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${hook.failureMode === 'failOpen' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                      {hook.failureMode === 'failOpen' ? 'Fail Open' : 'Fail Closed'}
                    </span>
                  </div>
                  <div className="text-xs text-desktop-muted font-mono truncate">{hook.url}</div>
                  <div className="flex gap-4 mt-1 text-xs text-desktop-muted">
                    <span>超时: {hook.timeoutMs}ms</span>
                    <span>优先级: {hook.priority}</span>
                    <span>创建: {new Date(hook.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(hook)}
                    className="text-xs text-desktop-muted hover:text-desktop-text transition-colors"
                    title="Edit"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(hook.id)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LLM Council ──────────────────────────────────────────────

function CouncilSettings() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [selectedModels, setSelectedModels] = useState<Array<{ providerId: string; modelId: string }>>([]);
  const [results, setResults] = useState<CouncilResult[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Available models (from LLM config — show the default)
  const [availableModels] = useState<Array<{ providerId: string; modelId: string; label: string }>>([
    { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4 (OpenRouter)' },
    { providerId: 'openrouter', modelId: 'openai/gpt-4o', label: 'GPT-4o (OpenRouter)' },
    { providerId: 'openrouter', modelId: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (OpenRouter)' },
    { providerId: 'openrouter', modelId: 'anthropic/claude-opus-4-7', label: 'Claude Opus 4 (OpenRouter)' },
  ]);

  type CouncilResult = {
    providerId: string; modelId: string; response: string; error?: string; elapsedMs: number;
  };

  const toggleModel = (m: typeof availableModels[0]) => {
    setSelectedModels((prev) => {
      const idx = prev.findIndex((s) => s.providerId === m.providerId && s.modelId === m.modelId);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, { providerId: m.providerId, modelId: m.modelId }];
    });
  };

  const handleSubmit = async () => {
    if (!prompt.trim()) { setError('Please enter a prompt'); return; }
    if (selectedModels.length === 0) { setError('Please select at least one model'); return; }
    setError(null);
    setResults([]);
    setSynthesis(null);
    setLoading(true);
    try {
      const data = await api.councilQuery({
        prompt,
        context: context || undefined,
        models: selectedModels,
      });
      setResults(data.results);
      if (data.synthesis) setSynthesis(data.synthesis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Council query failed');
    } finally {
      setLoading(false);
    }
  };

  const fmtTime = (ms: number) => `${ms}ms`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('settings.llmCouncil')}</h2>
      </div>

      <p className="text-xs text-desktop-muted">
        Query multiple AI models in parallel and compare their responses. Select models below and enter your question.
      </p>

      {/* Model Selection */}
      <div className="bg-white/5 rounded-lg p-4">
        <div className="text-sm font-medium mb-3">选择模型</div>
        <div className="grid grid-cols-2 gap-2">
          {availableModels.map((m) => {
            const selected = selectedModels.some(
              (s) => s.providerId === m.providerId && s.modelId === m.modelId,
            );
            return (
              <button
                key={`${m.providerId}/${m.modelId}`}
                onClick={() => toggleModel(m)}
                className={`text-left px-3 py-2 rounded-lg text-xs transition-colors border ${
                  selected
                    ? 'border-desktop-accent/60 bg-desktop-accent/20 text-desktop-text'
                    : 'border-white/10 bg-white/5 text-desktop-muted hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${selected ? 'bg-green-400' : 'bg-white/20'}`} />
                  <span className="truncate">{m.label}</span>
                </div>
                <div className="text-xs text-desktop-muted mt-0.5 font-mono truncate ml-5">{m.modelId}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Prompt */}
      <div className="bg-white/5 rounded-lg p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">问题 *</label>
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-desktop-highlight/50 resize-y"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What are the main risks of relying on a single LLM provider?"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">上下文 (可选)</label>
          <textarea
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-desktop-highlight/50 resize-y"
            rows={2}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Additional context or background information..."
          />
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
        <button
          onClick={handleSubmit}
          disabled={loading || selectedModels.length === 0 || !prompt.trim()}
          className="px-4 py-2 rounded-lg text-sm bg-desktop-accent/60 hover:bg-desktop-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              Querying {selectedModels.length} model{selectedModels.length > 1 ? 's' : ''}...
            </span>
          ) : (
            <span>查询模型议会</span>
          )}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium">模型回复</div>
          {results.map((r) => (
            <div key={`${r.providerId}/${r.modelId}`} className={`bg-white/5 rounded-lg p-4 ${r.error ? 'border border-red-500/30' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{r.modelId}</span>
                  {r.error ? (
                    <span className="text-xs text-red-400">Error</span>
                  ) : (
                    <span className="text-xs text-green-400">OK</span>
                  )}
                </div>
                <span className="text-xs text-desktop-muted font-mono">{fmtTime(r.elapsedMs)}</span>
              </div>
              {r.error ? (
                <div className="text-xs text-red-400">{r.error}</div>
              ) : (
                <div className="text-sm text-desktop-text whitespace-pre-wrap">{r.response}</div>
              )}
            </div>
          ))}

          {synthesis && (
            <div className="bg-desktop-accent/10 border border-desktop-accent/30 rounded-lg p-4">
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <Sparkles size={14} className="text-yellow-400" />
                综合分析
              </div>
              <div className="text-sm text-desktop-text whitespace-pre-wrap">{synthesis}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Audit Log ─────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  critical: 'text-red-400',
};

const TYPE_COLORS: Record<string, string> = {
  intent: 'text-blue-400',
  action: 'text-purple-400',
  result: 'text-green-400',
  approval: 'text-yellow-400',
  error: 'text-red-400',
  system: 'text-gray-400',
};

function AuditLogSettings() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Array<{
    id: string; userId: string | null; taskId: string; stepId: string | null;
    type: string; intent: string | null; action: string | null; result: string | null;
    riskLevel: string | null; metadata: Record<string, unknown> | null; createdAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filterType, setFilterType] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [filterTaskId, setFilterTaskId] = useState('');
  const [stats, setStats] = useState<{ total: number; byType: Record<string, number> } | null>(null);
  const LIMIT = 50;

  const fetchEntries = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const data = await api.auditLogQuery({
        type: filterType || undefined,
        riskLevel: filterRisk || undefined,
        taskId: filterTaskId || undefined,
        limit: LIMIT,
        offset: p * LIMIT,
      });
      setEntries(data.data);
      setTotal(data.meta.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterType, filterRisk, filterTaskId]);

  useEffect(() => { fetchEntries(0); setPage(0); }, [fetchEntries]);

  useEffect(() => {
    api.auditLogStats().then((d) => setStats(d.data)).catch(() => {});
  }, []);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('settings.auditLog')}</h2>
        <div className="flex items-center gap-4 text-xs text-desktop-muted">
          <span>{total.toLocaleString()} 条记录</span>
          <button
            onClick={() => fetchEntries(page)}
            disabled={loading}
            className="flex items-center gap-1 hover:text-desktop-text transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {Object.entries(stats.byType).map(([type, count]) => (
            <div key={type} className="bg-white/5 rounded-lg p-3 text-center">
              <div className={`text-lg font-mono ${TYPE_COLORS[type] ?? 'text-desktop-text'}`}>{count}</div>
              <div className="text-xs text-desktop-muted capitalize">{type}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); }}
        >
          <option value="">所有类型</option>
          {['intent', 'action', 'result', 'approval', 'error', 'system'].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50"
          value={filterRisk}
          onChange={(e) => { setFilterRisk(e.target.value); }}
        >
          <option value="">所有风险</option>
          {['low', 'medium', 'high', 'critical'].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <input
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-desktop-highlight/50 flex-1 min-w-32"
          placeholder="Task ID 过滤..."
          value={filterTaskId}
          onChange={(e) => setFilterTaskId(e.target.value)}
        />
        {(filterType || filterRisk || filterTaskId) && (
          <button
            onClick={() => { setFilterType(''); setFilterRisk(''); setFilterTaskId(''); }}
            className="text-xs text-desktop-muted hover:text-desktop-text"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* Table */}
      {loading && entries.length === 0 ? (
        <div className="text-center text-desktop-muted py-8">{t('common.loading')}</div>
      ) : entries.length === 0 ? (
        <div className="text-center text-desktop-muted py-8">暂无审计日志</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-desktop-muted">
                  <th className="text-left py-2 px-3 font-medium">时间</th>
                  <th className="text-left py-2 px-3 font-medium">类型</th>
                  <th className="text-left py-2 px-3 font-medium">意图</th>
                  <th className="text-left py-2 px-3 font-medium">动作</th>
                  <th className="text-left py-2 px-3 font-medium">结果</th>
                  <th className="text-left py-2 px-3 font-medium">风险</th>
                  <th className="text-left py-2 px-3 font-medium">Task ID</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 px-3 text-desktop-muted font-mono whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`${TYPE_COLORS[entry.type] ?? 'text-desktop-text'} capitalize font-medium`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-desktop-text max-w-xs truncate" title={entry.intent ?? ''}>
                      {entry.intent ?? '—'}
                    </td>
                    <td className="py-2 px-3 text-desktop-text max-w-xs truncate" title={entry.action ?? ''}>
                      {entry.action ?? '—'}
                    </td>
                    <td className="py-2 px-3 text-desktop-muted max-w-xs truncate" title={entry.result ?? ''}>
                      {entry.result ?? '—'}
                    </td>
                    <td className="py-2 px-3">
                      {entry.riskLevel ? (
                        <span className={`${RISK_COLORS[entry.riskLevel] ?? 'text-desktop-text'} capitalize font-mono`}>
                          {entry.riskLevel}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3 text-desktop-muted font-mono max-w-[100px] truncate" title={entry.taskId}>
                      {entry.taskId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => { const p = page - 1; if (p >= 0) { setPage(p); fetchEntries(p); } }}
                disabled={page === 0}
                className="px-3 py-1 rounded text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                上一页
              </button>
              <span className="text-xs text-desktop-muted">
                第 {page + 1} / {totalPages} 页
              </span>
              <button
                onClick={() => { const p = page + 1; if (p < totalPages) { setPage(p); fetchEntries(p); } }}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 rounded text-xs bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
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

interface CodeSnippet {
  id: string;
  title: string;
  code: string;
  language: string;
  description?: string;
  createdAt: number;
}

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'bash', 'shell', 'sql',
  'html', 'css', 'json', 'yaml', 'markdown', 'go', 'rust', 'java',
  'csharp', 'cpp', 'c', 'ruby', 'php', 'swift', 'kotlin', 'other',
];

function SnippetsSettings() {
  const { t } = useTranslation();
  const [snippets, setSnippets] = useState<CodeSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CodeSnippet>>({ language: 'javascript' });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.getUserConfig().then((cfg) => {
      const raw = cfg['snippets'];
      if (Array.isArray(raw)) setSnippets(raw as CodeSnippet[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!form.title?.trim() || !form.code?.trim()) return;
    setSaving(true);
    let updated: CodeSnippet[];
    if (editingId) {
      updated = snippets.map((s) => s.id === editingId ? { ...s, ...form, updatedAt: Date.now() } as CodeSnippet : s);
    } else {
      const newSnippet: CodeSnippet = {
        id: `snip-${Date.now()}`,
        title: form.title!.trim(),
        code: form.code!,
        language: form.language || 'javascript',
        description: form.description,
        createdAt: Date.now(),
      };
      updated = [...snippets, newSnippet];
    }
    try {
      await api.setUserConfig({ snippets: updated });
      setSnippets(updated);
      resetForm();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('settings.snippetDeleteConfirm'))) return;
    const updated = snippets.filter((s) => s.id !== id);
    await api.setUserConfig({ snippets: updated }).catch(() => {});
    setSnippets(updated);
  };

  const handleEdit = (snippet: CodeSnippet) => {
    setForm({ ...snippet });
    setEditingId(snippet.id);
    setShowForm(true);
  };

  const handleCopy = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const resetForm = () => {
    setForm({ language: 'javascript' });
    setEditingId(null);
    setShowForm(false);
  };

  const filtered = snippets.filter((s) =>
    !filter ||
    s.title.toLowerCase().includes(filter.toLowerCase()) ||
    s.code.toLowerCase().includes(filter.toLowerCase()) ||
    s.language.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) {
    return <div className="text-xs text-desktop-muted p-4">{t('common.loading', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-desktop-text">{t('settings.snippets')}</h3>
          <p className="text-[11px] text-desktop-muted mt-1">{t('settings.snippetsDesc')}</p>
        </div>
        <button
          type="button"
          onClick={() => { resetForm(); setShowForm(true); }}
          className="text-[11px] px-3 py-1.5 rounded bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80 transition-colors flex items-center gap-1"
        >
          <Plus size={12} /> {t('settings.snippetAdd')}
        </button>
      </div>

      {snippets.length > 0 && (
        <div className="flex">
          <input
            type="text"
            placeholder={t('settings.snippetSearchPlaceholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text placeholder:text-desktop-muted outline-none"
          />
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="border border-white/10 rounded-lg p-4 space-y-3 bg-white/[0.02]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-desktop-muted block mb-1">{t('settings.snippetTitle')}</label>
              <input
                type="text"
                value={form.title ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
                placeholder="e.g. React useEffect cleanup"
              />
            </div>
            <div>
              <label className="text-[11px] text-desktop-muted block mb-1">{t('settings.snippetLanguage')}</label>
              <select
                value={form.language ?? 'javascript'}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-desktop-muted block mb-1">{t('settings.snippetDescription')} (optional)</label>
            <input
              type="text"
              value={form.description ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] text-desktop-muted block mb-1">{t('settings.snippetCode')}</label>
            <textarea
              value={form.code ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              rows={6}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-desktop-text outline-none font-mono resize-y"
              placeholder="// your code here"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="text-[11px] px-3 py-1.5 rounded text-desktop-muted hover:bg-white/5">
              {t('settings.snippetCancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !form.title?.trim() || !form.code?.trim()}
              className="text-[11px] px-3 py-1.5 rounded bg-desktop-accent/60 text-desktop-text hover:bg-desktop-accent/80 disabled:opacity-50"
            >
              {t('settings.snippetSave')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 && !showForm ? (
        <p className="text-xs text-desktop-muted text-center py-8">{t('settings.snippetNoSnippets')}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((snippet) => (
            <div key={snippet.id} className="border border-white/10 rounded-lg p-3 hover:border-white/20 transition-colors group">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-desktop-accent/20 text-desktop-accent shrink-0">{snippet.language}</span>
                  <span className="text-xs font-medium text-desktop-text truncate">{snippet.title}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleCopy(snippet.code, snippet.id)}
                    className="p-1 rounded text-desktop-muted hover:text-desktop-text hover:bg-white/10"
                    title="Copy"
                  >
                    {copied === snippet.id
                      ? <CheckCircle size={12} className="text-green-400" />
                      : <Copy size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(snippet)}
                    className="p-1 rounded text-desktop-muted hover:text-desktop-text hover:bg-white/10"
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(snippet.id)}
                    className="p-1 rounded text-desktop-muted hover:text-red-400 hover:bg-white/10"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {snippet.description && (
                <p className="text-[11px] text-desktop-muted mb-2">{snippet.description}</p>
              )}
              <pre className="text-[11px] text-desktop-text/80 bg-black/20 rounded p-2 overflow-auto max-h-32 font-mono leading-relaxed">
                {snippet.code}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

// ── 工具列表（展示所有可用工具）──────────────────

function ToolsSettings() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  useEffect(() => {
    api.getTools().then(setTools).finally(() => setLoading(false));
  }, []);

  const filteredTools = tools.filter(
    (tool) =>
      !searchQuery ||
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder={t('settings.searchTools')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 outline-none focus:ring-1 focus:ring-green-400/50"
        />
      </div>
      {loading ? (
        <div className="text-center py-4 text-gray-500">
          <RefreshCw size={16} className="animate-spin inline mr-2" />
          {t('common.loading')}
        </div>
      ) : filteredTools.length === 0 ? (
        <div className="text-center py-4 text-gray-500">{t('settings.noTools')}</div>
      ) : (
        filteredTools.map((tool) => (
          <div key={tool.name} className="rounded-lg bg-white/[0.03] border border-white/5 overflow-hidden">
            <button
              onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5"
            >
              <div className="flex items-center gap-2 min-w-0">
                {expandedTool === tool.name ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-mono text-sm text-green-300 truncate">{tool.name}</span>
              </div>
              <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
            </button>
            {expandedTool === tool.name && (
              <div className="px-3 pb-3 border-t border-white/5 pt-2">
                <p className="text-xs text-gray-400 mb-2">{tool.description || t('common.noDescription')}</p>
                {tool.parameters && tool.parameters.length > 0 && (
                  <pre className="text-xs font-mono bg-black/30 p-2 rounded overflow-x-auto">
                    {JSON.stringify(tool.parameters, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))
      )}
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
          <p className="text-desktop-muted text-[11px]">点击复制安装指令，发送给我来安装 Skill。</p>
          <div className="flex flex-wrap gap-2">
            {recommended.map((r) => (
              <div
                key={r.slug}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/5"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-desktop-text">{r.name}</span>
                    <span className="text-[9px] px-1 rounded bg-purple-500/20 text-purple-300">{(r as any).source === 'openclaw' ? 'OpenClaw' : 'SkillHub'}</span>
                  </div>
                  <p className="text-[10px] text-desktop-muted line-clamp-1">{r.description}</p>
                </div>
                {r.installed ? (
                  <span className="text-[10px] text-green-400 shrink-0">已安装</span>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 px-2 py-1 rounded text-[10px] bg-blue-500/30 hover:bg-blue-500/50 text-blue-300 flex items-center gap-1"
                    onClick={() => {
                      const source = (r as any).source === 'openclaw' ? 'openclaw' : 'skillhub';
                      const text = `帮我安装 Skill ${r.name}，使用 ${source}:${r.slug}`;
                      navigator.clipboard.writeText(text);
                      setInstallingSlug(r.slug);
                      setTimeout(() => setInstallingSlug(null), 2000);
                    }}
                  >
                    {installingSlug === r.slug ? <><CheckCircle size={10} /> 已复制</> : <><Copy size={10} /> 复制</>}
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
