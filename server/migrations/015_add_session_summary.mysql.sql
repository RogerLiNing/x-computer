-- Migration: Add session summary field
-- MySQL version

ALTER TABLE chat_sessions ADD COLUMN summary TEXT;
