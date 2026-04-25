/**
 * Lifecycle Hook Service
 *
 * Manages user-defined HTTP webhook hooks that fire at key points in the agent lifecycle.
 * Based on IronClaw's HookSystem design.
 */

import { randomBytes } from 'crypto';
import type { AppDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

/** Lifecycle points where hooks can be registered. */
export type HookPoint =
  | 'beforeInbound'
  | 'beforeToolCall'
  | 'beforeOutbound'
  | 'onSessionStart'
  | 'onSessionEnd'
  | 'transformResponse';

export const HOOK_POINTS: HookPoint[] = [
  'beforeInbound',
  'beforeToolCall',
  'beforeOutbound',
  'onSessionStart',
  'onSessionEnd',
  'transformResponse',
];

export const HOOK_POINT_LABELS: Record<HookPoint, string> = {
  beforeInbound: 'Before Inbound Message',
  beforeToolCall: 'Before Tool Call',
  beforeOutbound: 'Before Outbound Response',
  onSessionStart: 'On Session Start',
  onSessionEnd: 'On Session End',
  transformResponse: 'Transform Response',
};

/** Failure handling mode when hook execution fails or times out. */
export type HookFailureMode = 'failOpen' | 'failClosed';

/** Stored hook record. */
export interface Hook {
  id: string;
  userId: string;
  name: string;
  hookPoint: HookPoint;
  url: string;
  enabled: boolean;
  failureMode: HookFailureMode;
  timeoutMs: number;
  headers: Record<string, string>;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

/** Event payload sent to hook URLs. */
export interface HookEventPayload {
  hookPoint: HookPoint;
  timestamp: number;
  userId: string;
  threadId?: string;
  context?: string;
  content?: string;
  toolName?: string;
  parameters?: Record<string, unknown>;
  response?: string;
}

function uuid(): string {
  return randomBytes(16).toString('hex');
}

export class HookService {
  private cachedHooks: Map<string, Hook[]> = new Map();
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private db: AppDatabase) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async createHook(params: {
    userId: string;
    name: string;
    hookPoint: HookPoint;
    url: string;
    enabled?: boolean;
    failureMode?: HookFailureMode;
    timeoutMs?: number;
    headers?: Record<string, string>;
    priority?: number;
  }): Promise<Hook> {
    const id = uuid();
    const now = Date.now();

    await this.db.run(
      `INSERT INTO hooks (id, user_id, name, hook_point, url, enabled, failure_mode, timeout_ms, headers, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.userId,
        params.name,
        params.hookPoint,
        params.url,
        params.enabled !== false ? 1 : 0,
        params.failureMode ?? 'failOpen',
        params.timeoutMs ?? 5000,
        JSON.stringify(params.headers ?? {}),
        params.priority ?? 100,
        now,
        now,
      ]
    );

    this.invalidateCache(params.userId);
    serverLogger.info('hooks', 'Hook 已创建', `id=${id} userId=${params.userId} name=${params.name} point=${params.hookPoint}`);
    return this.rowToHook({
      id,
      user_id: params.userId,
      name: params.name,
      hook_point: params.hookPoint,
      url: params.url,
      enabled: params.enabled !== false ? 1 : 0,
      failure_mode: params.failureMode ?? 'failOpen',
      timeout_ms: params.timeoutMs ?? 5000,
      headers: JSON.stringify(params.headers ?? {}),
      priority: params.priority ?? 100,
      created_at: now,
      updated_at: now,
    });
  }

  async listHooks(userId: string): Promise<Hook[]> {
    const cached = this.cachedHooks.get(userId);
    if (cached) return cached;

    const rows = await this.db.queryAll<{
      id: string; user_id: string; name: string; hook_point: string;
      url: string; enabled: number; failure_mode: string;
      timeout_ms: number; headers: string; priority: number;
      created_at: number; updated_at: number;
    }>(`SELECT * FROM hooks WHERE user_id = ? ORDER BY priority ASC, created_at DESC`, [userId]);

    const hooks = rows.map(this.rowToHook);
    this.cachedHooks.set(userId, hooks);
    return hooks;
  }

  async getHook(id: string, userId?: string): Promise<Hook | null> {
    const where = userId ? 'id = ? AND user_id = ?' : 'id = ?';
    const params = userId ? [id, userId] : [id];
    const row = await this.db.queryOne<{
      id: string; user_id: string; name: string; hook_point: string;
      url: string; enabled: number; failure_mode: string;
      timeout_ms: number; headers: string; priority: number;
      created_at: number; updated_at: number;
    }>(`SELECT * FROM hooks WHERE ${where}`, params);
    return row ? this.rowToHook(row) : null;
  }

  async updateHook(id: string, userId: string, params: {
    name?: string;
    hookPoint?: HookPoint;
    url?: string;
    enabled?: boolean;
    failureMode?: HookFailureMode;
    timeoutMs?: number;
    headers?: Record<string, string>;
    priority?: number;
  }): Promise<Hook | null> {
    const existing = await this.getHook(id, userId);
    if (!existing) return null;

    const now = Date.now();
    const updated = {
      name: params.name ?? existing.name,
      hookPoint: params.hookPoint ?? existing.hookPoint,
      url: params.url ?? existing.url,
      enabled: params.enabled ?? existing.enabled,
      failureMode: params.failureMode ?? existing.failureMode,
      timeoutMs: params.timeoutMs ?? existing.timeoutMs,
      headers: params.headers ?? existing.headers,
      priority: params.priority ?? existing.priority,
    };

    await this.db.run(
      `UPDATE hooks SET name=?, hook_point=?, url=?, enabled=?, failure_mode=?, timeout_ms=?, headers=?, priority=?, updated_at=? WHERE id=? AND user_id=?`,
      [
        updated.name,
        updated.hookPoint,
        updated.url,
        updated.enabled ? 1 : 0,
        updated.failureMode,
        updated.timeoutMs,
        JSON.stringify(updated.headers),
        updated.priority,
        now,
        id,
        userId,
      ]
    );

    this.invalidateCache(userId);
    serverLogger.info('hooks', 'Hook 已更新', `id=${id} userId=${userId}`);
    return { ...existing, ...updated, updatedAt: now };
  }

  async deleteHook(id: string, userId: string): Promise<boolean> {
    const existing = await this.getHook(id, userId);
    if (!existing) return false;

    await this.db.run(`DELETE FROM hooks WHERE id=? AND user_id=?`, [id, userId]);
    this.invalidateCache(userId);
    serverLogger.info('hooks', 'Hook 已删除', `id=${id} userId=${userId}`);
    return true;
  }

  async toggleHook(id: string, userId: string, enabled: boolean): Promise<Hook | null> {
    return this.updateHook(id, userId, { enabled });
  }

  // ── Execution ───────────────────────────────────────────────────

  /**
   * Execute all enabled hooks for a given hook point.
   * Returns the final (possibly modified) event payload.
   * Failures are handled per-hook based on failureMode.
   */
  async executeHooks(point: HookPoint, payload: HookEventPayload): Promise<HookEventPayload> {
    // Load all hooks for users (simplified: load hooks from all users)
    // In a real system we'd filter by userId from the payload
    const hooks = await this.loadEnabledHooks(point);

    if (hooks.length === 0) return payload;

    let currentPayload = { ...payload };

    for (const hook of hooks) {
      const result = await this.executeHook(hook, currentPayload);
      if (result.stop) {
        serverLogger.info('hooks', 'Hook rejected, stopping chain', `hook=${hook.name} point=${point}`);
        break;
      }
      if (result.modified) {
        currentPayload = { ...currentPayload, ...result.modified };
      }
    }

    return currentPayload;
  }

  private async executeHook(
    hook: Hook,
    payload: HookEventPayload,
  ): Promise<{ stop?: boolean; modified?: Partial<HookEventPayload> }> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), hook.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'x-computer-hook/1.0',
        'X-Hook-Point': hook.hookPoint,
        'X-Hook-Id': hook.id,
        ...hook.headers,
      };

      const response = await fetch(hook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        serverLogger.warn('hooks', 'Hook returned non-OK status', `hook=${hook.name} status=${response.status}`);
        if (hook.failureMode === 'failClosed') {
          return { stop: true };
        }
        return {};
      }

      const body = await response.text();
      if (body.trim()) {
        try {
          const data = JSON.parse(body) as { modified?: Partial<HookEventPayload>; reject?: { reason?: string } };
          if (data.reject) {
            serverLogger.info('hooks', 'Hook rejected', `hook=${hook.name} reason=${data.reject.reason}`);
            return { stop: true };
          }
          if (data.modified) {
            serverLogger.debug('hooks', 'Hook modified payload', `hook=${hook.name}`);
            return { modified: data.modified };
          }
        } catch {
          // Non-JSON response — treat as plain text modification
          return { modified: { content: body } };
        }
      }

      return {};
    } catch (err: unknown) {
      clearTimeout(timeout);
      const reason = err instanceof Error ? err.message : String(err);
      const elapsed = Date.now() - start;
      serverLogger.warn('hooks', 'Hook execution failed', `hook=${hook.name} reason=${reason} elapsed=${elapsed}ms`);

      if (hook.failureMode === 'failClosed') {
        return { stop: true };
      }
      return {};
    }
  }

  private async loadEnabledHooks(point: HookPoint): Promise<Hook[]> {
    const rows = await this.db.queryAll<{
      id: string; user_id: string; name: string; hook_point: string;
      url: string; enabled: number; failure_mode: string;
      timeout_ms: number; headers: string; priority: number;
      created_at: number; updated_at: number;
    }>(
      `SELECT * FROM hooks WHERE hook_point = ? AND enabled = 1 ORDER BY priority ASC`,
      [point]
    );
    return rows.map(this.rowToHook);
  }

  private invalidateCache(userId?: string): void {
    if (this.cacheTimer) clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(() => {
      if (userId) {
        this.cachedHooks.delete(userId);
      } else {
        this.cachedHooks.clear();
      }
    }, 100);
  }

  private rowToHook(row: {
    id: string; user_id: string; name: string; hook_point: string;
    url: string; enabled: number; failure_mode: string;
    timeout_ms: number; headers: string; priority: number;
    created_at: number; updated_at: number;
  }): Hook {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      hookPoint: row.hook_point as HookPoint,
      url: row.url,
      enabled: !!row.enabled,
      failureMode: row.failure_mode as HookFailureMode,
      timeoutMs: row.timeout_ms,
      headers: JSON.parse(row.headers || '{}'),
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
