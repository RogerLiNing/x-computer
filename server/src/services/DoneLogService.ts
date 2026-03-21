import type { AppDatabase } from '../db/database.js';

const X_DONE_LOG_KEY = 'x_done_log';
const X_DONE_LOG_MAX = 50;

export type DoneLogEntry = {
  at: number;
  summary: string;
  scheduled?: boolean;
  schedule?: string;
  title?: string;
  action?: string;
};

export class DoneLogService {
  constructor(private db: AppDatabase) {}

  async append(
    userId: string,
    summary: string,
    detail?: { scheduled?: boolean; schedule?: string; title?: string; action?: string },
  ): Promise<void> {
    const raw = await Promise.resolve(this.db.getConfig(userId, X_DONE_LOG_KEY));
    let arr: DoneLogEntry[] = [];
    try {
      if (raw) arr = JSON.parse(raw) as DoneLogEntry[];
      if (!Array.isArray(arr)) arr = [];
    } catch {
      arr = [];
    }
    const entry: DoneLogEntry = {
      at: Date.now(),
      summary,
      ...(detail?.scheduled && { scheduled: true }),
      ...(detail?.schedule && { schedule: detail.schedule }),
      ...(detail?.title && { title: detail.title }),
      ...(detail?.action && { action: detail.action }),
    };
    arr.push(entry);
    arr = arr.slice(-X_DONE_LOG_MAX);
    await Promise.resolve(this.db.setConfig(userId, X_DONE_LOG_KEY, JSON.stringify(arr)));
  }
}
