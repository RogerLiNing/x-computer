#!/usr/bin/env tsx
/**
 * 手动运行 MySQL 订阅迁移
 * 当服务启动时迁移失败，可单独执行此脚本创建 plans/subscriptions 等表
 *
 * 用法: DATABASE_TYPE=mysql MYSQL_HOST=... MYSQL_USER=... ... npx tsx scripts/run-mysql-migration.ts
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createDatabase } from '../server/src/db/database.js';
import { runMigrations } from '../server/src/db/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = process.env.X_COMPUTER_WORKSPACE ?? '/tmp/x-computer-workspace';

async function main() {
  if (process.env.DATABASE_TYPE !== 'mysql') {
    console.error('此脚本仅用于 MySQL，请设置 DATABASE_TYPE=mysql');
    console.error('示例: DATABASE_TYPE=mysql MYSQL_HOST=127.0.0.1 MYSQL_USER=xcom MYSQL_PASSWORD=xcomputer MYSQL_DATABASE=x_computer npx tsx scripts/run-mysql-migration.ts');
    process.exit(1);
  }

  console.log('[migrate] 连接 MySQL...');
  const db = await createDatabase(workspaceRoot);
  const migrationsDir = path.join(__dirname, '..', 'server', 'migrations');

  console.log('[migrate] 执行迁移:', migrationsDir);
  await runMigrations(db, migrationsDir);
  console.log('[migrate] 完成');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] 失败:', err);
  process.exit(1);
});
