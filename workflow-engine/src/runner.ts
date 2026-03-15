/**
 * 工作流运行器：驱动实例执行，回调主服务执行 task
 */

import type { WorkflowDefinition, WorkflowInstance } from './types.js';
import type { WorkflowStore } from './store.js';
import { getInitialNodeIds, advance } from './engine.js';

export interface TaskExecuteCallback {
  (params: {
    userId: string;
    instanceId: string;
    nodeId: string;
    taskType: string;
    config: Record<string, unknown>;
    variables: Record<string, unknown>;
  }): Promise<Record<string, unknown>>; // 返回要合并到 variables 的结果
}

export interface WorkflowRunnerDeps {
  store: WorkflowStore;
  onTaskExecute?: TaskExecuteCallback;
}

export class WorkflowRunner {
  constructor(private deps: WorkflowRunnerDeps) {}

  /** 启动新实例并执行到第一个等待点或结束 */
  async start(userId: string, definitionId: string): Promise<{ instanceId: string }> {
    const def = this.deps.store.getDefinition(userId, definitionId);
    if (!def) throw new Error(`流程定义不存在: ${definitionId}`);

    const instanceId = this.deps.store.createInstance(definitionId, userId);
    const initialIds = getInitialNodeIds(def);
    if (initialIds.length === 0) {
      this.deps.store.updateInstance(userId, instanceId, { status: 'completed', currentNodeIds: [] });
      return { instanceId };
    }

    await this.runFromNodes(userId, instanceId, initialIds);
    return { instanceId };
  }

  /** 从指定节点继续执行（任务完成后调用，主服务回调时使用单节点） */
  async continueAfterTask(userId: string, instanceId: string, completedNodeId: string, taskOutput: Record<string, unknown>): Promise<void> {
    await this.continueAfterTasks(userId, instanceId, [completedNodeId], [taskOutput]);
  }

  /** 内部：多个任务完成后合并输出并推进（支持 parallel join） */
  private async continueAfterTasks(
    userId: string,
    instanceId: string,
    completedNodeIds: string[],
    taskOutputs: Record<string, unknown>[],
  ): Promise<void> {
    const inst = this.deps.store.getInstance(userId, instanceId);
    if (!inst || inst.status !== 'running') return;

    const def = this.deps.store.getDefinition(userId, inst.definitionId);
    if (!def) return;

    const mergedOutput = taskOutputs.reduce((acc, o) => ({ ...acc, ...o }), {} as Record<string, unknown>);
    const variables = { ...inst.variables, ...mergedOutput };
    const { nextNodeIds, status } = advance(def, completedNodeIds, variables);

    this.deps.store.updateInstance(userId, instanceId, {
      variables,
      currentNodeIds: nextNodeIds,
      ...(status === 'completed' ? { status: 'completed' } : {}),
    });

    if (status === 'waiting' && nextNodeIds.length > 0) {
      await this.runFromNodes(userId, instanceId, nextNodeIds);
    }
  }

  private async runFromNodes(userId: string, instanceId: string, nodeIds: string[]): Promise<void> {
    const inst = this.deps.store.getInstance(userId, instanceId);
    if (!inst || inst.status !== 'running') return;

    const def = this.deps.store.getDefinition(userId, inst.definitionId);
    if (!def) return;

    const tasks = nodeIds.filter((nid) => {
      const node = def.nodes.find((n) => n.id === nid);
      return node?.type === 'task';
    });

    if (tasks.length === 0) return;

    if (this.deps.onTaskExecute) {
      try {
        const results = await Promise.all(
          tasks.map(async (nid) => {
            const node = def.nodes.find((n) => n.id === nid)!;
            const taskType = node.taskType ?? 'manual';
            const config = node.config ?? {};
            const output = await this.deps.onTaskExecute!({
              userId,
              instanceId,
              nodeId: nid,
              taskType,
              config,
              variables: inst.variables,
            });
            return { nid, output };
          }),
        );
        const completedIds = results.map((r) => r.nid);
        const outputs = results.map((r) => r.output);
        await this.continueAfterTasks(userId, instanceId, completedIds, outputs);
      } catch (err) {
        this.deps.store.updateInstance(userId, instanceId, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      const outputs = tasks.map((nid) => {
        const node = def.nodes.find((n) => n.id === nid)!;
        return { ...(node.config as Record<string, unknown>) };
      });
      await this.continueAfterTasks(userId, instanceId, tasks, outputs);
    }
  }
}
