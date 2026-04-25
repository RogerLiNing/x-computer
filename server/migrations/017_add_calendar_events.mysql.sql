-- Migration: Add calendar_events table
CREATE TABLE IF NOT EXISTS calendar_events (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_time BIGINT NOT NULL,
  end_time BIGINT,
  all_day TINYINT(1) NOT NULL DEFAULT 0,
  color VARCHAR(20) DEFAULT '#6366f1',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_calendar_events_user ON calendar_events(user_id);
CREATE INDEX idx_calendar_events_start ON calendar_events(user_id, start_time);
