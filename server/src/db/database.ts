/**
 * 数据库层：用户、配置、聊天会话、任务、审计等。
 *
 * - sqlite（默认）：使用 better-sqlite3，数据文件 basePath/x-computer.db
 * - mysql：使用 mysql2，需配置 MYSQL_HOST/PORT/USER/PASSWORD/DATABASE 环境变量
 *
 * 通过 createDatabase(basePath, { type }) 创建实例；type 可由 .x-config.json 的 database.type 或环境变量 DATABASE_TYPE 指定。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

export interface UserRow {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserConfigRow {
  user_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  /** 会话场景：x_direct = X 主脑对话，null/normal_chat = AI 助手 */
  scene?: string | null;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls_json: string | null;
  images_json: string | null;
  attached_files_json: string | null;
  created_at: string;
}

export class SqliteAppDatabase {
  private db: Database.Database;

  constructor(basePath: string) {
    // 确保数据库目录存在（SQLite 需要本地目录）
    fs.mkdirSync(basePath, { recursive: true });
    const dbPath = path.join(basePath, 'x-computer.db');
    this.db = new Database(dbPath);
    
    // 性能优化配置
    this.db.pragma('journal_mode = WAL');        // WAL 模式，提升并发读写
    this.db.pragma('synchronous = NORMAL');      // 平衡性能与安全性
    this.db.pragma('cache_size = -64000');       // 64MB 缓存
    this.db.pragma('temp_store = MEMORY');       // 临时表使用内存
    this.db.pragma('mmap_size = 268435456');     // 256MB 内存映射
    this.db.pragma('foreign_keys = ON');
    
    this.initSchema();
  }

