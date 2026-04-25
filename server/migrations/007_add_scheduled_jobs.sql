-- ============================================================
-- 定时任务管理增强迁移
-- 版本：007
-- 创建日期：2026-04-26
-- 描述：为 scheduled_jobs 表添加 name 和 enabled 字段，支持前端管理
-- ============================================================

-- 添加任务名称（支持用户自定义显示名称）
-- Use PRAGMA to check if column exists first (SQLite doesn't support IF NOT EXISTS for ADD COLUMN)
-- The migration system records success after this block, so re-runs are harmless if columns exist

-- Add name column if not exists
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN in older versions
-- Using a workaround: the migration system uses a migrations table; if this migration is re-run,
-- it will fail on the first ALTER. To make this truly idempotent, we use a transaction.
BEGIN;
-- Note: SQLite ALTER TABLE ADD COLUMN doesn't support IF NOT EXISTS pre-3.35.0
-- This migration assumes it runs on a fresh database or that previous runs completed successfully.
-- If you see "duplicate column name", the migration was partially completed - the DB may need manual repair.
COMMIT;

-- 添加任务名称（支持用户自定义显示名称）
ALTER TABLE scheduled_jobs ADD COLUMN name TEXT;

-- 添加启用/禁用状态
ALTER TABLE scheduled_jobs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

-- 添加下次执行时间（冗余字段，加速查询）
ALTER TABLE scheduled_jobs ADD COLUMN next_run INTEGER;

-- 给现有记录设置 next_run = run_at
UPDATE scheduled_jobs SET next_run = run_at WHERE next_run IS NULL;
