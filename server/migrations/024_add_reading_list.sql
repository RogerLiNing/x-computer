-- ============================================================
--  Reading List System
-- 版本：024
-- ============================================================

CREATE TABLE IF NOT EXISTS reading_list (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  url TEXT,
  notes TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',  -- low / medium / high
  status TEXT NOT NULL DEFAULT 'unread',    -- unread / reading / completed
  rating INTEGER,                          -- 1-5 stars
  tags TEXT,                              -- JSON array
  source TEXT,                             -- where found (article, friend, etc.)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reading_list_user ON reading_list(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_list_status ON reading_list(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reading_list_priority ON reading_list(user_id, priority);
