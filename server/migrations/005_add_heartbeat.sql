-- ============================================================
-- Heartbeat 心跳服务数据库迁移
-- 版本：005
-- 创建日期：2026-04-26
-- 描述：添加心跳状态配置表，支持 X 主脑定期主动检查并通知用户
-- ============================================================

-- 心跳配置表：每个用户的心跳偏好和状态
CREATE TABLE IF NOT EXISTS heartbeat_config (
  user_id TEXT PRIMARY KEY,                    -- 用户 ID
  enabled INTEGER NOT NULL DEFAULT 1,          -- 是否启用心跳（0=关闭，1=开启）
  interval_minutes INTEGER NOT NULL DEFAULT 60, -- 检查间隔（分钟），默认 60 分钟
  last_check_at INTEGER,                       -- 上次检查时间（毫秒时间戳）
  last_summary_at INTEGER,                     -- 上次摘要时间（毫秒时间戳）
  quota_alert_threshold REAL NOT NULL DEFAULT 0.8, -- 配额告警阈值（默认 80%）
  task_alert_enabled INTEGER NOT NULL DEFAULT 1,  -- 任务状态告警（0=关闭，1=开启）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_enabled ON heartbeat_config(enabled);

-- 心跳通知记录：存储最近的通知（可查重、避免重复推送）
CREATE TABLE IF NOT EXISTS heartbeat_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  check_type TEXT NOT NULL,                   -- quota_usage | task_status | system_announcement | daily_summary
  content TEXT NOT NULL,
  payload TEXT,                               -- JSON 附加数据
  notified_at INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_notif_user ON heartbeat_notifications(user_id, notified_at DESC);
