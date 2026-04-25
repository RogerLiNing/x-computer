-- Migration: Add task execution tracking fields
-- SQLite version

BEGIN;

ALTER TABLE tasks ADD COLUMN started_at INTEGER;
ALTER TABLE tasks ADD COLUMN completed_at INTEGER;
ALTER TABLE tasks ADD COLUMN duration_ms INTEGER;
ALTER TABLE tasks ADD COLUMN actual_cost REAL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN tool_executions TEXT;

-- Backfill existing tasks with created_at as started_at
UPDATE tasks SET started_at = created_at WHERE started_at IS NULL;

COMMIT;