  /** 暴露 exec 方法供迁移系统使用（异步兼容） */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** 异步 exec，供统一接口使用 */
  execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
    return Promise.resolve();
  }

  /** 执行无结果 SQL，参数化。供迁移、订阅等使用。 */
  run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
    return Promise.resolve();
  }

  /** 查询多行 */
  query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = this.db.prepare(sql).all(...params) as T[];
    return Promise.resolve(rows);
  }

  /** 查询单行 */
  queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const row = this.db.prepare(sql).get(...params) as T | undefined;
    return Promise.resolve(row);
  }

  /** 数据库类型，供迁移等区分 DDL */
  getDialect(): 'sqlite' | 'mysql' {
    return 'sqlite';
  }

  /** 暴露 prepare 方法供外部使用（SQLite 专用，MySQL 请用 run/query/queryOne） */
  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_config (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, key)
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        tool_calls_json TEXT,
        images_json TEXT,
        attached_files_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        steps_json TEXT,
        result_json TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        task_id TEXT NOT NULL,
        step_id TEXT,
        type TEXT NOT NULL,
        intent TEXT,
        action TEXT,
        result TEXT,
        risk_level TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_log(task_id);

      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        intent TEXT NOT NULL,
        run_at INTEGER NOT NULL,
        cron TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_user ON scheduled_jobs(user_id);

      CREATE TABLE IF NOT EXISTS app_backend_kv (
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, app_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_app_backend_kv_user_app ON app_backend_kv(user_id, app_id);

      CREATE TABLE IF NOT EXISTS app_backend_queue (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        queue_name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_app_backend_queue_user_app ON app_backend_queue(user_id, app_id, queue_name);

      CREATE TABLE IF NOT EXISTS app_public_read_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_app_public_read_tokens_user_app ON app_public_read_tokens(user_id, app_id);

      CREATE TABLE IF NOT EXISTS auth_accounts (
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (email)
      );
      CREATE INDEX IF NOT EXISTS idx_auth_accounts_user ON auth_accounts(user_id);

      CREATE TABLE IF NOT EXISTS emails (
        user_id TEXT NOT NULL,
        uid INTEGER NOT NULL,
        message_id TEXT,
        from_addr TEXT NOT NULL,
        to_addr TEXT,
        subject TEXT NOT NULL DEFAULT '',
        date TEXT,
        text TEXT,
        unseen INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, uid)
      );
      CREATE INDEX IF NOT EXISTS idx_emails_user_date ON emails(user_id, date);

      CREATE TABLE IF NOT EXISTS handled_events (
        user_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, fingerprint)
      );
      CREATE INDEX IF NOT EXISTS idx_handled_events_completed ON handled_events(completed_at);

      CREATE TABLE IF NOT EXISTS x_board_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_x_board_items_user ON x_board_items(user_id);
      CREATE INDEX IF NOT EXISTS idx_x_board_items_status ON x_board_items(user_id, status);

      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'privateKey')),
        password TEXT,
        private_key TEXT,
        passphrase TEXT,
        description TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_servers_created_at ON servers(created_at);
      CREATE INDEX IF NOT EXISTS idx_servers_host ON servers(host);

      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        message_id TEXT,
        from_jid TEXT NOT NULL,
        to_jid TEXT,
        text TEXT,
        timestamp INTEGER,
        is_group INTEGER NOT NULL DEFAULT 0,
        unseen INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_user ON whatsapp_messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_user_time ON whatsapp_messages(user_id, timestamp);

      CREATE TABLE IF NOT EXISTS channel_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        channel_message_id TEXT,
        from_id TEXT NOT NULL,
        from_name TEXT,
        chat_id TEXT,
        text TEXT,
        timestamp INTEGER,
        is_group INTEGER NOT NULL DEFAULT 0,
        unseen INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_channel_messages_user ON channel_messages(user_id, channel);
      CREATE INDEX IF NOT EXISTS idx_channel_messages_user_time ON channel_messages(user_id, channel, timestamp);
    `);
    // 兼容旧库：为已有 chat_sessions 表补充 scene 列（X 主脑对话场景）
    try {
      const sessionCols = this.db.prepare('PRAGMA table_info(chat_sessions)').all() as { name: string }[];
      if (!sessionCols.some((c) => c.name === 'scene')) {
        this.db.exec('ALTER TABLE chat_sessions ADD COLUMN scene TEXT');
      }
    } catch {
      /* 忽略 */
    }
    // 兼容旧库：x_board_items 补充 source_id（关联定时任务 jobId，便于任务完成后更新看板项为 done）
    try {
      const boardCols = this.db.prepare('PRAGMA table_info(x_board_items)').all() as { name: string }[];
      if (!boardCols.some((c) => c.name === 'source_id')) {
        this.db.exec('ALTER TABLE x_board_items ADD COLUMN source_id TEXT');
      }
    } catch {
      /* 忽略 */
    }
    // 兼容旧库：为已有 chat_messages 表补充 images_json、attached_files_json 列
    try {
      const cols = this.db.prepare('PRAGMA table_info(chat_messages)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'images_json')) {
        this.db.exec('ALTER TABLE chat_messages ADD COLUMN images_json TEXT');
      }
      if (!cols.some((c) => c.name === 'attached_files_json')) {
        this.db.exec('ALTER TABLE chat_messages ADD COLUMN attached_files_json TEXT');
      }
    } catch {
      /* 忽略 */
    }
  }

  // ── Users ──────────────────────────────────────────────────

  ensureUser(userId: string, displayName?: string): UserRow {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      userId,
      displayName ?? null,
      now,
      now,
    );
    return { id: userId, display_name: displayName ?? null, created_at: now, updated_at: now };
  }

  getUser(userId: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  }

  // ── Auth (邮箱+密码账号，关联 users.id) ────────────────────────

  getUserIdByEmail(email: string): string | undefined {
    const row = this.db
      .prepare('SELECT user_id FROM auth_accounts WHERE email = ?')
      .get(email.toLowerCase().trim()) as { user_id: string } | undefined;
    return row?.user_id;
  }

  getPasswordHashByEmail(email: string): string | undefined {
    const row = this.db
      .prepare('SELECT password_hash FROM auth_accounts WHERE email = ?')
      .get(email.toLowerCase().trim()) as { password_hash: string } | undefined;
    return row?.password_hash;
  }

  createAuthAccount(email: string, passwordHash: string, userId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO auth_accounts (email, password_hash, user_id, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(email.toLowerCase().trim(), passwordHash, userId, now);
  }

  /** 根据 user_id 查账号邮箱（有则已登录账号，无则为匿名） */
  getEmailByUserId(userId: string): string | undefined {
    const row = this.db
      .prepare('SELECT email FROM auth_accounts WHERE user_id = ?')
      .get(userId) as { email: string } | undefined;
    return row?.email;
  }

  /** 将 fromUserId 的所有数据合并到 toUserId（用于匿名用户登录/注册后关联） */
  mergeUserDataInto(fromUserId: string, toUserId: string): void {
    if (fromUserId === toUserId) return;
    this.ensureUser(toUserId);
    const run = (sql: string, ...params: unknown[]) => this.db.prepare(sql).run(...params);
    const fromConfigs = this.db.prepare('SELECT key, value, updated_at FROM user_config WHERE user_id = ?').all(fromUserId) as { key: string; value: string; updated_at: string }[];
    for (const row of fromConfigs) {
      const exists = this.db.prepare('SELECT 1 FROM user_config WHERE user_id = ? AND key = ?').get(toUserId, row.key);
      if (!exists) {
        this.db.prepare('INSERT INTO user_config (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run(toUserId, row.key, row.value, row.updated_at);
      }
    }
    run('DELETE FROM user_config WHERE user_id = ?', fromUserId);
    run('UPDATE chat_sessions SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE tasks SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE audit_log SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE scheduled_jobs SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE app_backend_kv SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE app_backend_queue SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE emails SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE whatsapp_messages SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
    run('UPDATE x_board_items SET user_id = ? WHERE user_id = ?', toUserId, fromUserId);
  }

  // ── User Config ────────────────────────────────────────────

  getConfig(userId: string, key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM user_config WHERE user_id = ? AND key = ?').get(userId, key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  getAllConfig(userId: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT key, value FROM user_config WHERE user_id = ?')
      .all(userId) as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key] = r.value;
    return result;
  }

  setConfig(userId: string, key: string, value: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_config (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(userId, key, value, now);
  }

  deleteConfig(userId: string, key: string): void {
    this.db.prepare('DELETE FROM user_config WHERE user_id = ? AND key = ?').run(userId, key);
  }

  /** Admin：列出用户（含邮箱、封禁状态），支持分页与搜索 */
  listAdminUsers(options: { limit?: number; offset?: number; search?: string }): { users: Array<{ id: string; displayName: string | null; email: string | null; createdAt: string; updatedAt: string; banned: boolean }>; total: number } {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const likeArg = search ? `%${search}%` : '';

    const countSql = search
      ? `SELECT COUNT(*) as c FROM users u
         LEFT JOIN auth_accounts a ON a.user_id = u.id
         WHERE LOWER(COALESCE(a.email,'')) LIKE LOWER(?) OR LOWER(COALESCE(u.display_name,'')) LIKE LOWER(?)`
      : `SELECT COUNT(*) as c FROM users u`;
    const countParams = search ? [likeArg, likeArg] : [];
    const total = (this.db.prepare(countSql).get(...countParams) as { c: number }).c;

    const listSql = `SELECT u.id, u.display_name, u.created_at, u.updated_at, a.email,
      CASE WHEN uc.value = '1' THEN 1 ELSE 0 END as banned
      FROM users u
      LEFT JOIN auth_accounts a ON a.user_id = u.id
      LEFT JOIN user_config uc ON uc.user_id = u.id AND uc.key = 'admin_banned'
      ${search ? 'WHERE LOWER(COALESCE(a.email,\'\')) LIKE LOWER(?) OR LOWER(COALESCE(u.display_name,\'\')) LIKE LOWER(?)' : ''}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`;
    const listParams = search ? [likeArg, likeArg, limit, offset] : [limit, offset];
    const rows = this.db.prepare(listSql).all(...listParams) as Array<{
      id: string;
      display_name: string | null;
      created_at: string;
      updated_at: string;
      email: string | null;
      banned: number;
    }>;

    return {
      users: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        email: r.email,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        banned: r.banned === 1,
      })),
      total,
    };
  }

  /** 获取拥有指定配置项的所有 user_id（用于邮件检查等定时任务） */
  getUserIdsWithConfigKey(key: string): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT user_id FROM user_config WHERE key = ? AND value IS NOT NULL AND value != '' AND value != '{}'")
      .all(key) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  // ── Chat Sessions ──────────────────────────────────────────

  createSession(userId: string, title?: string, scene?: string | null): ChatSessionRow {
    const id = uuid();
    const now = new Date().toISOString();
    const sceneVal = scene ?? null;
    this.db
      .prepare('INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at, scene) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, title ?? null, now, now, sceneVal);
    return { id, user_id: userId, title: title ?? null, created_at: now, updated_at: now, scene: sceneVal };
  }

  listSessions(userId: string, limit = 50, scene?: string | null): ChatSessionRow[] {
    if (scene === 'x_direct') {
      return this.db
        .prepare('SELECT * FROM chat_sessions WHERE user_id = ? AND scene = ? ORDER BY updated_at DESC LIMIT ?')
        .all(userId, 'x_direct', limit) as ChatSessionRow[];
    }
    if (scene === 'normal_chat' || scene == null || scene === '') {
      return this.db
        .prepare('SELECT * FROM chat_sessions WHERE user_id = ? AND (scene IS NULL OR scene = ?) ORDER BY updated_at DESC LIMIT ?')
        .all(userId, 'normal_chat', limit) as ChatSessionRow[];
    }
    return this.db
      .prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(userId, limit) as ChatSessionRow[];
  }

  getSession(sessionId: string): ChatSessionRow | undefined {
    return this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as ChatSessionRow | undefined;
  }

  updateSessionTitle(sessionId: string, title: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, now, sessionId);
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
  }

  touchSession(sessionId: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
  }

  // ── Chat Messages ──────────────────────────────────────────

  addMessage(
    sessionId: string,
    role: string,
    content: string,
    toolCallsJson?: string,
    imagesJson?: string,
    attachedFilesJson?: string,
  ): ChatMessageRow {
    const id = uuid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO chat_messages (id, session_id, role, content, tool_calls_json, images_json, attached_files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, sessionId, role, content, toolCallsJson ?? null, imagesJson ?? null, attachedFilesJson ?? null, now);
    this.touchSession(sessionId);
    return {
      id,
      session_id: sessionId,
      role,
      content,
      tool_calls_json: toolCallsJson ?? null,
      images_json: imagesJson ?? null,
      attached_files_json: attachedFilesJson ?? null,
      created_at: now,
    };
  }

  getMessages(sessionId: string, limit = 200): ChatMessageRow[] {
    return this.db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(sessionId, limit) as ChatMessageRow[];
  }

  deleteMessage(messageId: string): void {
    this.db.prepare('DELETE FROM chat_messages WHERE id = ?').run(messageId);
  }

  /** 获取会话最近 N 条消息（用于构建 LLM 上下文） */
  getRecentMessages(sessionId: string, limit = 20): ChatMessageRow[] {
    // 先降序取 N 条，再翻转为正序
    const rows = this.db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(sessionId, limit) as ChatMessageRow[];
    return rows.reverse();
  }

  // ── Tasks (C.4 持久化) ─────────────────────────────────────

  insertTask(task: {
    id: string;
    user_id: string;
    domain: string;
    title: string;
    description?: string;
    status: string;
    steps_json: string;
    result_json?: string;
    metadata_json?: string;
    created_at: number;
    updated_at: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, user_id, domain, title, description, status, steps_json, result_json, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           steps_json = excluded.steps_json,
           result_json = excluded.result_json,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        task.id,
        task.user_id,
        task.domain,
        task.title,
        task.description ?? null,
        task.status,
        task.steps_json,
        task.result_json ?? null,
        task.metadata_json ?? null,
        task.created_at,
        task.updated_at,
      );
  }

  updateTask(task: {
    id: string;
    status: string;
    steps_json: string;
    result_json?: string | null;
    metadata_json?: string | null;
    updated_at: number;
  }): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, steps_json = ?, result_json = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        task.status,
        task.steps_json,
        task.result_json ?? null,
        task.metadata_json ?? null,
        task.updated_at,
        task.id,
      );
  }

  listTasksByUser(userId: string, limit = 100): { id: string; status: string; title: string; updated_at: number }[] {
    return this.db
      .prepare('SELECT id, status, title, updated_at FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(userId, limit) as { id: string; status: string; title: string; updated_at: number }[];
  }

  /** 返回全部任务（完整行），供服务启动时加载到 orchestrator 内存 */
  getAllTasks(): {
    id: string;
    user_id: string;
    domain: string;
    title: string;
    description: string | null;
    status: string;
    steps_json: string | null;
    result_json: string | null;
    metadata_json: string | null;
    created_at: number;
    updated_at: number;
  }[] {
    return this.db
      .prepare(
        'SELECT id, user_id, domain, title, description, status, steps_json, result_json, metadata_json, created_at, updated_at FROM tasks ORDER BY updated_at DESC',
      )
      .all() as {
        id: string;
        user_id: string;
        domain: string;
        title: string;
        description: string | null;
        status: string;
        steps_json: string | null;
        result_json: string | null;
        metadata_json: string | null;
        created_at: number;
        updated_at: number;
      }[];
  }

  // ── Audit (C.4 持久化) ─────────────────────────────────────

  insertAudit(entry: {
    id: string;
    user_id: string | null;
    task_id: string;
    step_id?: string | null;
    type: string;
    intent?: string | null;
    action?: string | null;
    result?: string | null;
    risk_level?: string | null;
    metadata_json?: string | null;
    created_at: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (id, user_id, task_id, step_id, type, intent, action, result, risk_level, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.user_id ?? null,
        entry.task_id,
        entry.step_id ?? null,
        entry.type,
        entry.intent ?? null,
        entry.action ?? null,
        entry.result ?? null,
        entry.risk_level ?? null,
        entry.metadata_json ?? null,
        entry.created_at,
      );
  }

  getAuditByUser(userId: string, limit = 200): unknown[] {
    return this.db
      .prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit);
  }

  // ── Scheduled Jobs (X 主脑定时任务持久化) ─────────────────────

  insertScheduledJob(job: {
    id: string;
    user_id: string;
    intent: string;
    run_at: number;
    cron: string | null;
    created_at: number;
  }): void {
    this.db
      .prepare(
        'INSERT INTO scheduled_jobs (id, user_id, intent, run_at, cron, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(job.id, job.user_id, job.intent, job.run_at, job.cron ?? null, job.created_at);
  }

  updateScheduledJobRunAt(id: string, runAt: number): void {
    this.db.prepare('UPDATE scheduled_jobs SET run_at = ? WHERE id = ?').run(runAt, id);
  }

  deleteScheduledJob(id: string): void {
    this.db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(id);
  }

  getAllScheduledJobs(): {
    id: string;
    user_id: string;
    intent: string;
    run_at: number;
    cron: string | null;
    created_at: number;
  }[] {
    return this.db
      .prepare('SELECT id, user_id, intent, run_at, cron, created_at FROM scheduled_jobs ORDER BY run_at ASC')
      .all() as {
      id: string;
      user_id: string;
      intent: string;
      run_at: number;
      cron: string | null;
      created_at: number;
    }[];
  }

  // ── Handled Events（已处理事件去重，避免定时/信号任务重复执行）────────────────

  /** 7 天内视为已处理，避免重复执行同一事件 */
  static HANDLED_EVENTS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  hasHandledEvent(userId: string, fingerprint: string): boolean {
    const cutoff = Date.now() - SqliteAppDatabase.HANDLED_EVENTS_RETENTION_MS;
    const row = this.db
      .prepare('SELECT 1 FROM handled_events WHERE user_id = ? AND fingerprint = ? AND completed_at > ?')
      .get(userId, fingerprint, cutoff);
    return !!row;
  }

  insertHandledEvent(userId: string, fingerprint: string): void {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO handled_events (user_id, fingerprint, completed_at) VALUES (?, ?, ?) ON CONFLICT(user_id, fingerprint) DO UPDATE SET completed_at = excluded.completed_at',
      )
      .run(userId, fingerprint, now);
  }

  /** 清理过期记录，避免表无限增长 */
  pruneHandledEvents(): void {
    const cutoff = Date.now() - SqliteAppDatabase.HANDLED_EVENTS_RETENTION_MS;
    this.db.prepare('DELETE FROM handled_events WHERE completed_at < ?').run(cutoff);
  }

  // ── 小程序/小游戏后端存储（X 可创建，前端通过 API 读写）────────────────

  appBackendKvGet(userId: string, appId: string, key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM app_backend_kv WHERE user_id = ? AND app_id = ? AND key = ?')
      .get(userId, appId, key) as { value: string } | undefined;
    return row?.value;
  }

  appBackendKvSet(userId: string, appId: string, key: string, value: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO app_backend_kv (user_id, app_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, app_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(userId, appId, key, value, now);
  }

  appBackendKvDelete(userId: string, appId: string, key: string): void {
    this.db.prepare('DELETE FROM app_backend_kv WHERE user_id = ? AND app_id = ? AND key = ?').run(userId, appId, key);
  }

  appBackendKvList(userId: string, appId: string, prefix?: string): string[] {
    const rows = prefix
      ? (this.db
          .prepare('SELECT key FROM app_backend_kv WHERE user_id = ? AND app_id = ? AND key LIKE ? ORDER BY key')
          .all(userId, appId, `${prefix}%`) as { key: string }[])
      : (this.db
          .prepare('SELECT key FROM app_backend_kv WHERE user_id = ? AND app_id = ? ORDER BY key')
          .all(userId, appId) as { key: string }[]);
    return rows.map((r) => r.key);
  }

  /** 创建应用公开只读 Token，供外部分发站点 GET KV 使用（不暴露 X-User-Id）。同一 (userId, appId) 可有多条，均有效。 */
  createAppPublicReadToken(userId: string, appId: string): string {
    const token = uuid().replace(/-/g, '');
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO app_public_read_tokens (token, user_id, app_id, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(token, userId, appId, now);
    return token;
  }

  /** 校验 Token 并返回对应的 userId（仅当 token 属于该 appId 时）。 */
  resolveAppPublicReadToken(token: string, appId: string): string | null {
    const row = this.db
      .prepare('SELECT user_id FROM app_public_read_tokens WHERE token = ? AND app_id = ?')
      .get(token, appId) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  appBackendQueuePush(userId: string, appId: string, queueName: string, payload: string): void {
    const id = uuid();
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO app_backend_queue (id, user_id, app_id, queue_name, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, appId, queueName, payload, now);
  }

  appBackendQueuePop(userId: string, appId: string, queueName: string): string | null {
    const row = this.db
      .prepare(
        'SELECT id, payload FROM app_backend_queue WHERE user_id = ? AND app_id = ? AND queue_name = ? ORDER BY created_at ASC LIMIT 1',
      )
      .get(userId, appId, queueName) as { id: string; payload: string } | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM app_backend_queue WHERE id = ?').run(row.id);
    return row.payload;
  }

  appBackendQueueLen(userId: string, appId: string, queueName: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS c FROM app_backend_queue WHERE user_id = ? AND app_id = ? AND queue_name = ?',
      )
      .get(userId, appId, queueName) as { c: number };
    return row?.c ?? 0;
  }

  // ── Emails（IMAP 同步的收件箱，供前端读取）───────────────────────

  insertEmails(userId: string, emails: { uid: number; messageId?: string; from: string; to?: string; subject: string; date?: string; text?: string; unseen?: boolean }[]): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO emails (user_id, uid, message_id, from_addr, to_addr, subject, date, text, unseen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of emails) {
      stmt.run(userId, e.uid, e.messageId ?? null, e.from, e.to ?? null, e.subject, e.date ?? null, e.text ?? null, e.unseen ? 1 : 0, now);
    }
  }

  getEmailsByUser(userId: string, limit = 50): { uid: number; messageId?: string; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean }[] {
    const rows = this.db
      .prepare('SELECT uid, message_id, from_addr, to_addr, subject, date, text, unseen FROM emails WHERE user_id = ? ORDER BY date DESC NULLS LAST, uid DESC LIMIT ?')
      .all(userId, limit) as { uid: number; message_id: string | null; from_addr: string; to_addr: string | null; subject: string; date: string | null; text: string | null; unseen: number }[];
    return rows.map((r) => ({
      uid: r.uid,
      messageId: r.message_id ?? undefined,
      from: r.from_addr,
      to: r.to_addr ?? undefined,
      subject: r.subject,
      date: r.date ?? undefined,
      text: r.text ?? undefined,
      unseen: r.unseen === 1,
    }));
  }

  getEmailByUid(userId: string, uid: number): { uid: number; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean } | null {
    const row = this.db
      .prepare('SELECT uid, from_addr, to_addr, subject, date, text, unseen FROM emails WHERE user_id = ? AND uid = ?')
      .get(userId, uid) as { uid: number; from_addr: string; to_addr: string | null; subject: string; date: string | null; text: string | null; unseen: number } | undefined;
    if (!row) return null;
    return {
      uid: row.uid,
      from: row.from_addr,
      to: row.to_addr ?? undefined,
      subject: row.subject,
      date: row.date ?? undefined,
      text: row.text ?? undefined,
      unseen: row.unseen === 1,
    };
  }

  // ── WhatsApp 消息（R052）────────────────────────────────────

  insertWhatsAppMessage(
    userId: string,
    msg: { id: string; messageId?: string; fromJid: string; toJid?: string; text?: string; timestamp?: number; isGroup?: boolean },
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO whatsapp_messages (id, user_id, message_id, from_jid, to_jid, text, timestamp, is_group, unseen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
      )
      .run(
        msg.id,
        userId,
        msg.messageId ?? null,
        msg.fromJid,
        msg.toJid ?? null,
        msg.text ?? null,
        msg.timestamp ?? null,
        msg.isGroup ? 1 : 0,
      );
  }

  getWhatsAppMessagesByUser(
    userId: string,
    limit = 50,
  ): { id: string; messageId?: string; fromJid: string; toJid?: string; text?: string; timestamp?: number; isGroup: boolean; unseen: boolean; createdAt: string }[] {
    const rows = this.db
      .prepare(
        'SELECT id, message_id, from_jid, to_jid, text, timestamp, is_group, unseen, created_at FROM whatsapp_messages WHERE user_id = ? ORDER BY timestamp DESC NULLS LAST, created_at DESC LIMIT ?',
      )
      .all(userId, limit) as {
        id: string;
        message_id: string | null;
        from_jid: string;
        to_jid: string | null;
        text: string | null;
        timestamp: number | null;
        is_group: number;
        unseen: number;
        created_at: string;
      }[];
    return rows.map((r) => ({
      id: r.id,
      messageId: r.message_id ?? undefined,
      fromJid: r.from_jid,
      toJid: r.to_jid ?? undefined,
      text: r.text ?? undefined,
      timestamp: r.timestamp ?? undefined,
      isGroup: r.is_group === 1,
      unseen: r.unseen === 1,
      createdAt: r.created_at,
    }));
  }

  // ── Channel Messages (Telegram / Discord / Slack 等) ─────

  insertChannelMessage(
    userId: string,
    msg: { id: string; channel: string; channelMessageId?: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup?: boolean },
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO channel_messages (id, user_id, channel, channel_message_id, from_id, from_name, chat_id, text, timestamp, is_group, unseen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
      )
      .run(msg.id, userId, msg.channel, msg.channelMessageId ?? null, msg.fromId, msg.fromName ?? null, msg.chatId ?? null, msg.text ?? null, msg.timestamp ?? null, msg.isGroup ? 1 : 0);
  }

  getChannelMessagesByUser(
    userId: string,
    channel: string,
    limit = 50,
  ): { id: string; channelMessageId?: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup: boolean; unseen: boolean; createdAt: string }[] {
    const rows = this.db
      .prepare(
        'SELECT id, channel_message_id, from_id, from_name, chat_id, text, timestamp, is_group, unseen, created_at FROM channel_messages WHERE user_id = ? AND channel = ? ORDER BY timestamp DESC NULLS LAST, created_at DESC LIMIT ?',
      )
      .all(userId, channel, limit) as {
        id: string; channel_message_id: string | null; from_id: string; from_name: string | null; chat_id: string | null; text: string | null; timestamp: number | null; is_group: number; unseen: number; created_at: string;
      }[];
    return rows.map((r) => ({
      id: r.id,
      channelMessageId: r.channel_message_id ?? undefined,
      fromId: r.from_id,
      fromName: r.from_name ?? undefined,
      chatId: r.chat_id ?? undefined,
      text: r.text ?? undefined,
      timestamp: r.timestamp ?? undefined,
      isGroup: r.is_group === 1,
      unseen: r.unseen === 1,
      createdAt: r.created_at,
    }));
  }

  // ── X Board (任务看板) ────────────────────────────────────

  listBoardItems(userId: string): { id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }[] {
    return this.db
      .prepare('SELECT * FROM x_board_items WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC')
      .all(userId) as { id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }[];
  }

  getBoardItem(id: string): { id: string; user_id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string } | undefined {
    return this.db
      .prepare('SELECT * FROM x_board_items WHERE id = ?')
      .get(id) as { id: string; user_id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string } | undefined;
  }

  insertBoardItem(item: { id: string; user_id: string; title: string; description?: string; status: string; priority: string; sort_order?: number; source_id?: string }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO x_board_items (id, user_id, title, description, status, priority, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(item.id, item.user_id, item.title, item.description ?? null, item.status, item.priority, item.sort_order ?? 0, item.source_id ?? null, now, now);
  }

  /** 按 source_id 查找看板项（如定时任务 jobId），用于任务完成后更新为 done */
  getBoardItemBySourceId(userId: string, sourceId: string): { id: string } | undefined {
    return this.db
      .prepare('SELECT id FROM x_board_items WHERE user_id = ? AND source_id = ?')
      .get(userId, sourceId) as { id: string } | undefined;
  }

  updateBoardItem(id: string, fields: { title?: string; description?: string; status?: string; priority?: string; sort_order?: number }): void {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];
    if (fields.title !== undefined) { sets.push('title = ?'); params.push(fields.title); }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description); }
    if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status); }
    if (fields.priority !== undefined) { sets.push('priority = ?'); params.push(fields.priority); }
    if (fields.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(fields.sort_order); }
    params.push(id);
    this.db.prepare(`UPDATE x_board_items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteBoardItem(id: string): void {
    this.db.prepare('DELETE FROM x_board_items WHERE id = ?').run(id);
  }

  // ── Cleanup ────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}

