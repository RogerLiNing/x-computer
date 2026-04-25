import type { ToolCallRecord } from '@/components/shared';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  taskId?: string;
  taskStatus?: string;
  /** 工具/MCP 调用记录，可展开查看详情 */
  toolCalls?: ToolCallRecord[];
  /** 图片：助手为生成图 URL；用户为附带图片的沙箱路径（显示时用 /api/fs/read-binary 加载） */
  images?: string[];
  /** 用户附带的文档（名称与沙箱路径），在对话中单独展示 */
  attachedFiles?: Array<{ name: string; path: string }>;
  /** 建议追问（AI 回复后由服务端生成，可点击填入输入框） */
  suggestedFollowUps?: string[];
  /** 是否为配额超限错误，若是则展示升级入口 */
  quotaError?: boolean;
  /** 消息表情反应（thumbsUp/thumbsDown 等，值为 true 表示当前用户已点赞/点踩） */
  reactions?: Record<string, boolean>;
}
