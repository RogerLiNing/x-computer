/**
 * 邮箱验证服务
 * 处理邮箱验证码的生成、发送和验证
 */

import crypto from 'crypto';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export interface VerificationCode {
  email: string;
  code: string;
  expiresAt: number;
  purpose: 'email_verification' | 'password_reset';
  createdAt: number;
}

export class EmailVerificationService {
  private initPromise: Promise<void>;

  constructor(private db: AsyncDatabase) {
    this.initPromise = this.initSchema();
  }

  private async initSchema(): Promise<void> {
    const dialect = this.db.getDialect();
    if (dialect === 'mysql') {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS verification_codes (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          code VARCHAR(16) NOT NULL,
          purpose VARCHAR(64) NOT NULL,
          expires_at BIGINT NOT NULL,
          used INT NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL
        );
      `);
      try {
        await this.db.exec('CREATE INDEX idx_verification_codes_email ON verification_codes(email)');
      } catch (e: unknown) {
        if ((e as { errno?: number })?.errno !== 1061) throw e; // 1061 = ER_DUP_KEYNAME
      }
      try {
        await this.db.exec('CREATE INDEX idx_verification_codes_code ON verification_codes(code)');
      } catch (e: unknown) {
        if ((e as { errno?: number })?.errno !== 1061) throw e;
      }
    } else {
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS verification_codes (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          code TEXT NOT NULL,
          purpose TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
        CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON verification_codes(code);
      `);
    }
  }

  private generateCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  async createVerificationCode(
    email: string,
    purpose: 'email_verification' | 'password_reset',
    expiresInMinutes: number = 15
  ): Promise<string> {
    await this.initPromise;
    const code = this.generateCode();
    const id = `vc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    const expiresAt = now + expiresInMinutes * 60 * 1000;

    await this.db.run(
      `INSERT INTO verification_codes (id, email, code, purpose, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, email.toLowerCase(), code, purpose, expiresAt, now]
    );

    serverLogger.info('auth/verification', `创建验证码`, `email=${email} purpose=${purpose}`);
    return code;
  }

  async verifyCode(
    email: string,
    code: string,
    purpose: 'email_verification' | 'password_reset'
  ): Promise<boolean> {
    await this.initPromise;
    const now = Date.now();

    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM verification_codes
       WHERE email = ? AND code = ? AND purpose = ? AND used = 0 AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase(), code, purpose, now]
    );

    if (!row) {
      serverLogger.warn('auth/verification', `验证码无效或已过期`, `email=${email} purpose=${purpose}`);
      return false;
    }

    await this.db.run(`UPDATE verification_codes SET used = 1 WHERE id = ?`, [row.id]);
    serverLogger.info('auth/verification', `验证码验证成功`, `email=${email} purpose=${purpose}`);
    return true;
  }

  async cleanupExpiredCodes(): Promise<void> {
    await this.initPromise;
    const now = Date.now();
    await this.db.run(`DELETE FROM verification_codes WHERE expires_at < ?`, [now]);
  }

  async isInCooldown(
    email: string,
    purpose: 'email_verification' | 'password_reset',
    cooldownMinutes: number = 1
  ): Promise<boolean> {
    await this.initPromise;
    const cooldownTime = Date.now() - cooldownMinutes * 60 * 1000;

    const row = await this.db.queryOne(
      `SELECT created_at FROM verification_codes
       WHERE email = ? AND purpose = ? AND created_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase(), purpose, cooldownTime]
    );

    return !!row;
  }
}
