-- ============================================================
--  Reading List System
-- 版本：024 (MySQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS reading_list (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  url TEXT,
  notes TEXT,
  priority VARCHAR(16) NOT NULL DEFAULT 'medium',
  status VARCHAR(16) NOT NULL DEFAULT 'unread',
  rating INT,
  tags TEXT,
  source TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_reading_list_user ON reading_list(user_id);
CREATE INDEX idx_reading_list_status ON reading_list(user_id, status);
CREATE INDEX idx_reading_list_priority ON reading_list(user_id, priority);
