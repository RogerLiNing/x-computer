-- ============================================================
-- Webhook 系统数据库迁移
-- 版本：006
-- 创建日期：2026-04-26
-- 描述：添加 Webhook 表，支持外部服务通过 Webhook 触发 X 主脑任务
-- ============================================================

-- Webhook 表：存储用户创建的 Webhook 配置
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,                        -- Webhook 名称
  description TEXT,                          -- 描述
  url_path TEXT NOT NULL,                    -- Webhook URL 路径（如 /webhook/abc123）
  secret TEXT NOT NULL,                      -- 签名密钥（用于 HMAC-SHA256 验签）
  events TEXT NOT NULL,                      -- JSON 数组：触发事件类型 ["task.trigger", "github.push"]
  enabled INTEGER NOT NULL DEFAULT 1,         -- 是否启用（0=禁用，1=启用）
  headers TEXT,                              -- JSON：自定义响应头
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_url_path ON webhooks(url_path);
CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);

-- Webhook 调用记录：存储每次 Webhook 触发历史
CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event TEXT NOT NULL,                        -- 触发事件类型
  payload TEXT,                               -- 请求体（JSON）
  headers TEXT,                               -- 请求头（JSON）
  ip_address TEXT,                            -- 请求来源 IP
  signature_valid INTEGER NOT NULL DEFAULT 0, -- 签名是否有效
  response_status INTEGER,                   -- 响应状态码
  response_body TEXT,                         -- 响应体（前 2KB）
  triggered_task_id TEXT,                    -- 触发的任务 ID（如果有）
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_user ON webhook_logs(user_id, created_at DESC);
