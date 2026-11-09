import type { ToolDefinition } from '@x-computer/shared';
import type { MemoryService } from '../../memory/MemoryService.js';
import type { ToolHandler } from './types.js';

const base = { domain: ['chat', 'agent'] as ToolDefinition['domain'], riskLevel: 'low' as const, requiredPermissions: [] as string[] };

export const memoryTopicToolDefinitions: ToolDefinition[] = [
  { ...base, name: 'memory_remember', displayName: '记住一条事实',
    description: '把一条用户亲口说的事实、偏好或决定记为一行带日期的长期记忆。可选 topic 把它归入主题笔记（如 产检、饮食、家人）；可选 until 给有时效的信息设到期日（如孕周、临时安排），到期后不再出现在提示里。',
    parameters: [{ name: 'text', type: 'string', description: '完整独立的陈述句，如「预产期是 2027-03-20」', required: true }, { name: 'topic', type: 'string', description: '主题名（字母/数字/中文/短横线），不填写入 MEMORY.md', required: false }, { name: 'until', type: 'string', description: '到期日 YYYY-MM-DD', required: false }] },
  { ...base, name: 'memory_supersede', displayName: '更正一条记忆',
    description: '当用户更正了以前说过的事实时调用：把包含 needle 的那条旧记忆划掉（保留痕迹），并可同时写入新的说法。',
    parameters: [{ name: 'needle', type: 'string', description: '旧记忆里的关键词', required: true }, { name: 'replacement', type: 'string', description: '新的完整陈述句', required: false }, { name: 'topic', type: 'string', description: '主题名，不填则在 MEMORY.md 里找', required: false }] },
  { ...base, name: 'memory_topic_read', displayName: '读取主题笔记',
    description: '读取某个主题笔记的全文。系统提示里列出了已有主题；当用户的问题与某主题相关时先读它。',
    parameters: [{ name: 'topic', type: 'string', description: '主题名', required: true }] },
  { ...base, name: 'memory_topic_write', displayName: '整理主题笔记',
    description: '用整理后的全文替换一个主题笔记（可带 front matter：title、aliases）。用于合并重复条目或重写结构；日常新增请用 memory_remember。',
    parameters: [{ name: 'topic', type: 'string', description: '主题名', required: true }, { name: 'content', type: 'string', description: '笔记全文（Markdown）', required: true }] },
  { ...base, name: 'memory_undo', displayName: '撤销上一次记忆修改', riskLevel: 'medium',
    description: '撤销最近一次对记忆文件的修改（记住、更正、整理都算）。用户说「记错了，撤销」时调用。', parameters: [] },
];

export const MEMORY_TOPIC_TOOL_NAMES: readonly string[] = memoryTopicToolDefinitions.map((definition) => definition.name);

export interface MemoryTopicToolsDeps { getMemoryServiceForUser?: (userId: string) => Promise<MemoryService | null> }

async function memoryFor(deps: MemoryTopicToolsDeps, context: unknown): Promise<MemoryService> {
  const userId = (context as { userId?: string } | undefined)?.userId;
  if (!userId || userId === 'anonymous') throw new Error('需要已登录用户');
  const service = await deps.getMemoryServiceForUser?.(userId);
  if (!service) throw new Error('记忆服务不可用');
  return service;
}

const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

export function createMemoryTopicToolHandlers(deps: MemoryTopicToolsDeps): Record<string, ToolHandler> {
  return {
    memory_remember: async (input, context) => {
      const text = optionalText(input.text);
      if (!text) throw new Error('text 必填');
      const until = optionalText(input.until);
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('until 须为 YYYY-MM-DD');
      const line = await (await memoryFor(deps, context)).topics.appendEntry(optionalText(input.topic), text, { until });
      return { ok: true, entry: line, topic: optionalText(input.topic) ?? 'MEMORY.md' };
    },
    memory_supersede: async (input, context) => {
      const needle = optionalText(input.needle);
      if (!needle) throw new Error('needle 必填');
      const ok = await (await memoryFor(deps, context)).topics.supersede(optionalText(input.topic), needle, optionalText(input.replacement));
      return ok ? { ok: true, message: '旧记忆已划掉' + (input.replacement ? '，新说法已记录' : '') } : { ok: false, error: '没有找到包含该关键词的有效记忆' };
    },
    memory_topic_read: async (input, context) => {
      const topic = optionalText(input.topic);
      if (!topic) throw new Error('topic 必填');
      const content = await (await memoryFor(deps, context)).topics.read(topic);
      return content === undefined ? { ok: false, error: '没有这个主题' } : { ok: true, topic, content };
    },
    memory_topic_write: async (input, context) => {
      const topic = optionalText(input.topic);
      if (!topic || typeof input.content !== 'string') throw new Error('topic 与 content 必填');
      await (await memoryFor(deps, context)).topics.write(topic, input.content, 'model-rewrite');
      return { ok: true, topic };
    },
    memory_undo: async (_input, context) => {
      const undone = await (await memoryFor(deps, context)).topics.undoLast();
      return undone ? { ok: true, file: undone.file, reason: undone.reason } : { ok: false, error: '没有可撤销的修改' };
    },
  };
}
