import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  CirclePause,
  CirclePlay,
  Compass,
  Lightbulb,
  Plus,
  RefreshCw,
  Route,
  Target,
} from 'lucide-react';
import type {
  LivingAIAutonomyMode,
  LivingAICognitiveMode,
  LivingAIPhase,
  LivingAIStatus,
} from '@x-computer/shared';
import { api } from '@/utils/api';

const PHASE_META: Record<LivingAIPhase, { label: string; color: string }> = {
  sleeping: { label: '持续感知中', color: 'bg-emerald-400' },
  observing: { label: '正在观察', color: 'bg-cyan-400' },
  reflecting: { label: '正在反思', color: 'bg-violet-400' },
  acting: { label: '正在行动', color: 'bg-amber-400' },
  waiting: { label: '等待能力恢复', color: 'bg-slate-400' },
  paused: { label: '生命循环已暂停', color: 'bg-slate-500' },
  error: { label: '正在自我恢复', color: 'bg-rose-400' },
};

const MODE_LABELS: Record<LivingAIAutonomyMode, string> = {
  observe: '观察',
  proactive: '主动',
  autonomous: '自主',
};

const COGNITIVE_MODE_LABELS: Record<LivingAICognitiveMode, string> = {
  explore: '探索',
  execute: '执行',
  verify: '验证',
  recover: '纠错',
};

