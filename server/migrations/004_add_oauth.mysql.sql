-- ============================================================
-- OAuth 状态管理数据库迁移（MySQL 版本）
-- 版本：004
-- 创建日期：2026-04-26
-- 描述：添加 OAuth 状态管理表，支持 Google/GitHub OAuth 登录
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_states (
  state VARCHAR(64) PRIMARY KEY,
  provider VARCHAR(16) NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT,
  user_id VARCHAR(64),
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX idx_oauth_states_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  provider VARCHAR(16) NOT NULL,
  provider_user_id VARCHAR(128) NOT NULL,
  email VARCHAR(255),
  name VARCHAR(255),
  avatar_url TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uk_provider_user (provider, provider_user_id),
  INDEX idx_oauth_accounts_user (user_id),
  INDEX idx_oauth_accounts_provider (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
