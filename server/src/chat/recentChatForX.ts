/**
 * 供 X 主脑感知「用户与 AI 助手」的近期对话，用于优化助手提示词、了解用户需求与助手表现。
 * 仅返回 X 尚未读过的消息，读过后会标记，下次不再拉取。
 */

import type { AppDatabase } from '../db/database.js';

const X_READ_CURSOR_KEY = 'x_assistant_chat_read_before';

/**
 * 获取指定用户与 AI 助手的**未读**对话（跨会话合并、按时间排序），格式化为可读文本供 X 主脑阅读。
 * 仅包含用户与助手的对话（不含 X 主脑会话）。每次调用后会将本次返回的消息标记为「已读」，下次只返回更新后的新消息。
 */
export async function getRecentAssistantChat(
  db: AppDatabase,
  userId: string,
  limit = 80,
): Promise<string> {
  const readBefore = await Promise.resolve(db.getConfig(userId, X_READ_CURSOR_KEY) ?? '');
  const sessions = await Promise.resolve(db.listSessions(userId, 5));
  const all: { role: string; content: string; created_at: string }[] = [];
  for (const s of sessions) {
    const msgs = await Promise.resolve(db.getMessages(s.id, 150));
    for (const m of msgs) {
      if (m.role === 'user' || m.role === 'assistant') {
        all.push({ role: m.role, content: m.content || '', created_at: m.created_at });
      }
    }
  }
  const unread = readBefore
    ? all.filter((m) => m.created_at > readBefore)
    : all;
  unread.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const recent = unread.slice(0, limit);
  if (recent.length === 0) {
    return readBefore
      ? '（暂无新的用户与 AI 助手对话；X 已读过的历史不会再次返回）'
      : '（暂无用户与 AI 助手的近期对话）';
  }
  const newestCreatedAt = recent[0]!.created_at;
  await Promise.resolve(db.setConfig(userId, X_READ_CURSOR_KEY, newestCreatedAt));
  const lines = recent.map((m) => {
    const role = m.role === 'user' ? '用户' : 'AI助手';
    const text = m.content.slice(0, 2500).replace(/\n/g, '\n  ');
    return `[${role}]\n  ${text}`;
  });
  return lines.join('\n\n');
}
