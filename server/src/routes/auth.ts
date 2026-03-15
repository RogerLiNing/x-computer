/**
 * 认证路由：注册、登录、验证码。支持登录/注册后将匿名用户数据关联到新账号。
 * 安全措施：验证码防自动化、多次失败锁定防暴力破解。
 */

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import type { AppDatabase } from '../db/database.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createCaptcha, verifyCaptcha } from '../auth/captcha.js';
import { recordFailure, clearFailures, isLocked, getLockedRemainingSeconds } from '../auth/rateLimit.js';
import { mergeMessagesInto } from '../x/XProactiveMessages.js';
import { getDefaultScheduler } from '../scheduler/XScheduler.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 6;

export function createAuthRouter(
  db: AppDatabase,
  userSandboxManager: UserSandboxManager,
): Router {
  const router = Router();

  /** GET /api/auth/settings - 获取认证相关配置（公开，无需登录），如是否允许注册 */
  router.get('/settings', (_req, res) => {
    const cfg = loadDefaultConfig();
    const allowRegister = cfg.auth?.allowRegister !== false;
    res.json({ allowRegister });
  });

  /** GET /api/auth/captcha - 获取验证码（登录/注册前调用） */
  router.get('/captcha', (_req, res) => {
    const { id, question } = createCaptcha();
    res.json({ id, question });
  });

  /** POST /api/auth/register - 注册：邮箱+密码+验证码，创建账号；若当前为匿名则自动关联数据 */
  router.post('/register', async (req, res) => {
    if (loadDefaultConfig().auth?.allowRegister === false) {
      res.status(403).json({ error: '当前已关闭注册' });
      return;
    }
    try {
      const { email, password, captchaId, captchaAnswer } = req.body ?? {};
      const emailStr = typeof email === 'string' ? email.trim() : '';
      const passwordStr = typeof password === 'string' ? password : '';
      if (!emailStr || !EMAIL_REGEX.test(emailStr)) {
        res.status(400).json({ error: '请输入有效的邮箱地址' });
        return;
      }
      if (passwordStr.length < MIN_PASSWORD_LEN) {
        res.status(400).json({ error: `密码至少 ${MIN_PASSWORD_LEN} 位` });
        return;
      }
      if (!captchaId || !verifyCaptcha(String(captchaId), String(captchaAnswer ?? ''))) {
        res.status(400).json({ error: '验证码错误或已过期，请刷新后重试' });
        return;
      }
      const existingUserId = await db.getUserIdByEmail(emailStr);
      if (existingUserId) {
        res.status(409).json({ error: '该邮箱已注册' });
        return;
      }
      const userId = uuid();
      await db.ensureUser(userId);
      const passwordHash = await hashPassword(passwordStr);
      await db.createAuthAccount(emailStr, passwordHash, userId);

      const previousUserId = req.userId && req.userId !== 'anonymous' ? req.userId : null;
      if (previousUserId && previousUserId !== userId) {
        await db.mergeUserDataInto(previousUserId, userId);
        await userSandboxManager.mergeWorkspaceInto(previousUserId, userId).catch(() => {});
        mergeMessagesInto(previousUserId, userId);
        getDefaultScheduler()?.mergeJobsInto(previousUserId, userId);
      }

      res.status(201).json({ userId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '注册失败';
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/auth/login - 登录：邮箱+密码+验证码；若当前为匿名则自动关联数据到该账号 */
  router.post('/login', async (req, res) => {
    try {
      const { email, password, captchaId, captchaAnswer } = req.body ?? {};
      const emailStr = typeof email === 'string' ? email.trim() : '';
      const passwordStr = typeof password === 'string' ? password : '';
      if (!emailStr || !passwordStr) {
        res.status(400).json({ error: '请输入邮箱和密码' });
        return;
      }
      if (isLocked(emailStr)) {
        const sec = getLockedRemainingSeconds(emailStr);
        res.status(429).json({
          error: `登录尝试次数过多，请 ${Math.ceil(sec / 60)} 分钟后再试`,
          code: 'RATE_LIMITED',
          retryAfterSeconds: sec,
        });
        return;
      }
      if (!captchaId || !verifyCaptcha(String(captchaId), String(captchaAnswer ?? ''))) {
        recordFailure(emailStr);
        res.status(400).json({ error: '验证码错误或已过期，请刷新后重试' });
        return;
      }
      const storedHash = await db.getPasswordHashByEmail(emailStr);
      if (!storedHash) {
        recordFailure(emailStr);
        res.status(401).json({ error: '邮箱或密码错误' });
        return;
      }
      const ok = await verifyPassword(passwordStr, storedHash);
      if (!ok) {
        recordFailure(emailStr);
        res.status(401).json({ error: '邮箱或密码错误' });
        return;
      }
      clearFailures(emailStr);
      const userId = (await db.getUserIdByEmail(emailStr))!;

      const banned = (await db.getConfig(userId, 'admin_banned')) === '1';
      if (banned) {
        res.status(403).json({ error: '账号已被封禁，请联系管理员' });
        return;
      }

      const previousUserId = req.userId && req.userId !== 'anonymous' ? req.userId : null;
      if (previousUserId && previousUserId !== userId) {
        await db.mergeUserDataInto(previousUserId, userId);
        await userSandboxManager.mergeWorkspaceInto(previousUserId, userId).catch(() => {});
        mergeMessagesInto(previousUserId, userId);
        getDefaultScheduler()?.mergeJobsInto(previousUserId, userId);
      }

      res.json({ userId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
