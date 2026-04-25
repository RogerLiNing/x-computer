/**
 * X 主脑 Heartbeat 心跳服务
 *
 * 定期主动检查用户状态并推送通知，类似 CoPaw/IronClaw 的 Heartbeat 系统。
 *
 * 检查项：
 * - 配额使用量（AI 调用、存储）- 接近阈值时告警
 * - 任务状态（长时间运行、失败）- 通知用户
 * - 系统公告 - 新公告时通知
 * - 每日摘要 - 每日定时推送任务概览
 *
 * 持久化心跳配置和通知记录到数据库，支持重启恢复。
 */

import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { broadcastToUser } from '../wsBroadcast.js';
import { serverLogger } from '../observability/ServerLogger.js';

// ── 类型定义 ─────────────────────────────────────────────────────

export type CheckType = 'quota_usage' | 'task_status' | 'system_announcement' | 'daily_summary';

export interface HeartbeatConfig {
  userId: string;
  enabled: boolean;
  intervalMinutes: number;
  lastCheckAt: number | null;
  lastSummaryAt: number | null;
  quotaAlertThreshold: number; // 0.0 - 1.0
  taskAlertEnabled: boolean;
}

export interface HeartbeatNotification {
  id: string;
  userId: string;
  checkType: CheckType;
  content: string;
  payload?: Record<string, unknown>;
  notifiedAt: number;
  dismissed: boolean;
}

// ── 心跳服务 ─────────────────────────────────────────────────────

export class HeartbeatService {
  private db: AppDatabase;
  private subscriptionService: SubscriptionService;
  private orchestrator: AgentOrchestrator;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private userConfigs: Map<string, HeartbeatConfig> = new Map();
  private isRunning = false;

  constructor(
    db: AppDatabase,
    subscriptionService: SubscriptionService,
    orchestrator: AgentOrchestrator,
    intervalMs = 60 * 60 * 1000, // 默认每 60 分钟检查一次
  ) {
    this.db = db;
    this.subscriptionService = subscriptionService;
    this.orchestrator = orchestrator;
    this.intervalMs = intervalMs;
  }

  /** 启动心跳服务 */
  async start(): Promise<void> {
    if (this.timer) return;
    await this.loadAllConfigs();
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.isRunning = true;
    serverLogger.info('heartbeat', '心跳服务已启动', `intervalMs=${this.intervalMs} users=${this.userConfigs.size}`);
    // 立即执行一次
    await this.tick();
  }

  /** 停止心跳服务 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.isRunning = false;
      serverLogger.info('heartbeat', '心跳服务已停止');
    }
  }

  /** 是否正在运行 */
  running(): boolean {
    return this.isRunning;
  }

  // ── 配置管理 ─────────────────────────────────────────────────

  /** 加载所有启用了心跳的用户配置 */
  private async loadAllConfigs(): Promise<void> {
    const rows = await this.db.query<{
      user_id: string;
      enabled: number;
      interval_minutes: number;
      last_check_at: number | null;
      last_summary_at: number | null;
      quota_alert_threshold: number;
      task_alert_enabled: number;
    }>('SELECT * FROM heartbeat_config WHERE enabled = 1');

    this.userConfigs.clear();
    for (const row of rows) {
      this.userConfigs.set(row.user_id, {
        userId: row.user_id,
        enabled: row.enabled === 1,
        intervalMinutes: row.interval_minutes,
        lastCheckAt: row.last_check_at ?? null,
        lastSummaryAt: row.last_summary_at ?? null,
        quotaAlertThreshold: row.quota_alert_threshold,
        taskAlertEnabled: row.task_alert_enabled === 1,
      });
    }
  }

