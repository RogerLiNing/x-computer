/**
 * 增强认证路由
 * 邮箱验证、密码重置、OAuth 等
 */

import { Router } from 'express';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import type { XConfigOAuth } from '../config/defaultConfig.js';
import { EmailVerificationService } from '../auth/emailVerification.js';
import { PasswordResetService } from '../auth/passwordReset.js';
import { sendSystemEmail } from '../email/emailService.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createAuthEnhancedRoutes(
  db: AppDatabase,
  oauthConfig?: XConfigOAuth,
): Router {
  const router = Router();
  const verificationService = new EmailVerificationService(db);
  const passwordResetService = new PasswordResetService(db);

  /**
   * POST /api/auth/send-verification-code
   * 发送邮箱验证码
   */
  router.post('/send-verification-code', async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    try {
      if (await verificationService.isInCooldown(email, 'email_verification', 1)) {
        return res.status(429).json({
          error: 'Too many requests',
          message: 'Please wait before requesting another code',
        });
      }

      const code = await verificationService.createVerificationCode(email, 'email_verification', 15);

      const emailResult = await sendSystemEmail({
        to: email,
        subject: 'X-Computer 邮箱验证码',
        body: `您的验证码是：${code}，15 分钟内有效。\n\n如果不是您本人操作，请忽略此邮件。`,
        html: false,
      });

      if (!emailResult.ok) {
        serverLogger.warn('auth/verification', `验证码邮件发送失败`, `email=${email} error=${emailResult.error}`);
        // 仍然返回成功，但记录警告（避免攻击者通过响应判断是否配置了 SMTP）
        return res.json({
          success: true,
          message: emailResult.error ?? '验证码已生成',
        });
      }

      serverLogger.info('auth/verification', `验证码已发送至邮箱`, `email=${email}`);
      res.json({
        success: true,
        message: 'Verification code sent successfully',
        // 开发模式下返回验证码，生产环境不返回
        code: process.env.NODE_ENV === 'development' ? code : undefined,
      });
    } catch (err) {
      serverLogger.error('auth/verification', `发送验证码失败`, `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to send verification code' });
    }
  });

  /**
   * POST /api/auth/verify-email
   * 验证邮箱
   */
  router.post('/verify-email', async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    try {
      const isValid = await verificationService.verifyCode(email, code, 'email_verification');

      if (!isValid) {
        return res.status(400).json({
          error: 'Invalid or expired code',
          message: 'The verification code is invalid or has expired',
        });
      }

      await db.run(`UPDATE auth_accounts SET created_at = created_at WHERE email = ?`, [email.toLowerCase()]);

      res.json({
        success: true,
        message: 'Email verified successfully',
      });
    } catch (err) {
      serverLogger.error('auth/verification', `邮箱验证失败`, `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to verify email' });
    }
  });

  /**
   * POST /api/auth/request-password-reset
   * 请求密码重置
   */
  router.post('/request-password-reset', async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    try {
      const result = await passwordResetService.requestPasswordReset(email);

      // 为了安全，总是返回成功消息（不暴露邮箱是否存在）
      res.json({
        success: true,
        message: 'If this email exists, a reset code has been sent',
      });
    } catch (err) {
      serverLogger.error('auth/password-reset', `密码重置请求失败`, `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to process password reset request' });
    }
  });

  /**
   * POST /api/auth/reset-password
   * 重置密码
   */
  router.post('/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    try {
      const success = await passwordResetService.resetPassword(email, code, newPassword);

      if (!success) {
        return res.status(400).json({
          error: 'Invalid or expired code',
          message: 'The reset code is invalid or has expired',
        });
      }

      res.json({
        success: true,
        message: 'Password reset successfully',
      });
    } catch (err) {
      serverLogger.error('auth/password-reset', `密码重置失败`, `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  /**
   * GET /api/auth/oauth/google/url
   * 获取 Google OAuth 授权 URL（PKCE 流程）
   */
  router.get('/oauth/google/url', async (_req, res) => {
    if (!oauthConfig?.google) {
      res.status(503).json({ error: 'Google OAuth not configured' });
      return;
    }
    try {
      const { authUrl, state } = await initiateOAuthFlow(db, oauthConfig, 'google');
      res.json({ authUrl, state });
    } catch (err) {
      serverLogger.error('oauth', `Failed to initiate Google OAuth`, `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to initiate OAuth flow' });
    }
  });

  /**
   * GET /api/auth/oauth/github/url
   * 获取 GitHub OAuth 授权 URL（PKCE 流程）
   */
  router.get('/oauth/github/url', async (_req, res) => {
    if (!oauthConfig?.github) {
      res.status(503).json({ error: 'GitHub OAuth not configured' });
      return;
    }
    try {
      const { authUrl, state } = await initiateOAuthFlow(db, oauthConfig, 'github');
      res.json({ authUrl, state });
    } catch (err) {
      serverLogger.error('oauth', `Failed to initiate GitHub OAuth`, `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to initiate OAuth flow' });
    }
  });

  /**
   * GET /api/auth/oauth/status
   * 查询 OAuth 提供商配置状态（前端据此决定是否显示 OAuth 按钮）
   */
  router.get('/oauth/status', (_req, res) => {
    res.json({
      google: !!(oauthConfig?.google?.clientId),
      github: !!(oauthConfig?.github?.clientId),
    });
  });

  return router;
}

// ── OAuth 启动辅助函数 ─────────────────────────────────────────────

type OAuthProvider = 'google' | 'github';

async function initiateOAuthFlow(
  db: AppDatabase,
  oauthConfig: XConfigOAuth,
  provider: OAuthProvider,
): Promise<{ authUrl: string; state: string }> {
  const cfg = oauthConfig[provider]!;
  const callbackBase = oauthConfig.callbackUrl.replace(/\/oauth\/callback$/, '');

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = hash.toString('base64url');
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000; // 10 分钟

  await db.run(
    `INSERT OR REPLACE INTO oauth_states (state, provider, code_verifier, redirect_uri, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [state, provider, codeVerifier, null, null, now, expiresAt],
  );

  const callbackUrl = `${callbackBase}/oauth/callback`;

  if (provider === 'google') {
    const scopes = encodeURIComponent([
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' '));
    const authUrl = [
      'https://accounts.google.com/o/oauth2/v2/auth',
      `?client_id=${cfg.clientId}`,
      `&redirect_uri=${encodeURIComponent(callbackUrl)}`,
      `&response_type=code`,
      `&scope=${scopes}`,
      `&access_type=online`,
      `&prompt=select_account`,
      `&code_challenge=${codeChallenge}`,
      `&code_challenge_method=S256`,
      `&state=${state}`,
    ].join('');
    return { authUrl, state };
  }

  // GitHub
  const scopes = encodeURIComponent('read:user user:email');
  const authUrl = [
    'https://github.com/login/oauth/authorize',
    `?client_id=${cfg.clientId}`,
    `&redirect_uri=${encodeURIComponent(callbackUrl)}`,
    `&scope=${scopes}`,
    `&state=${state}`,
  ].join('');
  return { authUrl, state };
}
