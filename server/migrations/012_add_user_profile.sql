-- Migration 012: Add bio and timezone to user profile
-- User profile fields for personalization

-- SQLite: bio and timezone stored in user_config (key-value)
-- MySQL: same pattern via user_config table
-- No schema change needed for users table (display_name already exists)
