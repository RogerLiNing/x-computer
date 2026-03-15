/**
 * 对话上下文截断：对齐 OpenCode session 思路，避免 token 超限。
 * 供 POST /api/chat 与 POST /api/chat/with-tools 使用。
 */

export const MAX_CHAT_MESSAGES = 51; // 1 system + 50 条对话（约 25 轮）

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * 截断为最多 max 条：保留首条 system（若有）+ 最近 (max-1) 条非 system，或无 system 时最近 max 条。
 */
export function truncateChatMessages(
  messages: Array<{ role: string; content: string }>,
  max: number = MAX_CHAT_MESSAGES,
): ChatMessage[] {
  const normalized = messages.map((m) => ({
    role: (m.role === 'system' || m.role === 'assistant' ? m.role : 'user') as 'system' | 'user' | 'assistant',
    content: String(m.content ?? ''),
  }));
  if (normalized.length <= max) return normalized;
  const systemMsg = normalized.find((m) => m.role === 'system');
  const rest = normalized.filter((m) => m.role !== 'system');
  const tail = rest.slice(-(max - (systemMsg ? 1 : 0)));
  return systemMsg ? [systemMsg, ...tail] : tail;
}
