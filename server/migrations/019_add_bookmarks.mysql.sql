-- Migration: Add bookmarks table
CREATE TABLE IF NOT EXISTS bookmarks (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  folder VARCHAR(255) NOT NULL DEFAULT '/',
  tags TEXT,
  favicon VARCHAR(512),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_folder ON bookmarks(user_id, folder);
