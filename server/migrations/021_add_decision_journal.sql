-- ============================================================
--  Decision Journal 决策日志系统
-- 版本：021
-- ============================================================

-- 决策日志表
CREATE TABLE IF NOT EXISTS decision_journals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  context TEXT,                      -- 决策背景
  decision_text TEXT NOT NULL,       -- 决定内容
  rationale TEXT,                    -- 决策理由
  alternatives TEXT,                 -- 备选方案（JSON 数组）
  outcome TEXT,                     -- 结果
  outcome_positive INTEGER,          -- 1=positive, 0=negative, null=unknown
  tags TEXT,                        -- JSON 数组
  status TEXT NOT NULL DEFAULT 'open', -- open/resolved/reversed
  follow_up_at TEXT,                -- 回顾日期
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_decision_journal_user ON decision_journals(user_id);
CREATE INDEX IF NOT EXISTS idx_decision_journal_status ON decision_journals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_decision_journal_followup ON decision_journals(user_id, follow_up_at);
