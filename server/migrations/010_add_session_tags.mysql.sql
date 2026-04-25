-- Add tags column to chat_sessions for organizing conversations
ALTER TABLE chat_sessions ADD COLUMN tags TEXT;

-- Index for tag filtering (MySQL syntax)
ALTER TABLE chat_sessions ADD INDEX idx_chat_sessions_tags (user_id, tags(255));
