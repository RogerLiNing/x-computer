import type { AppDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';
import type { ModelUsageRecord } from './usage.js';

interface Row { provider_id: string; model_id: string; calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number | null; day?: string }

export interface UsageTotals { calls: number; promptTokens: number; completionTokens: number; costUsd: number | null }
export interface UsageSummary {
  since: number;
  totals: UsageTotals;
  byModel: Array<UsageTotals & { providerId: string; modelId: string }>;
  byDay: Array<UsageTotals & { day: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function totals(row: Row): UsageTotals {
  return { calls: Number(row.calls), promptTokens: Number(row.prompt_tokens), completionTokens: Number(row.completion_tokens), costUsd: row.cost_usd === null ? null : Number(row.cost_usd) };
}

/** Persists per-call token usage and answers the aggregations the usage panel shows. */
export class ModelUsageStore {
  private readonly ready: Promise<void>;

  constructor(private readonly db: AppDatabase) {
    this.ready = (async () => {
      await db.run('CREATE TABLE IF NOT EXISTS model_usage (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NULL, run_id VARCHAR(128) NULL, provider_id VARCHAR(128) NOT NULL, model_id VARCHAR(255) NOT NULL, virtual_model_id VARCHAR(128) NULL, prompt_tokens INT NOT NULL, completion_tokens INT NOT NULL, total_tokens INT NOT NULL, cost_usd DOUBLE NULL, created_at BIGINT NOT NULL)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_model_usage_user_time ON model_usage(user_id, created_at)').catch(() => {});
    })();
    void this.ready.catch((error: unknown) => serverLogger.warn('llm', '创建 model_usage 表失败', error instanceof Error ? error.message : String(error)));
  }

  async insert(record: ModelUsageRecord): Promise<void> {
    await this.ready;
    await this.db.run('INSERT INTO model_usage (id, user_id, run_id, provider_id, model_id, virtual_model_id, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [record.id, record.userId ?? null, record.runId ?? null, record.providerId, record.modelId, record.virtualModelId ?? null, record.promptTokens, record.completionTokens, record.totalTokens, record.costUsd ?? null, record.at]);
  }

  async summary(userId: string, options: { days?: number } = {}): Promise<UsageSummary> {
    await this.ready;
    const since = Date.now() - Math.min(366, Math.max(1, options.days ?? 30)) * DAY_MS;
    const dayExpr = this.db.getDialect() === 'mysql' ? "DATE_FORMAT(FROM_UNIXTIME(created_at / 1000), '%Y-%m-%d')" : "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')";
    const agg = 'COUNT(*) AS calls, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens, CASE WHEN SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) = COUNT(*) THEN NULL ELSE SUM(COALESCE(cost_usd, 0)) END AS cost_usd';
    const [total] = await this.db.query<Row>(`SELECT '' AS provider_id, '' AS model_id, ${agg} FROM model_usage WHERE user_id = ? AND created_at >= ?`, [userId, since]);
    const byModel = await this.db.query<Row>(`SELECT provider_id, model_id, ${agg} FROM model_usage WHERE user_id = ? AND created_at >= ? GROUP BY provider_id, model_id ORDER BY prompt_tokens + completion_tokens DESC`, [userId, since]);
    const byDay = await this.db.query<Row>(`SELECT ${dayExpr} AS day, '' AS provider_id, '' AS model_id, ${agg} FROM model_usage WHERE user_id = ? AND created_at >= ? GROUP BY day ORDER BY day ASC`, [userId, since]);
    return {
      since,
      totals: total && Number(total.calls) > 0 ? totals(total) : { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: null },
      byModel: byModel.map((row) => ({ providerId: row.provider_id, modelId: row.model_id, ...totals(row) })),
      byDay: byDay.map((row) => ({ day: row.day ?? '', ...totals(row) })),
    };
  }
}
