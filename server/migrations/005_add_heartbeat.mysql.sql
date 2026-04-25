-- ============================================================
-- Heartbeat 心跳服务数据库迁移（MySQL 版本）
-- 版本：005
-- 创建日期：2026-04-26
-- 描述：添加心跳状态配置表，支持 X 主脑定期主动检查并通知用户
-- ============================================================

CREATE TABLE IF NOT EXISTS heartbeat_config (
  user_id VARCHAR(64) PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  interval_minutes INT NOT NULL DEFAULT 60,
  last_check_at BIGINT,
  last_summary_at BIGINT,
  quota_alert_threshold DOUBLE NOT NULL DEFAULT 0.8,
  task_alert_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_heartbeat_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS heartbeat_notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  check_type VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  payload TEXT,
  notified_at BIGINT NOT NULL,
  dismissed TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_heartbeat_notif_user (user_id, notified_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
