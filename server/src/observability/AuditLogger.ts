import type { AuditEntry } from '../../../shared/src/index.js';

/**
 * AuditLogger — records the intent-action-result triple for every AI operation.
 *
 * Provides:
 * - Full execution trace for compliance / replay
 * - Queryable log by task, step, type, risk level
 * - In-memory storage for MVP (production: Postgres + object storage)
 */

export type AuditPersist = (entry: AuditEntry) => void;

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private maxEntries = 10_000;
  private persist: AuditPersist | null = null;

  constructor(options?: { persist?: AuditPersist }) {
    if (options?.persist) this.persist = options.persist;
  }

  setPersist(fn: AuditPersist | null): void {
    this.persist = fn;
  }

  /**
   * Record an audit entry.
   */
  log(entry: AuditEntry): void {
    this.entries.push(entry);
    this.persist?.(entry);

    // Trim if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Console output for observability during dev
    const parts = [
      `[Audit][${entry.type}]`,
      entry.intent ? `意图="${entry.intent}"` : '',
      entry.action ? `动作="${entry.action}"` : '',
      entry.result ? `结果="${entry.result}"` : '',
      entry.riskLevel ? `风险=${entry.riskLevel}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    console.log(parts);
  }

  /**
   * Get all entries for a task.
   */
  getByTask(taskId: string): AuditEntry[] {
    return this.entries.filter((e) => e.taskId === taskId);
  }

  /**
   * Get all entries.
   */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by type.
   */
  getByType(type: AuditEntry['type']): AuditEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * Get entries within a time range.
   */
  getByTimeRange(start: number, end: number): AuditEntry[] {
    return this.entries.filter((e) => e.timestamp >= start && e.timestamp <= end);
  }

  /**
   * Get the full timeline for replay.
   */
  getTimeline(taskId: string): AuditEntry[] {
    return this.getByTask(taskId).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get entry count.
   */
  get count(): number {
    return this.entries.length;
  }
}
