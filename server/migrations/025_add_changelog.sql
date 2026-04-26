-- ============================================================
--  Changelog / Version History 更新日志
-- 版本：025
-- ============================================================

CREATE TABLE IF NOT EXISTS changelog (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  version TEXT NOT NULL,                  -- e.g. "1.2.0"
  title TEXT NOT NULL,                   -- 版本标题
  title_en TEXT,                         -- 英文标题
  content TEXT NOT NULL,                 -- 更新内容（中文）
  content_en TEXT,                       -- 更新内容（英文）
  tags TEXT,                              -- JSON array: ["feat", "fix", "refactor"]
  released_at TEXT,                       -- 发布日期
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_changelog_user ON changelog(user_id);
CREATE INDEX IF NOT EXISTS idx_changelog_version ON changelog(version DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_released ON changelog(released_at DESC);
