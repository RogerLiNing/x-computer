-- ============================================================
--  Heartbeat HEARTBEAT.md 清单系统
-- 版本：020
-- ============================================================

-- 心跳检查发现结果
CREATE TABLE IF NOT EXISTS heartbeat_findings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  findings TEXT NOT NULL,           -- JSON 数组：[{item, output, status}]
  summary TEXT,                      -- AI 生成摘要
  notification_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hb_findings_user ON heartbeat_findings(user_id);
CREATE INDEX IF NOT EXISTS idx_hb_findings_run ON heartbeat_findings(user_id, run_at DESC);

-- 心跳检查清单内容（替代 HEARTBEAT.md 文件，存储在数据库便于管理）
CREATE TABLE IF NOT EXISTS heartbeat_checklist (
  user_id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 插入默认清单模板
INSERT OR IGNORE INTO heartbeat_checklist (user_id, content, updated_at)
VALUES ('default', '# Heartbeat Checklist

<!--
保持此文件为空将跳过心跳检查。
在下方添加周期性检查任务，心跳服务会按配置间隔自动执行。
-->

## 每日任务
- [ ] 检查是否有未处理的提醒或待办事项
- [ ] 查看今日会话摘要，整理重要信息

## 每周任务（周一）
- [ ] 生成上周工作周报摘要

## 始终
- [ ] 如有重要发现，写入 heartbeat/latest.md
- [ ] 仅在发现可操作事项时通知用户
', datetime('now'));
