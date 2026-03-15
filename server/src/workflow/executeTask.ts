/**
 * R041：工作流引擎执行任务回调
 * 主服务暴露此逻辑，供工作流引擎在执行 script/ai 任务时调用
 */

import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { SandboxShell } from '../tooling/SandboxShell.js';
import type { RunIntentFn } from './executeTask.types.js';

export interface ExecuteTaskParams {
  userId: string;
  instanceId: string;
  nodeId: string;
  taskType: string;
  config: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export interface ExecuteTaskDeps {
  userSandboxManager?: UserSandboxManager;
  runIntent?: RunIntentFn;
}

/**
 * 执行工作流任务，返回要合并到 variables 的结果
 */
export async function executeWorkflowTask(
  params: ExecuteTaskParams,
  deps: ExecuteTaskDeps,
): Promise<Record<string, unknown>> {
  const { userId, taskType, config, variables } = params;

  if (taskType === 'script') {
    return executeScriptTask(userId, config, deps);
  }

  if (taskType === 'ai') {
    return executeAITask(userId, config, deps);
  }

  // manual / http：直接返回 config 作为输出
  return { ...(config as Record<string, unknown>) };
}

async function executeScriptTask(
  userId: string,
  config: Record<string, unknown>,
  deps: ExecuteTaskDeps,
): Promise<Record<string, unknown>> {
  const manager = deps.userSandboxManager;
  if (!manager) {
    return { _error: 'userSandboxManager 未配置', _stdout: '', _stderr: '' };
  }

  const { sandboxFS } = await manager.getForUser(userId);
  const root = sandboxFS.getRoot();

  const scriptPath = config.script as string | undefined;
  const command = config.command as string | undefined;
  const args = (config.args as string[]) ?? [];

  let cmd: string;
  if (command) {
    cmd = command;
  } else if (scriptPath) {
    const path = scriptPath.startsWith('/') ? scriptPath.slice(1) : scriptPath;
    if (path.endsWith('.py')) {
      cmd = `python3 ${path} ${args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ')}`.trim();
    } else if (path.endsWith('.js')) {
      cmd = `node ${path} ${args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`).join(' ')}`.trim();
    } else {
      cmd = `./${path}`;
    }
  } else {
    return { _error: 'script 或 command 必填', _stdout: '', _stderr: '' };
  }

  const shell = new SandboxShell(root, 60_000);
  const result = await shell.execute(cmd);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    parsed = result.stdout.trim() || undefined;
  }

  return {
    _stdout: result.stdout,
    _stderr: result.stderr,
    _exitCode: result.exitCode,
    result: parsed,
    ...(typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}),
  };
}

async function executeAITask(
  userId: string,
  config: Record<string, unknown>,
  deps: ExecuteTaskDeps,
): Promise<Record<string, unknown>> {
  const runIntent = deps.runIntent;
  const intent = config.intent as string | undefined;
  if (!runIntent || !intent) {
    return { _ai_done: false, _error: 'runIntent 未配置或 intent 为空' };
  }

  runIntent(userId, intent);
  return { _ai_done: true };
}
