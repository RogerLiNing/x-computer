/**
 * 认证流程集成测试：验证码、注册、登录、限流、匿名数据同步
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import os from 'os';
import { createApp } from '../app.js';

function getCaptchaAnswer(question: string): string {
  const match = (question || '').match(/(\d+) \+ (\d+)/);
  return match ? String(parseInt(match[1], 10) + parseInt(match[2], 10)) : '';
}

async function fetchCaptcha(appInstance: Parameters<typeof request>[0]) {
  const res = await request(appInstance).get('/api/auth/captcha');
  expect(res.status).toBe(200);
  return res.body as { id: string; question: string };
}

async function registerWithCaptcha(
  appInstance: Parameters<typeof request>[0],
  email: string,
  password: string,
  previousUserId?: string,
) {
  const { id, question } = await fetchCaptcha(appInstance);
  const body = { email, password, captchaId: id, captchaAnswer: getCaptchaAnswer(question) };
  const req = previousUserId
    ? request(appInstance).post('/api/auth/register').set('X-User-Id', previousUserId).send(body)
    : request(appInstance).post('/api/auth/register').send(body);
  return req;
}

async function loginWithCaptcha(
  appInstance: Parameters<typeof request>[0],
  email: string,
  password: string,
  previousUserId?: string,
) {
  const { id, question } = await fetchCaptcha(appInstance);
  const body = { email, password, captchaId: id, captchaAnswer: getCaptchaAnswer(question) };
  const req = previousUserId
    ? request(appInstance).post('/api/auth/login').set('X-User-Id', previousUserId).send(body)
    : request(appInstance).post('/api/auth/login').send(body);
  return req;
}

describe('认证流程集成测试', () => {
  const workspaceRoot = path.join(os.tmpdir(), `x-computer-auth-test-${Date.now()}`);
  let app: any, sandboxFS: any, db: any, userSandboxManager: any;

  const TEST_EMAIL = `test-${Date.now()}@example.com`;
  const TEST_PASSWORD = 'password123';

  beforeAll(async () => {
    const result = await createApp({
      workspaceRoot,
      allowAnonymous: false,
      databaseType: 'sqlite',
    });
    app = result.app;
    sandboxFS = result.sandboxFS;
    db = result.db;
    userSandboxManager = result.userSandboxManager;
    await sandboxFS.init();
  });

  describe('GET /api/auth/captcha', () => {
    it('无需 X-User-Id 即可获取验证码', async () => {
      const res = await request(app).get('/api/auth/captcha');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('question');
      expect(typeof res.body.id).toBe('string');
      expect(typeof res.body.question).toBe('string');
      expect(res.body.question).toMatch(/\d+ \+ \d+ = \?/);
    });
  });

  describe('POST /api/auth/register', () => {
    it('无效邮箱返回 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({
          email: 'invalid-email',
          password: TEST_PASSWORD,
          captchaId: 'x',
          captchaAnswer: '1',
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/邮箱/);
    });

    it('密码不足 6 位返回 400', async () => {
      const { id, question } = await fetchCaptcha(app);
      const res = await request(app)
        .post('/api/auth/register')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({
          email: 'short@example.com',
          password: '12345',
          captchaId: id,
          captchaAnswer: getCaptchaAnswer(question),
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/至少.*6/);
    });

    it('缺少验证码返回 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/验证码/);
    });

    it('错误验证码返回 400', async () => {
      const capRes = await request(app).get('/api/auth/captcha');
      const { id } = capRes.body;
      const res = await request(app)
        .post('/api/auth/register')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          captchaId: id,
          captchaAnswer: '99', // 错误答案
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/验证码/);
    });

    it('正确验证码可注册成功', async () => {
      const capRes = await request(app).get('/api/auth/captcha');
      expect(capRes.status).toBe(200);
      const { id, question } = capRes.body;
      const match = (question || '').match(/(\d+) \+ (\d+)/);
      const answer = match ? String(parseInt(match[1], 10) + parseInt(match[2], 10)) : '';
      const res = await request(app)
        .post('/api/auth/register')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          captchaId: id,
          captchaAnswer: answer,
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('userId');
      expect(typeof res.body.userId).toBe('string');
    });

    it('重复注册同一邮箱返回 409', async () => {
      const capRes = await request(app).get('/api/auth/captcha');
      const { id, question } = capRes.body;
      const match = (question || '').match(/(\d+) \+ (\d+)/);
      const answer = match ? String(parseInt(match[1], 10) + parseInt(match[2], 10)) : '';
      const res = await request(app)
        .post('/api/auth/register')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          captchaId: id,
          captchaAnswer: answer,
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/已注册/);
    });
  });

  describe('POST /api/auth/login', () => {
    it('缺少验证码返回 400', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/验证码/);
    });

    it('正确验证码与密码可登录', async () => {
      const capRes = await request(app).get('/api/auth/captcha');
      const { id, question } = capRes.body;
      const match = (question || '').match(/(\d+) \+ (\d+)/);
      const answer = match ? String(parseInt(match[1], 10) + parseInt(match[2], 10)) : '';
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          captchaId: id,
          captchaAnswer: answer,
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('userId');
    });

    it('错误密码返回 401', async () => {
      const capRes = await request(app).get('/api/auth/captcha');
      const { id, question } = capRes.body;
      const match = (question || '').match(/(\d+) \+ (\d+)/);
      const answer = match ? String(parseInt(match[1], 10) + parseInt(match[2], 10)) : '';
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-User-Id', 'anon-' + Date.now())
        .send({
          email: TEST_EMAIL,
          password: 'wrongpassword',
          captchaId: id,
          captchaAnswer: answer,
        });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/邮箱或密码错误/);
    });
  });

  describe('受保护接口需登录', () => {
    it('无 X-User-Id 时 GET /api/users/me 返回 401', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/X-User-Id|请先登录/);
    });

    it('有效 X-User-Id 时 GET /api/users/me 返回用户信息', async () => {
      const loginRes = await loginWithCaptcha(app, TEST_EMAIL, TEST_PASSWORD);
      const userId = loginRes.body.userId;
      const res = await request(app).get('/api/users/me').set('X-User-Id', userId);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userId);
      expect(res.body.email).toBe(TEST_EMAIL);
    });
  });

  describe('匿名数据同步（登录/注册后合并到新账号）', () => {
    const SYNC_EMAIL = `sync-${Date.now()}@example.com`;
    const SYNC_PASSWORD = 'syncpass123';
    const ANON_USER = 'anon-sync-' + Date.now();

    it('注册时匿名配置同步到新账号', async () => {
      await request(app)
        .put('/api/users/me/config')
        .set('X-User-Id', ANON_USER)
        .send({ test_sync_key: { value: 'anon-config-data' } });
      const regRes = await registerWithCaptcha(app, SYNC_EMAIL, SYNC_PASSWORD, ANON_USER);
      const reg = await regRes;
      expect(reg.status).toBe(201);
      const userId = reg.body.userId;
      const configRes = await request(app)
        .get('/api/users/me/config')
        .set('X-User-Id', userId);
      expect(configRes.status).toBe(200);
      expect(configRes.body.test_sync_key).toEqual({ value: 'anon-config-data' });
    });

    it('登录时匿名聊天会话同步到新账号', async () => {
      const anon2 = 'anon-session-' + Date.now();
      const createRes = await request(app)
        .post('/api/chat/sessions')
        .set('X-User-Id', anon2)
        .send({ title: '匿名会话' });
      expect(createRes.status).toBe(201);
      const sessionId = createRes.body.id;
      await request(app)
        .post(`/api/chat/sessions/${sessionId}/messages`)
        .set('X-User-Id', anon2)
        .send({ role: 'user', content: '测试消息' });
      const loginRes = await loginWithCaptcha(app, SYNC_EMAIL, SYNC_PASSWORD, anon2);
      const userId = loginRes.body.userId;
      const sessionsRes = await request(app)
        .get('/api/chat/sessions')
        .set('X-User-Id', userId);
      expect(sessionsRes.status).toBe(200);
      const sessions = sessionsRes.body as Array<{ id: string; title: string }>;
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.some((s) => s.title === '匿名会话')).toBe(true);
    });

    it('注册时匿名沙箱文件同步到新账号', async () => {
      const anon3 = 'anon-workspace-' + Date.now();
      await userSandboxManager.getForUser(anon3);
      const writeRes = await request(app)
        .post('/api/fs/write')
        .set('X-User-Id', anon3)
        .send({ path: '文档/sync-test.txt', content: '匿名沙箱内容' });
      expect(writeRes.status).toBe(200);
      const syncEmail = `sync-file-${Date.now()}@example.com`;
      const regRes = await registerWithCaptcha(app, syncEmail, SYNC_PASSWORD, anon3);
      const reg = await regRes;
      expect(reg.status).toBe(201);
      const userId = reg.body.userId;
      const readRes = await request(app)
        .get('/api/fs/read')
        .set('X-User-Id', userId)
        .query({ path: '文档/sync-test.txt' });
      expect(readRes.status).toBe(200);
      expect(readRes.body.content).toContain('匿名沙箱内容');
    });
  });
});
