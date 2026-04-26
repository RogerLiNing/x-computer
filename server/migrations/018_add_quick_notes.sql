-- ============================================================
-- 快速笔记表（SQLite 版本）
-- 版本：018
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  color TEXT DEFAULT '#fef3c7',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quick_notes_user ON quick_notes(user_id);
