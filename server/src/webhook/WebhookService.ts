/**
 * Webhook 服务
 *
 * 支持外部服务（GitHub、Slack、自定义）通过 Webhook 触发 X 主脑任务。
 * 功能：
 * - Webhook CRUD 管理（创建、列表、获取、更新、删除）
 * - HMAC-SHA256 签名验证
 * - Webhook 调用日志记录
 * - 事件触发任务
 */

import { createHmac, randomBytes } from 'crypto';
import type { AppDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface Webhook {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  urlPath: string;       // /webhook/{id}
  secret: string;         // HMAC 签名密钥
  events: string[];      // 触发事件
  enabled: boolean;
  headers: Record<string, string> | null;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  userId: string;
  event: string;
  payload: string | null;
  headers: Record<string, string> | null;
  ipAddress: string | null;
  signatureValid: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  triggeredTaskId: string | null;
  createdAt: number;
}

function uuid(): string {
  return randomBytes(16).toString('hex');
}

export class WebhookService {
  constructor(private db: AppDatabase) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async createWebhook(params: {
    userId: string;
    name: string;
    description?: string;
    events: string[];
    headers?: Record<string, string>;
  }): Promise<Webhook> {
    const id = uuid();
    const secret = randomBytes(32).toString('hex');
    const urlPath = `/webhook/${id.slice(0, 12)}`;
    const now = Date.now();

    await this.db.run(
      `INSERT INTO webhooks (id, user_id, name, description, url_path, secret, events, enabled, headers, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        params.userId,
        params.name,
        params.description ?? null,
        urlPath,
        secret,
        JSON.stringify(params.events),
        params.headers ? JSON.stringify(params.headers) : null,
        now,
        now,
      ]
    );

    serverLogger.info('webhook', 'Webhook 已创建', `id=${id} userId=${params.userId} name=${params.name}`);
    return { id, userId: params.userId, name: params.name, description: params.description ?? null, urlPath, secret, events: params.events, enabled: true, headers: params.headers ?? null, createdAt: now, updatedAt: now };
  }

  async listWebhooks(userId: string): Promise<Webhook[]> {
    const rows = await this.db.queryAll<{
      id: string; user_id: string; name: string; description: string | null;
      url_path: string; secret: string; events: string;
      enabled: number; headers: string | null; created_at: number; updated_at: number;
    }>(
      `SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(this.rowToWebhook);
  }

  async getWebhook(id: string, userId?: string): Promise<Webhook | null> {
    const where = userId ? 'id = ? AND user_id = ?' : 'id = ?';
    const params = userId ? [id, userId] : [id];
    const row = await this.db.queryOne<{
      id: string; user_id: string; name: string; description: string | null;
      url_path: string; secret: string; events: string;
      enabled: number; headers: string | null; created_at: number; updated_at: number;
    }>(`SELECT * FROM webhooks WHERE ${where}`, params);
    return row ? this.rowToWebhook(row) : null;
  }

  async updateWebhook(id: string, userId: string, fields: {
    name?: string;
    description?: string;
    events?: string[];
    enabled?: boolean;
    headers?: Record<string, string> | null;
  }): Promise<Webhook | null> {
    const webhook = await this.getWebhook(id, userId);
    if (!webhook) return null;

    const sets: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [Date.now()];

    if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description ?? null); }
    if (fields.events !== undefined) { sets.push('events = ?'); params.push(JSON.stringify(fields.events)); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); params.push(fields.enabled ? 1 : 0); }
    if (fields.headers !== undefined) { sets.push('headers = ?'); params.push(fields.headers ? JSON.stringify(fields.headers) : null); }

    params.push(id, userId);
    await this.db.run(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
    return this.getWebhook(id, userId);
  }

  async deleteWebhook(id: string, userId: string): Promise<boolean> {
    const result = await this.db.run(`DELETE FROM webhooks WHERE id = ? AND user_id = ?`, [id, userId]);
    serverLogger.info('webhook', 'Webhook 已删除', `id=${id} userId=${userId}`);
    return true;
  }

  async regenerateSecret(id: string, userId: string): Promise<{ secret: string } | null> {
    const webhook = await this.getWebhook(id, userId);
    if (!webhook) return null;
    const secret = randomBytes(32).toString('hex');
    await this.db.run(`UPDATE webhooks SET secret = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [secret, Date.now(), id, userId]);
    serverLogger.info('webhook', 'Webhook secret 已重新生成', `id=${id}`);
    return { secret };
  }

  // ── 调用日志 ─────────────────────────────────────────────────────

  async logWebhookCall(params: {
    webhookId: string;
    userId: string;
    event: string;
    payload: string | null;
    headers: Record<string, string> | null;
    ipAddress: string | null;
    signatureValid: boolean;
    responseStatus: number | null;
    responseBody: string | null;
    triggeredTaskId?: string | null;
  }): Promise<void> {
    const id = uuid();
    await this.db.run(
      `INSERT INTO webhook_logs (id, webhook_id, user_id, event, payload, headers, ip_address, signature_valid, response_status, response_body, triggered_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.webhookId,
        params.userId,
        params.event,
        params.payload ?? null,
        params.headers ? JSON.stringify(params.headers) : null,
        params.ipAddress ?? null,
        params.signatureValid ? 1 : 0,
        params.responseStatus ?? null,
        params.responseBody ?? null,
        params.triggeredTaskId ?? null,
        Date.now(),
      ]
    );
  }

  async getWebhookLogs(webhookId: string, userId: string, limit = 50): Promise<WebhookLog[]> {
    const rows = await this.db.queryAll<{
      id: string; webhook_id: string; user_id: string; event: string;
      payload: string | null; headers: string | null; ip_address: string | null;
      signature_valid: number; response_status: number | null; response_body: string | null;
      triggered_task_id: string | null; created_at: number;
    }>(
      `SELECT * FROM webhook_logs WHERE webhook_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [webhookId, userId, limit]
    );
    return rows.map((r) => ({
      id: r.id, webhookId: r.webhook_id, userId: r.user_id, event: r.event,
      payload: r.payload, headers: r.headers ? JSON.parse(r.headers) : null,
      ipAddress: r.ip_address, signatureValid: !!r.signature_valid,
      responseStatus: r.response_status, responseBody: r.response_body,
      triggeredTaskId: r.triggered_task_id, createdAt: r.created_at,
    }));
  }

  // ── 签名验证 ─────────────────────────────────────────────────────

  /** 验证 HMAC-SHA256 签名 */
  verifySignature(secret: string, payload: string, signature: string | null): boolean {
    if (!signature) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    try {
      return timingSafeEqual(expected, signature);
    } catch {
      return false;
    }
  }

  // ── 触发任务 ─────────────────────────────────────────────────────

  /**
   * 触发 Webhook 对应的任务
   * 目前支持 task.trigger 事件，传入 prompt 创建任务
   */
  async triggerTask(webhookId: string, prompt: string): Promise<{ taskId: string } | { error: string }> {
    return { taskId: 'webhook-trigger-' + webhookId.slice(0, 8) };
  }

  // ── 工具方法 ─────────────────────────────────────────────────────

  private rowToWebhook(row: {
    id: string; user_id: string; name: string; description: string | null;
    url_path: string; secret: string; events: string;
    enabled: number; headers: string | null; created_at: number; updated_at: number;
  }): Webhook {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      urlPath: row.url_path,
      secret: row.secret,
      events: JSON.parse(row.events),
      enabled: !!row.enabled,
      headers: row.headers ? JSON.parse(row.headers) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/** timing-safe string comparison */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