/**
 * SQLite 的异步适配器，与 MysqlDatabase 统一为 Promise API，供 createDatabase 返回。
 */
export class SqliteDatabaseAdapter {
  constructor(private db: SqliteAppDatabase) {}

  getDialect(): 'sqlite' | 'mysql' {
    return 'sqlite';
  }
  exec(sql: string): Promise<void> {
    return this.db.execAsync(sql);
  }
  run(sql: string, params?: unknown[]): Promise<void> {
    return this.db.run(sql, params ?? []);
  }
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.db.query<T>(sql, params ?? []);
  }
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return this.db.queryOne<T>(sql, params ?? []);
  }

  ensureUser(userId: string, displayName?: string): Promise<UserRow> {
    return Promise.resolve(this.db.ensureUser(userId, displayName));
  }
  getUser(userId: string): Promise<UserRow | undefined> {
    return Promise.resolve(this.db.getUser(userId));
  }
  getUserIdByEmail(email: string): Promise<string | undefined> {
    return Promise.resolve(this.db.getUserIdByEmail(email));
  }
  getPasswordHashByEmail(email: string): Promise<string | undefined> {
    return Promise.resolve(this.db.getPasswordHashByEmail(email));
  }
  createAuthAccount(email: string, passwordHash: string, userId: string): Promise<void> {
    this.db.createAuthAccount(email, passwordHash, userId);
    return Promise.resolve();
  }
  getEmailByUserId(userId: string): Promise<string | undefined> {
    return Promise.resolve(this.db.getEmailByUserId(userId));
  }
  listAdminUsers(
    options: { limit?: number; offset?: number; search?: string },
  ): Promise<{ users: Array<{ id: string; displayName: string | null; email: string | null; createdAt: string; updatedAt: string; banned: boolean }>; total: number }> {
    return Promise.resolve(this.db.listAdminUsers(options));
  }
  mergeUserDataInto(fromUserId: string, toUserId: string): Promise<void> {
    this.db.mergeUserDataInto(fromUserId, toUserId);
    return Promise.resolve();
  }
  getConfig(userId: string, key: string): Promise<string | undefined> {
    return Promise.resolve(this.db.getConfig(userId, key));
  }
  getAllConfig(userId: string): Promise<Record<string, string>> {
    return Promise.resolve(this.db.getAllConfig(userId));
  }
  setConfig(userId: string, key: string, value: string): Promise<void> {
    this.db.setConfig(userId, key, value);
    return Promise.resolve();
  }
  deleteConfig(userId: string, key: string): Promise<void> {
    this.db.deleteConfig(userId, key);
    return Promise.resolve();
  }
  getUserIdsWithConfigKey(key: string): Promise<string[]> {
    return Promise.resolve(this.db.getUserIdsWithConfigKey(key));
  }
  createSession(userId: string, title?: string, scene?: string | null): Promise<ChatSessionRow> {
    return Promise.resolve(this.db.createSession(userId, title, scene));
  }
  listSessions(userId: string, limit?: number, scene?: string | null): Promise<ChatSessionRow[]> {
    return Promise.resolve(this.db.listSessions(userId, limit, scene));
  }
  getSession(sessionId: string): Promise<ChatSessionRow | undefined> {
    return Promise.resolve(this.db.getSession(sessionId));
  }
  updateSessionTitle(sessionId: string, title: string): Promise<void> {
    this.db.updateSessionTitle(sessionId, title);
    return Promise.resolve();
  }
  deleteSession(sessionId: string): Promise<void> {
    this.db.deleteSession(sessionId);
    return Promise.resolve();
  }
  touchSession(sessionId: string): Promise<void> {
    this.db.touchSession(sessionId);
    return Promise.resolve();
  }
  addMessage(
    sessionId: string,
    role: string,
    content: string,
    toolCallsJson?: string,
    imagesJson?: string,
    attachedFilesJson?: string,
  ): Promise<ChatMessageRow> {
    return Promise.resolve(
      this.db.addMessage(sessionId, role, content, toolCallsJson, imagesJson, attachedFilesJson),
    );
  }
  getMessages(sessionId: string, limit?: number): Promise<ChatMessageRow[]> {
    return Promise.resolve(this.db.getMessages(sessionId, limit));
  }
  deleteMessage(messageId: string): Promise<void> {
    this.db.deleteMessage(messageId);
    return Promise.resolve();
  }
  getRecentMessages(sessionId: string, limit?: number): Promise<ChatMessageRow[]> {
    return Promise.resolve(this.db.getRecentMessages(sessionId, limit));
  }
  insertTask(task: Parameters<SqliteAppDatabase['insertTask']>[0]): Promise<void> {
    this.db.insertTask(task);
    return Promise.resolve();
  }
  updateTask(task: Parameters<SqliteAppDatabase['updateTask']>[0]): Promise<void> {
    this.db.updateTask(task);
    return Promise.resolve();
  }
  listTasksByUser(
    userId: string,
    limit?: number,
  ): Promise<{ id: string; status: string; title: string; updated_at: number }[]> {
    return Promise.resolve(this.db.listTasksByUser(userId, limit));
  }
  getAllTasks(): Promise<
    {
      id: string;
      user_id: string;
      domain: string;
      title: string;
      description: string | null;
      status: string;
      steps_json: string | null;
      result_json: string | null;
      metadata_json: string | null;
      created_at: number;
      updated_at: number;
    }[]
  > {
    return Promise.resolve(this.db.getAllTasks());
  }
  insertAudit(entry: Parameters<SqliteAppDatabase['insertAudit']>[0]): Promise<void> {
    this.db.insertAudit(entry);
    return Promise.resolve();
  }
  getAuditByUser(userId: string, limit?: number): Promise<unknown[]> {
    return Promise.resolve(this.db.getAuditByUser(userId, limit));
  }
  insertScheduledJob(job: Parameters<SqliteAppDatabase['insertScheduledJob']>[0]): Promise<void> {
    this.db.insertScheduledJob(job);
    return Promise.resolve();
  }
  updateScheduledJobRunAt(id: string, runAt: number): Promise<void> {
    this.db.updateScheduledJobRunAt(id, runAt);
    return Promise.resolve();
  }
  deleteScheduledJob(id: string): Promise<void> {
    this.db.deleteScheduledJob(id);
    return Promise.resolve();
  }
  getAllScheduledJobs(): Promise<
    { id: string; user_id: string; intent: string; run_at: number; cron: string | null; created_at: number }[]
  > {
    return Promise.resolve(this.db.getAllScheduledJobs());
  }
  hasHandledEvent(userId: string, fingerprint: string): Promise<boolean> {
    return Promise.resolve(this.db.hasHandledEvent(userId, fingerprint));
  }
  insertHandledEvent(userId: string, fingerprint: string): Promise<void> {
    this.db.insertHandledEvent(userId, fingerprint);
    return Promise.resolve();
  }
  pruneHandledEvents(): Promise<void> {
    this.db.pruneHandledEvents();
    return Promise.resolve();
  }
  appBackendKvGet(userId: string, appId: string, key: string): Promise<string | undefined> {
    return Promise.resolve(this.db.appBackendKvGet(userId, appId, key));
  }
  appBackendKvSet(userId: string, appId: string, key: string, value: string): Promise<void> {
    this.db.appBackendKvSet(userId, appId, key, value);
    return Promise.resolve();
  }
  appBackendKvDelete(userId: string, appId: string, key: string): Promise<void> {
    this.db.appBackendKvDelete(userId, appId, key);
    return Promise.resolve();
  }
  appBackendKvList(userId: string, appId: string, prefix?: string): Promise<string[]> {
    return Promise.resolve(this.db.appBackendKvList(userId, appId, prefix));
  }
  createAppPublicReadToken(userId: string, appId: string): Promise<string> {
    return Promise.resolve(this.db.createAppPublicReadToken(userId, appId));
  }
  resolveAppPublicReadToken(token: string, appId: string): Promise<string | null> {
    return Promise.resolve(this.db.resolveAppPublicReadToken(token, appId));
  }
  appBackendQueuePush(userId: string, appId: string, queueName: string, payload: string): Promise<void> {
    this.db.appBackendQueuePush(userId, appId, queueName, payload);
    return Promise.resolve();
  }
  appBackendQueuePop(userId: string, appId: string, queueName: string): Promise<string | null> {
    return Promise.resolve(this.db.appBackendQueuePop(userId, appId, queueName));
  }
  appBackendQueueLen(userId: string, appId: string, queueName: string): Promise<number> {
    return Promise.resolve(this.db.appBackendQueueLen(userId, appId, queueName));
  }
  insertEmails(
    userId: string,
    emails: { uid: number; messageId?: string; from: string; to?: string; subject: string; date?: string; text?: string; unseen?: boolean }[],
  ): Promise<void> {
    this.db.insertEmails(userId, emails);
    return Promise.resolve();
  }
  getEmailsByUser(
    userId: string,
    limit?: number,
  ): Promise<
    { uid: number; messageId?: string; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean }[]
  > {
    return Promise.resolve(this.db.getEmailsByUser(userId, limit));
  }
  getEmailByUid(
    userId: string,
    uid: number,
  ): Promise<{ uid: number; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean } | null> {
    return Promise.resolve(this.db.getEmailByUid(userId, uid));
  }
  insertWhatsAppMessage(
    userId: string,
    msg: { id: string; messageId?: string; fromJid: string; toJid?: string; text?: string; timestamp?: number; isGroup?: boolean },
  ): Promise<void> {
    this.db.insertWhatsAppMessage(userId, msg);
    return Promise.resolve();
  }
  getWhatsAppMessagesByUser(
    userId: string,
    limit?: number,
  ): Promise<
    { id: string; messageId?: string; fromJid: string; toJid?: string; text?: string; timestamp?: number; isGroup: boolean; unseen: boolean; createdAt: string }[]
  > {
    return Promise.resolve(this.db.getWhatsAppMessagesByUser(userId, limit));
  }
  insertChannelMessage(
    userId: string,
    msg: { id: string; channel: string; channelMessageId?: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup?: boolean },
  ): Promise<void> {
    this.db.insertChannelMessage(userId, msg);
    return Promise.resolve();
  }
  getChannelMessagesByUser(
    userId: string,
    channel: string,
    limit?: number,
  ): Promise<
    { id: string; channelMessageId?: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup: boolean; unseen: boolean; createdAt: string }[]
  > {
    return Promise.resolve(this.db.getChannelMessagesByUser(userId, channel, limit));
  }
  listBoardItems(
    userId: string,
  ): Promise<
    { id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }[]
  > {
    return Promise.resolve(this.db.listBoardItems(userId));
  }
  getBoardItem(
    id: string,
  ): Promise<
    | { id: string; user_id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }
    | undefined
  > {
    return Promise.resolve(this.db.getBoardItem(id));
  }
  insertBoardItem(item: {
    id: string;
    user_id: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    sort_order?: number;
    source_id?: string;
  }): Promise<void> {
    this.db.insertBoardItem(item);
    return Promise.resolve();
  }
  getBoardItemBySourceId(userId: string, sourceId: string): Promise<{ id: string } | undefined> {
    return Promise.resolve(this.db.getBoardItemBySourceId(userId, sourceId));
  }
  updateBoardItem(
    id: string,
    fields: { title?: string; description?: string; status?: string; priority?: string; sort_order?: number },
  ): Promise<void> {
    this.db.updateBoardItem(id, fields);
    return Promise.resolve();
  }
  deleteBoardItem(id: string): Promise<void> {
    this.db.deleteBoardItem(id);
    return Promise.resolve();
  }
  close(): void {
    this.db.close();
  }
}

