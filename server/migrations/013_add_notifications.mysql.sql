-- Migration 013: Add notifications table (MySQL)
-- Stores in-app notifications for users (task events, webhook deliveries, etc.)

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'info',
  title VARCHAR(512) NOT NULL,
  body TEXT,
  link VARCHAR(1024),
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  INDEX idx_notifications_user (user_id),
  INDEX idx_notifications_user_unread (user_id, `read`),
  INDEX idx_notifications_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
