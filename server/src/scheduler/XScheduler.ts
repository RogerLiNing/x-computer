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
  /** 关联的 chat 会话 ID（提醒用） */
  sessionId?: string;
  /** 任务名称 */
  name?: string;
  scopeJson?: string | null;
}

/** Durable stores enqueue an occurrence before moving the plan forward. */
export interface ScheduledJobStore {
  loadAll(): Promise<ScheduledJob[]>;
  save(job: ScheduledJob): void | Promise<void>;
  updateRunAt(id: string, runAt: number): void | Promise<void>;
  remove(id: string): void | Promise<void>;
  queue?(job: ScheduledJob, nextAt: number | null): Promise<void>;
  recover?(): Promise<void>;
}

const TICK_MS = 60_000; // 每分钟检查一次

function nextId(): string {
  return `sched-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cronValues(segment: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of segment.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) return null;
    const step = Number(match[2] ?? 1);
    const range = match[1] === '*' ? [min, max] : match[1].split('-').map(Number);
    const start = range[0];
    const end = range[1] ?? (match[2] ? max : start);
    if (step < 1 || step > max + 1 || start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

/** Standard five-field cron in the server timezone; missed intervals coalesce into one run. */
export function nextCronRun(cron: string, now: number): number | null {
  if (!Number.isFinite(now)) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minutes = cronValues(parts[0], 0, 59), hours = cronValues(parts[1], 0, 23);
  const days = cronValues(parts[2], 1, 31), months = cronValues(parts[3], 1, 12), weeks = cronValues(parts[4], 0, 7);
  if (!minutes || !hours || !days || !months || !weeks) return null;
  if (weeks.has(7)) weeks.add(0);
  const date = new Date(now); date.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < 366 * 5; offset++, date.setDate(date.getDate() + 1)) {
    if (!months.has(date.getMonth() + 1)) continue;
    const day = days.has(date.getDate()), week = weeks.has(date.getDay());
    const matches = parts[2] === '*' ? week : parts[4] === '*' ? day : day || week;
    if (!matches) continue;
    for (const hour of [...hours].sort((a, b) => a - b)) {
      for (const minute of [...minutes].sort((a, b) => a - b)) {
        const candidate = new Date(date); candidate.setHours(hour, minute, 0, 0);
        if (candidate.getHours() !== hour || candidate.getMinutes() !== minute) continue;
        if (candidate.getTime() > now) return candidate.getTime();
      }
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
  private ticking = false;

  constructor(onRun: OnRunJob, store?: ScheduledJobStore) {
    this.onRun = onRun;
    this.store = store;
  }

  /** Preserve missed due times so restarting cannot silently skip an occurrence. */
  async loadJobs(): Promise<void> {
    if (!this.store) return;
    this.jobs = await this.store.loadAll();
  }

  /** 添加定时任务。at：ISO 时间或时间戳（单次）；cron：五段 cron（周期）；inMinutes/inHours：相对当前时间的分钟/小时数。至少填 at、cron、in_minutes、in_hours 之一。 */
  async addJob(
    userId: string,
    intent: string,
    at?: string | number,
    cron?: string,
    inMinutes?: number,
    inHours?: number,
    sessionId?: string,
    name?: string,
    scopeJson?: string,
  ): Promise<ScheduledJob> {
    const id = nextId();
    const now = Date.now();
    let runAt: number;
    if (cron && cron.trim()) {
      const next = nextCronRun(cron.trim(), now);
      if (next == null) throw new Error('不支持或无有效下次时间的 cron 表达式');
      runAt = next;
    } else if (inMinutes != null && inMinutes > 0) {
      runAt = now + inMinutes * 60 * 1000;
    } else if (inHours != null && inHours > 0) {
      runAt = now + inHours * 60 * 60 * 1000;
    } else if (at != null) {
      runAt = typeof at === 'number' ? at : new Date(at).getTime();
      if (runAt < now) runAt = now;
    } else {
      throw new Error('请指定有效的执行时间');
    }
    if (!Number.isFinite(runAt)) throw new Error('执行时间无效');
    const job: ScheduledJob = {
      id,
      userId,
      intent: String(intent).trim() || '执行预定任务',
      runAt,
      cron: cron?.trim() || undefined,
      createdAt: now,
      sessionId: sessionId?.trim() || undefined,
      name: name?.trim() || undefined,
      scopeJson,
    };
    await this.store?.save(job);
    this.jobs.push(job);
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

  async removeJob(id: string): Promise<boolean> {
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i < 0 && !this.store) return false;
    await this.store?.remove(id);
    const current = this.jobs.findIndex(job => job.id === id);
    if (current >= 0) this.jobs.splice(current, 1);
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
    const dispatch = () => { void this.tick().catch(error => console.error('[XScheduler] dispatch failed', error)); };
    this.timer = setInterval(dispatch, TICK_MS);
    dispatch();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
    await this.loadJobs();
    const now = Date.now();
    const due = this.jobs.filter((j) => j.runAt <= now);
    for (const job of due) {
      const snapshot = { ...job };
      const next = job.cron ? nextCronRun(job.cron, now) : null;
      if (this.store?.queue) {
        await this.store.queue(snapshot, next);
        continue;
      }
      // shortcut: only nonpersistent schedulers use this callback; durable dispatch uses the journal.
      await this.onRun(snapshot);
      if (job.cron) {
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
    }
    await this.store?.recover?.();
    if (this.store?.queue) await this.loadJobs();
    } finally { this.ticking = false; }
  }
}

let defaultScheduler: XScheduler | null = null;

export function setDefaultScheduler(s: XScheduler | null): void {
  defaultScheduler = s;
}

export function getDefaultScheduler(): XScheduler | null {
  return defaultScheduler;
}
