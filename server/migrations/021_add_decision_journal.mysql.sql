-- ============================================================
--  Decision Journal 决策日志系统
-- 版本：021 (MySQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS decision_journals (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  context TEXT,
  decision_text TEXT NOT NULL,
  rationale TEXT,
  alternatives TEXT,
  outcome TEXT,
  outcome_positive TINYINT(1),
  tags TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  follow_up_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_decision_journal_user ON decision_journals(user_id);
CREATE INDEX idx_decision_journal_status ON decision_journals(user_id, status);
CREATE INDEX idx_decision_journal_followup ON decision_journals(user_id, follow_up_at);
