-- ============================================================
-- 订阅与付费系统数据库迁移 (MySQL)
-- 版本：001
-- ============================================================

-- 套餐定义表
CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  display_name_en VARCHAR(255) NOT NULL,
  display_name_zh VARCHAR(255) NOT NULL,
  description_en TEXT,
  description_zh TEXT,
  price_monthly INT,
  price_yearly INT,
  ai_calls_limit INT NOT NULL DEFAULT 100,
  storage_limit BIGINT NOT NULL DEFAULT 104857600,
  concurrent_tasks_limit INT NOT NULL DEFAULT 1,
  features TEXT,
  is_active INT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 插入默认套餐
INSERT INTO plans (id, name, display_name_en, display_name_zh, description_en, description_zh, price_monthly, price_yearly, ai_calls_limit, storage_limit, concurrent_tasks_limit, features, is_active, created_at, updated_at) VALUES
('trial', 'trial', 'Free Trial', '免费试用', 'Try X-Computer for free', '免费体验 X-Computer', 0, 0, 100, 104857600, 1, '["basic_features"]', 1, UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
('personal', 'personal', 'Personal', '个人版', 'Perfect for individual users', '适合个人用户', 999, 9990, 1000, 1073741824, 3, '["all_features","priority_support"]', 1, UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
('pro', 'pro', 'Professional', '专业版', 'For power users and small teams', '适合高级用户和小团队', 2999, 29990, 5000, 10737418240, 10, '["all_features","priority_support","advanced_tools"]', 1, UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000),
('enterprise', 'enterprise', 'Enterprise', '企业版', 'Custom solutions for organizations', '为企业提供定制方案', NULL, NULL, -1, -1, -1, '["all_features","priority_support","advanced_tools","custom_deployment","sla"]', 1, UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000);

-- 用户订阅表
CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  billing_cycle VARCHAR(32) NOT NULL DEFAULT 'monthly',
  current_period_start BIGINT NOT NULL,
  current_period_end BIGINT NOT NULL,
  trial_end BIGINT,
  cancel_at_period_end INT NOT NULL DEFAULT 0,
  stripe_subscription_id VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  stripe_price_id VARCHAR(255),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);

-- 配额使用记录表
CREATE TABLE IF NOT EXISTS usage_records (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  amount INT NOT NULL,
  period_start BIGINT NOT NULL,
  period_end BIGINT NOT NULL,
  metadata TEXT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_records_user_period ON usage_records(user_id, period_start, period_end);
CREATE INDEX idx_usage_records_resource_type ON usage_records(resource_type);
CREATE INDEX idx_usage_records_created_at ON usage_records(created_at);

-- 支付历史表
CREATE TABLE IF NOT EXISTS payment_history (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  subscription_id VARCHAR(64),
  amount INT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'usd',
  status VARCHAR(32) NOT NULL,
  stripe_payment_intent_id VARCHAR(255),
  stripe_invoice_id VARCHAR(255),
  description TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX idx_payment_history_user_id ON payment_history(user_id);
CREATE INDEX idx_payment_history_status ON payment_history(status);
CREATE INDEX idx_payment_history_stripe_payment_intent ON payment_history(stripe_payment_intent_id);

-- 为所有用户创建默认试用订阅
INSERT INTO subscriptions (id, user_id, plan_id, status, billing_cycle, current_period_start, current_period_end, trial_end, created_at, updated_at)
SELECT 
  CONCAT('sub-trial-', u.id, '-', UNIX_TIMESTAMP()),
  u.id,
  'trial',
  'trialing',
  'monthly',
  UNIX_TIMESTAMP() * 1000,
  UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 7 DAY)) * 1000,
  UNIX_TIMESTAMP(DATE_ADD(NOW(), INTERVAL 7 DAY)) * 1000,
  UNIX_TIMESTAMP() * 1000,
  UNIX_TIMESTAMP() * 1000
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
);
