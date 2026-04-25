/**
 * Session Summary Service
 * Generates LLM-powered summaries for chat sessions.
 */
import { callLLM } from './chatService.js';
import type { AppDatabase } from '../db/database.js';

const MAX_TRANSCRIPT_CHARS = 8000;

function buildTranscript(messages: Array<{ role: string; content: string }>): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role === 'user' ? '用户' : '助手';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    lines.push(`[${role}] ${content}`);
    lines.push('');
  }
  return lines.join('\n').slice(0, MAX_TRANSCRIPT_CHARS);
}

function sanitize(text: string): string {
  return text
    .replace(/\x00/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();
}

export interface SessionSummaryOptions {
  providerId: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
}

export async function generateSessionSummary(
  db: AppDatabase,
  sessionId: string,
  opts: SessionSummaryOptions,
): Promise<string | null> {
  try {
    const messages = await db.getMessages(sessionId, 100);
    if (messages.length === 0) return null;

    const transcript = buildTranscript(messages.map((m) => ({ role: m.role, content: m.content ?? '' })));
    const date = new Date().toISOString().slice(0, 10);

    const prompt = `你是一个专业的技术文档助手。请为以下对话生成一个简洁的摘要。

要求：
- 中文，200字以内
- 总结本次会话的主要话题、解决的问题和关键结论
- 只输出摘要内容，不要有前缀说明

---
## 会话记录 (${date})

${transcript}

---
摘要：`;

    const result = await callLLM({
      messages: [{ role: 'user', content: prompt }],
      providerId: opts.providerId,
      modelId: opts.modelId,
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
    });

    const summary = sanitize(result ?? '');
    if (summary) {
      await db.updateSessionSummary(sessionId, summary);
      return summary;
    }
    return null;
  } catch (err) {
    console.error('[SessionSummary] Failed to generate summary:', err);
    return null;
  }
}
