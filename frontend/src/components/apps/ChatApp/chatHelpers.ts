import type { Message } from './Message';

/**
 * 取最近 N 轮对话（仅 user/assistant），用于 API 请求。后端会注入 system 提示，此处不传首条 system。
 * 若需扩展可配置 N，可从设置或 llmConfig 读取。
 */
export function getMessagesForChat(
  messages: Message[],
  userMsg: Message,
  maxRounds: number,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const conversation = [...messages, userMsg].filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  ) as Message[];
  const take = maxRounds * 2;
  const last = conversation.length <= take ? conversation : conversation.slice(-take);
  return last.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}
