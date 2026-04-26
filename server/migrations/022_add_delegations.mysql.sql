-- ============================================================
--  Delegation Tracker 委托追踪系统
-- 版本：022 (MySQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS delegations (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  delegated_to VARCHAR(255) NOT NULL,
  due_at DATETIME,
  last_checked_at DATETIME,
  status VARCHAR(32) NOT NULL DEFAULT 'waiting',
  follow_up_count INT NOT NULL DEFAULT 0,
  notes TEXT,
  source TEXT,
  tags TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_delegations_user ON delegations(user_id);
CREATE INDEX idx_delegations_status ON delegations(user_id, status);
CREATE INDEX idx_delegations_due ON delegations(user_id, due_at);