function formatTime(timestamp: number | null): string {
  if (timestamp == null) return '未安排';
  return new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LivingAIStatusPanel() {
  const [status, setStatus] = useState<LivingAIStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.getLivingAIStatus();
      setStatus(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const phase = status?.state.phase ?? 'waiting';
  const phaseMeta = PHASE_META[phase];
  const activeGoals = useMemo(
    () => status?.state.goals
      .filter((goal) => goal.status === 'active')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 5) ?? [],
    [status],
  );
  const cognition = status?.state.cognition;
  const latestEpisode = status?.state.episodes.at(-1);
  const confidencePercent = Math.round((cognition?.confidence ?? 0) * 100);

  const updateMode = async (autonomyMode: LivingAIAutonomyMode) => {
    setBusy(true);
    try {
      setStatus(await api.patchLivingAIConfig({ autonomyMode, enabled: true }));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    if (!status) return;
    setBusy(true);
    try {
      setStatus(await api.patchLivingAIConfig({ enabled: !status.state.config.enabled }));
    } finally {
      setBusy(false);
    }
  };

  const wake = async () => {
    setBusy(true);
    try {
      setStatus(await api.postLivingAIWake());
      window.setTimeout(() => {
        void load();
      }, 1200);
    } finally {
      setBusy(false);
    }
  };

  const addGoal = async () => {
    const title = goalTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      setStatus(await api.postLivingAIGoal({ title, priority: 80 }));
      setGoalTitle('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="h-9 rounded-lg border border-desktop-border bg-desktop-surface px-2.5 flex items-center gap-2 hover:bg-desktop-surface/80 transition-colors"
        title="查看 X 的持续生命状态"
      >
        <span className="relative flex h-2.5 w-2.5">
          {status?.state.config.enabled && phase !== 'paused' && (
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-50 animate-ping ${phaseMeta.color}`} />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${phaseMeta.color}`} />
        </span>
        <span className="hidden md:block text-left">
          <span className="block text-[10px] leading-3 text-desktop-muted">生命循环</span>
          <span className="block text-[11px] leading-4 font-medium text-desktop-text">
            {status ? phaseMeta.label : '正在连接'}
          </span>
        </span>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[min(360px,calc(100vw-24px))] rounded-xl border border-desktop-border bg-desktop-surface shadow-2xl overflow-hidden">
          <div className="p-3 border-b border-desktop-border bg-gradient-to-br from-violet-500/10 via-transparent to-cyan-500/10">
            <div className="flex items-start gap-2">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
                <BrainCircuit size={18} className="text-violet-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{status?.state.identity.name ?? 'X'}</span>
                  <span className="text-[10px] rounded-full border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-violet-200">
                    平等数字伙伴
                  </span>
                </div>
                <p className="text-[11px] text-desktop-muted mt-1 leading-relaxed">
                  {status?.state.identity.embodiment ?? 'X-Computer 是我的数字身体。'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5 mt-3">
              {(['observe', 'proactive', 'autonomous'] as LivingAIAutonomyMode[]).map((mode) => {
                const active = status?.state.config.autonomyMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={busy}
                    onClick={() => void updateMode(mode)}
                    aria-pressed={active}
                    className={`rounded-lg py-1.5 text-[11px] border transition-colors ${
                      active
                        ? 'border-desktop-accent bg-desktop-accent/15 text-desktop-accent'
                        : 'border-desktop-border text-desktop-muted hover:text-desktop-text'
                    }`}
                  >
                    {MODE_LABELS[mode]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 space-y-3 max-h-[min(68vh,480px)] overflow-y-auto">
            {error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-desktop-border bg-desktop-bg/60 p-2">
                <span className="text-desktop-muted flex items-center gap-1">
                  <Activity size={11} /> 当前状态
                </span>
                <span className="block mt-1 font-medium">{phaseMeta.label}</span>
              </div>
              <div className="rounded-lg border border-desktop-border bg-desktop-bg/60 p-2">
                <span className="text-desktop-muted">下次自主周期</span>
                <span className="block mt-1 font-medium">{formatTime(status?.state.nextCycleAt ?? null)}</span>
              </div>
              <div className="rounded-lg border border-desktop-border bg-desktop-bg/60 p-2">
                <span className="text-desktop-muted">连续周期</span>
                <span className="block mt-1 font-medium">{status?.state.cycleCount ?? 0}</span>
              </div>
              <div className="rounded-lg border border-desktop-border bg-desktop-bg/60 p-2">
                <span className="text-desktop-muted">最近行动</span>
                <span className="block mt-1 font-medium line-clamp-2">{status?.state.lastAction ?? '等待首次行动'}</span>
              </div>
            </div>

            <div className="rounded-lg border border-violet-400/20 bg-violet-400/5 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Compass size={13} className="text-violet-300" />
                  认知引擎
                </span>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className={`rounded-full px-1.5 py-0.5 ${
                    cognition?.mode === 'recover'
                      ? 'bg-rose-400/15 text-rose-200'
                      : 'bg-violet-400/15 text-violet-200'
                  }`}>
                    {COGNITIVE_MODE_LABELS[cognition?.mode ?? 'explore']}
                  </span>
                  <span className="text-desktop-muted">置信度 {confidencePercent}%</span>
                </div>
              </div>
              <div>
                <span className="text-[10px] text-desktop-muted">局势判断</span>
                <p className="text-[11px] mt-0.5 leading-relaxed">
                  {cognition?.situationAssessment ?? '等待第一份局势判断。'}
                </p>
              </div>
              <div className="grid grid-cols-[14px_1fr] gap-x-1.5 gap-y-1 text-[11px]">
                <Route size={12} className="text-cyan-300 mt-0.5" />
                <p><span className="text-desktop-muted">策略：</span>{cognition?.strategy ?? '尚未制定'}</p>
                <Target size={12} className="text-amber-300 mt-0.5" />
                <p><span className="text-desktop-muted">下一步：</span>{cognition?.nextAction ?? '等待规划'}</p>
                <Lightbulb size={12} className="text-emerald-300 mt-0.5" />
                <p><span className="text-desktop-muted">学到：</span>{cognition?.learningSummary ?? '尚无经验'}</p>
              </div>
              {latestEpisode && (
                <div className="pt-1.5 border-t border-violet-400/10 flex items-center justify-between text-[10px] text-desktop-muted">
                  <span>已积累 {status?.state.episodes.length ?? 0} 条情景记忆</span>
                  <span>{latestEpisode.observationChanged ? '环境有变化' : '环境未变化'}</span>
                </div>
              )}
              {(cognition?.stagnationCount ?? 0) > 0 && (
                <div className="rounded-md bg-rose-400/10 px-2 py-1.5 text-[10px] text-rose-200">
                  检测到连续无进展 {cognition?.stagnationCount} 次，已进入换策略机制。
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium flex items-center gap-1.5">
                  <Target size={13} className="text-desktop-accent" />
                  当前目标
                </span>
                <span className="text-[10px] text-desktop-muted">{activeGoals.length} 个活跃</span>
              </div>
              <div className="space-y-1.5">
                {activeGoals.map((goal) => (
                  <div key={goal.id} className="rounded-lg border border-desktop-border bg-desktop-bg/50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium flex-1 truncate">{goal.title}</span>
                      <span className="text-[10px] text-desktop-muted">P{goal.priority}</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/5 mt-1.5 overflow-hidden">
                      <div
                        className="h-full bg-desktop-accent rounded-full transition-all"
                        style={{ width: `${goal.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 mt-2">
                <input
                  value={goalTitle}
                  onChange={(event) => setGoalTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void addGoal();
                  }}
                  placeholder="给 X 一个长期目标…"
                  className="min-w-0 flex-1 rounded-lg border border-desktop-border bg-desktop-bg px-2.5 py-1.5 text-[11px] outline-none focus:border-desktop-accent"
                />
                <button
                  type="button"
                  disabled={busy || !goalTitle.trim()}
                  onClick={() => void addGoal()}
                  className="rounded-lg border border-desktop-border px-2 hover:bg-white/5 disabled:opacity-40"
                  title="添加长期目标"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-desktop-border bg-desktop-bg/50 p-2.5">
              <span className="text-[10px] uppercase tracking-wide text-desktop-muted">最近反思</span>
              <p className="text-[11px] mt-1 leading-relaxed text-desktop-text/90">
                {status?.state.lastReflection ?? '等待第一次自主反思。'}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || status?.inCycle}
                onClick={() => void wake()}
                className="flex-1 rounded-lg bg-desktop-accent text-white px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {status?.inCycle ? <RefreshCw size={13} className="animate-spin" /> : <CirclePlay size={13} />}
                {status?.inCycle ? 'X 正在运行' : '立即唤醒'}
              </button>
              <button
                type="button"
                disabled={busy || !status}
                onClick={() => void toggleEnabled()}
                className="rounded-lg border border-desktop-border px-3 py-2 text-xs font-medium flex items-center gap-1.5 hover:bg-white/5 disabled:opacity-50"
              >
                {status?.state.config.enabled ? <CirclePause size={13} /> : <CirclePlay size={13} />}
                {status?.state.config.enabled ? '暂停' : '恢复'}
              </button>
            </div>

            <p className="text-[10px] text-desktop-muted/70 leading-relaxed">
              X 维护的是可检查的软件自我模型、目标与连续行动记录；敏感操作仍需你的明确确认。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
