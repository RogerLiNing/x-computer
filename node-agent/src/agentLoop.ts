import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeChatMessage, NodeTaskAssignment, NodeTaskProgress, NodeTaskResult, NodeToolDef } from '../../shared/src/nodeProtocol.js';
import type { ModelReply } from './connection.js';
import { localToolDefinitions, localToolHandlers, resolveInWorkspace, type LocalToolHandler } from './localTools.js';

export interface AgentLoopDeps {
  workspace: string;
  nodeName: string;
  labels: string[];
  model: (messages: NodeChatMessage[], tools: NodeToolDef[], onChunk: (delta: string) => void) => Promise<ModelReply>;
  emit: (progress: Omit<NodeTaskProgress, 'taskId' | 'at'>) => void;
  askUser: (question: string, options?: string[]) => Promise<string>;
  signal: AbortSignal;
  /** Steering messages pushed while the task runs are drained before each model call. */
  pendingSteers: () => string[];
  tools?: Record<string, LocalToolHandler>;
  toolDefinitions?: NodeToolDef[];
}

const DEFAULT_MAX_STEPS = 40;

export function buildSystemPrompt(deps: Pick<AgentLoopDeps, 'nodeName' | 'labels' | 'workspace'>): string {
  return [
    `你是运行在服务器「${deps.nodeName}」上的 X 子智能体${deps.labels.length ? `（标签：${deps.labels.join('、')}）` : ''}。`,
    '主脑把一个目标交给你独立完成。你只能用给出的工具操作这台机器的工作区，模型推理由 X 代为调用。',
    `工作区路径：${deps.workspace}。所有文件路径相对工作区；产出文件放在工作区里并在 finish 时列出。`,
    '原则：先看再做（列目录、读文件、试运行），每一步只做一件事；命令失败时读错误再调整，不要重复同样的命令；',
    '不做目标之外的改动，不删除不属于本任务的文件；需要用户决定时用 ask_user，但尽量自己推进。',
    '完成后必须调用 finish 给出结论；不要用纯文字结束。',
  ].join('\n');
}

function describeOutput(output: unknown): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

async function listProducedFiles(workspace: string, files: string[]): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];
  for (const file of files.slice(0, 50)) {
    try { const stat = await fs.stat(resolveInWorkspace(workspace, file)); if (stat.isFile()) out.push({ path: path.normalize(file), size: stat.size }); } catch { /* the model may list a file it never wrote */ }
  }
  return out;
}

/** One task from assignment to result: the node's own think → act loop with the brain on loan. */
export async function runAgentTask(task: NodeTaskAssignment, deps: AgentLoopDeps): Promise<NodeTaskResult> {
  const handlers = deps.tools ?? localToolHandlers;
  const allDefinitions = deps.toolDefinitions ?? localToolDefinitions;
  const definitions = task.allowedTools ? allDefinitions.filter((tool) => task.allowedTools!.includes(tool.name) || tool.name === 'finish' || tool.name === 'ask_user') : allDefinitions;
  const messages: NodeChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(deps) },
    { role: 'user', content: `目标：${task.goal}${task.context ? `\n\n背景：\n${task.context}` : ''}` },
  ];
  const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
  let steps = 0; let modelCalls = 0;
  const fail = (error: string): NodeTaskResult => ({ taskId: task.taskId, ok: false, content: '', error, steps, modelCalls });
  while (steps < maxSteps) {
    if (deps.signal.aborted) return fail('任务已取消');
    for (const steer of deps.pendingSteers()) messages.push({ role: 'user', content: `【主脑补充指令】${steer}` });
    let reply: ModelReply;
    try {
      modelCalls += 1;
      let streamed = '';
      reply = await deps.model(messages, definitions, (delta) => { streamed += delta; if (streamed.length % 200 < delta.length) deps.emit({ kind: 'thinking', text: streamed.slice(-200) }); });
    } catch (error: unknown) {
      return fail(`模型调用失败：${error instanceof Error ? error.message : String(error)}`);
    }
    steps += 1;
    if (reply.toolCalls.length === 0) {
      // No tool call and no finish: treat the text as the conclusion rather than looping forever.
      if (reply.content.trim()) return { taskId: task.taskId, ok: true, content: reply.content.trim(), steps, modelCalls, files: [] };
      messages.push({ role: 'assistant', content: '' }, { role: 'user', content: '请继续执行，或调用 finish 给出结论。' });
      continue;
    }
    messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      if (deps.signal.aborted) return fail('任务已取消');
      deps.emit({ kind: 'tool_start', toolName: call.name, toolInput: call.arguments, step: steps });
      if (call.name === 'finish') {
        const summary = String(call.arguments.summary ?? reply.content ?? '').trim();
        const files = Array.isArray(call.arguments.files) ? call.arguments.files.filter((item): item is string => typeof item === 'string') : [];
        return { taskId: task.taskId, ok: true, content: summary || '（无结论文字）', files: await listProducedFiles(deps.workspace, files), steps, modelCalls };
      }
      let output: unknown;
      try {
        if (call.name === 'ask_user') {
          const answer = await deps.askUser(String(call.arguments.question ?? ''), Array.isArray(call.arguments.options) ? call.arguments.options.map(String) : undefined);
          output = { answer };
        } else {
          const handler = handlers[call.name];
          if (!handler || !definitions.some((tool) => tool.name === call.name)) throw new Error(`没有名为 ${call.name} 的工具`);
          output = await handler(call.arguments ?? {}, { workspace: deps.workspace, signal: deps.signal });
        }
      } catch (error: unknown) {
        output = { error: error instanceof Error ? error.message : String(error) };
      }
      deps.emit({ kind: 'tool_result', toolName: call.name, text: describeOutput(output), step: steps });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return fail(`超过最大步数 ${maxSteps}，任务未完成`);
}
