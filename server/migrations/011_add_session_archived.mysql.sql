-- Migration 011: Add is_archived field to chat_sessions (MySQL)
ALTER TABLE chat_sessions ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD INDEX idx_chat_sessions_archived (user_id, is_archived);
