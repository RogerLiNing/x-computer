-- Migration 011: Add is_archived field to chat_sessions
-- Allows users to archive old sessions and filter them out of the main list

-- SQLite
ALTER TABLE chat_sessions ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

-- MySQL will use ensureColumn pattern (see 011_add_session_archived.mysql.sql)
