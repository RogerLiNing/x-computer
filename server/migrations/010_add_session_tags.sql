-- Add tags column to chat_sessions for organizing conversations
ALTER TABLE chat_sessions ADD COLUMN tags TEXT;

-- Index for tag filtering
CREATE INDEX IF NOT EXISTS idx_chat_sessions_tags ON chat_sessions(user_id, tags);
