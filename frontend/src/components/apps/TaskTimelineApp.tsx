import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopStore } from '@/store/desktopStore';
import { api, isQuotaError } from '@/utils/api';
import {
  Clock, CheckCircle2, XCircle, Loader2, AlertTriangle,
  Play, Pause, RotateCcw, Eye, Shield, Zap, RefreshCw,
  Trash2, Filter, ChevronDown, ArrowRight,
} from 'lucide-react';
import type { Task, AuditEntry, TaskStatus, TaskDomain } from '@shared/index';

interface Props {
  windowId: string;
}

function getStatusConfig(t: (k: string) => string): Record<TaskStatus, { icon: React.ElementType; color: string; label: string }> {
  return {
    pending: { icon: Clock, color: 'text-desktop-muted', label: t('taskTimeline.pending') },
    planning: { icon: Loader2, color: 'text-blue-400', label: t('taskTimeline.planning') },
    running: { icon: Loader2, color: 'text-green-400', label: t('taskTimeline.running') },
    awaiting_approval: { icon: Shield, color: 'text-yellow-400', label: t('taskTimeline.awaitingApproval') },
    paused: { icon: Pause, color: 'text-orange-400', label: t('taskTimeline.paused') },
    completed: { icon: CheckCircle2, color: 'text-green-400', label: t('taskTimeline.completed') },
    failed: { icon: XCircle, color: 'text-red-400', label: t('taskTimeline.failed') },
    cancelled: { icon: XCircle, color: 'text-desktop-muted', label: t('taskTimeline.cancelled') },
  };
}

function getDomainLabels(t: (k: string) => string): Record<TaskDomain, string> {
  return {
    chat: t('taskTimeline.domainChat'),
    coding: t('taskTimeline.domainCoding'),
    agent: t('taskTimeline.domainAgent'),
    office: t('taskTimeline.domainOffice'),
  };
}

const DOMAIN_COLORS: Record<TaskDomain, string> = {
  chat: 'bg-blue-500/20 text-blue-400',
  coding: 'bg-green-500/20 text-green-400',
  agent: 'bg-purple-500/20 text-purple-400',
  office: 'bg-yellow-500/20 text-yellow-400',
};

/** X 定时任务条目（与 api.getXSchedulerStatus 的 jobs 一致） */
type SchedulerJob = { id: string; intent: string; runAt: number; runAtISO: string; cron?: string };

