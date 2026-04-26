-- ============================================================
--  Delegation Tracker 委托追踪系统
-- 版本：022
-- ============================================================

CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  delegated_to TEXT NOT NULL,         -- 委托对象（人名/团队）
  due_at TEXT,                        -- 预期回复日期
  last_checked_at TEXT,               -- 最后检查日期
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting/completed/cancelled
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,                         -- 备注/更新
  source TEXT,                        -- 来源（如对话中的描述）
  tags TEXT,                          -- JSON 数组
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delegations_user ON delegations(user_id);
CREATE INDEX IF NOT EXISTS idx_delegations_status ON delegations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_delegations_due ON delegations(user_id, due_at);
