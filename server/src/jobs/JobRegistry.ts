import { randomUUID } from 'node:crypto';
import { serverLogger } from '../observability/ServerLogger.js';

export type JobStatus = 'running' | 'completed' | 'failed' | 'killed';

export interface JobRecord {
  id: string;
  userId: string;
  label: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  /** Bounded tail of what the job printed or returned. */
  output: string;
  error?: string;
}

export interface JobCompletion { job: JobRecord }

export interface JobRegistryOptions {
  /** Running jobs one user may hold at once. */
  maxRunningPerUser?: number;
  /** Characters of output kept per job. */
  maxOutputChars?: number;
  /** Finished jobs are forgotten after this long. */
  retainFinishedMs?: number;
  /** Called once when a job leaves the running state; used to notify the user. */
  onFinished?: (job: JobRecord) => void | Promise<void>;
}

const DEFAULTS = { maxRunningPerUser: 5, maxOutputChars: 50_000, retainFinishedMs: 6 * 60 * 60 * 1000 } as const;

interface Entry { record: JobRecord; controller: AbortController }

/**
 * In-process registry of background work started by tools (long shell commands today). A job is
 * owned by one user, keeps a bounded output tail, can be killed, and reports once when it finishes.
 * It is deliberately not durable: a restart forgets running jobs, and the tool says so.
 */
export class JobRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly options: Required<Omit<JobRegistryOptions, 'onFinished'>> & Pick<JobRegistryOptions, 'onFinished'>;

  constructor(options: JobRegistryOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Starts `work` right away and returns the job record without waiting for it. */
  start(userId: string, label: string, work: (signal: AbortSignal, append: (text: string) => void) => Promise<unknown>): JobRecord {
    this.sweep();
    if (this.list(userId).filter((job) => job.status === 'running').length >= this.options.maxRunningPerUser) {
      throw new Error(`最多同时运行 ${this.options.maxRunningPerUser} 个后台任务，请先等待或用 job.kill 结束一个`);
    }
    const controller = new AbortController();
    const record: JobRecord = { id: `job-${randomUUID().slice(0, 8)}`, userId, label: label.slice(0, 200), status: 'running', startedAt: Date.now(), output: '' };
    const entry: Entry = { record, controller };
    this.entries.set(record.id, entry);
    const append = (text: string) => { entry.record = { ...entry.record, output: (entry.record.output + text).slice(-this.options.maxOutputChars) }; };
    void work(controller.signal, append)
      .then((result) => { if (result !== undefined && typeof result !== 'string') append(`\n${JSON.stringify(result).slice(0, 4000)}`); else if (typeof result === 'string') append(result); this.finish(entry, controller.signal.aborted ? 'killed' : 'completed'); })
      .catch((error: unknown) => this.finish(entry, controller.signal.aborted ? 'killed' : 'failed', error instanceof Error ? error.message : String(error)));
    return record;
  }

  list(userId: string): JobRecord[] {
    this.sweep();
    return [...this.entries.values()].map((entry) => entry.record).filter((job) => job.userId === userId).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(userId: string, id: string): JobRecord | undefined {
    const record = this.entries.get(id)?.record;
    return record?.userId === userId ? record : undefined;
  }

  /** Signals the job to stop; the work decides how quickly it honours the signal. */
  kill(userId: string, id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.record.userId !== userId || entry.record.status !== 'running') return false;
    entry.controller.abort(new DOMException('用户结束了后台任务', 'AbortError'));
    return true;
  }

  private finish(entry: Entry, status: JobStatus, error?: string): void {
    if (entry.record.status !== 'running') return;
    entry.record = { ...entry.record, status, endedAt: Date.now(), ...(error ? { error } : {}) };
    this.entries.set(entry.record.id, entry);
    Promise.resolve(this.options.onFinished?.(entry.record)).catch((reason: unknown) => serverLogger.warn('jobs', '后台任务完成通知失败', reason instanceof Error ? reason.message : String(reason)));
  }

  private sweep(): void {
    const cutoff = Date.now() - this.options.retainFinishedMs;
    for (const [id, entry] of this.entries) if (entry.record.status !== 'running' && (entry.record.endedAt ?? 0) < cutoff) this.entries.delete(id);
  }
}
