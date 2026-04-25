-- ============================================================
-- 通知偏好设置数据库迁移
-- 版本：008
-- 创建日期：2026-04-26
-- 描述：添加通知偏好表，支持用户精细控制各类型通知
-- ============================================================

-- 通知偏好表：用户对各类型通知的接收偏好
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,               -- 用户 ID
  -- 通知渠道开关
  in_app INTEGER NOT NULL DEFAULT 1,       -- 应用内通知
  email INTEGER NOT NULL DEFAULT 0,        -- 邮件通知
  -- 通知类型开关
  task_events INTEGER NOT NULL DEFAULT 1,  -- 任务状态变化（完成/失败）
  approval INTEGER NOT NULL DEFAULT 1,      -- 审批请求
  heartbeat INTEGER NOT NULL DEFAULT 1,     -- 心跳通知（配额告警等）
  heartbeat_daily INTEGER NOT NULL DEFAULT 1, -- 每日摘要
  webhook INTEGER NOT NULL DEFAULT 1,       -- Webhook 触发通知
  system INTEGER NOT NULL DEFAULT 1,        -- 系统公告
  skill INTEGER NOT NULL DEFAULT 1,         -- Skills 更新通知
  -- 免打扰设置
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,  -- 免打扰模式
  quiet_hours_start TEXT,                  -- 开始时间 HH:MM
  quiet_hours_end TEXT,                    -- 结束时间 HH:MM
  -- 元数据
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
