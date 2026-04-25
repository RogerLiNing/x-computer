-- ============================================================
-- 系统提示词管理迁移
-- 版本：009
-- 创建日期：2026-04-26
-- 描述：创建 system_prompts 表，支持管理员自定义 AI 系统提示词
-- ============================================================

CREATE TABLE IF NOT EXISTS system_prompts (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_prompts_mode ON system_prompts(mode);
