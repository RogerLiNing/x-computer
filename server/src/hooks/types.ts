/**
 * 事件式钩子类型（对齐 OpenClaw hooks）。
 * 用于 task_complete、memory_captured、x_chat_round_complete 等事件，扩展时不必改核心流程。
 */

export type HookEventName = 'task_complete' | 'memory_captured' | 'x_chat_round_complete';

export interface TaskCompletePayload {
  taskId: string;
  /** 与 TaskEvent task_complete 的 data 一致 */
  data: unknown;
}

export interface MemoryCapturedPayload {
  workspaceId?: string;
  type: 'preference' | 'decision' | 'fact';
  content: string;
  /** 写入的 daily 文件路径，如 memory/2026-02-11.md */
  filePath?: string;
}

/** 主脑（X）与用户一轮对话结束，用于自动判断是否进化自我约定 */
export interface XChatRoundCompletePayload {
  userId: string;
  lastUserMessage: string;
  lastAssistantContent: string;
}

export type HookPayloadMap = {
  task_complete: TaskCompletePayload;
  memory_captured: MemoryCapturedPayload;
  x_chat_round_complete: XChatRoundCompletePayload;
};

export type HookHandler<E extends HookEventName = HookEventName> = (payload: HookPayloadMap[E]) => void | Promise<void>;
