/**
 * 数据库迁移工具
 * 运行 migrations/ 目录下的 SQL 迁移文件
 */

import fs from 'fs/promises';
import path from 'path';
import type { AsyncDatabase } from './database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface MigrationRecord {
  id: string;
  filename: string;
  applied_at: number;
}

/**
 * 初始化迁移记录表（按数据库类型执行对应 DDL）
 */
async function initMigrationsTable(db: AsyncDatabase): Promise<void> {
  const dialect = db.getDialect();
  if (dialect === 'mysql') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at BIGINT NOT NULL
      )
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )
    `);
  }
}

/**
 * 获取已应用的迁移
 */
async function getAppliedMigrations(db: AsyncDatabase): Promise<Set<string>> {
  const rows = await db.query<{ filename: string }>('SELECT filename FROM migrations');
  return new Set(rows.map(r => r.filename));
}

/**
 * 记录迁移已应用
 */
async function recordMigration(db: AsyncDatabase, filename: string): Promise<void> {
  await db.run('INSERT INTO migrations (filename, applied_at) VALUES (?, ?)', [filename, Date.now()]);
}

/**
 * 运行所有待应用的迁移
 * @param db 数据库实例
 * @param migrationsDir 迁移文件目录（默认：项目根目录/migrations）
 */
export async function runMigrations(db: AsyncDatabase, migrationsDir?: string): Promise<void> {
  const dir = migrationsDir ?? path.join(process.cwd(), 'migrations');
  
  serverLogger.info('db/migrate', '开始数据库迁移', `dir=${dir}`);
  
  // 初始化迁移记录表
  await initMigrationsTable(db);
  
  // 获取已应用的迁移
  const applied = await getAppliedMigrations(db);
  
  // 读取迁移文件
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      serverLogger.info('db/migrate', '迁移目录不存在，跳过迁移', `dir=${dir}`);
      return;
    }
    throw err;
  }
  
  // 筛选迁移：只认「非 .mysql.sql」的 .sql 为迁移名；MySQL 时优先执行同名的 .mysql.sql
  const dialect = db.getDialect();
  const sqlFiles = files
    .filter(f => f.endsWith('.sql') && !f.endsWith('.mysql.sql'))
    .sort();
  
  if (sqlFiles.length === 0) {
    serverLogger.info('db/migrate', '没有找到迁移文件');
    return;
  }
  
  // 应用每个迁移
  let appliedCount = 0;
  for (const file of sqlFiles) {
    if (applied.has(file)) {
      serverLogger.info('db/migrate', `跳过已应用的迁移`, `file=${file}`);
      continue;
    }
    
    const mysqlFile = file.replace(/\.sql$/, '.mysql.sql');
    const useMysql = dialect === 'mysql' && files.includes(mysqlFile);
    const runFile = useMysql ? mysqlFile : file;
    const filePath = path.join(dir, runFile);
    
    serverLogger.info('db/migrate', `应用迁移`, `file=${runFile}`);
    
    const sql = await fs.readFile(filePath, 'utf-8');
    
    try {
      // 执行迁移 SQL
      await db.exec(sql);
      
      // 记录迁移
      await recordMigration(db, file);
      
      appliedCount++;
      serverLogger.info('db/migrate', `迁移成功`, `file=${file}`);
    } catch (err) {
      serverLogger.error('db/migrate', `迁移失败`, `file=${file} error=${err instanceof Error ? err.message : String(err)}`);
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  if (appliedCount > 0) {
    serverLogger.info('db/migrate', `数据库迁移完成`, `applied=${appliedCount} total=${sqlFiles.length}`);
  } else {
    serverLogger.info('db/migrate', '所有迁移已是最新');
  }
}

/**
 * 获取迁移状态（用于管理界面）
 */
export async function getMigrationStatus(db: AsyncDatabase): Promise<{
  applied: MigrationRecord[];
  pending: string[];
}> {
  await initMigrationsTable(db);
  
  const rows = await db.query<{ id: number; filename: string; applied_at: number }>(
    'SELECT * FROM migrations ORDER BY applied_at DESC'
  );
  
  const applied: MigrationRecord[] = rows.map(r => ({
    id: String(r.id),
    filename: r.filename,
    applied_at: r.applied_at,
  }));
  
  // TODO: 读取 migrations 目录，找出未应用的
  const pending: string[] = [];
  
  return { applied, pending };
}
