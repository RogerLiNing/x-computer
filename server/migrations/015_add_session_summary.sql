-- Migration: Add session summary field
-- SQLite version

BEGIN;

ALTER TABLE chat_sessions ADD COLUMN summary TEXT;

COMMIT;
