-- Migration: Add parent_session_id column for conversation branching
BEGIN;
ALTER TABLE chat_sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE chat_sessions ADD COLUMN summary TEXT;
COMMIT;
