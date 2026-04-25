-- ============================================================
-- 系统提示词管理迁移 (MySQL)
-- 版本：009
-- 创建日期：2026-04-26
-- 描述：创建 system_prompts 表，支持管理员自定义 AI 系统提示词
-- ============================================================

CREATE TABLE IF NOT EXISTS system_prompts (
  id VARCHAR(255) PRIMARY KEY,
  mode VARCHAR(64) NOT NULL,
  content TEXT NOT NULL,
  enabled INT NOT NULL DEFAULT 0,
  created_by VARCHAR(255),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX idx_system_prompts_mode ON system_prompts(mode);
