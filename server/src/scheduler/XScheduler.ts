/**
 * X 主脑自主定时执行：按指定时间或 cron 触发，在后台以对应用户身份跑 Agent（intent 作为用户消息）。
 * 不限制 X 想做什么——到点即执行，想做啥就做啥。
 * 支持可选持久化：启动时从 store 加载，增删改时同步到 store，重启后任务不丢失。
 */

export interface ScheduledJob {
  id: string;
  userId: string;
  intent: string;
  /** 单次执行：下次运行时间戳 */
  runAt: number;
  /** 可选：cron 五段 "分 时 日 月 周"（如 "0 9 * * *" 每天 9:00），有则周期执行 */
  cron?: string;
  createdAt: number;
}

/** 持久化存储：用于重启恢复与多实例一致性 */
export interface ScheduledJobStore {
  loadAll(): Promise<ScheduledJob[]>;
  save(job: ScheduledJob): void | Promise<void>;
  updateRunAt(id: string, runAt: number): void | Promise<void>;
  remove(id: string): void | Promise<void>;
}

const TICK_MS = 60_000; // 每分钟检查一次

function nextId(): string {
  return `sched-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 单段是否匹配：*、步长写法（如 * 斜杠 + 数字）、数字、逗号分隔数字 */
function cronSegmentMatches(seg: string, value: number): boolean {
  const s = seg.trim();
  if (s === '*') return true;
  const stepMatch = s.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10);
    return step > 0 && value % step === 0;
  }
  return s.split(',').some((part) => parseInt(part.trim(), 10) === value);
}

/** 简单 cron 五段 "分 时 日 月 周"，返回下一次运行时间戳（严格在 now 之后）；不支持则返回 null */
function nextCronRun(cron: string, now: number): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minStr, hourStr, dayStr, monthStr, weekStr] = parts;
  // 从下一分钟开始，逐分钟试探（最多 8 天）
  const start = new Date(now);
  start.setSeconds(0, 0);
  const startMs = start.getTime() + 60_000;
  for (let offset = 0; offset < 8 * 24 * 60; offset++) {
    const t = new Date(startMs + offset * 60 * 1000);
    if (
      cronSegmentMatches(minStr, t.getMinutes()) &&
      cronSegmentMatches(hourStr, t.getHours()) &&
      cronSegmentMatches(dayStr, t.getDate()) &&
      cronSegmentMatches(monthStr, t.getMonth() + 1) &&
      cronSegmentMatches(weekStr, t.getDay())
    ) {
      return t.getTime();
    }
  }
  return null;
}

export type OnRunJob = (job: ScheduledJob) => Promise<void>;

export class XScheduler {
  private onRun: OnRunJob;
  private store?: ScheduledJobStore;
  private jobs: ScheduledJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(onRun: OnRunJob, store?: ScheduledJobStore) {
    this.onRun = onRun;
    this.store = store;
  }

  /** 从持久化存储加载任务（启动时调用，再 start）。有 store 时应在 start() 前调用。对 cron 任务用 nextCronRun 重算 runAt，修正历史上错误存储的下次运行时间。 */
  async loadJobs(): Promise<void> {
    if (!this.store) return;
    const loaded = await this.store.loadAll();
    this.jobs = loaded;
    const now = Date.now();
    for (const job of this.jobs) {
      if (job.cron) {
        const next = nextCronRun(job.cron, now);
        if (next != null && next !== job.runAt) {
          job.runAt = next;
          const p = this.store?.updateRunAt(job.id, next);
          if (p) await p;
        }
      }
    }
  }

  /** 添加定时任务。at：ISO 时间或时间戳（单次）；cron：五段 cron（周期）；inMinutes/inHours：相对当前时间的分钟/小时数。至少填 at、cron、in_minutes、in_hours 之一。 */
  addJob(
    userId: string,
    intent: string,
    at?: string | number,
    cron?: string,
    inMinutes?: number,
    inHours?: number,
  ): ScheduledJob {
    const id = nextId();
    const now = Date.now();
    let runAt: number;
    if (cron && cron.trim()) {
      const next = nextCronRun(cron.trim(), now);
      runAt = next ?? now + 24 * 60 * 60 * 1000;
    } else if (inMinutes != null && inMinutes > 0) {
      runAt = now + inMinutes * 60 * 1000;
    } else if (inHours != null && inHours > 0) {
      runAt = now + inHours * 60 * 60 * 1000;
    } else if (at != null) {
      runAt = typeof at === 'number' ? at : new Date(at).getTime();
      if (runAt < now) runAt = now;
    } else {
      runAt = now;
    }
    const job: ScheduledJob = {
      id,
      userId,
      intent: String(intent).trim() || '执行预定任务',
      runAt,
      cron: cron?.trim() || undefined,
      createdAt: now,
    };
    this.jobs.push(job);
    void Promise.resolve(this.store?.save(job)).catch(() => {});
    return job;
  }

  listJobs(userId?: string): ScheduledJob[] {
    if (userId) return this.jobs.filter((j) => j.userId === userId);
    return [...this.jobs];
  }

  /** 调度器是否已启动（每分钟 tick 一次） */
  isRunning(): boolean {
    return this.timer != null;
  }

  /** 状态摘要：任务数、下次运行时间（当前用户或全局最近一次） */
  getStats(userId?: string): { jobCount: number; nextRunAt: number | null } {
    const list = userId ? this.jobs.filter((j) => j.userId === userId) : this.jobs;
    const now = Date.now();
    const future = list.filter((j) => j.runAt > now).map((j) => j.runAt);
    return {
      jobCount: list.length,
      nextRunAt: future.length > 0 ? Math.min(...future) : null,
    };
  }

  removeJob(id: string): boolean {
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i < 0) return false;
    this.jobs.splice(i, 1);
    void Promise.resolve(this.store?.remove(id)).catch(() => {});
    return true;
  }

  /** 将 fromUserId 的定时任务在内存中改为归属 toUserId（与 DB 合并后同步内存） */
  mergeJobsInto(fromUserId: string, toUserId: string): void {
    if (fromUserId === toUserId) return;
    for (const job of this.jobs) {
      if (job.userId === fromUserId) job.userId = toUserId;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const due = this.jobs.filter((j) => j.runAt <= now);
    for (const job of due) {
      if (job.cron) {
        const next = nextCronRun(job.cron, now);
        if (next != null) {
          job.runAt = next;
          const p = this.store?.updateRunAt(job.id, next);
          if (p) await p;
        } else {
          this.jobs.splice(this.jobs.indexOf(job), 1);
          const r = this.store?.remove(job.id);
          if (r) await r;
        }
      } else {
        this.jobs.splice(this.jobs.indexOf(job), 1);
        const r = this.store?.remove(job.id);
        if (r) await r;
      }
      this.onRun(job).catch((err) => {
        console.error('[XScheduler] run job failed', job.id, err);
      });
    }
  }
}

let defaultScheduler: XScheduler | null = null;

export function setDefaultScheduler(s: XScheduler): void {
  defaultScheduler = s;
}

export function getDefaultScheduler(): XScheduler | null {
  return defaultScheduler;
}