/** 统一异步数据库类型（SQLite 适配器或 MySQL），所有方法返回 Promise，调用方需 await */
export type AsyncDatabase = SqliteDatabaseAdapter | import('./database-mysql.js').MysqlDatabase;

/** 向后兼容：外部使用 AppDatabase 表示异步数据库接口 */
export type AppDatabase = AsyncDatabase;

export interface CreateDatabaseOptions {
  /** 数据库类型：不传时从环境变量 DATABASE_TYPE 读取，默认 sqlite */
  type?: 'sqlite' | 'mysql';
}

/**
 * 创建数据库实例。根据 options.type 或 DATABASE_TYPE 环境变量选择 SQLite 或 MySQL。
 * 返回统一异步 API，调用方需 await 所有数据库方法。
 */
export async function createDatabase(
  basePath: string,
  options?: CreateDatabaseOptions
): Promise<AsyncDatabase> {
  const type = (options?.type ?? process.env.DATABASE_TYPE ?? 'sqlite').toLowerCase().trim();
  if (type === 'mysql') {
    const { MysqlDatabase } = await import('./database-mysql.js');
    const db = new MysqlDatabase(basePath);
    await db.init();
    return db;
  }
  return new SqliteDatabaseAdapter(new SqliteAppDatabase(basePath));
}