  /** 获取用户心跳配置（不存在时返回默认） */
  async getConfig(userId: string): Promise<HeartbeatConfig> {
    const row = await this.db.queryOne<{
      user_id: string;
      enabled: number;
      interval_minutes: number;
      last_check_at: number | null;
      last_summary_at: number | null;
      quota_alert_threshold: number;
      task_alert_enabled: number;
    }>('SELECT * FROM heartbeat_config WHERE user_id = ?', [userId]);

    if (row) {
      return {
        userId: row.user_id,
        enabled: row.enabled === 1,
        intervalMinutes: row.interval_minutes,
        lastCheckAt: row.last_check_at ?? null,
        lastSummaryAt: row.last_summary_at ?? null,
        quotaAlertThreshold: row.quota_alert_threshold,
        taskAlertEnabled: row.task_alert_enabled === 1,
      };
    }

    return {
      userId,
      enabled: true,
      intervalMinutes: 60,
      lastCheckAt: null,
      lastSummaryAt: null,
      quotaAlertThreshold: 0.8,
      taskAlertEnabled: true,
    };
  }

  /** 更新用户心跳配置 */
  async setConfig(userId: string, config: Partial<Omit<HeartbeatConfig, 'userId' | 'lastCheckAt' | 'lastSummaryAt'>>): Promise<HeartbeatConfig> {
    const now = Date.now();
    const existing = await this.getConfig(userId);

    const merged: HeartbeatConfig = {
      ...existing,
      ...config,
      userId,
    };

    await this.db.run(
      `INSERT OR REPLACE INTO heartbeat_config
       (user_id, enabled, interval_minutes, last_check_at, last_summary_at, quota_alert_threshold, task_alert_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        merged.enabled ? 1 : 0,
        merged.intervalMinutes,
        merged.lastCheckAt ?? null,
        merged.lastSummaryAt ?? null,
        merged.quotaAlertThreshold,
        merged.taskAlertEnabled ? 1 : 0,
        now,
        now,
      ],
    );

    this.userConfigs.set(userId, merged);
    return merged;
  }

  /** 获取心跳状态统计 */
  async getStats(): Promise<{ enabledUsers: number; running: boolean }> {
    return {
      enabledUsers: this.userConfigs.size,
      running: this.isRunning,
    };
  }

  // ── 核心心跳循环 ─────────────────────────────────────────────

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [userId, config] of this.userConfigs) {
      // 检查是否到了检查时间（根据 interval 配置）
      const intervalMs = config.intervalMinutes * 60 * 1000;
      if (config.lastCheckAt && now - config.lastCheckAt < intervalMs) {
        continue;
      }

      try {
        await this.runChecksForUser(userId, config);
      } catch (err) {
        serverLogger.error('heartbeat', `用户 ${userId} 心跳检查失败`, `error=${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async runChecksForUser(userId: string, config: HeartbeatConfig): Promise<void> {
    const now = Date.now();
    const checks: Promise<void>[] = [];

    // 1. 配额使用量检查
    if (config.enabled) {
      checks.push(this.checkQuotaUsage(userId, config));
    }

    // 2. 任务状态检查
    if (config.taskAlertEnabled) {
      checks.push(this.checkTaskStatus(userId));
    }

    // 3. 每日摘要（每天最多一次）
    if (this.shouldRunDailySummary(config, now)) {
      checks.push(this.runDailySummary(userId));
    }

    await Promise.allSettled(checks);

    // 更新 lastCheckAt
    await this.updateLastCheck(userId, now, config);
  }

  // ── 配额检查 ─────────────────────────────────────────────────

  private async checkQuotaUsage(userId: string, config: HeartbeatConfig): Promise<void> {
    try {
      const limits = await this.subscriptionService.getQuotaLimits(userId);
      const usage = await this.subscriptionService.getCurrentUsage(userId);

      // 检查 AI 调用配额
      if (limits.aiCallsLimit !== Infinity && limits.aiCallsLimit > 0) {
        const ratio = usage.aiCalls / limits.aiCallsLimit;
        if (ratio >= config.quotaAlertThreshold) {
          const pct = Math.round(ratio * 100);
          const remaining = limits.aiCallsLimit - usage.aiCalls;
          const msg = pct >= 100
            ? `AI 调用配额已用完（${usage.aiCalls} 次），请考虑升级套餐以继续使用。`
            : `AI 调用配额已使用 ${pct}%（剩余约 ${remaining} 次），建议关注使用量。`;

          // 查重：最近 1 小时内是否已通知过
          if (!await this.hasRecentNotification(userId, 'quota_usage', 60)) {
            await this.notify(userId, 'quota_usage', msg, { ratio, remaining, limit: limits.aiCallsLimit });
          }
        }
      }

      // 检查存储配额
      if (limits.storageLimit !== Infinity && limits.storageLimit > 0) {
        const ratio = usage.storage / limits.storageLimit;
        if (ratio >= config.quotaAlertThreshold) {
          const pct = Math.round(ratio * 100);
          const remaining = limits.storageLimit - usage.storage;
          const remainingMB = Math.round(remaining / (1024 * 1024));
          const msg = pct >= 100
            ? `存储空间已用完，请清理文件或升级套餐。`
            : `存储空间已使用 ${pct}%（剩余约 ${remainingMB} MB），建议关注存储使用。`;

          if (!await this.hasRecentNotification(userId, 'quota_usage', 60)) {
            await this.notify(userId, 'quota_usage', msg, { ratio, remainingMB, limit: limits.storageLimit });
          }
        }
      }
    } catch (err) {
      // 忽略错误（用户可能未配置订阅）
    }
  }

  // ── 任务状态检查 ─────────────────────────────────────────────

  private async checkTaskStatus(userId: string): Promise<void> {
    const allTasks = this.orchestrator.getAllTasks().filter((t) => {
      const taskUserId = (t.metadata as { userId?: string } | undefined)?.userId;
      return taskUserId === userId;
    });

    if (allTasks.length === 0) return;

    // 检查是否有长时间运行的任务（超过 10 分钟未完成）
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000;
    const stale = allTasks.filter(
      (t) => t.status === 'running' && now - t.createdAt > staleThreshold,
    );

    if (stale.length > 0) {
      const taskTitles = stale.map((t) => `"${t.title}"`).slice(0, 3).join('、');
      const msg = stale.length > 3
        ? `有 ${stale.length} 个任务长时间运行中，可能需要关注：${taskTitles} 等。`
        : `以下任务长时间运行中，可能需要关注：${taskTitles}。`;

      if (!await this.hasRecentNotification(userId, 'task_status', 30)) {
        await this.notify(userId, 'task_status', msg, {
          staleCount: stale.length,
          tasks: stale.slice(0, 5).map((t) => ({ id: t.id, title: t.title, status: t.status })),
        });
      }
    }

    // 检查是否有失败的任务（最近 1 小时内）
    const recentFailures = allTasks.filter(
      (t) => t.status === 'failed' && now - t.updatedAt < 60 * 60 * 1000,
    );

    if (recentFailures.length > 0) {
      const titles = recentFailures.map((t) => `"${t.title}"`).slice(0, 3).join('、');
      const msg = recentFailures.length > 3
        ? `有 ${recentFailures.length} 个任务最近失败了：${titles} 等。请检查任务配置。`
        : `以下任务最近失败了：${titles}。请检查任务配置。`;

      if (!await this.hasRecentNotification(userId, 'task_status', 30)) {
        await this.notify(userId, 'task_status', msg, {
          failedCount: recentFailures.length,
          tasks: recentFailures.slice(0, 5).map((t) => ({ id: t.id, title: t.title })),
        });
      }
    }
  }

  // ── 每日摘要 ─────────────────────────────────────────────────

  private shouldRunDailySummary(config: HeartbeatConfig, now: number): boolean {
    if (!config.lastSummaryAt) return true;
    const oneDayMs = 24 * 60 * 60 * 1000;
    // 每天北京时间 9:00 左右发送
    return now - config.lastSummaryAt >= oneDayMs;
  }

  private async runDailySummary(userId: string): Promise<void> {
    const allTasks = this.orchestrator.getAllTasks().filter((t) => {
      const taskUserId = (t.metadata as { userId?: string } | undefined)?.userId;
      return taskUserId === userId;
    });

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const completedToday = allTasks.filter((t) => t.status === 'completed' && t.updatedAt > oneDayAgo);
    const failedToday = allTasks.filter((t) => t.status === 'failed' && t.updatedAt > oneDayAgo);
    const totalToday = completedToday.length + failedToday.length;

    // 如果今天没有任何任务，不需要摘要
    if (totalToday === 0) return;

    const completedCount = completedToday.length;
    const failedCount = failedToday.length;
    const successRate = totalToday > 0 ? Math.round((completedCount / totalToday) * 100) : 0;

    const parts: string[] = [];
    parts.push(`今日任务概览：共 ${totalToday} 个任务`);
    if (completedCount > 0) parts.push(`✅ 完成 ${completedCount} 个`);
    if (failedCount > 0) parts.push(`❌ 失败 ${failedCount} 个`);
    parts.push(`成功率 ${successRate}%`);

    const msg = parts.join('，') + '。';

    await this.notify(userId, 'daily_summary', msg, {
      completedCount,
      failedCount,
      totalCount: totalToday,
      successRate,
    });

    // 更新 lastSummaryAt
    await this.db.run(
      'UPDATE heartbeat_config SET last_summary_at = ? WHERE user_id = ?',
      [now, userId],
    );

    const config = this.userConfigs.get(userId);
    if (config) {
      config.lastSummaryAt = now;
    }
  }

  // ── 通知推送 ─────────────────────────────────────────────────

  private async notify(
    userId: string,
    checkType: CheckType,
    content: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const id = uuid();
    const now = Date.now();

    // 存储通知记录
    await this.db.run(
      `INSERT INTO heartbeat_notifications (id, user_id, check_type, content, payload, notified_at, dismissed)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [id, userId, checkType, content, payload ? JSON.stringify(payload) : null, now],
    );

    // 通过 WebSocket 推送给前端
    const notification: HeartbeatNotification = {
      id,
      userId,
      checkType,
      content,
      payload,
      notifiedAt: now,
      dismissed: false,
    };

    broadcastToUser(userId, { type: 'heartbeat_notification', data: notification });

    // 同时通过主动消息系统展示
    const { addMessage } = await import('../x/XProactiveMessages.js');
    addMessage(userId, content, 'info');

    serverLogger.info('heartbeat', `推送通知`, `userId=${userId} type=${checkType} content=${content.slice(0, 60)}`);
  }

  /** 检查最近是否已通知过（用于去重） */
  private async hasRecentNotification(userId: string, checkType: CheckType, withinMinutes: number): Promise<boolean> {
    const cutoff = Date.now() - withinMinutes * 60 * 1000;
    const row = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM heartbeat_notifications WHERE user_id = ? AND check_type = ? AND notified_at > ? AND dismissed = 0 LIMIT 1',
      [userId, checkType, cutoff],
    );
    return !!row;
  }

  private async updateLastCheck(userId: string, now: number, config: HeartbeatConfig): Promise<void> {
    await this.db.run(
      'UPDATE heartbeat_config SET last_check_at = ? WHERE user_id = ?',
      [now, userId],
    );
    config.lastCheckAt = now;
  }

  // ── 通知查询 ─────────────────────────────────────────────────

  /** 获取用户最近通知 */
  async getNotifications(userId: string, limit = 20): Promise<HeartbeatNotification[]> {
    const rows = await this.db.query<{
      id: string;
      user_id: string;
      check_type: string;
      content: string;
      payload: string | null;
      notified_at: number;
      dismissed: number;
    }>(
      'SELECT * FROM heartbeat_notifications WHERE user_id = ? ORDER BY notified_at DESC LIMIT ?',
      [userId, limit],
    );

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      checkType: r.check_type as CheckType,
      content: r.content,
      payload: r.payload ? JSON.parse(r.payload) : undefined,
      notifiedAt: r.notified_at,
      dismissed: r.dismissed === 1,
    }));
  }

  /** 忽略通知 */
  async dismissNotification(userId: string, notificationId: string): Promise<void> {
    await this.db.run(
      'UPDATE heartbeat_notifications SET dismissed = 1 WHERE id = ? AND user_id = ?',
      [notificationId, userId],
    );
  }
}
