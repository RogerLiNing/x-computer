-- Hooks for lifecycle event interception
CREATE TABLE IF NOT EXISTS hooks (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  hook_point VARCHAR(50) NOT NULL,
  url TEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  failure_mode VARCHAR(20) NOT NULL DEFAULT 'failOpen',
  timeout_ms INT NOT NULL DEFAULT 5000,
  headers JSON DEFAULT ('{}'),
  priority INT NOT NULL DEFAULT 100,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT chk_hook_point CHECK (hook_point IN (
    'beforeInbound', 'beforeToolCall', 'beforeOutbound',
    'onSessionStart', 'onSessionEnd', 'transformResponse'
  )),
  CONSTRAINT chk_failure_mode CHECK (failure_mode IN ('failOpen', 'failClosed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_hooks_user ON hooks(user_id);
CREATE INDEX idx_hooks_point ON hooks(hook_point);
