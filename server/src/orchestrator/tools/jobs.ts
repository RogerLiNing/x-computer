import type { ToolDefinition } from '@x-computer/shared';
import type { JobRegistry } from '../../jobs/JobRegistry.js';
import type { ToolHandler } from './types.js';

const base = { domain: ['chat', 'agent', 'coding'] as ToolDefinition['domain'], riskLevel: 'low' as const, requiredPermissions: [] as string[] };

export const jobToolDefinitions: ToolDefinition[] = [
  { ...base, name: 'job.list', displayName: '查看后台任务', parameters: [],
    description: '列出当前用户的后台任务（如 shell.run 以 run_in_background 启动的命令）：id、名称、状态、开始/结束时间。服务重启后运行中的任务不会保留。' },
  { ...base, name: 'job.output', displayName: '读取后台任务输出',
    description: '读取一个后台任务目前的输出（尾部最多 5 万字符）与状态；任务还在运行时也可读。',
    parameters: [{ name: 'job_id', type: 'string', description: 'job.list 返回的 id', required: true }, { name: 'tail', type: 'number', description: '只取末尾多少字符，默认 8000', required: false }] },
  { ...base, name: 'job.kill', displayName: '结束后台任务', riskLevel: 'medium',
    description: '结束一个仍在运行的后台任务。',
    parameters: [{ name: 'job_id', type: 'string', description: 'job.list 返回的 id', required: true }] },
];

export const JOB_TOOL_NAMES: readonly string[] = jobToolDefinitions.map((definition) => definition.name);

function requireUser(context: unknown): string {
  const userId = (context as { userId?: string } | undefined)?.userId;
  if (!userId || userId === 'anonymous') throw new Error('需要已登录用户');
  return userId;
}

export function createJobToolHandlers(jobs: JobRegistry): Record<string, ToolHandler> {
  const present = (job: ReturnType<JobRegistry['list']>[number]) => ({ id: job.id, label: job.label, status: job.status, startedAtISO: new Date(job.startedAt).toISOString(), ...(job.endedAt ? { endedAtISO: new Date(job.endedAt).toISOString() } : {}), ...(job.error ? { error: job.error } : {}) });
  return {
    'job.list': async (_input, context) => ({ jobs: jobs.list(requireUser(context)).map(present) }),
    'job.output': async (input, context) => {
      const job = jobs.get(requireUser(context), String(input.job_id ?? ''));
      if (!job) throw new Error('没有这个后台任务（可能已过期或属于别人）');
      const tail = Math.min(50_000, Math.max(200, Number(input.tail) || 8_000));
      return { ...present(job), output: job.output.slice(-tail), truncated: job.output.length > tail };
    },
    'job.kill': async (input, context) => {
      const userId = requireUser(context);
      const id = String(input.job_id ?? '');
      if (!jobs.kill(userId, id)) throw new Error('任务不存在或已结束');
      return { ok: true, id };
    },
  };
}
