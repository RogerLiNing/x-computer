import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NodeChatMessage, NodeTaskProgress } from '../../shared/src/nodeProtocol.js';
import { runAgentTask } from './agentLoop.js';

const task = { taskId: 't1', userId: 'roger', goal: '把 hello 写进 out.txt 并汇报' };

function deps(workspace: string, replies: Array<(messages: NodeChatMessage[]) => { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>) {
  const progress: Array<Omit<NodeTaskProgress, 'taskId' | 'at'>> = [];
  let call = 0;
  return {
    progress,
    deps: {
      workspace, nodeName: 'test-node', labels: ['test'], signal: new AbortController().signal, pendingSteers: () => [],
      askUser: vi.fn(async () => '可以'),
      emit: (item: Omit<NodeTaskProgress, 'taskId' | 'at'>) => { progress.push(item); },
      model: async (messages: NodeChatMessage[]) => { const reply = replies[call] ?? replies.at(-1)!; call += 1; return reply(messages); },
    },
  };
}

describe('runAgentTask', () => {
  it('runs tools the model asks for, feeds results back, and returns the finish summary with produced files', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'x-node-loop-'));
    const { deps: loop, progress } = deps(workspace, [
      () => ({ content: '', toolCalls: [{ id: 'c1', name: 'file_write', arguments: { path: 'out.txt', content: 'hello' } }] }),
      (messages) => { expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' }); return { content: '', toolCalls: [{ id: 'c2', name: 'shell_run', arguments: { command: 'cat out.txt' } }] }; },
      (messages) => { expect(messages.at(-1)!.content).toContain('hello'); return { content: '', toolCalls: [{ id: 'c3', name: 'finish', arguments: { summary: '已写入 out.txt', files: ['out.txt', 'missing.txt'] } }] }; },
    ]);
    const result = await runAgentTask(task, loop);
    expect(result).toMatchObject({ ok: true, content: '已写入 out.txt', steps: 3, modelCalls: 3 });
    expect(result.files).toEqual([{ path: 'out.txt', size: 5 }]);
    expect(await readFile(path.join(workspace, 'out.txt'), 'utf8')).toBe('hello');
    expect(progress.filter((item) => item.kind === 'tool_start').map((item) => item.toolName)).toEqual(['file_write', 'shell_run', 'finish']);
    expect(loop.model).toBeDefined();
  });

  it('routes ask_user through the brain, refuses unknown tools, and stops at the step limit', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'x-node-loop-'));
    const { deps: loop } = deps(workspace, [
      () => ({ content: '', toolCalls: [{ id: 'q', name: 'ask_user', arguments: { question: '删掉旧文件吗？' } }, { id: 'x', name: 'rm_everything', arguments: {} }] }),
      (messages) => { const answers = messages.filter((message) => message.role === 'tool').map((message) => message.content); expect(answers[0]).toContain('可以'); expect(answers[1]).toContain('没有名为'); return { content: '', toolCalls: [{ id: 'l', name: 'file_list', arguments: {} }] }; },
    ]);
    const result = await runAgentTask({ ...task, maxSteps: 3 }, loop);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('最大步数');
    expect(loop.askUser).toHaveBeenCalledWith('删掉旧文件吗？', undefined);
  });

  it('treats a plain text reply as the conclusion and honours cancellation', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'x-node-loop-'));
    const { deps: loop } = deps(workspace, [() => ({ content: '这台机器空闲，无需处理。', toolCalls: [] })]);
    expect(await runAgentTask(task, loop)).toMatchObject({ ok: true, content: '这台机器空闲，无需处理。' });
    const controller = new AbortController(); controller.abort();
    expect(await runAgentTask(task, { ...loop, signal: controller.signal })).toMatchObject({ ok: false, error: '任务已取消' });
  });

  it('only exposes the allowed tools plus finish and ask_user', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'x-node-loop-'));
    let seen: string[] = [];
    const { deps: loop } = deps(workspace, [() => ({ content: 'done', toolCalls: [] })]);
    await runAgentTask({ ...task, allowedTools: ['file_read'] }, { ...loop, model: async (_messages, tools) => { seen = tools.map((tool) => tool.name); return { content: 'ok', toolCalls: [] }; } });
    expect(seen.sort()).toEqual(['ask_user', 'file_read', 'finish']);
  });
});
