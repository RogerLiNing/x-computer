-- Migration: Add parent_session_id column for conversation branching
ALTER TABLE chat_sessions ADD COLUMN summary TEXT;
ALTER TABLE chat_sessions ADD COLUMN parent_session_id VARCHAR(36);
