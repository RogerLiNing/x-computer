/**
 * OAuth 回调路由：处理 Google/GitHub OAuth 授权后的回调
 *
 * 流程：
 * 1. OAuth Provider 授权后重定向到 /oauth/callback/google?code=xxx&state=yyy
 * 2. 后端验证 state，换 code → access_token，获取用户信息
 * 3. 创建/关联本地用户，生成 userId
 * 4. 重定向到前端回调页：/?oauth_callback=1&userId=xxx
 *
 * 此路由在 userContextMiddleware 之前挂载，无需 X-User-Id
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import type { XConfigOAuth } from '../config/defaultConfig.js';
import { serverLogger } from '../observability/ServerLogger.js';

interface OAuthCallbackRow {
  state: string;
  provider: string;
  code_verifier: string;
  user_id: string | null;
  expires_at: number;
}

// ── 回调路由工厂 ───────────────────────────────────────────────────

export function createOAuthCallbackRouter(
  db: AppDatabase,
  oauthConfig: XConfigOAuth | undefined,
): Router {
  const router = Router();

  router.get('/google/callback', async (req: Request, res: Response) => {
    await handleOAuthCallback(db, oauthConfig, 'google', req, res);
  });

  router.get('/github/callback', async (req: Request, res: Response) => {
    await handleOAuthCallback(db, oauthConfig, 'github', req, res);
  });

  return router;
}

// ── 统一回调处理 ───────────────────────────────────────────────────

async function handleOAuthCallback(
  db: AppDatabase,
  oauthConfig: XConfigOAuth | undefined,
  provider: 'google' | 'github',
  req: Request,
  res: Response,
): Promise<void> {
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

  if (error) {
    const frontendUrl = buildFrontendCallbackUrl(undefined, `oauth_error=${encodeURIComponent(error_description ?? error)}`);
    serverLogger.warn('oauth', `OAuth callback error`, `provider=${provider} error=${error} description=${error_description}`);
    res.redirect(frontendUrl);
    return;
  }

  if (!code || !state) {
    serverLogger.error('oauth', `OAuth callback missing params`, `provider=${provider}`);
    res.redirect(buildFrontendCallbackUrl(undefined, 'oauth_error=missing_params'));
    return;
  }

  if (!oauthConfig || !oauthConfig[provider]) {
    serverLogger.error('oauth', `OAuth provider not configured`, `provider=${provider}`);
    res.redirect(buildFrontendCallbackUrl(undefined, 'oauth_error=not_configured'));
    return;
  }

  const cfg = oauthConfig[provider]!;
  const callbackBase = oauthConfig.callbackUrl.replace(/\/oauth\/callback$/, '');

  try {
    const row = await db.queryOne<OAuthCallbackRow>(
      `SELECT * FROM oauth_states WHERE state = ? AND provider = ?`,
      [state, provider],
    );

    if (!row) {
      throw new Error('Invalid or missing state');
    }
    if (Date.now() > row.expires_at) {
      await db.run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
      throw new Error('State expired');
    }
    const codeVerifier = row.code_verifier;
    await db.run(`DELETE FROM oauth_states WHERE state = ?`, [state]);

    const tokens = await exchangeCode(provider, code, codeVerifier, cfg, `${callbackBase}/oauth/callback`);
    const userInfo = await fetchUserInfo(provider, tokens.accessToken);
    const userId = await resolveUser(db, provider, userInfo);

    serverLogger.info('oauth', `OAuth login success`, `provider=${provider} userId=${userId}`);
    res.redirect(buildFrontendCallbackUrl(userId));
  } catch (err: unknown) {
    serverLogger.error('oauth', `OAuth callback failed`, `provider=${provider} error=${err instanceof Error ? err.message : String(err)}`);
    res.redirect(buildFrontendCallbackUrl(undefined, `oauth_error=${encodeURIComponent(err instanceof Error ? err.message : 'unknown_error')}`));
  }
}

// ── Token 交换 ─────────────────────────────────────────────────────

async function exchangeCode(
  provider: 'google' | 'github',
  code: string,
  codeVerifier: string,
  cfg: { clientId: string; clientSecret: string },
  redirectUri: string,
): Promise<{ accessToken: string }> {
  if (provider === 'google') {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google token exchange failed: ${err}`);
    }
    const data = await res.json() as { access_token: string };
    return { accessToken: data.access_token };
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error('GitHub token exchange failed');
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (data.error) throw new Error(`GitHub error: ${data.error_description ?? data.error}`);
  if (!data.access_token) throw new Error('No access token from GitHub');
  return { accessToken: data.access_token };
}

// ── 获取用户信息 ───────────────────────────────────────────────────

async function fetchUserInfo(
  provider: 'google' | 'github',
  accessToken: string,
): Promise<{ provider: string; providerUserId: string; email?: string; name?: string; avatarUrl?: string }> {
  if (provider === 'google') {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('Failed to fetch Google user info');
    const data = await res.json() as { id: string; email?: string; name?: string; picture?: string };
    return { provider, providerUserId: data.id, email: data.email, name: data.name, avatarUrl: data.picture };
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'X-Computer' },
  });
  if (!userRes.ok) throw new Error('Failed to fetch GitHub user info');
  const userData = await userRes.json() as { id: number; login: string; name?: string; avatar_url?: string; email?: string };

  let email = userData.email;
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'X-Computer' },
    });
    if (emailRes.ok) {
      const emails = await emailRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primaryEmail = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      email = primaryEmail?.email;
    }
  }

  return { provider, providerUserId: String(userData.id), email, name: userData.name ?? userData.login, avatarUrl: userData.avatar_url };
}

// ── 用户解析 ───────────────────────────────────────────────────────

async function resolveUser(
  db: AppDatabase,
  provider: 'google' | 'github',
  userInfo: { provider: string; providerUserId: string; email?: string; name?: string; avatarUrl?: string },
): Promise<string> {
  // 1. 检查是否已关联
  const existing = await db.queryOne<{ user_id: string }>(
    `SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?`,
    [provider, userInfo.providerUserId],
  );
  if (existing) {
    await db.run(
      `UPDATE oauth_accounts SET email = ?, name = ?, avatar_url = ?, updated_at = ? WHERE provider = ? AND provider_user_id = ?`,
      [userInfo.email ?? null, userInfo.name ?? null, userInfo.avatarUrl ?? null, Date.now(), provider, userInfo.providerUserId],
    );
    return existing.user_id;
  }

  // 2. 检查邮箱是否已注册
  let userId: string;
  if (userInfo.email) {
    const byEmail = await db.queryOne<{ user_id: string }>(
      `SELECT user_id FROM auth_accounts WHERE email = ?`,
      [userInfo.email.toLowerCase()],
    );
    if (byEmail) {
      userId = byEmail.user_id;
    } else {
      userId = uuid();
      await db.ensureUser(userId);
    }
  } else {
    userId = uuid();
    await db.ensureUser(userId);
  }

  // 3. 关联 OAuth 账号
  const oauthId = uuid();
  const now = Date.now();
  await db.run(
    `INSERT OR REPLACE INTO oauth_accounts (id, user_id, provider, provider_user_id, email, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [oauthId, userId, provider, userInfo.providerUserId, userInfo.email ?? null, userInfo.name ?? null, userInfo.avatarUrl ?? null, now, now],
  );

  // 4. 如果邮箱已存在但没有 OAuth 关联，也创建一个无密码的 auth_account 记录
  if (userInfo.email) {
    const hasAccount = await db.queryOne<{ email: string }>(
      `SELECT email FROM auth_accounts WHERE email = ?`,
      [userInfo.email.toLowerCase()],
    );
    if (!hasAccount) {
      await db.run(
        `INSERT OR IGNORE INTO auth_accounts (email, password_hash, user_id, created_at)
         VALUES (?, ?, ?, ?)`,
        [userInfo.email.toLowerCase(), `oauth:${provider}`, userId, new Date().toISOString()],
      );
    }
  }

  return userId;
}

// ── 前端回调 URL ───────────────────────────────────────────────────

/**
 * 构建前端回调 URL：用户授权成功/失败后重定向到此处
 * 前端 App.tsx 监听 URL 参数，完成登录状态设置
 */
function buildFrontendCallbackUrl(userId?: string, error?: string): string {
  const base = process.env.OAUTH_FRONTEND_BASE_URL ?? 'http://localhost:5173';
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  if (error) params.set('error', error);
  const qs = params.toString();
  return `${base}/oauth-callback${qs ? `?${qs}` : ''}`;
}
