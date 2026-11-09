import type { ToolDefinition } from '@x-computer/shared';
import type { NodeRuntime } from '../../nodes/index.js';
import type { ToolHandler } from './types.js';

const base = { domain: ['chat', 'agent'] as ToolDefinition['domain'], requiredPermissions: [] as string[] };

export const nodeToolDefinitions: ToolDefinition[] = [
  { ...base, name: 'node.list', displayName: '查看我的节点', riskLevel: 'low', parameters: [],
    description: '列出用户登记的节点服务器（名称、标签、在线状态、负载）。派任务前先看哪台在线、哪台带 gpu / overseas / cn-mainland 等标签。' },
  { ...base, name: 'node.run', displayName: '派任务给节点', riskLevel: 'medium',
    description: '把一个目标交给某台节点上的子智能体独立完成：它有自己的 shell、文件、python、http 工具，会借用用户的模型逐步执行，完成后结果会通知用户。适合爬取、批处理、长时间脚本、需要在特定网络环境（如海外）执行的事。目标要写清楚交付物。',
    parameters: [{ name: 'node', type: 'string', description: '节点 id、名称或标签（如 overseas）', required: true }, { name: 'goal', type: 'string', description: '要完成的目标与交付要求', required: true }, { name: 'context', type: 'string', description: '补充背景（文件内容摘录、约束等）', required: false }] },
  { ...base, name: 'node.task_status', displayName: '查看节点任务', riskLevel: 'low',
    description: '查看一个节点任务的状态、最近进度和结果；不传 task_id 则列出最近任务。',
    parameters: [{ name: 'task_id', type: 'string', description: '任务 id', required: false }] },
  { ...base, name: 'node.task_answer', displayName: '回答节点提问', riskLevel: 'low',
    description: '节点任务处于 waiting_user（节点提了问题）时，把用户的回答转给节点继续执行。',
    parameters: [{ name: 'task_id', type: 'string', description: '任务 id', required: true }, { name: 'answer', type: 'string', description: '回答内容', required: true }] },
  { ...base, name: 'node.task_cancel', displayName: '取消节点任务', riskLevel: 'medium', description: '取消一个排队或运行中的节点任务。',
    parameters: [{ name: 'task_id', type: 'string', description: '任务 id', required: true }] },
  { ...base, name: 'node.exec', displayName: '在节点上运行命令', riskLevel: 'high',
    description: '直接在某台节点上执行一条 shell 命令并返回输出（不经过子智能体）。只用于明确、短小的命令；复杂目标请用 node.run。',
    parameters: [{ name: 'node', type: 'string', description: '节点 id、名称或标签', required: true }, { name: 'command', type: 'string', description: '命令', required: true }, { name: 'timeout_seconds', type: 'number', description: '超时秒数，默认 120', required: false }] },
];

export const NODE_TOOL_NAMES: readonly string[] = nodeToolDefinitions.map((definition) => definition.name);

function requireUser(context: unknown): string {
  const userId = (context as { userId?: string } | undefined)?.userId;
  if (!userId || userId === 'anonymous') throw new Error('需要已登录用户');
  return userId;
}

export function createNodeToolHandlers(getRuntime: () => NodeRuntime | undefined): Record<string, ToolHandler> {
  const runtime = () => { const value = getRuntime(); if (!value) throw new Error('节点功能未启用'); return value; };
  return {
    'node.list': async (_input, context) => {
      const userId = requireUser(context);
      const { registry, gateway } = runtime();
      return { nodes: (await registry.list(userId)).map((node) => ({ id: node.id, name: node.name, labels: node.labels, online: gateway.isOnline(node.id), specs: node.specs, metrics: node.metrics, lastSeenAtISO: node.lastSeenAt ? new Date(node.lastSeenAt).toISOString() : undefined })) };
    },
    'node.run': async (input, context) => {
      const userId = requireUser(context);
      const task = await runtime().tasks.create(userId, String(input.node ?? ''), String(input.goal ?? ''), { context: typeof input.context === 'string' ? input.context : undefined });
      return { ok: true, taskId: task.id, node: task.nodeName, status: task.status, message: task.status === 'running' ? `已交给节点「${task.nodeName}」执行，完成后会通知用户；可用 node.task_status 查看进度。` : `节点「${task.nodeName}」当前离线，任务已排队，上线后自动开始。` };
    },
    'node.task_status': async (input, context) => {
      const userId = requireUser(context);
      const { tasks } = runtime();
      const id = typeof input.task_id === 'string' ? input.task_id : '';
      if (!id) return { tasks: (await tasks.list(userId, 20)).map((task) => ({ id: task.id, node: task.nodeName, goal: task.goal.slice(0, 120), status: task.status, updatedAtISO: new Date(task.updatedAt).toISOString() })) };
      const task = await tasks.get(userId, id);
      if (!task) throw new Error('任务不存在');
      return { id: task.id, node: task.nodeName, goal: task.goal, status: task.status, question: task.question, result: task.result, recentProgress: task.progress.slice(-12).map((item) => ({ kind: item.kind, text: item.text, toolName: item.toolName, atISO: new Date(item.at).toISOString() })) };
    },
    'node.task_answer': async (input, context) => {
      const userId = requireUser(context);
      const ok = await runtime().tasks.answer(userId, String(input.task_id ?? ''), String(input.answer ?? ''));
      return ok ? { ok: true } : { ok: false, error: '该任务当前没有待回答的问题' };
    },
    'node.task_cancel': async (input, context) => {
      const userId = requireUser(context);
      return { ok: await runtime().tasks.cancel(userId, String(input.task_id ?? '')) };
    },
    'node.exec': async (input, context) => {
      const userId = requireUser(context);
      const { registry, gateway } = runtime();
      const node = await registry.resolve(userId, String(input.node ?? ''));
      if (!node) throw new Error('找不到该节点');
      const command = String(input.command ?? '').trim();
      if (!command) throw new Error('command 必填');
      let stdout = ''; let stderr = '';
      const exit = await gateway.exec(node.id, command, { onOutput: (stream, data) => { if (stream === 'stdout') stdout = (stdout + data).slice(-50_000); else stderr = (stderr + data).slice(-10_000); } }, { timeoutMs: Math.min(600, Math.max(5, Number(input.timeout_seconds) || 120)) * 1000, });
      return { node: node.name, exitCode: exit.exitCode, timedOut: exit.timedOut ?? false, stdout, stderr };
    },
  };
}
