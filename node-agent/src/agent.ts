import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeTaskAssignment, ServerToNodeMessage } from '../../shared/src/nodeProtocol.js';
import { runAgentTask } from './agentLoop.js';
import type { NodeConfig } from './config.js';
import { NodeConnection } from './connection.js';
import { resolveInWorkspace, runShell } from './localTools.js';
import { collectMetrics, collectSpecs } from './metrics.js';

interface RunningTask { controller: AbortController; steers: string[]; answers: Map<string, (answer: string) => void> }

/**
 * The node process: holds the connection, runs one agent loop per assigned task, answers the
 * brain's exec/fs side-channel requests, and reports everything back.
 */
export class NodeAgent {
  readonly connection: NodeConnection;
  private readonly tasks = new Map<string, RunningTask>();
  private readonly execs = new Map<string, AbortController>();

  constructor(private readonly config: NodeConfig, private readonly log: (line: string) => void = (line) => console.log(`[x-node] ${line}`)) {
    this.connection = new NodeConnection({
      serverUrl: config.serverUrl, nodeId: config.nodeId, nodeKey: config.nodeKey, specs: collectSpecs(), labels: config.labels,
      collectMetrics: () => collectMetrics(config.workspace, this.tasks.size),
      onMessage: (message) => void this.handle(message),
      log,
    });
  }

  async start(): Promise<void> {
    await fs.mkdir(this.config.workspace, { recursive: true });
    this.connection.start();
  }

  stop(): void {
    for (const task of this.tasks.values()) task.controller.abort();
    this.connection.stop();
  }

  private async handle(message: ServerToNodeMessage): Promise<void> {
    switch (message.type) {
      case 'task/assign': this.startTask(message.task); return;
      case 'task/steer': this.tasks.get(message.taskId)?.steers.push(message.text); return;
      case 'task/cancel': this.tasks.get(message.taskId)?.controller.abort(); return;
      case 'task/answer': this.tasks.get(message.taskId)?.answers.get(message.questionId)?.(message.answer); return;
      case 'exec/run': await this.runExec(message); return;
      case 'exec/kill': this.execs.get(message.id)?.abort(); return;
      case 'fs/read': case 'fs/write': case 'fs/list': await this.runFs(message); return;
      case 'error': this.log(`X 报错：${message.message}`); return;
      default: return;
    }
  }

  private startTask(task: NodeTaskAssignment): void {
    if (this.tasks.has(task.taskId)) return;
    const running: RunningTask = { controller: new AbortController(), steers: [], answers: new Map() };
    this.tasks.set(task.taskId, running);
    this.log(`开始任务 ${task.taskId}：${task.goal.slice(0, 80)}`);
    const workspace = path.join(this.config.workspace, 'tasks', task.taskId.replace(/[^\w-]/g, '_'));
    void fs.mkdir(workspace, { recursive: true }).then(() => runAgentTask(task, {
      workspace, nodeName: this.config.name, labels: this.config.labels, signal: running.controller.signal,
      model: (messages, tools, onChunk) => this.connection.requestModel(messages, tools, { taskId: task.taskId, onChunk }),
      emit: (progress) => { this.connection.send({ type: 'task/progress', progress: { ...progress, taskId: task.taskId, at: Date.now() } }); },
      askUser: (question, options) => new Promise<string>((resolve, reject) => {
        const questionId = randomUUID();
        running.answers.set(questionId, (answer) => { running.answers.delete(questionId); resolve(answer); });
        running.controller.signal.addEventListener('abort', () => reject(new Error('任务已取消')), { once: true });
        this.connection.send({ type: 'task/question', taskId: task.taskId, questionId, question, options });
      }),
      pendingSteers: () => running.steers.splice(0, running.steers.length),
    })).then((result) => {
      const files = result.files?.map((file) => ({ ...file, path: path.join('tasks', task.taskId.replace(/[^\w-]/g, '_'), file.path) }));
      this.connection.send({ type: 'task/result', result: { ...result, files } });
      this.log(`任务 ${task.taskId} ${result.ok ? '完成' : '失败'}：${(result.content || result.error || '').slice(0, 80)}`);
    }).catch((error: unknown) => {
      this.connection.send({ type: 'task/result', result: { taskId: task.taskId, ok: false, content: '', error: error instanceof Error ? error.message : String(error), steps: 0, modelCalls: 0 } });
    }).finally(() => this.tasks.delete(task.taskId));
  }

  private async runExec(message: Extract<ServerToNodeMessage, { type: 'exec/run' }>): Promise<void> {
    const controller = new AbortController();
    this.execs.set(message.id, controller);
    try {
      const cwd = resolveInWorkspace(this.config.workspace, message.cwd ?? '.');
      await fs.mkdir(cwd, { recursive: true });
      const result = await runShell(message.command, { cwd, timeoutMs: message.timeoutMs ?? 120_000, signal: controller.signal, onOutput: (stream, data) => this.connection.send({ type: 'exec/output', id: message.id, stream, data }) });
      this.connection.send({ type: 'exec/exit', id: message.id, exitCode: result.exitCode, timedOut: result.timedOut || undefined });
    } catch (error: unknown) {
      this.connection.send({ type: 'exec/output', id: message.id, stream: 'stderr', data: error instanceof Error ? error.message : String(error) });
      this.connection.send({ type: 'exec/exit', id: message.id, exitCode: null });
    } finally { this.execs.delete(message.id); }
  }

  private async runFs(message: Extract<ServerToNodeMessage, { type: 'fs/read' | 'fs/write' | 'fs/list' }>): Promise<void> {
    try {
      const target = resolveInWorkspace(this.config.workspace, message.path);
      if (message.type === 'fs/read') {
        const stat = await fs.stat(target);
        if (stat.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB');
        this.connection.send({ type: 'fs/result', id: message.id, ok: true, data: { content: await fs.readFile(target, 'utf8') } });
      } else if (message.type === 'fs/write') {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, message.content, 'utf8');
        this.connection.send({ type: 'fs/result', id: message.id, ok: true, data: { bytes: Buffer.byteLength(message.content) } });
      } else {
        const entries = await fs.readdir(target, { withFileTypes: true });
        this.connection.send({ type: 'fs/result', id: message.id, ok: true, data: { entries: entries.slice(0, 500).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } });
      }
    } catch (error: unknown) {
      this.connection.send({ type: 'fs/result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
