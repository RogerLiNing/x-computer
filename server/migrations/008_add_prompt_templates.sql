-- ============================================================
-- 提示词模板管理迁移
-- 版本：008
-- 创建日期：2026-04-26
-- 描述：创建 prompt_templates 表，支持用户保存和管理提示词模板
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  description TEXT,
  variables TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_user ON prompt_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(user_id, category);
