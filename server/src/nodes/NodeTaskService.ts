import { randomUUID } from 'node:crypto';
import type { NodeTaskProgress, NodeTaskResult } from '../../../shared/src/nodeProtocol.js';
import type { AppDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { NodeGateway } from './NodeGateway.js';
import type { NodeRecord, NodeRegistry } from './NodeRegistry.js';

export type NodeTaskStatus = 'queued' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';

export interface NodeTask {
  id: string;
  userId: string;
  nodeId: string;
  nodeName: string;
  goal: string;
  status: NodeTaskStatus;
  progress: NodeTaskProgress[];
  result?: NodeTaskResult;
  question?: { questionId: string; question: string; options?: string[] };
  createdAt: number;
  updatedAt: number;
}

interface Row { id: string; user_id: string; node_id: string; node_name: string; goal: string; status: string; progress_json: string; result_json: string | null; question_json: string | null; created_at: number; updated_at: number }

export interface NodeTaskServiceOptions {
  db: AppDatabase;
  registry: NodeRegistry;
  gateway: NodeGateway;
  /** Tells the person about a finished or blocked task (notification, QQ, …). */
  notify?: (task: NodeTask, event: 'completed' | 'failed' | 'question') => void | Promise<void>;
  /** Pushes live updates to the owner's open clients. */
  broadcast?: (userId: string, message: { type: string; data?: unknown }) => void;
}

const MAX_PROGRESS = 200;
const parse = <T,>(raw: string | null, fallback: T): T => { if (!raw) return fallback; try { return JSON.parse(raw) as T; } catch { return fallback; } };

function toTask(row: Row): NodeTask {
  return { id: row.id, userId: row.user_id, nodeId: row.node_id, nodeName: row.node_name, goal: row.goal, status: row.status as NodeTaskStatus, progress: parse<NodeTaskProgress[]>(row.progress_json, []), ...(row.result_json ? { result: parse<NodeTaskResult | undefined>(row.result_json, undefined) } : {}), ...(row.question_json ? { question: parse<NodeTask['question']>(row.question_json, undefined) } : {}), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

/**
 * Tasks the brain hands to node sub-agents. State lives in `x_node_tasks`; the gateway relays the
 * assignment and streams progress back. A task queued while its node is offline is sent when the
 * node reconnects.
 */
export class NodeTaskService {
  private readonly ready: Promise<void>;

  constructor(private readonly options: NodeTaskServiceOptions) {
    this.ready = options.db.run('CREATE TABLE IF NOT EXISTS x_node_tasks (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, node_id VARCHAR(64) NOT NULL, node_name VARCHAR(128) NOT NULL, goal TEXT NOT NULL, status VARCHAR(32) NOT NULL, progress_json TEXT NOT NULL, result_json TEXT NULL, question_json TEXT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)');
    void this.ready.catch((error: unknown) => serverLogger.warn('nodes', '创建 x_node_tasks 表失败', error instanceof Error ? error.message : String(error)));
  }

  async create(userId: string, nodeRef: string, goal: string, options: { context?: string; allowedTools?: string[]; maxSteps?: number } = {}): Promise<NodeTask> {
    await this.ready;
    const node = await this.options.registry.resolve(userId, nodeRef);
    if (!node) throw new Error(`找不到节点「${nodeRef}」`);
    const trimmed = goal.trim();
    if (!trimmed) throw new Error('goal 必填');
    const now = Date.now();
    const task: NodeTask = { id: `ntask-${randomUUID().slice(0, 12)}`, userId, nodeId: node.id, nodeName: node.name, goal: trimmed.slice(0, 8000), status: 'queued', progress: [], createdAt: now, updatedAt: now };
    await this.options.db.run('INSERT INTO x_node_tasks (id, user_id, node_id, node_name, goal, status, progress_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [task.id, userId, node.id, node.name, task.goal, task.status, '[]', now, now]);
    await this.dispatch(task, options);
    return (await this.get(userId, task.id)) ?? task;
  }

  private async dispatch(task: NodeTask, options: { context?: string; allowedTools?: string[]; maxSteps?: number } = {}): Promise<void> {
    const sent = this.options.gateway.assignTask(task.nodeId, { taskId: task.id, userId: task.userId, goal: task.goal, ...options });
    if (sent) await this.setStatus(task.userId, task.id, 'running');
  }

  /** Re-sends queued tasks when their node comes online. */
  async flushQueued(node: NodeRecord): Promise<void> {
    await this.ready;
    const rows = await this.options.db.query<Row>("SELECT * FROM x_node_tasks WHERE node_id = ? AND status = 'queued' ORDER BY created_at ASC", [node.id]);
    for (const row of rows) await this.dispatch(toTask(row));
  }

  async list(userId: string, limit = 50): Promise<NodeTask[]> {
    await this.ready;
    return (await this.options.db.query<Row>('SELECT * FROM x_node_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, Math.min(200, Math.max(1, limit))])).map(toTask);
  }

  async get(userId: string, taskId: string): Promise<NodeTask | undefined> {
    await this.ready;
    const [row] = await this.options.db.query<Row>('SELECT * FROM x_node_tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
    return row ? toTask(row) : undefined;
  }

  async cancel(userId: string, taskId: string): Promise<boolean> {
    const task = await this.get(userId, taskId);
    if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) return false;
    this.options.gateway.send(task.nodeId, { type: 'task/cancel', taskId });
    await this.setStatus(userId, taskId, 'cancelled');
    return true;
  }

  async answer(userId: string, taskId: string, answer: string): Promise<boolean> {
    const task = await this.get(userId, taskId);
    if (!task?.question || task.status !== 'waiting_user') return false;
    if (!this.options.gateway.send(task.nodeId, { type: 'task/answer', taskId, questionId: task.question.questionId, answer })) throw new Error('节点不在线，稍后再回答');
    await this.options.db.run('UPDATE x_node_tasks SET status = ?, question_json = NULL, updated_at = ? WHERE id = ? AND user_id = ?', ['running', Date.now(), taskId, userId]);
    this.options.broadcast?.(userId, { type: 'node_task_updated', data: { id: taskId, status: 'running' } });
    return true;
  }

  async steer(userId: string, taskId: string, text: string): Promise<boolean> {
    const task = await this.get(userId, taskId);
    if (!task || task.status !== 'running') return false;
    return this.options.gateway.send(task.nodeId, { type: 'task/steer', taskId, text });
  }

  // ── Gateway callbacks ─────────────────────────────────────────

  async onProgress(node: NodeRecord, progress: NodeTaskProgress): Promise<void> {
    const task = await this.owned(node, progress.taskId);
    if (!task) return;
    const next = [...task.progress, progress].slice(-MAX_PROGRESS);
    await this.options.db.run('UPDATE x_node_tasks SET progress_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(next), Date.now(), task.id]);
    this.options.broadcast?.(task.userId, { type: 'node_task_progress', data: { id: task.id, progress } });
  }

  async onResult(node: NodeRecord, result: NodeTaskResult): Promise<void> {
    const task = await this.owned(node, result.taskId);
    if (!task || task.status === 'cancelled') return;
    const status: NodeTaskStatus = result.ok ? 'completed' : 'failed';
    await this.options.db.run('UPDATE x_node_tasks SET status = ?, result_json = ?, question_json = NULL, updated_at = ? WHERE id = ?', [status, JSON.stringify(result), Date.now(), task.id]);
    const updated = { ...task, status, result };
    this.options.broadcast?.(task.userId, { type: 'node_task_updated', data: { id: task.id, status } });
    await this.options.notify?.(updated, result.ok ? 'completed' : 'failed');
  }

  async onQuestion(node: NodeRecord, message: { taskId: string; questionId: string; question: string; options?: string[] }): Promise<void> {
    const task = await this.owned(node, message.taskId);
    if (!task) return;
    const question = { questionId: message.questionId, question: message.question.slice(0, 2000), ...(message.options ? { options: message.options.slice(0, 8) } : {}) };
    await this.options.db.run('UPDATE x_node_tasks SET status = ?, question_json = ?, updated_at = ? WHERE id = ?', ['waiting_user', JSON.stringify(question), Date.now(), task.id]);
    this.options.broadcast?.(task.userId, { type: 'node_task_updated', data: { id: task.id, status: 'waiting_user', question } });
    await this.options.notify?.({ ...task, status: 'waiting_user', question }, 'question');
  }

  private async owned(node: NodeRecord, taskId: string): Promise<NodeTask | undefined> {
    const task = await this.get(node.userId, taskId);
    if (!task || task.nodeId !== node.id) { serverLogger.warn('nodes', `节点 ${node.name} 汇报了不属于它的任务 ${taskId}`); return undefined; }
    return task;
  }

  private async setStatus(userId: string, taskId: string, status: NodeTaskStatus): Promise<void> {
    await this.options.db.run('UPDATE x_node_tasks SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', [status, Date.now(), taskId, userId]);
    this.options.broadcast?.(userId, { type: 'node_task_updated', data: { id: taskId, status } });
  }
}
