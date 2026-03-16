/**
 * 工具调用记录类型定义
 */
export interface ToolCallRecord {
  id: string;
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  duration?: number;
}
