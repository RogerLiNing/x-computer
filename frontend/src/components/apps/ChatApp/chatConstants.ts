/** 任务关键词，用于识别用户是否在请求执行任务 */
export const TASK_KEYWORDS = ['帮我', '执行', '创建', '整理', '发送', '编写', '修改', '分析', '生成', '修复', '部署', '搜索', '下载', '安装', '运行'];

/** 请求 /api/chat 时携带的最近对话轮数（每轮 = user + assistant），对齐 OpenCode session 思路。 */
export const DEFAULT_MAX_CHAT_ROUNDS = 10;

/** 智能体简要（用于选择器） */
export interface AgentOption {
  id: string;
  name: string;
}
