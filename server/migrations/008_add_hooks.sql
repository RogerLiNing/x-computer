-- Hooks for lifecycle event interception
CREATE TABLE IF NOT EXISTS hooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hook_point TEXT NOT NULL CHECK (hook_point IN (
    'beforeInbound', 'beforeToolCall', 'beforeOutbound',
    'onSessionStart', 'onSessionEnd', 'transformResponse'
  )),
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  failure_mode TEXT NOT NULL DEFAULT 'failOpen' CHECK (failure_mode IN ('failOpen', 'failClosed')),
  timeout_ms INTEGER NOT NULL DEFAULT 5000,
  headers TEXT DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hooks_user ON hooks(user_id);
CREATE INDEX IF NOT EXISTS idx_hooks_point ON hooks(hook_point);
