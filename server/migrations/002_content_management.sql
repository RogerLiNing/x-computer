-- ============================================================
-- 内容管理数据库迁移
-- 版本：002
-- 创建日期：2026-04-08
-- 描述：添加公告和邮件模板管理
-- ============================================================

-- 公告表
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_en TEXT,
  content TEXT NOT NULL,
  content_en TEXT,
  type TEXT NOT NULL DEFAULT 'info', -- info, warning, success, error
  target TEXT NOT NULL DEFAULT 'all', -- all, free, paid, pro, enterprise
  priority INTEGER NOT NULL DEFAULT 0, -- 越高越靠前
  is_active INTEGER NOT NULL DEFAULT 1,
  start_at INTEGER, -- 开始显示时间（null 表示立即）
  end_at INTEGER, -- 结束显示时间（null 表示永久）
  created_by TEXT, -- 创建者用户 ID
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_announcements_start_end ON announcements(start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_announcements_priority ON announcements(priority DESC);

-- 邮件模板表
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, -- 模板名称（如 welcome, password_reset）
  name_en TEXT,
  subject TEXT NOT NULL, -- 邮件主题
  subject_en TEXT,
  body TEXT NOT NULL, -- 邮件正文（Markdown 格式）
  body_en TEXT,
  variables TEXT, -- 可用变量（JSON 数组）
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_templates_name ON email_templates(name);
CREATE INDEX IF NOT EXISTS idx_email_templates_is_active ON email_templates(is_active);

-- 插入默认邮件模板
INSERT INTO email_templates (id, name, name_en, subject, subject_en, body, body_en, variables, is_active, created_at, updated_at) VALUES
('welcome', 'welcome', '欢迎', '欢迎加入 X-Computer', 'Welcome to X-Computer', 
'感谢您注册 X-Computer！\n\n您的账号已创建成功，现在可以开始使用 X-Computer 的各项功能。\n\n## 快速开始\n\n1. 创建您的第一个任务\n2. 探索内置应用\n3. 配置您的偏好设置\n\n如有任何问题，请随时联系我们。\n\n祝您使用愉快！\n\nX-Computer 团队',
'Thank you for registering with X-Computer!\n\nYour account has been successfully created. You can now start using all features of X-Computer.\n\n## Quick Start\n\n1. Create your first task\n2. Explore built-in apps\n3. Configure your preferences\n\nIf you have any questions, feel free to contact us.\n\nBest regards,\n\nX-Computer Team',
'["displayName", "email"]',
1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('password_reset', 'password_reset', '密码重置', '重置您的密码', 'Reset Your Password',
'您好！\n\n您收到此邮件是因为您（或其他人）请求重置您的 X-Computer 账号密码。\n\n**验证码：{code}**\n\n此验证码将在 15 分钟后失效。\n\n如果您没有请求重置密码，请忽略此邮件。\n\nX-Computer 团队',
'Hello!\n\nYou are receiving this email because you (or someone else) requested to reset your password for your X-Computer account.\n\n**Verification Code: {code}**\n\nThis code will expire in 15 minutes.\n\nIf you did not request a password reset, please ignore this email.\n\nX-Computer Team',
'["email", "code"]',
1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('email_verification', 'email_verification', '邮箱验证', '验证您的邮箱', 'Verify Your Email',
'您好！\n\n感谢您注册 X-Computer！请使用以下验证码验证您的邮箱：\n\n**验证码：{code}**\n\n此验证码将在 15 分钟后失效。\n\nX-Computer 团队',
'Hello!\n\nThank you for registering with X-Computer! Please use the following verification code to verify your email:\n\n**Verification Code: {code}**\n\nThis code will expire in 15 minutes.\n\nX-Computer Team',
'["email", "code"]',
1, strftime('%s', 'now') * 1000, strftime('%s', 'now')),

('subscription_created', 'subscription_created', '订阅成功', '订阅创建成功通知', 'Subscription Created',
'您好！\n\n恭喜您成功订阅 **{planName}** 套餐！\n\n## 订阅详情\n\n- 套餐：{planName}\n- 计费周期：{billingCycle}\n- 开始时间：{startDate}\n- 结束时间：{endDate}\n\n感谢您选择 X-Computer！\n\nX-Computer 团队',
'Hello!\n\nCongratulations on successfully subscribing to the **{planName}** plan!\n\n## Subscription Details\n\n- Plan: {planName}\n- Billing Cycle: {billingCycle}\n- Start Date: {startDate}\n- End Date: {endDate}\n\nThank you for choosing X-Computer!\n\nX-Computer Team',
'["email", "planName", "billingCycle", "startDate", "endDate"]',
1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

('subscription_canceled', 'subscription_canceled', '订阅取消', '订阅取消通知', 'Subscription Canceled',
'您好！\n\n您的 **{planName}** 订阅已取消。\n\n## 订阅详情\n\n- 套餐：{planName}\n- 取消时间：{cancelDate}\n- 到期时间：{endDate}\n\n您可以在到期前继续使用服务。如有任何问题，请联系我们。\n\nX-Computer 团队',
'Hello!\n\nYour **{planName}** subscription has been canceled.\n\n## Subscription Details\n\n- Plan: {planName}\n- Cancel Date: {cancelDate}\n- End Date: {endDate}\n\nYou can continue to use the service until the end date. If you have any questions, please contact us.\n\nX-Computer Team',
'["email", "planName", "cancelDate", "endDate"]',
1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);