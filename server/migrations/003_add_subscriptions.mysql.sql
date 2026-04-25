-- ============================================================
-- 添加订阅表（MySQL 版本）
-- 版本：003
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  billing_cycle VARCHAR(16) NOT NULL DEFAULT 'monthly',
  current_period_start BIGINT NOT NULL,
  current_period_end BIGINT NOT NULL,
  trial_end BIGINT,
  cancel_at_period_end INT NOT NULL DEFAULT 0,
  stripe_subscription_id VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  stripe_price_id VARCHAR(255),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_subscriptions_user (user_id),
  INDEX idx_subscriptions_stripe (stripe_subscription_id)
);
