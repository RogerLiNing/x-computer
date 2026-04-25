-- ============================================================
-- OAuth 状态管理数据库迁移
-- 版本：004
-- 创建日期：2026-04-26
-- 描述：添加 OAuth 状态管理表，支持 Google/GitHub OAuth 登录
-- ============================================================

-- OAuth 状态表（用于 PKCE 流程，防止 CSRF）
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,            -- 随机 state 参数
  provider TEXT NOT NULL,            -- google | github
  code_verifier TEXT NOT NULL,       -- PKCE code_verifier（用于后续 token 交换）
  redirect_uri TEXT,                  -- 授权后重定向的 frontend URI
  user_id TEXT,                      -- 关联的 user_id（可选，用于账号绑定）
  created_at INTEGER NOT NULL,        -- 毫秒时间戳
  expires_at INTEGER NOT NULL         -- 过期时间（毫秒时间戳）
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- OAuth 账号关联表（第三方账号与本地用户关联）
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,            -- google | github
  provider_user_id TEXT NOT NULL,    -- 第三方平台的用户 ID
  email TEXT,                        -- 第三方返回的邮箱（可能为空）
  name TEXT,                         -- 第三方返回的显示名称
  avatar_url TEXT,                   -- 第三方返回的头像 URL
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider ON oauth_accounts(provider, provider_user_id);
