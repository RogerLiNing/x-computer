-- ============================================================
-- Webhook 系统数据库迁移 (MySQL)
-- 版本：006
-- 创建日期：2026-04-26
-- 描述：添加 Webhook 表，支持外部服务通过 Webhook 触发 X 主脑任务
-- ============================================================

-- Webhook 表：存储用户创建的 Webhook 配置
CREATE TABLE IF NOT EXISTS webhooks (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  url_path VARCHAR(255) NOT NULL,
  secret VARCHAR(255) NOT NULL,
  events TEXT NOT NULL COMMENT 'JSON array of event types',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  headers TEXT COMMENT 'JSON custom response headers',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_webhooks_user ON webhooks(user_id);
CREATE INDEX idx_webhooks_url_path ON webhooks(url_path);
CREATE INDEX idx_webhooks_enabled ON webhooks(enabled);

-- Webhook 调用记录
CREATE TABLE IF NOT EXISTS webhook_logs (
  id VARCHAR(64) PRIMARY KEY,
  webhook_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  event VARCHAR(64) NOT NULL,
  payload TEXT,
  headers TEXT,
  ip_address VARCHAR(64),
  signature_valid TINYINT(1) NOT NULL DEFAULT 0,
  response_status INT,
  response_body TEXT,
  triggered_task_id VARCHAR(64),
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_webhook_logs_webhook ON webhook_logs(webhook_id, created_at DESC);
CREATE INDEX idx_webhook_logs_user ON webhook_logs(user_id, created_at DESC);
