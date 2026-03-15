import type { AppIdentifier, AppWindow, ComputerContext, TaskSummary, TaskDomain, TaskStatus } from '@shared/index';

/**
 * 将 ComputerContext 格式化为供主脑阅读的「当前整机状态」短文（注入 system 用）
 */
export function formatComputerContextForPrompt(ctx: ComputerContext): string {
  const parts: string[] = [];
  parts.push(`执行模式: ${ctx.executionMode === 'auto' ? '自动' : '审批'}`);
  parts.push(`窗口数: ${ctx.windows?.length ?? 0}`);
  if (ctx.activeWindowId) {
    const active = ctx.windows?.find((w) => w.id === ctx.activeWindowId);
    if (active) parts.push(`当前焦点: ${active.title ?? active.appId} (${active.appId})`);
  }
  if (ctx.activeContext?.filePath) parts.push(`当前打开文件: ${ctx.activeContext.filePath}`);
  parts.push(`任务数: ${ctx.tasks?.length ?? 0}`);
  if ((ctx.notificationCount ?? 0) > 0) parts.push(`未读通知: ${ctx.notificationCount}`);
  return parts.join('；');
}

/**
 * 将任务列表格式化为供主脑阅读的「任务摘要」短文（注入 system 用）
 */
export function formatTaskSummaryForPrompt(tasks: Array<{ id: string; domain: string; title: string; status: string; steps?: Array<{ status: string }> }>): string {
  if (!tasks?.length) return '（无进行中或最近任务）';
  const lines = tasks.slice(0, 8).map((t) => {
    const steps = t.steps ?? [];
    const done = steps.filter((s) => s.status === 'completed').length;
    const total = steps.length;
    return `- [${t.status}] ${t.title} (${t.domain})${total ? ` 步骤 ${done}/${total}` : ''}`;
  });
  return lines.join('\n');
}

/**
 * Build the current computer context from desktop store for the AI to perceive.
 * Sent to backend via WebSocket set_computer_context.
 */
export function buildComputerContext(state: {
  windows: AppWindow[];
  activeWindowId: string | null;
  executionMode: 'auto' | 'approval';
  tasks: Array<{ id: string; domain: TaskDomain; title: string; status: TaskStatus; steps: Array<{ status: string }> }>;
  taskbarPinned: AppIdentifier[];
  notifications: unknown[];
}): ComputerContext {
  const tasks: TaskSummary[] = (state.tasks ?? []).map((t) => {
    const steps = t.steps ?? [];
    return {
      id: t.id,
      domain: t.domain,
      title: t.title,
      status: t.status,
      stepsDone: steps.filter((s) => s.status === 'completed').length,
      stepsTotal: steps.length,
    };
  });

  const active = state.windows.find((w) => w.id === state.activeWindowId);
  const windows = state.windows.map((w) => ({
    id: w.id,
    appId: w.appId,
    title: w.title,
    isMinimized: w.isMinimized,
    isFocused: w.isFocused,
    metadata: w.metadata,
  }));

  return {
    timestamp: Date.now(),
    executionMode: state.executionMode,
    activeWindowId: state.activeWindowId,
    windows,
    tasks,
    taskbarPinned: state.taskbarPinned,
    notificationCount: state.notifications.length,
    activeContext: active?.metadata
      ? {
          appId: active.appId,
          filePath: active.metadata.filePath as string | undefined,
          fileName: active.metadata.fileName as string | undefined,
          ...active.metadata,
        }
      : undefined,
  };
}
