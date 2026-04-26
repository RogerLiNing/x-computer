-- ============================================================
--  Weekly Planner / Weekly Review System
-- 版本：023 (MySQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS weekly_plans (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  goals TEXT,
  reflection TEXT,
  rating INT,
  tags TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS weekly_plan_entries (
  id VARCHAR(64) PRIMARY KEY,
  plan_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  date DATE NOT NULL,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES weekly_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_weekly_plans_user ON weekly_plans(user_id);
CREATE INDEX idx_weekly_plans_status ON weekly_plans(user_id, status);
CREATE INDEX idx_weekly_plans_week ON weekly_plans(user_id, week_start);
CREATE INDEX idx_weekly_entries_plan ON weekly_plan_entries(plan_id);
CREATE INDEX idx_weekly_entries_user ON weekly_plan_entries(user_id);
