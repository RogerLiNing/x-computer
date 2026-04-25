/**
 * OAuth 2.0 Service (PKCE Flow)
 * 支持 Google 和 GitHub OAuth 登录
 */

import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

// ── 类型定义 ──────────────────────────────────────────────────────────

export type OAuthProvider = 'google' | 'github';

export interface OAuthState {
  state: string;
  provider: OAuthProvider;
  codeVerifier: string;
  redirectUri?: string;
  userId?: string;
  createdAt: number;
  expiresAt: number;
}

export interface OAuthUserInfo {
  provider: OAuthProvider;
  providerUserId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

export interface OAuthConfig {
  google?: {
    clientId: string;
    clientSecret: string;
  };
  github?: {
    clientId: string;
    clientSecret: string;
  };
  callbackUrl: string; // e.g. https://yourdomain.com/oauth/callback
}

// ── PKCE 工具 ────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash.toString('base64url');
}

// ── OAuth Service ──────────────────────────────────────────────────────

export class OAuthService {
  constructor(
    private db: AppDatabase,
    private config: OAuthConfig,
  ) {}

  /** 检查提供商是否已配置 */
  isProviderEnabled(provider: OAuthProvider): boolean {
    return !!(this.config[provider]?.clientId && this.config[provider]?.clientSecret);
  }

  /**
   * 启动 OAuth 流程：生成 state + code_verifier，存入 DB，返回授权 URL
   */
  async initiateFlow(
    provider: OAuthProvider,
    redirectUri?: string,
    userId?: string,
  ): Promise<{ authUrl: string; state: string }> {
    const cfg = this.config[provider];
    if (!cfg) throw new Error(`${provider} OAuth not configured`);

    const codeVerifier = generateCodeVerifier();
    const state = generateState();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 分钟过期

    // 存入数据库
    await this.db.run(
      `INSERT OR REPLACE INTO oauth_states (state, provider, code_verifier, redirect_uri, user_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [state, provider, codeVerifier, redirectUri ?? null, userId ?? null, now, expiresAt],
    );

    // 构建授权 URL
    const authUrl = this.buildAuthUrl(provider, {
      clientId: cfg.clientId,
      codeChallenge,
      state,
    });

    serverLogger.info('oauth', `OAuth flow initiated`, `provider=${provider} state=${state.slice(0, 8)}...`);
    return { authUrl, state };
  }

  /**
   * 处理 OAuth 回调：验证 state，换 code → access_token，获取用户信息
   * 返回 provider user info（不包含 JWT，需外部自行颁发）
   */
  async handleCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
  ): Promise<OAuthUserInfo & { tempToken: string }> {
    // 1. 验证 state
    const row = await this.db.queryOne<{
      state: string;
      provider: string;
      code_verifier: string;
      user_id: string | null;
      expires_at: number;
    }>(`SELECT * FROM oauth_states WHERE state = ? AND provider = ?`, [state, provider]);

    if (!row) {
      throw new Error('Invalid or missing OAuth state');
    }
    if (Date.now() > row.expires_at) {
      await this.db.run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
      throw new Error('OAuth state expired, please try again');
    }

    const codeVerifier = row.code_verifier;

    // 删除 state（一次性使用）
    await this.db.run(`DELETE FROM oauth_states WHERE state = ?`, [state]);

    // 2. 换 token
    const tokens = await this.exchangeCode(provider, code, codeVerifier);

    // 3. 获取用户信息
    const userInfo = await this.fetchUserInfo(provider, tokens.accessToken);

    // 4. 生成临时 token（后续颁发正式 JWT）
    const tempToken = uuid();

    serverLogger.info('oauth', `OAuth callback success`, `provider=${provider} userId=${userInfo.providerUserId}`);
    return { ...userInfo, tempToken };
  }

  /** 关联 OAuth 账号到已有用户 */
  async linkAccount(userId: string, userInfo: OAuthUserInfo): Promise<string> {
    const id = uuid();
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO oauth_accounts (id, user_id, provider, provider_user_id, email, name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_user_id) DO UPDATE SET
         email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`,
      [id, userId, userInfo.provider, userInfo.providerUserId, userInfo.email ?? null, userInfo.name ?? null, userInfo.avatarUrl ?? null, now, now],
    );
    return id;
  }