const DISPLAY_TIMEZONE = 'Asia/Shanghai';
/** 下次运行时间展示（东八区） */
function formatNextRun(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
  const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
  const dDate = d.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
  const time = d.toLocaleTimeString('zh-CN', { timeZone: DISPLAY_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });
  if (dDate === today) return `今日 ${time}`;
  if (dDate === tomorrow) return `明日 ${time}`;
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: DISPLAY_TIMEZONE, month: 'numeric', day: 'numeric' }).formatToParts(d);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${month}月${day}日 ${time}`;
}

export function TaskTimelineApp({ windowId }: Props) {
  const { t } = useTranslation();
  const STATUS_CONFIG = useMemo(() => getStatusConfig(t), [t]);
  const DOMAIN_LABELS = useMemo(() => getDomainLabels(t), [t]);
  const tasksRaw = useDesktopStore((s) => s.tasks);
  const tasks = Array.isArray(tasksRaw) ? tasksRaw : [];
  const auditLogRaw = useDesktopStore((s) => s.auditLog);
  const auditLog = Array.isArray(auditLogRaw) ? auditLogRaw : [];
  const toolsRaw = useDesktopStore((s) => s.tools);
  const tools = Array.isArray(toolsRaw) ? toolsRaw : [];
  const fetchTools = useDesktopStore((s) => s.fetchTools);
  const { addNotification, addAuditEntry, syncAuditLog } = useDesktopStore();

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const getToolDisplayName = (name: string) => tools.find((t) => t.name === name)?.displayName ?? name;

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedScheduledId, setSelectedScheduledId] = useState<string | null>(null);
  const [scheduledJobs, setScheduledJobs] = useState<SchedulerJob[]>([]);
  const [viewMode, setViewMode] = useState<'tasks' | 'audit'>('tasks');
  const [filterDomain, setFilterDomain] = useState<TaskDomain | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all');
  const [loading, setLoading] = useState(false);

  // Load tasks, audit, and X scheduled jobs from backend on mount
  useEffect(() => {
    loadFromBackend();
  }, []);

  const loadFromBackend = async () => {
    setLoading(true);
    try {
      const [tasksData, auditData, schedulerRes] = await Promise.all([
        api.getTasks(),
        api.getAudit(200),
        api.getXSchedulerStatus().catch(() => ({ jobs: [] as SchedulerJob[] })),
      ]);
      useDesktopStore.getState().syncTasks(tasksData);
      syncAuditLog(auditData);
      setScheduledJobs(Array.isArray(schedulerRes?.jobs) ? schedulerRes.jobs : []);
    } catch (err) {
      // Backend might not be running
    } finally {
      setLoading(false);
    }
  };

  /** 刷新当前选中任务的详情（从服务器拉取最新步骤与结果） */
  const refreshSelectedTask = useCallback(async () => {
    if (!selectedTaskId) return;
    try {
      const task = await api.getTask(selectedTaskId);
      useDesktopStore.getState().upsertTask(selectedTaskId, task);
    } catch {
      // 可能 403/404，忽略
    }
  }, [selectedTaskId]);

  const handleApprove = async (taskId: string, stepId: string) => {
    try {
      await api.approveStep(taskId, stepId);
      addNotification({ type: 'info', title: t('taskTimeline.approved'), message: t('taskTimeline.approvedMsg') });
      // Refresh
      setTimeout(loadFromBackend, 1000);
    } catch (err: any) {
      const msg = isQuotaError(err)
        ? `${t('errors.quotaExceededFriendly')} ${t('errors.quotaUpgradeHint')}`
        : err?.message ?? String(err);
      addNotification({ type: 'error', title: isQuotaError(err) ? t('errors.quotaExceeded') : t('common.error'), message: msg });
    }
  };

  const handleReject = async (taskId: string, stepId: string) => {
    try {
      await api.rejectStep(taskId, stepId);
      addNotification({ type: 'warning', title: t('taskTimeline.rejected'), message: t('taskTimeline.rejectedMsg') });
      setTimeout(loadFromBackend, 500);
    } catch (err: any) {
      const msg = isQuotaError(err)
        ? `${t('errors.quotaExceededFriendly')} ${t('errors.quotaUpgradeHint')}`
        : err?.message ?? String(err);
      addNotification({ type: 'error', title: isQuotaError(err) ? t('errors.quotaExceeded') : t('common.error'), message: msg });
    }
  };

  const handlePause = async (taskId: string) => {
    try {
      await api.pauseTask(taskId);
      addNotification({ type: 'info', title: t('taskTimeline.paused'), message: t('taskTimeline.pausedMsg') });
      setTimeout(loadFromBackend, 500);
    } catch (err: any) {
      const msg = isQuotaError(err)
        ? `${t('errors.quotaExceededFriendly')} ${t('errors.quotaUpgradeHint')}`
        : err?.message ?? String(err);
      addNotification({ type: 'error', title: isQuotaError(err) ? t('errors.quotaExceeded') : t('common.error'), message: msg });
    }
  };

  const handleResume = async (taskId: string) => {
    try {
      await api.resumeTask(taskId);
      addNotification({ type: 'info', title: t('taskTimeline.resumedMsg'), message: '' });
      setTimeout(loadFromBackend, 1000);
    } catch (err: any) {
      const msg = isQuotaError(err)
        ? `${t('errors.quotaExceededFriendly')} ${t('errors.quotaUpgradeHint')}`
        : err?.message ?? String(err);
      addNotification({ type: 'error', title: isQuotaError(err) ? t('errors.quotaExceeded') : t('common.error'), message: msg });
    }
  };

  const handleRetry = async (taskId: string, mode: 'restart' | 'from_failure') => {
    try {
      await api.retryTask(taskId, mode);
      addNotification({
        type: 'info',
        title: '已重试',
        message: mode === 'from_failure' ? t('taskTimeline.retryFromFailure') : t('taskTimeline.retryFromStart'),
      });
      setTimeout(loadFromBackend, 800);
    } catch (err: any) {
      const msg = isQuotaError(err)
        ? `${t('errors.quotaExceededFriendly')} ${t('errors.quotaUpgradeHint')}`
        : err?.message ?? String(err);
      addNotification({ type: 'error', title: isQuotaError(err) ? t('errors.quotaExceeded') : '重试失败', message: msg });
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filterDomain !== 'all' && t.domain !== filterDomain) return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    return true;
  });

  const selected = tasks.find((t) => t.id === selectedTaskId);
  const selectedJob = scheduledJobs.find((j) => j.id === selectedScheduledId);

  const onSelectTask = (id: string) => {
    setSelectedTaskId(id);
    setSelectedScheduledId(null);
  };
  const onSelectScheduled = (id: string) => {
    setSelectedScheduledId(id);
    setSelectedTaskId(null);
  };

  return (
    <div className="h-full flex flex-col text-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <Clock size={16} className="text-desktop-highlight shrink-0" />
        <span className="text-xs font-medium text-desktop-text">{t('taskTimeline.title')}</span>

        <div className="flex-1" />

        {/* View mode toggle */}
        <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
          <button
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${viewMode === 'tasks' ? 'bg-desktop-accent text-desktop-text' : 'text-desktop-muted hover:text-desktop-text'}`}
            onClick={() => setViewMode('tasks')}
          >
            {t('taskTimeline.tasksCount', { count: tasks.length })}
          </button>
          <button
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${viewMode === 'audit' ? 'bg-desktop-accent text-desktop-text' : 'text-desktop-muted hover:text-desktop-text'}`}
            onClick={() => setViewMode('audit')}
          >
            {t('taskTimeline.auditCount', { count: auditLog.length })}
          </button>
        </div>

        <button
          onClick={loadFromBackend}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="刷新"
        >
          <RefreshCw size={13} className={`text-desktop-muted ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'tasks' ? (
          <>
            {/* Task list */}
            <div className="w-72 border-r border-white/5 flex flex-col overflow-hidden">
              {/* Filters */}
              <div className="flex gap-1.5 px-2 py-2 border-b border-white/5">
                <select
                  className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-1 text-desktop-muted outline-none"
                  value={filterDomain}
                  onChange={(e) => setFilterDomain(e.target.value as any)}
                >
                  <option value="all">{t('taskTimeline.allDomains')}</option>
                  <option value="chat">聊天</option>
                  <option value="coding">编程</option>
                  <option value="agent">智能体</option>
                  <option value="office">办公</option>
                </select>
                <select
                  className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-1 text-desktop-muted outline-none"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                >
                  <option value="all">{t('taskTimeline.allStatuses')}</option>
                  <option value="running">{t('taskTimeline.running')}</option>
                  <option value="awaiting_approval">{t('taskTimeline.awaitingApproval')}</option>
                  <option value="completed">{t('taskTimeline.completed')}</option>
                  <option value="failed">{t('taskTimeline.failed')}</option>
                  <option value="paused">已暂停</option>
                </select>
              </div>

              {/* List: X 的定时任务 + 执行记录 */}
              <div className="flex-1 overflow-auto">
                {/* X 的定时任务 */}
                {scheduledJobs.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-[10px] font-medium text-desktop-muted uppercase tracking-wide border-b border-white/5">
                      {t('taskTimeline.xScheduledCount', { count: scheduledJobs.length })}
                    </div>
                    {scheduledJobs.map((job) => (
                      <div
                        key={job.id}
                        className={`px-3 py-2.5 border-b border-white/5 cursor-pointer transition-colors ${
                          selectedScheduledId === job.id ? 'bg-desktop-accent/30' : 'hover:bg-white/[0.03]'
                        }`}
                        onClick={() => onSelectScheduled(job.id)}
                      >
                        <div className="flex items-center gap-2">
                          <Clock size={14} className="text-desktop-muted shrink-0" />
                          <span className="text-xs text-desktop-text/90 truncate flex-1" title={job.intent}>
                            {job.intent}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 ml-5 text-[10px] text-desktop-muted/40 flex-wrap">
                          <span title={job.runAtISO}>下次 {formatNextRun(job.runAt)}</span>
                          {job.cron && <span className="font-mono opacity-80">{job.cron}</span>}
                        </div>
                      </div>
                    ))}
                    <div className="px-2 py-1.5 text-[10px] font-medium text-desktop-muted uppercase tracking-wide border-b border-white/5 mt-1">
                      {t('taskTimeline.execRecordsCount', { count: filteredTasks.length })}
                    </div>
                  </>
                )}
                {filteredTasks.length === 0 && scheduledJobs.length === 0 ? (
                  <div className="text-center py-12 text-desktop-muted text-xs">
                    {t('taskTimeline.noTasksHint')}
                  </div>
                ) : filteredTasks.length === 0 ? (
                  <div className="text-center py-6 text-desktop-muted text-xs">{t('taskTimeline.noMatch')}</div>
                ) : (
                  filteredTasks.map((task) => {
                    const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
                    const StatusIcon = config.icon;
                    const steps = task.steps ?? [];
                    const completedSteps = steps.filter((s) => s.status === 'completed').length;
                    return (
                      <div
                        key={task.id}
                        className={`px-3 py-2.5 border-b border-white/5 cursor-pointer transition-colors ${
                          selectedTaskId === task.id ? 'bg-desktop-accent/30' : 'hover:bg-white/[0.03]'
                        }`}
                        onClick={() => onSelectTask(task.id)}
                      >
                        <div className="flex items-center gap-2">
                          <StatusIcon
                            size={14}
                            className={`${config.color} ${task.status === 'running' || task.status === 'planning' ? 'animate-spin' : ''} shrink-0`}
                          />
                          <span className="text-xs text-desktop-text/90 truncate flex-1">{task.title}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 ml-5">
                          <span className={`text-[10px] rounded px-1.5 py-0.5 ${DOMAIN_COLORS[task.domain]}`}>
                            {DOMAIN_LABELS[task.domain]}
                          </span>
                          <span className={`text-[10px] ${config.color}`}>{config.label}</span>
                          <span className="text-[10px] text-desktop-muted/40 ml-auto">
                            {completedSteps}/{steps.length}
                          </span>
                          <span className="text-[10px] text-desktop-muted/40" title={new Date(task.updatedAt).toLocaleString('zh-CN', { timeZone: DISPLAY_TIMEZONE })}>
                            {new Date(task.updatedAt).toLocaleString('zh-CN', { timeZone: DISPLAY_TIMEZONE, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Task / 定时任务 detail */}
            <div className="flex-1 overflow-auto p-4">
              {selectedJob ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-desktop-muted shrink-0" />
                    <span className="text-xs font-medium text-desktop-muted">{t('taskTimeline.xScheduled')}</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-desktop-text mb-1">{t('taskTimeline.intent')}</h3>
                    <p className="text-sm text-desktop-text/90 whitespace-pre-wrap break-words">{selectedJob.intent}</p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-desktop-muted">
                    <span title={selectedJob.runAtISO}>
                      下次运行：{formatNextRun(selectedJob.runAt)}
                    </span>
                    {selectedJob.cron && (
                      <span className="font-mono" title="cron 表达式">
                        cron: {selectedJob.cron}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-desktop-muted/50">ID: {selectedJob.id}</p>
                </div>
              ) : selected ? (() => {
                const selectedSteps = selected.steps ?? [];
                return (
                <div className="space-y-4">
                  {/* Task header */}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium text-desktop-text flex-1 min-w-0">{selected.title}</h3>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 ${DOMAIN_COLORS[selected.domain]}`}>
                        {DOMAIN_LABELS[selected.domain]}
                      </span>
                      <button
                        type="button"
                        onClick={refreshSelectedTask}
                        className="p-1.5 rounded hover:bg-white/10 transition-colors"
                        title={t('taskTimeline.refreshHint')}
                      >
                        <RefreshCw size={12} className="text-desktop-muted" />
                      </button>
                    </div>
                    <p className="text-xs text-desktop-muted mt-1">{selected.description}</p>
                    <div className="text-[10px] text-desktop-muted/50 mt-1">
                      ID: {selected.id.slice(0, 8)}... · 创建于 {new Date(selected.createdAt).toLocaleString('zh-CN', { timeZone: DISPLAY_TIMEZONE })}
                    </div>
                  </div>

                  {/* Task actions */}
                  <div className="flex gap-2">
                    {selected.status === 'running' && (
                      <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 text-xs hover:bg-orange-500/25 transition-colors"
                        onClick={() => handlePause(selected.id)}
                      >
                        <Pause size={12} /> 暂停
                      </button>
                    )}
                    {selected.status === 'paused' && (
                      <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs hover:bg-green-500/25 transition-colors"
                        onClick={() => handleResume(selected.id)}
                      >
                        <Play size={12} /> 恢复
                      </button>
                    )}
                    {selected.status === 'failed' && (
                      <>
                        <button
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 text-xs hover:bg-blue-500/25 transition-colors"
                          onClick={() => handleRetry(selected.id, 'restart')}
                        >
                          <RotateCcw size={12} /> 从头重试
                        </button>
                        {selectedSteps.some((s) => s.status === 'failed') && (
                          <button
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs hover:bg-amber-500/25 transition-colors"
                            onClick={() => handleRetry(selected.id, 'from_failure')}
                          >
                            <RefreshCw size={12} /> 从失败处重试
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Approval banner */}
                  {selected.status === 'awaiting_approval' && (() => {
                    const awaitingStep = selectedSteps.find((s) => s.status === 'awaiting_approval');
                    if (!awaitingStep) return null;
                    return (
                      <div className="flex gap-2 p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                        <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="text-xs text-yellow-300 font-medium">{t('taskTimeline.needsApproval')}</div>
                          <div className="text-[11px] text-desktop-muted mt-0.5">
                            步骤「{awaitingStep.action}」(工具: {getToolDisplayName(awaitingStep.toolName)}) 风险等级为 {awaitingStep.riskLevel}，需要确认后才能继续。
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              className="px-4 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-xs hover:bg-green-500/30 transition-colors font-medium"
                              onClick={() => handleApprove(selected.id, awaitingStep.id)}
                            >
                              ✓ {t('taskTimeline.approveExecute')}
                            </button>
                            <button
                              className="px-4 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 transition-colors"
                              onClick={() => handleReject(selected.id, awaitingStep.id)}
                            >
                              ✗ {t('taskTimeline.rejectStep')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Steps timeline */}
                  <div>
                    <div className="text-xs font-medium text-desktop-muted mb-2">{t('taskTimeline.steps')}</div>
                    <div className="space-y-1.5">
                      {selectedSteps.map((step, i) => {
                        const stepConfig = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
                        const StepIcon = stepConfig.icon;
                        const duration = step.startedAt && step.completedAt ? step.completedAt - step.startedAt : null;
                        return (
                          <div
                            key={step.id}
                            className={`flex items-start gap-2.5 py-2.5 px-3 rounded-lg border transition-colors ${
                              step.status === 'awaiting_approval'
                                ? 'bg-yellow-500/5 border-yellow-500/20'
                                : step.status === 'running'
                                  ? 'bg-green-500/5 border-green-500/10'
                                  : 'bg-white/[0.02] border-white/5'
                            }`}
                          >
                            <div className="flex flex-col items-center gap-1 mt-0.5">
                              <StepIcon
                                size={14}
                                className={`${stepConfig.color} ${step.status === 'running' ? 'animate-spin' : ''}`}
                              />
                              {i < selectedSteps.length - 1 && (
                                <div className={`w-px h-4 ${step.status === 'completed' ? 'bg-green-500/30' : 'bg-white/10'}`} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-desktop-text/90 font-medium">{step.action}</div>
                              <div className="text-[10px] text-desktop-muted mt-0.5 flex items-center gap-2 flex-wrap">
                                <span className="bg-white/5 rounded px-1.5 py-0.5">{getToolDisplayName(step.toolName)}</span>
                                <span>风险: <span className={
                                  step.riskLevel === 'high' || step.riskLevel === 'critical'
                                    ? 'text-red-400'
                                    : step.riskLevel === 'medium'
                                      ? 'text-yellow-400'
                                      : 'text-green-400'
                                }>{step.riskLevel}</span></span>
                                {duration != null && <span>耗时: {duration}ms</span>}
                              </div>
                              {step.error && (
                                <div className="text-[10px] text-red-400 mt-1 bg-red-500/10 rounded px-2 py-1">
                                  {step.error}
                                </div>
                              )}
                              {step.output != null && step.status === 'completed' && (
                                <div className="text-[10px] text-desktop-muted/60 mt-1 truncate">
                                  输出: {JSON.stringify(step.output).slice(0, 100)}
                                </div>
                              )}
                            </div>
                            <span className={`text-[10px] shrink-0 ${stepConfig.color}`}>{stepConfig.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Result */}
                  {selected.result && (
                    <div className={`p-3 rounded-xl border ${
                      selected.result.success
                        ? 'bg-green-500/10 border-green-500/20'
                        : 'bg-red-500/10 border-red-500/20'
                    }`}>
                      <div className={`text-xs font-medium flex items-center gap-1.5 ${
                        selected.result.success ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {selected.result.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                        {selected.result.success ? t('taskTimeline.taskDone') : t('taskTimeline.taskFailed')}
                      </div>
                      {selected.result.output != null && (
                        <div className="text-[11px] text-desktop-muted mt-1.5">{String(selected.result.output)}</div>
                      )}
                      {selected.result.error && (
                        <div className="text-[11px] text-red-400/80 mt-1.5">{selected.result.error}</div>
                      )}
                    </div>
                  )}
                </div>
              );
              })() : (
                <div className="flex flex-col items-center justify-center h-full text-desktop-muted text-xs gap-2">
                  <Clock size={32} className="text-desktop-accent" />
                  <p>{t('taskTimeline.selectTaskHint')}</p>
                  <p className="text-[10px] text-desktop-muted/50">{t('taskTimeline.listHint')}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Audit log view */
          <div className="flex-1 overflow-auto p-4">
            {auditLog.length > 0 ? (
              <div className="space-y-1">
                {[...auditLog].reverse().slice(0, 100).map((entry, idx) => (
                  <div key={entry.id || idx} className="flex items-start gap-2.5 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/5 text-xs">
                    <div className="text-[10px] text-desktop-muted tabular-nums shrink-0 mt-0.5 w-16">
                      {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { timeZone: DISPLAY_TIMEZONE })}
                    </div>
                    <span className={`shrink-0 text-[10px] rounded px-1.5 py-0.5 ${
                      entry.type === 'error' ? 'bg-red-500/15 text-red-400' :
                      entry.type === 'approval' ? 'bg-yellow-500/15 text-yellow-400' :
                      entry.type === 'intent' ? 'bg-blue-500/15 text-blue-400' :
                      entry.type === 'result' ? 'bg-green-500/15 text-green-400' :
                      'bg-desktop-highlight/10 text-desktop-highlight/60'
                    }`}>
                      {entry.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      {entry.intent && <div className="text-desktop-text/80 truncate">意图: {entry.intent}</div>}
                      {entry.action && <div className="text-desktop-muted truncate">动作: {entry.action}</div>}
                      {entry.result && <div className="text-desktop-muted/70 truncate">结果: {entry.result}</div>}
                    </div>
                    {entry.riskLevel && (
                      <span className={`text-[10px] shrink-0 ${
                        entry.riskLevel === 'high' || entry.riskLevel === 'critical' ? 'text-red-400' :
                        entry.riskLevel === 'medium' ? 'text-yellow-400' : 'text-green-400/50'
                      }`}>
                        {entry.riskLevel}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-desktop-muted text-xs gap-2">
                <Eye size={32} className="text-desktop-accent" />
                <p>{t('taskTimeline.auditEmpty')}</p>
                <p className="text-[10px] text-desktop-muted/50">{t('taskTimeline.auditHint')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
