-- ============================================================
--  Weekly Planner / Weekly Review System
-- 版本：023
-- ============================================================

CREATE TABLE IF NOT EXISTS weekly_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  week_start TEXT NOT NULL,          -- 周起始日期 (YYYY-MM-DD)
  week_end TEXT NOT NULL,            -- 周结束日期 (YYYY-MM-DD)
  status TEXT NOT NULL DEFAULT 'active',  -- active / archived
  goals TEXT,                        -- JSON array of goal strings
  reflection TEXT,                    -- 周回顾/反思
  rating INTEGER,                    -- 1-5 评分
  tags TEXT,                         -- JSON array
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_plan_entries (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,                -- 日期 (YYYY-MM-DD)
  completed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES weekly_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_weekly_plans_user ON weekly_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_status ON weekly_plans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_week ON weekly_plans(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_entries_plan ON weekly_plan_entries(plan_id);
CREATE INDEX IF NOT EXISTS idx_weekly_entries_user ON weekly_plan_entries(user_id);
