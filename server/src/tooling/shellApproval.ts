import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

export interface ShellApprovalRequest {
  toolCallId: string;
  command: string;
  workdir: string;
  timeout: number;
  workspace: string;
  executionMode: 'container' | 'host';
  hash: string;
}
export interface ShellApproval extends ShellApprovalRequest {
  id: string;
  expiresAt: number;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'rejected';
}
export class ShellApprovalRequiredError extends Error {
  constructor(readonly request: ShellApprovalRequest) { super('这条命令需要你确认后才能运行'); }
}
export class ShellExecutionDeniedError extends Error {}

export async function shellApprovalRequest(input: Record<string, unknown>, root: string, context: {userId?:string;runId?:string;toolCallId?:string}, executionMode:'container'|'host'='host') {
  if (!context.userId || context.userId === 'anonymous' || !context.runId || !context.toolCallId) throw new Error('Shell 命令须从可确认的交办记录执行');
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (!command || command.length > 16000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) throw new Error('命令为空、过长或包含不可见控制字符');
  if (input.workdir !== undefined && typeof input.workdir !== 'string') throw new Error('工作目录无效');
  if (input.timeout !== undefined && (typeof input.timeout !== 'number' || !Number.isSafeInteger(input.timeout))) throw new Error('命令超时参数无效');
  const timeout = Math.min(300000, Math.max(5000, input.timeout as number ?? 60000));
  const workspace = await realpath(root), requested = path.resolve(workspace, String(input.workdir ?? '.').replace(/^\//,''));
  const cwd = await realpath(requested), relative = path.relative(workspace,cwd);
  if (relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw new Error('命令工作目录必须在当前工作区内');
  const workdir = relative.split(path.sep).join('/') || '.';
  const hash = createHash('sha256').update(JSON.stringify([context.userId,context.runId,context.toolCallId,workspace,executionMode,command,workdir,timeout])).digest('hex');
  return { toolCallId: context.toolCallId, command, workdir, timeout, workspace, executionMode, hash };
}