  /** 根据 provider + providerUserId 查找本地用户 */
  async findUserByOAuth(userInfo: OAuthUserInfo): Promise<string | null> {
    const row = await this.db.queryOne<{ user_id: string }>(
      `SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?`,
      [userInfo.provider, userInfo.providerUserId],
    );
    return row?.user_id ?? null;
  }

  /** 根据邮箱查找用户（用于账号绑定/去重） */
  async findUserByEmail(email: string): Promise<string | null> {
    const row = await this.db.queryOne<{ user_id: string }>(
      `SELECT user_id FROM auth_accounts WHERE email = ?`,
      [email.toLowerCase()],
    );
    return row?.user_id ?? null;
  }

  /** 清理过期 state（定时调用） */
  async cleanupExpiredStates(): Promise<void> {
    const now = Date.now();
    await this.db.run(`DELETE FROM oauth_states WHERE expires_at < ?`, [now]);
  }

  // ── 私有方法 ──────────────────────────────────────────────────────

  private buildAuthUrl(provider: OAuthProvider, params: {
    clientId: string;
    codeChallenge: string;
    state: string;
  }): string {
    const { clientId, codeChallenge, state } = params;
    const callbackUrl = this.config.callbackUrl;

    if (provider === 'google') {
      const scopes = encodeURIComponent([
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ].join(' '));
      return [
        'https://accounts.google.com/o/oauth2/v2/auth',
        `?client_id=${clientId}`,
        `&redirect_uri=${encodeURIComponent(callbackUrl)}`,
        `&response_type=code`,
        `&scope=${scopes}`,
        `&access_type=online`,
        `&prompt=select_account`,
        `&code_challenge=${codeChallenge}`,
        `&code_challenge_method=S256`,
        `&state=${state}`,
      ].join('');
    }

    if (provider === 'github') {
      const scopes = encodeURIComponent('read:user user:email');
      return [
        'https://github.com/login/oauth/authorize',
        `?client_id=${clientId}`,
        `&redirect_uri=${encodeURIComponent(callbackUrl)}`,
        `&scope=${scopes}`,
        `&state=${state}`,
      ].join('');
    }

    throw new Error(`Unknown provider: ${provider}`);
  }

  private async exchangeCode(
    provider: OAuthProvider,
    code: string,
    codeVerifier: string,
  ): Promise<{ accessToken: string; refreshToken?: string; idToken?: string }> {
    const cfg = this.config[provider];
    if (!cfg) throw new Error(`${provider} OAuth not configured`);

    if (provider === 'google') {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.config.callbackUrl,
          code_verifier: codeVerifier,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        serverLogger.error('oauth', `Google token exchange failed`, err);
        throw new Error('Failed to exchange code with Google');
      }

      const data = await res.json() as { access_token: string; refresh_token?: string; id_token?: string };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
      };
    }

    if (provider === 'github') {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: this.config.callbackUrl,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        serverLogger.error('oauth', `GitHub token exchange failed`, err);
        throw new Error('Failed to exchange code with GitHub');
      }

      const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
      if (data.error) {
        throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error}`);
      }
      if (!data.access_token) {
        throw new Error('No access token from GitHub');
      }
      return { accessToken: data.access_token };
    }

    throw new Error(`Unknown provider: ${provider}`);
  }

  private async fetchUserInfo(provider: OAuthProvider, accessToken: string): Promise<OAuthUserInfo> {
    if (provider === 'google') {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch Google user info');
      const data = await res.json() as { id: string; email?: string; name?: string; picture?: string };
      return {
        provider: 'google',
        providerUserId: data.id,
        email: data.email,
        name: data.name,
        avatarUrl: data.picture,
      };
    }

    if (provider === 'github') {
      // 获取用户信息
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'X-Computer',
        },
      });
      if (!userRes.ok) throw new Error('Failed to fetch GitHub user info');
      const userData = await userRes.json() as { id: number; login: string; name?: string; avatar_url?: string; email?: string };

      // 如果没有公开邮箱，尝试获取邮件列表
      let email = userData.email;
      if (!email) {
        const emailRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'X-Computer',
          },
        });
        if (emailRes.ok) {
          const emails = await emailRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
          const primaryEmail = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
          email = primaryEmail?.email;
        }
      }

      return {
        provider: 'github',
        providerUserId: String(userData.id),
        email,
        name: userData.name ?? userData.login,
        avatarUrl: userData.avatar_url,
      };
    }

    throw new Error(`Unknown provider: ${provider}`);
  }
}
