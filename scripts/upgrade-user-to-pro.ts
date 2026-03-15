#!/usr/bin/env tsx
/**
 * 将指定用户升级为专业版（pro），以启用自定义大模型配置等高级功能
 *
 * 用法:
 *   npx tsx scripts/upgrade-user-to-pro.ts <userId|email>
 *
 * 示例:
 *   npx tsx scripts/upgrade-user-to-pro.ts user-uuid-here
 *   npx tsx scripts/upgrade-user-to-pro.ts me@example.com
 *
 * 环境变量：会加载 server/.env（与 dev 服务一致），再读取 MYSQL_*、DATABASE_TYPE 等
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });
import { loadDefaultConfig } from '../server/src/config/defaultConfig.js';
import { createDatabase } from '../server/src/db/database.js';

const workspaceRoot = process.env.X_COMPUTER_WORKSPACE ?? '/tmp/x-computer-workspace';

async function main() {
  const arg = process.argv[2];
  const listOnly = arg === '--list' || arg === '-l';

  const config = loadDefaultConfig();
  const dbType = (config.database?.type ?? process.env.DATABASE_TYPE ?? 'sqlite').toString().toLowerCase();
  if (dbType === 'mysql') {
    const { ensureMysqlReady } = await import('../server/src/db/ensureMysqlContainer.js');
    await ensureMysqlReady();
  }

  const db = await createDatabase(workspaceRoot, { type: dbType as 'sqlite' | 'mysql' });

  if (listOnly) {
    const users = await db.query<{ id: string; display_name: string | null }>('SELECT id, display_name FROM users ORDER BY created_at DESC LIMIT 20');
    const accounts = await db.query<{ email: string; user_id: string }>('SELECT email, user_id FROM auth_accounts ORDER BY created_at DESC LIMIT 20');
    console.log('[upgrade] 数据库类型:', dbType);
    console.log('[upgrade] users 表 (最近20条):');
    if (users.length === 0) console.log('  (空)');
    else users.forEach((u) => console.log(`  id=${u.id} display_name=${u.display_name ?? '—'}`));
    console.log('[upgrade] auth_accounts 表 (最近20条):');
    if (accounts.length === 0) console.log('  (空)');
    else accounts.forEach((a) => console.log(`  email=${a.email} user_id=${a.user_id}`));
    process.exit(0);
  }

  if (!arg) {
    console.error('用法: npx tsx scripts/upgrade-user-to-pro.ts <userId|email>');
    console.error('       npx tsx scripts/upgrade-user-to-pro.ts --list   # 列出用户');
    console.error('示例: npx tsx scripts/upgrade-user-to-pro.ts me@example.com');
    process.exit(1);
  }

  let userId: string;
  if (arg.includes('@')) {
    const row = await db.queryOne<{ user_id: string }>(
      'SELECT user_id FROM auth_accounts WHERE email = ?',
      [arg.toLowerCase().trim()]
    );
    if (!row?.user_id) {
      console.error(`未找到邮箱对应的用户: ${arg}`);
      process.exit(1);
    }
    userId = row.user_id;
    console.log(`[upgrade] 邮箱 ${arg} 对应 userId: ${userId}`);
  } else {
    const user = await db.queryOne<{ id: string }>('SELECT id FROM users WHERE id = ?', [arg]);
    if (!user) {
      console.error(`未找到用户: ${arg}`);
      process.exit(1);
    }
    userId = user.id;
  }

  const existing = await db.queryOne<{ id: string; plan_id: string }>(
    'SELECT id, plan_id FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  );

  const now = Date.now();
  const periodEnd = now + 365 * 24 * 60 * 60 * 1000;

  if (existing) {
    if (existing.plan_id === 'pro' || existing.plan_id === 'enterprise') {
      console.log(`[upgrade] 用户已是 ${existing.plan_id} 套餐，无需升级`);
      process.exit(0);
    }
    await db.run(
      `UPDATE subscriptions SET plan_id = 'pro', status = 'active', current_period_start = ?, current_period_end = ?, trial_end = NULL, updated_at = ? WHERE id = ?`,
      [now, periodEnd, now, existing.id]
    );
    console.log(`[upgrade] 已将用户 ${userId} 从 ${existing.plan_id} 升级为 pro`);
  } else {
    const id = `sub-pro-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await db.run(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, billing_cycle, current_period_start, current_period_end, trial_end, created_at, updated_at)
       VALUES (?, ?, 'pro', 'active', 'monthly', ?, ?, NULL, ?, ?)`,
      [id, userId, now, periodEnd, now, now]
    );
    console.log(`[upgrade] 已为用户 ${userId} 创建 pro 订阅`);
  }

  console.log('[upgrade] 完成。刷新页面后可在 设置 -> 大模型配置 中自定义模型。');
  process.exit(0);
}

main().catch((err) => {
  console.error('[upgrade] 失败:', err);
  process.exit(1);
});
