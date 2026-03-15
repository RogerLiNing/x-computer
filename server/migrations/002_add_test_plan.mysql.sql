-- ============================================================
-- 添加测试套餐（$0.10/月，用于支付流程测试）
-- 版本：002
-- ============================================================

INSERT INTO plans (id, name, display_name_en, display_name_zh, description_en, description_zh, price_monthly, price_yearly, ai_calls_limit, storage_limit, concurrent_tasks_limit, features, is_active, created_at, updated_at) VALUES
('test', 'test', 'Test (Free Trial)', '测试套餐', 'Pay $0.10 to test payment flow', '支付 0.1 美元测试支付流程', 10, 10, 100, 104857600, 1, '["basic_features"]', 1, UNIX_TIMESTAMP() * 1000, UNIX_TIMESTAMP() * 1000);
