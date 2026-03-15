/**
 * MySQL 数据库实现（开发中）：用户、配置、聊天、任务、审计等。
 * 使用 mysql2/promise（异步 API），完整接入需将 database.ts、routes、orchestrator 等改为 async。
 *
 * 环境变量：MYSQL_HOST、MYSQL_PORT、MYSQL_USER、MYSQL_PASSWORD、MYSQL_DATABASE
 *
 * @internal 当前未接入主流程，createDatabase 在 DATABASE_TYPE=mysql 时会抛错。
 */
import mysql from 'mysql2/promise';
import { v4 as uuid } from 'uuid';

// 本地类型与常量（与 database.ts 对齐，完整接入时统一）
interface UserRow { id: string; display_name: string | null; created_at: string; updated_at: string; }
interface ChatSessionRow { id: string; user_id: string; title: string | null; created_at: string; updated_at: string; scene?: string | null; }
interface ChatMessageRow { id: string; session_id: string; role: string; content: string; tool_calls_json: string | null; images_json: string | null; attached_files_json: string | null; created_at: string; }
const HANDLED_EVENTS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Pool = mysql.Pool;

function getPool(): Pool {
  const host = process.env.MYSQL_HOST ?? 'localhost';
  const port = parseInt(process.env.MYSQL_PORT ?? '3306', 10);
  const user = process.env.MYSQL_USER ?? 'root';
  const password = process.env.MYSQL_PASSWORD ?? '';
  const database = process.env.MYSQL_DATABASE ?? 'x_computer';
  return mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true, // 迁移脚本可能包含多条 SQL
  });
}

export class MysqlDatabase {
  private pool: Pool;
  private readonly initPromise: Promise<void>;

  constructor(_basePath: string) {
    this.pool = getPool();
    this.initPromise = this.initSchema();
  }

  /** 初始化 schema，createDatabase 会 await 此方法 */
  async init(): Promise<void> {
    await this.initPromise;
  }

