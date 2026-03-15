-- ============================================================
-- 订阅与付费系统数据库迁移
-- 版本：001
-- 创建日期：2026-02-28
-- 描述：添加订阅、配额、套餐相关表
-- ============================================================

-- 套餐定义表
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name_en TEXT NOT NULL,
  display_name_zh TEXT NOT NULL,
  description_en TEXT,
  description_zh TEXT,
  price_monthly INTEGER,          -- 月付价格（美分）
  price_yearly INTEGER,            -- 年付价格（美分）
  ai_calls_limit INTEGER NOT NULL DEFAULT 100,
  storage_limit INTEGER NOT NULL DEFAULT 104857600,  -- 100MB in bytes
  concurrent_tasks_limit INTEGER NOT NULL DEFAULT 1,
  features TEXT,                   -- JSON array of feature flags
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 插入默认套餐
INSERT INTO plans (id, name, display_name_en, display_name_zh, description_en, description_zh, price_monthly, price_yearly, ai_calls_limit, storage_limit, concurrent_tasks_limit, features, is_active, created_at, updated_at) VALUES
('trial', 'trial', 'Free Trial', '免费试用', 'Try X-Computer for free', '免费体验 X-Computer', 0, 0, 100, 104857600, 1, '["basic_features"]', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('personal', 'personal', 'Personal', '个人版', 'Perfect for individual users', '适合个人用户', 999, 9990, 1000, 1073741824, 3, '["all_features","priority_support"]', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('pro', 'pro', 'Professional', '专业版', 'For power users and small teams', '适合高级用户和小团队', 2999, 29990, 5000, 10737418240, 10, '["all_features","priority_support","advanced_tools"]', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('enterprise', 'enterprise', 'Enterprise', '企业版', 'Custom solutions for organizations', '为企业提供定制方案', NULL, NULL, -1, -1, -1, '["all_features","priority_support","advanced_tools","custom_deployment","sla"]', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- 用户订阅表
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active, canceled, expired, past_due, trialing
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',  -- monthly, yearly
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  trial_end INTEGER,               -- 试用结束时间
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  stripe_price_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);

-- 配额使用记录表
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,     -- ai_calls, storage, tasks, api_requests
  amount INTEGER NOT NULL,
  period_start INTEGER NOT NULL,   -- 计费周期开始时间
  period_end INTEGER NOT NULL,     -- 计费周期结束时间
  metadata TEXT,                   -- JSON: {taskId, endpoint, model, etc.}
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_period ON usage_records(user_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_usage_records_resource_type ON usage_records(resource_type);
CREATE INDEX IF NOT EXISTS idx_usage_records_created_at ON usage_records(created_at);

-- 支付历史表
CREATE TABLE IF NOT EXISTS payment_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subscription_id TEXT,
  amount INTEGER NOT NULL,         -- 金额（美分）
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL,            -- succeeded, pending, failed, refunded
  stripe_payment_intent_id TEXT,
  stripe_invoice_id TEXT,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_history_user_id ON payment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_status ON payment_history(status);
CREATE INDEX IF NOT EXISTS idx_payment_history_stripe_payment_intent ON payment_history(stripe_payment_intent_id);

-- 为所有用户创建默认试用订阅（如果还没有订阅）
-- 注意：这个会在迁移时为现有用户创建试用订阅
INSERT INTO subscriptions (id, user_id, plan_id, status, billing_cycle, current_period_start, current_period_end, trial_end, created_at, updated_at)
SELECT 
  'sub-trial-' || u.id || '-' || strftime('%s', 'now'),
  u.id,
  'trial',
  'trialing',
  'monthly',
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now', '+7 days') * 1000,
  strftime('%s', 'now', '+7 days') * 1000,
  strftime('%s', 'now') * 1000,
  strftime('%s', 'now') * 1000
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions WHERE user_id = u.id
);
