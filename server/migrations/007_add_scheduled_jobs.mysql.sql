-- ============================================================
-- 定时任务管理增强迁移 (MySQL)
-- 版本：007
-- 创建日期：2026-04-26
-- 描述：为 scheduled_jobs 表添加 name 和 enabled 字段，支持前端管理
-- ============================================================

-- 添加任务名称（支持用户自定义显示名称）
ALTER TABLE scheduled_jobs ADD COLUMN name TEXT;

-- 添加启用/禁用状态
ALTER TABLE scheduled_jobs ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1;

-- 添加下次执行时间（冗余字段，加速查询）
ALTER TABLE scheduled_jobs ADD COLUMN next_run BIGINT;

-- 给现有记录设置 next_run = run_at
UPDATE scheduled_jobs SET next_run = run_at WHERE next_run IS NULL;