  private async initSchema(): Promise<void> {
    await this._run(`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      display_name VARCHAR(255),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`, [], true);
    await this._run(`CREATE TABLE IF NOT EXISTS user_config (
      user_id VARCHAR(36) NOT NULL,
      \`key\` VARCHAR(255) NOT NULL,
      value LONGTEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, \`key\`)
    )`, [], true);
    await this._run(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      title VARCHAR(512),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      scene VARCHAR(64)
    )`, [], true);
    await this.ensureIndex('chat_sessions', 'idx_chat_sessions_user', 'CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id)', true);

    await this._run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR(36) PRIMARY KEY,
      session_id VARCHAR(36) NOT NULL,
      role VARCHAR(64) NOT NULL,
      content LONGTEXT NOT NULL,
      tool_calls_json LONGTEXT,
      images_json LONGTEXT,
      attached_files_json LONGTEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`, [], true);
    await this.ensureIndex(
      'chat_messages',
      'idx_chat_messages_session',
      'CREATE INDEX idx_chat_messages_session ON chat_messages(session_id)',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS tasks (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      domain VARCHAR(64) NOT NULL,
      title VARCHAR(512) NOT NULL,
      description TEXT,
      status VARCHAR(64) NOT NULL,
      steps_json LONGTEXT,
      result_json LONGTEXT,
      metadata_json LONGTEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`, [], true);
    await this.ensureIndex('tasks', 'idx_tasks_user', 'CREATE INDEX idx_tasks_user ON tasks(user_id)', true);

    await this._run(`CREATE TABLE IF NOT EXISTS audit_log (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36),
      task_id VARCHAR(36) NOT NULL,
      step_id VARCHAR(36),
      type VARCHAR(64) NOT NULL,
      intent VARCHAR(512),
      action VARCHAR(512),
      result TEXT,
      risk_level VARCHAR(64),
      metadata_json LONGTEXT,
      created_at BIGINT NOT NULL
    )`, [], true);
    await this.ensureIndex('audit_log', 'idx_audit_user', 'CREATE INDEX idx_audit_user ON audit_log(user_id)', true);
    await this.ensureIndex('audit_log', 'idx_audit_task', 'CREATE INDEX idx_audit_task ON audit_log(task_id)', true);

    await this._run(`CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      intent VARCHAR(512) NOT NULL,
      run_at BIGINT NOT NULL,
      cron VARCHAR(255),
      created_at BIGINT NOT NULL
    )`, [], true);
    await this.ensureIndex(
      'scheduled_jobs',
      'idx_scheduled_jobs_user',
      'CREATE INDEX idx_scheduled_jobs_user ON scheduled_jobs(user_id)',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS app_backend_kv (
      user_id VARCHAR(36) NOT NULL,
      app_id VARCHAR(64) NOT NULL,
      \`key\` VARCHAR(255) NOT NULL,
      value LONGTEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, app_id, \`key\`)
    )`, [], true);
    await this.ensureIndex(
      'app_backend_kv',
      'idx_app_backend_kv_user_app',
      'CREATE INDEX idx_app_backend_kv_user_app ON app_backend_kv(user_id, app_id)',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS app_backend_queue (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      app_id VARCHAR(64) NOT NULL,
      queue_name VARCHAR(64) NOT NULL,
      payload LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`, [], true);
    await this.ensureIndex(
      'app_backend_queue',
      'idx_app_backend_queue_user_app',
      'CREATE INDEX idx_app_backend_queue_user_app ON app_backend_queue(user_id, app_id, queue_name)',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS app_public_read_tokens (
      token VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      app_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`, [], true);
    await this.ensureIndex(
      'app_public_read_tokens',
      'idx_app_public_read_tokens_user_app',
      'CREATE INDEX idx_app_public_read_tokens_user_app ON app_public_read_tokens(user_id, app_id)',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS auth_accounts (
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (email)
    )`, [], true);
    await this.ensureIndex(
      'auth_accounts',
      'idx_auth_accounts_user',
      'CREATE INDEX idx_auth_accounts_user ON auth_accounts(user_id)',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS emails (
      user_id VARCHAR(36) NOT NULL,
      uid INT NOT NULL,
      message_id VARCHAR(255),
      from_addr VARCHAR(512) NOT NULL,
      to_addr VARCHAR(512),
      subject TEXT NOT NULL,
      date VARCHAR(128),
      text LONGTEXT,
      unseen INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, uid)
    )`, [], true);
    await this.ensureIndex('emails', 'idx_emails_user_date', 'CREATE INDEX idx_emails_user_date ON emails(user_id, date)', true);

    await this._run(`CREATE TABLE IF NOT EXISTS handled_events (
      user_id VARCHAR(36) NOT NULL,
      fingerprint VARCHAR(191) NOT NULL,
      completed_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, fingerprint)
    )`, [], true);
    await this.ensureIndex(
      'handled_events',
      'idx_handled_events_completed',
      'CREATE INDEX idx_handled_events_completed ON handled_events(completed_at)',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS x_board_items (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'todo',
      priority VARCHAR(16) NOT NULL DEFAULT 'medium',
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`, [], true);
    await this.ensureIndex('x_board_items', 'idx_x_board_items_user', 'CREATE INDEX idx_x_board_items_user ON x_board_items(user_id)', true);
    await this.ensureIndex('x_board_items', 'idx_x_board_items_status', 'CREATE INDEX idx_x_board_items_status ON x_board_items(user_id, status)', true);
    await this.ensureColumn('x_board_items', 'source_id', 'ALTER TABLE x_board_items ADD COLUMN source_id VARCHAR(64)', true);

    await this.ensureColumn('chat_sessions', 'scene', 'ALTER TABLE chat_sessions ADD COLUMN scene VARCHAR(64)', true);
    await this.ensureColumn('chat_messages', 'images_json', 'ALTER TABLE chat_messages ADD COLUMN images_json LONGTEXT', true);
    await this.ensureColumn(
      'chat_messages',
      'attached_files_json',
      'ALTER TABLE chat_messages ADD COLUMN attached_files_json LONGTEXT',
      true,
    );

    await this._run(`CREATE TABLE IF NOT EXISTS servers (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port INT NOT NULL DEFAULT 22,
      username VARCHAR(255) NOT NULL,
      auth_type VARCHAR(32) NOT NULL,
      password VARCHAR(512),
      private_key TEXT,
      passphrase VARCHAR(255),
      description TEXT,
      tags TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`, [], true);
    await this.ensureIndex('servers', 'idx_servers_created_at', 'CREATE INDEX idx_servers_created_at ON servers(created_at)', true);
    await this.ensureIndex('servers', 'idx_servers_host', 'CREATE INDEX idx_servers_host ON servers(host)', true);

    await this._run(`CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      message_id VARCHAR(255),
      from_jid VARCHAR(255) NOT NULL,
      to_jid VARCHAR(255),
      text TEXT,
      timestamp BIGINT,
      is_group INT NOT NULL DEFAULT 0,
      unseen INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`, [], true);
    await this.ensureIndex('whatsapp_messages', 'idx_whatsapp_messages_user', 'CREATE INDEX idx_whatsapp_messages_user ON whatsapp_messages(user_id)', true);
    await this.ensureIndex('whatsapp_messages', 'idx_whatsapp_messages_user_time', 'CREATE INDEX idx_whatsapp_messages_user_time ON whatsapp_messages(user_id, timestamp)', true);

    await this._run(`CREATE TABLE IF NOT EXISTS channel_messages (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      channel VARCHAR(64) NOT NULL,
      channel_message_id VARCHAR(255),
      from_id VARCHAR(255) NOT NULL,
      from_name VARCHAR(255),
      chat_id VARCHAR(255),
      text TEXT,
      timestamp BIGINT,
      is_group INT NOT NULL DEFAULT 0,
      unseen INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`, [], true);
    await this.ensureIndex('channel_messages', 'idx_channel_messages_user', 'CREATE INDEX idx_channel_messages_user ON channel_messages(user_id, channel)', true);
    await this.ensureIndex('channel_messages', 'idx_channel_messages_user_time', 'CREATE INDEX idx_channel_messages_user_time ON channel_messages(user_id, channel, timestamp)', true);
  }

  private async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  private async ensureIndex(table: string, indexName: string, createSql: string, skipInitWait = false): Promise<void> {
    const row = await this._queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
      [table, indexName],
      skipInitWait,
    );
    if ((row?.count ?? 0) === 0) {
      await this._run(createSql, [], skipInitWait);
    }
  }

  private async ensureColumn(table: string, column: string, alterSql: string, skipInitWait = false): Promise<void> {
    const row = await this._queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
      skipInitWait,
    );
    if ((row?.count ?? 0) === 0) {
      await this._run(alterSql, [], skipInitWait);
    }
  }

  /**
   * 规范化参数：MySQL 8.0.22+ 与 mysql2 的 prepared statement 对类型严格，
   * 易触发 "Incorrect arguments to mysqld_stmt_execute"。将 undefined→null、number→string 可规避。
   */
  private normalizeParams(params: (string | number | null | undefined)[]): (string | null)[] {
    return params.map((p) => {
      if (p === undefined) return null;
      if (typeof p === 'number') return String(p);
      return p;
    });
  }

  private async _query<T = unknown>(
    sql: string,
    params: (string | number | null)[] = [],
    skipInitWait = false,
  ): Promise<T[]> {
    if (!skipInitWait) await this.waitForInit();
    const normalized = this.normalizeParams(params);
    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(sql, normalized);
    return (rows ?? []) as T[];
  }

  private async _queryOne<T = unknown>(
    sql: string,
    params: (string | number | null)[] = [],
    skipInitWait = false,
  ): Promise<T | undefined> {
    const rows = await this._query<T>(sql, params, skipInitWait);
    return rows[0];
  }

  private async _run(sql: string, params: (string | number | null)[] = [], skipInitWait = false): Promise<void> {
    if (!skipInitWait) await this.waitForInit();
    await this.pool.execute(sql, this.normalizeParams(params));
  }

  /** 数据库类型，供迁移等区分 DDL */
  getDialect(): 'sqlite' | 'mysql' {
    return 'mysql';
  }

  /** 执行 DDL 或单条无参数 SQL（供迁移等） */
  async exec(sql: string): Promise<void> {
    await this.waitForInit();
    // 注意：mysql2 的 execute() 不支持多语句；迁移文件通常包含多条 SQL
    await this.pool.query(sql);
  }

  /** 执行无结果 SQL，参数化。供迁移、订阅等使用。 */
  async run(sql: string, params: (string | number | null)[] = []): Promise<void> {
    await this._run(sql, params);
  }

  /** 查询多行（公开 API，与 SQLite 适配器一致） */
  async query<T = unknown>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
    return this._query<T>(sql, params);
  }

  /** 查询单行（公开 API） */
  async queryOne<T = unknown>(sql: string, params: (string | number | null)[] = []): Promise<T | undefined> {
    return this._queryOne<T>(sql, params);
  }

  ensureUser(userId: string, displayName?: string): Promise<UserRow> {
    return this.queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [userId]).then(async (existing) => {
      if (existing) return existing;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await this._run('INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        userId,
        displayName ?? null,
        now,
        now,
      ]);
      return { id: userId, display_name: displayName ?? null, created_at: now, updated_at: now };
    });
  }

  getUser(userId: string): Promise<UserRow | undefined> {
    return this.queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  }

  getUserIdByEmail(email: string): Promise<string | undefined> {
    return this.queryOne<{ user_id: string }>(
      'SELECT user_id FROM auth_accounts WHERE email = ?',
      [email.toLowerCase().trim()],
    ).then((r) => r?.user_id);
  }

  getPasswordHashByEmail(email: string): Promise<string | undefined> {
    return this.queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM auth_accounts WHERE email = ?',
      [email.toLowerCase().trim()],
    ).then((r) => r?.password_hash);
  }

  createAuthAccount(email: string, passwordHash: string, userId: string): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return this._run(
      'INSERT INTO auth_accounts (email, password_hash, user_id, created_at) VALUES (?, ?, ?, ?)',
      [email.toLowerCase().trim(), passwordHash, userId, now],
    );
  }

  getEmailByUserId(userId: string): Promise<string | undefined> {
    return this.queryOne<{ email: string }>('SELECT email FROM auth_accounts WHERE user_id = ?', [userId]).then(
      (r) => r?.email,
    );
  }

  async mergeUserDataInto(fromUserId: string, toUserId: string): Promise<void> {
    if (fromUserId === toUserId) return;
    const existing = await this._queryOne('SELECT 1 FROM users WHERE id = ?', [toUserId]);
    if (!existing) {
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await this._run('INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
        toUserId,
        null,
        now,
        now,
      ]);
    }
    const fromConfigs = await this.query<{ key: string; value: string; updated_at: string }>(
      'SELECT `key`, value, updated_at FROM user_config WHERE user_id = ?',
      [fromUserId],
    );
    for (const row of fromConfigs) {
      const exists = await this._queryOne('SELECT 1 FROM user_config WHERE user_id = ? AND `key` = ?', [
        toUserId,
        row.key,
      ]);
      if (!exists) {
        await this._run(
          'INSERT INTO user_config (user_id, `key`, value, updated_at) VALUES (?, ?, ?, ?)',
          [toUserId, row.key, row.value, row.updated_at],
        );
      }
    }
    await this._run('DELETE FROM user_config WHERE user_id = ?', [fromUserId]);
    await this._run('UPDATE chat_sessions SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE tasks SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE audit_log SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE scheduled_jobs SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE app_backend_kv SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE app_backend_queue SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE emails SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE whatsapp_messages SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
    await this._run('UPDATE x_board_items SET user_id = ? WHERE user_id = ?', [toUserId, fromUserId]);
  }

  getConfig(userId: string, key: string): Promise<string | undefined> {
    return this.queryOne<{ value: string }>('SELECT value FROM user_config WHERE user_id = ? AND `key` = ?', [
      userId,
      key,
    ]).then((r) => r?.value);
  }

  async getAllConfig(userId: string): Promise<Record<string, string>> {
    const rows = await this.query<{ key: string; value: string }>('SELECT `key`, value FROM user_config WHERE user_id = ?', [userId]);
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key] = r.value;
    return result;
  }

  setConfig(userId: string, key: string, value: string): Promise<void> {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return this._run(
      `INSERT INTO user_config (user_id, \`key\`, value, updated_at) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
      [userId, key, value, now],
    );
  }

  deleteConfig(userId: string, key: string): Promise<void> {
    return this._run('DELETE FROM user_config WHERE user_id = ? AND `key` = ?', [userId, key]);
  }

  async listAdminUsers(options: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<{
    users: Array<{ id: string; displayName: string | null; email: string | null; createdAt: string; updatedAt: string; banned: boolean }>;
    total: number;
  }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const likeArg = search ? `%${search}%` : '';

    const countRows = search
      ? await this.query<{ c: number }>(
          `SELECT COUNT(*) as c FROM users u
           LEFT JOIN auth_accounts a ON a.user_id = u.id
           WHERE LOWER(COALESCE(a.email,'')) LIKE LOWER(?) OR LOWER(COALESCE(u.display_name,'')) LIKE LOWER(?)`,
          [likeArg, likeArg],
        )
      : await this.query<{ c: number }>('SELECT COUNT(*) as c FROM users u');
    const total = countRows[0]?.c ?? 0;

    const listSql = `SELECT u.id, u.display_name, u.created_at, u.updated_at, a.email,
      CASE WHEN uc.value = '1' THEN 1 ELSE 0 END as banned
      FROM users u
      LEFT JOIN auth_accounts a ON a.user_id = u.id
      LEFT JOIN user_config uc ON uc.user_id = u.id AND uc.\`key\` = 'admin_banned'
      ${search ? 'WHERE LOWER(COALESCE(a.email,"")) LIKE LOWER(?) OR LOWER(COALESCE(u.display_name,"")) LIKE LOWER(?)' : ''}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`;
    const listParams = search ? [likeArg, likeArg, limit, offset] : [limit, offset];
    const rows = await this.query<{
      id: string;
      display_name: string | null;
      created_at: string;
      updated_at: string;
      email: string | null;
      banned: number;
    }>(listSql, listParams);

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

  getUserIdsWithConfigKey(key: string): Promise<string[]> {
    return this.query<{ user_id: string }>(
      "SELECT DISTINCT user_id FROM user_config WHERE `key` = ? AND value IS NOT NULL AND value != '' AND value != '{}'",
      [key],
    ).then((rows) => rows.map((r) => r.user_id));
  }

  async createSession(userId: string, title?: string, scene?: string | null): Promise<ChatSessionRow> {
    const id = uuid();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const sceneVal = scene ?? null;
    await this._run(
      'INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at, scene) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, title ?? null, now, now, sceneVal],
    );
    return { id, user_id: userId, title: title ?? null, created_at: now, updated_at: now, scene: sceneVal };
  }

  listSessions(userId: string, limit = 50, scene?: string | null): Promise<ChatSessionRow[]> {
    if (scene === 'x_direct') {
      return this.query<ChatSessionRow>(
        'SELECT * FROM chat_sessions WHERE user_id = ? AND scene = ? ORDER BY updated_at DESC LIMIT ?',
        [userId, 'x_direct', limit],
      );
    }
    if (scene === 'normal_chat' || scene == null || scene === '') {
      return this.query<ChatSessionRow>(
        'SELECT * FROM chat_sessions WHERE user_id = ? AND (scene IS NULL OR scene = ?) ORDER BY updated_at DESC LIMIT ?',
        [userId, 'normal_chat', limit],
      );
    }
    return this.query<ChatSessionRow>(
      'SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
      [userId, limit],
    );
  }

  getSession(sessionId: string): Promise<ChatSessionRow | undefined> {
    return this.queryOne<ChatSessionRow>('SELECT * FROM chat_sessions WHERE id = ?', [sessionId]);
  }

  updateSessionTitle(sessionId: string, title: string): Promise<void> {
    return this._run('UPDATE chat_sessions SET title = ?, updated_at = NOW() WHERE id = ?', [title, sessionId]);
  }

  deleteSession(sessionId: string): Promise<void> {
    return this._run('DELETE FROM chat_messages WHERE session_id = ?', [sessionId]).then(() =>
      this._run('DELETE FROM chat_sessions WHERE id = ?', [sessionId]),
    );
  }

  touchSession(sessionId: string): Promise<void> {
    return this._run('UPDATE chat_sessions SET updated_at = NOW() WHERE id = ?', [sessionId]);
  }

  async addMessage(
    sessionId: string,
    role: string,
    content: string,
    toolCallsJson?: string,
    imagesJson?: string,
    attachedFilesJson?: string,
  ): Promise<ChatMessageRow> {
    const id = uuid();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this._run(
      'INSERT INTO chat_messages (id, session_id, role, content, tool_calls_json, images_json, attached_files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, sessionId, role, content, toolCallsJson ?? null, imagesJson ?? null, attachedFilesJson ?? null, now],
    );
    await this.touchSession(sessionId);
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

  getMessages(sessionId: string, limit = 200): Promise<ChatMessageRow[]> {
    return this.query<ChatMessageRow>(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
      [sessionId, limit],
    );
  }

  deleteMessage(messageId: string): Promise<void> {
    return this._run('DELETE FROM chat_messages WHERE id = ?', [messageId]);
  }

  getRecentMessages(sessionId: string, limit = 20): Promise<ChatMessageRow[]> {
    return this.query<ChatMessageRow>(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
      [sessionId, limit],
    ).then((rows) => rows.reverse());
  }

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
  }): Promise<void> {
    return this._run(
      `INSERT INTO tasks (id, user_id, domain, title, description, status, steps_json, result_json, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         steps_json = VALUES(steps_json),
         result_json = VALUES(result_json),
         metadata_json = VALUES(metadata_json),
         updated_at = VALUES(updated_at)`,
      [
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
      ],
    );
  }

  updateTask(task: {
    id: string;
    status: string;
    steps_json: string;
    result_json?: string | null;
    metadata_json?: string | null;
    updated_at: number;
  }): Promise<void> {
    return this._run(
      'UPDATE tasks SET status = ?, steps_json = ?, result_json = ?, metadata_json = ?, updated_at = ? WHERE id = ?',
      [
        task.status,
        task.steps_json,
        task.result_json ?? null,
        task.metadata_json ?? null,
        task.updated_at,
        task.id,
      ],
    );
  }

  listTasksByUser(
    userId: string,
    limit = 100,
  ): Promise<{ id: string; status: string; title: string; updated_at: number }[]> {
    return this.query<{ id: string; status: string; title: string; updated_at: number }>(
      'SELECT id, status, title, updated_at FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
      [userId, limit],
    );
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
    return this._query(
      'SELECT id, user_id, domain, title, description, status, steps_json, result_json, metadata_json, created_at, updated_at FROM tasks ORDER BY updated_at DESC',
    );
  }

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
  }): Promise<void> {
    return this._run(
      `INSERT INTO audit_log (id, user_id, task_id, step_id, type, intent, action, result, risk_level, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ],
    );
  }

  getAuditByUser(userId: string, limit = 200): Promise<unknown[]> {
    return this._query('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [
      userId,
      limit,
    ]);
  }

  insertScheduledJob(job: {
    id: string;
    user_id: string;
    intent: string;
    run_at: number;
    cron: string | null;
    created_at: number;
  }): Promise<void> {
    return this._run(
      'INSERT INTO scheduled_jobs (id, user_id, intent, run_at, cron, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [job.id, job.user_id, job.intent, job.run_at, job.cron ?? null, job.created_at],
    );
  }

  updateScheduledJobRunAt(id: string, runAt: number): Promise<void> {
    return this._run('UPDATE scheduled_jobs SET run_at = ? WHERE id = ?', [runAt, id]);
  }

  deleteScheduledJob(id: string): Promise<void> {
    return this._run('DELETE FROM scheduled_jobs WHERE id = ?', [id]);
  }

  getAllScheduledJobs(): Promise<
    { id: string; user_id: string; intent: string; run_at: number; cron: string | null; created_at: number }[]
  > {
    return this._query(
      'SELECT id, user_id, intent, run_at, cron, created_at FROM scheduled_jobs ORDER BY run_at ASC',
    );
  }

  hasHandledEvent(userId: string, fingerprint: string): Promise<boolean> {
    const cutoff = Date.now() - HANDLED_EVENTS_RETENTION_MS;
    return this._queryOne(
      'SELECT 1 FROM handled_events WHERE user_id = ? AND fingerprint = ? AND completed_at > ?',
      [userId, fingerprint, cutoff],
    ).then((r) => !!r);
  }

  insertHandledEvent(userId: string, fingerprint: string): Promise<void> {
    const now = Date.now();
    return this._run(
      `INSERT INTO handled_events (user_id, fingerprint, completed_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE completed_at = VALUES(completed_at)`,
      [userId, fingerprint, now],
    );
  }

  pruneHandledEvents(): Promise<void> {
    const cutoff = Date.now() - HANDLED_EVENTS_RETENTION_MS;
    return this._run('DELETE FROM handled_events WHERE completed_at < ?', [cutoff]);
  }

  appBackendKvGet(userId: string, appId: string, key: string): Promise<string | undefined> {
    return this.queryOne<{ value: string }>(
      'SELECT value FROM app_backend_kv WHERE user_id = ? AND app_id = ? AND `key` = ?',
      [userId, appId, key],
    ).then((r) => r?.value);
  }

  appBackendKvSet(userId: string, appId: string, key: string, value: string): Promise<void> {
    return this._run(
      `INSERT INTO app_backend_kv (user_id, app_id, \`key\`, value, updated_at) VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
      [userId, appId, key, value],
    );
  }

  appBackendKvDelete(userId: string, appId: string, key: string): Promise<void> {
    return this._run('DELETE FROM app_backend_kv WHERE user_id = ? AND app_id = ? AND `key` = ?', [
      userId,
      appId,
      key,
    ]);
  }

  appBackendKvList(userId: string, appId: string, prefix?: string): Promise<string[]> {
    if (prefix) {
      return this.query<{ key: string }>(
        'SELECT `key` FROM app_backend_kv WHERE user_id = ? AND app_id = ? AND `key` LIKE ? ORDER BY `key`',
        [userId, appId, `${prefix}%`],
      ).then((rows) => rows.map((r) => r.key));
    }
    return this.query<{ key: string }>(
      'SELECT `key` FROM app_backend_kv WHERE user_id = ? AND app_id = ? ORDER BY `key`',
      [userId, appId],
    ).then((rows) => rows.map((r) => r.key));
  }

  async createAppPublicReadToken(userId: string, appId: string): Promise<string> {
    const token = uuid().replace(/-/g, '');
    await this._run(
      'INSERT INTO app_public_read_tokens (token, user_id, app_id, created_at) VALUES (?, ?, ?, NOW())',
      [token, userId, appId],
    );
    return token;
  }

  resolveAppPublicReadToken(token: string, appId: string): Promise<string | null> {
    return this.queryOne<{ user_id: string }>(
      'SELECT user_id FROM app_public_read_tokens WHERE token = ? AND app_id = ?',
      [token, appId],
    ).then((r) => r?.user_id ?? null);
  }

  appBackendQueuePush(userId: string, appId: string, queueName: string, payload: string): Promise<void> {
    const id = uuid();
    return this._run(
      'INSERT INTO app_backend_queue (id, user_id, app_id, queue_name, payload, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [id, userId, appId, queueName, payload],
    );
  }

  async appBackendQueuePop(userId: string, appId: string, queueName: string): Promise<string | null> {
    const row = await this.queryOne<{ id: string; payload: string }>(
      'SELECT id, payload FROM app_backend_queue WHERE user_id = ? AND app_id = ? AND queue_name = ? ORDER BY created_at ASC LIMIT 1',
      [userId, appId, queueName],
    );
    if (!row) return null;
    await this._run('DELETE FROM app_backend_queue WHERE id = ?', [row.id]);
    return row.payload;
  }

  appBackendQueueLen(userId: string, appId: string, queueName: string): Promise<number> {
    return this.queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM app_backend_queue WHERE user_id = ? AND app_id = ? AND queue_name = ?',
      [userId, appId, queueName],
    ).then((r) => r?.c ?? 0);
  }

  async insertEmails(
    userId: string,
    emails: {
      uid: number;
      messageId?: string;
      from: string;
      to?: string;
      subject: string;
      date?: string;
      text?: string;
      unseen?: boolean;
    }[],
  ): Promise<void> {
    for (const e of emails) {
      await this._run(
        `INSERT INTO emails (user_id, uid, message_id, from_addr, to_addr, subject, date, text, unseen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE message_id = VALUES(message_id), from_addr = VALUES(from_addr), to_addr = VALUES(to_addr),
         subject = VALUES(subject), date = VALUES(date), text = VALUES(text), unseen = VALUES(unseen)`,
        [
          userId,
          e.uid,
          e.messageId ?? null,
          e.from,
          e.to ?? null,
          e.subject,
          e.date ?? null,
          e.text ?? null,
          e.unseen ? 1 : 0,
        ],
      );
    }
  }

  getEmailsByUser(
    userId: string,
    limit = 50,
  ): Promise<
    { uid: number; messageId?: string; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean }[]
  > {
    return this.query<{
      uid: number;
      message_id: string | null;
      from_addr: string;
      to_addr: string | null;
      subject: string;
      date: string | null;
      text: string | null;
      unseen: number;
    }>(
      'SELECT uid, message_id, from_addr, to_addr, subject, date, text, unseen FROM emails WHERE user_id = ? ORDER BY date DESC, uid DESC LIMIT ?',
      [userId, limit],
    ).then((rows) =>
      rows.map((r) => ({
        uid: r.uid,
        messageId: r.message_id ?? undefined,
        from: r.from_addr,
        to: r.to_addr ?? undefined,
        subject: r.subject,
        date: r.date ?? undefined,
        text: r.text ?? undefined,
        unseen: r.unseen === 1,
      })),
    );
  }

  getEmailByUid(
    userId: string,
    uid: number,
  ): Promise<{ uid: number; from: string; to?: string; subject: string; date?: string; text?: string; unseen: boolean } | null> {
    return this.queryOne<{
      uid: number;
      from_addr: string;
      to_addr: string | null;
      subject: string;
      date: string | null;
      text: string | null;
      unseen: number;
    }>('SELECT uid, from_addr, to_addr, subject, date, text, unseen FROM emails WHERE user_id = ? AND uid = ?', [
      userId,
      uid,
    ]).then((row) =>
      row
        ? {
            uid: row.uid,
            from: row.from_addr,
            to: row.to_addr ?? undefined,
            subject: row.subject,
            date: row.date ?? undefined,
            text: row.text ?? undefined,
            unseen: row.unseen === 1,
          }
        : null,
    );
  }

  // ── WhatsApp 消息（R052）────────────────────────────────────

  insertWhatsAppMessage(
    userId: string,
    msg: { id: string; messageId?: string; fromJid: string; toJid?: string; text?: string; timestamp?: number; isGroup?: boolean },
  ): Promise<void> {
    return this._run(
      `INSERT INTO whatsapp_messages (id, user_id, message_id, from_jid, to_jid, text, timestamp, is_group, unseen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE message_id = VALUES(message_id), from_jid = VALUES(from_jid), to_jid = VALUES(to_jid),
       text = VALUES(text), timestamp = VALUES(timestamp), is_group = VALUES(is_group), unseen = 1`,
      [
        msg.id,
        userId,
        msg.messageId ?? null,
        msg.fromJid,
        msg.toJid ?? null,
        msg.text ?? null,
        msg.timestamp ?? null,
        msg.isGroup ? 1 : 0,
      ],
    );
  }

  getWhatsAppMessagesByUser(
    userId: string,
    limit = 50,
  ): Promise<{ id: string; messageId?: string; fromJid: string; toJid?: string; text?: string; timestamp?: number; isGroup: boolean; unseen: boolean; createdAt: string }[]> {
    return this._query<{
      id: string;
      message_id: string | null;
      from_jid: string;
      to_jid: string | null;
      text: string | null;
      timestamp: number | null;
      is_group: number;
      unseen: number;
      created_at: string;
    }>(
      'SELECT id, message_id, from_jid, to_jid, text, timestamp, is_group, unseen, created_at FROM whatsapp_messages WHERE user_id = ? ORDER BY timestamp DESC, created_at DESC LIMIT ?',
      [userId, limit],
    ).then((rows) =>
      rows.map((r) => ({
        id: r.id,
        messageId: r.message_id ?? undefined,
        fromJid: r.from_jid,
        toJid: r.to_jid ?? undefined,
        text: r.text ?? undefined,
        timestamp: r.timestamp ?? undefined,
        isGroup: r.is_group === 1,
        unseen: r.unseen === 1,
        createdAt: r.created_at,
      })),
    );
  }

  // ── Channel Messages (Telegram / Discord / Slack 等) ─────

  async insertChannelMessage(
    userId: string,
    msg: { id: string; channel: string; channelMessageId?: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup?: boolean },
  ): Promise<void> {
    await this._run(
      `INSERT INTO channel_messages (id, user_id, channel, channel_message_id, from_id, from_name, chat_id, text, timestamp, is_group, unseen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE from_id = VALUES(from_id), from_name = VALUES(from_name), text = VALUES(text), timestamp = VALUES(timestamp), is_group = VALUES(is_group), unseen = 1`,
      [msg.id, userId, msg.channel, msg.channelMessageId ?? null, msg.fromId, msg.fromName ?? null, msg.chatId ?? null, msg.text ?? null, msg.timestamp ?? null, msg.isGroup ? 1 : 0],
    );
  }

  async getChannelMessagesByUser(
    userId: string,
    channel: string,
    limit = 50,
  ): Promise<{ id: string; channelMessageId?: string; fromId: string; fromName?: string; chatId?: string; text?: string; timestamp?: number; isGroup: boolean; unseen: boolean; createdAt: string }[]> {
    return this._query<{
      id: string; channel_message_id: string | null; from_id: string; from_name: string | null; chat_id: string | null; text: string | null; timestamp: number | null; is_group: number; unseen: number; created_at: string;
    }>(
      'SELECT id, channel_message_id, from_id, from_name, chat_id, text, timestamp, is_group, unseen, created_at FROM channel_messages WHERE user_id = ? AND channel = ? ORDER BY timestamp DESC, created_at DESC LIMIT ?',
      [userId, channel, limit],
    ).then((rows) =>
      rows.map((r) => ({
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
      })),
    );
  }

  // ── X Board (任务看板) ────────────────────────────────────

  async listBoardItems(userId: string): Promise<{ id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }[]> {
    return this.query<{ id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }>(
      'SELECT id, title, description, status, priority, sort_order, created_at, updated_at FROM x_board_items WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC',
      [userId],
    );
  }

  async getBoardItem(id: string): Promise<{ id: string; user_id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string } | undefined> {
    return this.queryOne<{ id: string; user_id: string; title: string; description: string | null; status: string; priority: string; sort_order: number; created_at: string; updated_at: string }>(
      'SELECT * FROM x_board_items WHERE id = ?',
      [id],
    ).then((r) => r ?? undefined);
  }

  async insertBoardItem(item: { id: string; user_id: string; title: string; description?: string; status: string; priority: string; sort_order?: number; source_id?: string }): Promise<void> {
    await this._run(
      'INSERT INTO x_board_items (id, user_id, title, description, status, priority, sort_order, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [item.id, item.user_id, item.title, item.description ?? null, item.status, item.priority, item.sort_order ?? 0, item.source_id ?? null],
    );
  }

  async getBoardItemBySourceId(userId: string, sourceId: string): Promise<{ id: string } | undefined> {
    return this.queryOne<{ id: string }>('SELECT id FROM x_board_items WHERE user_id = ? AND source_id = ?', [userId, sourceId]).then((r) => r ?? undefined);
  }

  async updateBoardItem(id: string, fields: { title?: string; description?: string; status?: string; priority?: string; sort_order?: number }): Promise<void> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: (string | number | null)[] = [];
    if (fields.title !== undefined) { sets.push('title = ?'); params.push(fields.title); }
    if (fields.description !== undefined) { sets.push('description = ?'); params.push(fields.description); }
    if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status); }
    if (fields.priority !== undefined) { sets.push('priority = ?'); params.push(fields.priority); }
    if (fields.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(fields.sort_order); }
    params.push(id);
    await this._run(`UPDATE x_board_items SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteBoardItem(id: string): Promise<void> {
    await this._run('DELETE FROM x_board_items WHERE id = ?', [id]);
  }

  close(): void {
    this.pool.end();
  }
}
