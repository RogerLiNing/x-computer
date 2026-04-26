-- ============================================================
--  Changelog / Version History 更新日志
-- 版本：025 (MySQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS changelog (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  version VARCHAR(32) NOT NULL,
  title TEXT NOT NULL,
  title_en TEXT,
  content TEXT NOT NULL,
  content_en TEXT,
  tags TEXT,
  released_at DATE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_changelog_user ON changelog(user_id);
CREATE INDEX idx_changelog_version ON changelog(version DESC);
CREATE INDEX idx_changelog_released ON changelog(released_at DESC);
