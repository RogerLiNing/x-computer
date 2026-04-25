-- ============================================================
-- 提示词模板管理迁移 (MySQL)
-- 版本：008
-- 创建日期：2026-04-26
-- 描述：创建 prompt_templates 表，支持用户保存和管理提示词模板
-- ============================================================

CREATE TABLE IF NOT EXISTS prompt_templates (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(100),
  description TEXT,
  variables TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX idx_prompt_templates_user ON prompt_templates(user_id);
CREATE INDEX idx_prompt_templates_category ON prompt_templates(user_id, category);
