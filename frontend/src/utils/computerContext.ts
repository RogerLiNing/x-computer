import type { AppIdentifier, AppWindow, ComputerContext } from '@shared/index';

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval';
}

/**
 * 将 ComputerContext 格式化为供主脑阅读的「当前整机状态」短文（注入 system 用）
 */
export function formatComputerContextForPrompt(ctx: ComputerContext): string {
  const parts: string[] = [];
  parts.push(`窗口数: ${ctx.windows?.length ?? 0}`);
  if (ctx.activeWindowId) {
    const active = ctx.windows?.find((w) => w.id === ctx.activeWindowId);
    if (active) parts.push(`当前焦点: ${active.title ?? active.appId} (${active.appId})`);
  }
  if (ctx.activeContext?.filePath) parts.push(`当前打开文件: ${ctx.activeContext.filePath}`);
  if ((ctx.notificationCount ?? 0) > 0) parts.push(`未读通知: ${ctx.notificationCount}`);
  return parts.join('；');
}

/**
 * Format task summary for AI prompt - stub implementation
 */
export function formatTaskSummaryForPrompt(tasks: Task[]): string {
  if (!tasks || tasks.length === 0) return '';
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'pending');
  if (active.length === 0) return '';
  return `当前任务: ${active.map((t) => t.title).join(', ')}`;
}

/**
 * Build the current computer context from desktop store for the AI to perceive.
 * Sent to backend via WebSocket set_computer_context.
 */
export function buildComputerContext(state: {
  windows: AppWindow[];
  activeWindowId: string | null;
  tasks?: Task[];
  taskbarPinned: AppIdentifier[];
  notifications: unknown[];
}): ComputerContext {
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
    activeWindowId: state.activeWindowId,
    windows,
    tasks: [],
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
