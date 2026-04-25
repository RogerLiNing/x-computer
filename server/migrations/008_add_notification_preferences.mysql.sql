-- ============================================================
-- 通知偏好设置数据库迁移 (MySQL)
-- 版本：008
-- 创建日期：2026-04-26
-- 描述：添加通知偏好表，支持用户精细控制各类型通知
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id VARCHAR(64) PRIMARY KEY,
  in_app TINYINT(1) NOT NULL DEFAULT 1,
  email TINYINT(1) NOT NULL DEFAULT 0,
  task_events TINYINT(1) NOT NULL DEFAULT 1,
  approval TINYINT(1) NOT NULL DEFAULT 1,
  heartbeat TINYINT(1) NOT NULL DEFAULT 1,
  heartbeat_daily TINYINT(1) NOT NULL DEFAULT 1,
  webhook TINYINT(1) NOT NULL DEFAULT 1,
  system TINYINT(1) NOT NULL DEFAULT 1,
  skill TINYINT(1) NOT NULL DEFAULT 1,
  quiet_hours_enabled TINYINT(1) NOT NULL DEFAULT 0,
  quiet_hours_start VARCHAR(5),
  quiet_hours_end VARCHAR(5),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
