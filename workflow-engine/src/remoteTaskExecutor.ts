/**
 * 远程任务执行：工作流引擎通过 HTTP 回调主服务执行 script/ai 任务
 */

import type { TaskExecuteCallback } from './runner.js';

const CALLBACK_URL = process.env.WORKFLOW_CALLBACK_URL ?? process.env.X_COMPUTER_URL ?? 'http://localhost:4000';

export function createRemoteTaskExecutor(): TaskExecuteCallback | undefined {
  const base = CALLBACK_URL.replace(/\/$/, '');
  const url = `${base}/api/workflow/execute-task`;

  return async (params) => {
    const token=process.env.WORKFLOW_SERVICE_TOKEN;
    if(!token || token.length<32)throw new Error('WORKFLOW_SERVICE_TOKEN必须配置至少32字符');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userId: params.userId,
        instanceId: params.instanceId,
        nodeId: params.nodeId,
        taskType: params.taskType,
        config: params.config,
        variables: params.variables,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`execute-task failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return data;
  };
}
