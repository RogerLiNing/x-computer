/**
 * 增强认证路由
 * 邮箱验证、密码重置、OAuth 等
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';
import { EmailVerificationService } from '../auth/emailVerification.js';
import { PasswordResetService } from '../auth/passwordReset.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createAuthEnhancedRoutes(db: AppDatabase): Router {
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

      // TODO: 实际应用中应通过邮件发送验证码
      // 目前为了开发方便，直接返回验证码
      serverLogger.info('auth/verification', `验证码已生成（开发模式）`, `email=${email} code=${code}`);

      res.json({
        success: true,
        message: 'Verification code sent successfully',
        // 开发模式下返回验证码，生产环境应删除此字段
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

      // 为了安全，总是返回成功消息
      res.json({
        success: true,
        message: 'If this email exists, a reset code has been sent',
        // 开发模式下返回验证码
        code: process.env.NODE_ENV === 'development' && result.success ? result.code : undefined,
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
   * POST /api/auth/oauth/google
   * Google OAuth 登录（占位符）
   */
  router.post('/oauth/google', async (req, res) => {
    res.status(501).json({
      error: 'Not implemented',
      message: 'Google OAuth integration is under development',
    });
  });

  /**
   * POST /api/auth/oauth/github
   * GitHub OAuth 登录（占位符）
   */
  router.post('/oauth/github', async (req, res) => {
    res.status(501).json({
      error: 'Not implemented',
      message: 'GitHub OAuth integration is under development',
    });
  });

  return router;
}
