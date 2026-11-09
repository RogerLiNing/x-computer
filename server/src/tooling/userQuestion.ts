import type { ToolDefinition } from '../../../shared/src/index.js';

export interface UserQuestion {
  id: string;
  toolCallId: string;
  question: string;
  options: string[];
  status: 'pending' | 'answered' | 'cancelled';
  answer?: string;
  noticeDelivered?: number;
}
export class UserInputRequiredError extends Error {
  constructor(readonly request: Pick<UserQuestion, 'toolCallId' | 'question' | 'options'>) {
    super('需要你补充一点信息');
  }
}

export const askUserDefinition: ToolDefinition = {
  name: 'x.ask_user', displayName: '请用户补充信息', domain: ['chat', 'agent'], riskLevel: 'low', requiredPermissions: [],
  description: '仅当缺少会影响执行结果的关键信息时，暂停原交办并向用户提一个简短问题。可给2至4个选项，用户也可填写。用户回答后从当前检查点继续。能合理假设的信息自行推进。密钥在设置中填写，命令及发送操作使用专门的审批入口。',
  parameters: [
    { name: 'question', type: 'string', description: '需要用户回答的一个简短问题', required: true },
    { name: 'options', type: 'array', description: '可选的2至4个简短答案，用户仍能自由填写', required: false },
  ],
};

export async function askUser(input: Record<string, unknown>, context?: { userId?: string; runId?: string; toolCallId?: string; signal?: AbortSignal }) {
  context?.signal?.throwIfAborted();
  if (!context?.userId || context.userId === 'anonymous' || !context.runId || !context.toolCallId) {
    throw new Error('请在已登录的交办对话里请求补充信息');
  }
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question || question.length > 1000) throw new Error('问题为空或过长');
  const options = input.options === undefined ? [] : input.options;
  if (!Array.isArray(options) || (options.length !== 0 && (options.length < 2 || options.length > 4))
    || options.some(option => typeof option !== 'string' || !option.trim() || option.length > 120)) {
    throw new Error('请提供2至4个简短选项，或省略选项');
  }
  const choices = options.map(option => option.trim());
  if (new Set(choices).size !== choices.length) throw new Error('选项不能重复');
  throw new UserInputRequiredError({ toolCallId: context.toolCallId, question, options: choices });
}
