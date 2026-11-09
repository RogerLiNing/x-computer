/**
 * 认证流程集成测试：验证码、注册、登录、限流、匿名数据同步
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import path from 'path';
import os from 'os';
import { createApp } from '../app.js';
import { resetRateLimitState } from '../middleware/chatRateLimit.js';

// Mock loadDefaultConfig so allowRegister is true in tests
vi.mock('../config/defaultConfig.js', () => ({
  loadDefaultConfig: () => ({ auth: { allowRegister: true, allowAnonymous: false } }),
  getToolLoadingMode: () => 'all',
  clearDefaultConfigCache: () => {},
}));

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
  beforeEach(() => {
    resetRateLimitState();
  });

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
      const res = await request(app).get('/api/users/me').set('Cookie',loginRes.headers['set-cookie']);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(userId);
      expect(res.body.email).toBe(TEST_EMAIL);
    });
  });

  describe('不能凭用户编号合并他人数据', () => {
    it('注册时不合并伪造的旧用户配置',async()=>{
      await db.ensureUser('victim-config');await db.setConfig('victim-config','protected','retained');
      const reg=await registerWithCaptcha(app,'new-'+Date.now()+'@example.test','password123','victim-config');
      expect(reg.status).toBe(201);
      expect(await db.getConfig('victim-config','protected')).toBe('retained');
      expect(await db.getConfig(reg.body.userId,'protected')).toBeUndefined();
    });
    it('登录时不合并伪造的旧用户对话',async()=>{
      await db.ensureUser('victim-chat');const session=await db.createSession('victim-chat','private');
      const login=await loginWithCaptcha(app,TEST_EMAIL,TEST_PASSWORD,'victim-chat');
      expect(login.status).toBe(200);expect((await db.getSession(session.id)).user_id).toBe('victim-chat');
      const me=await request(app).get('/api/users/me').set('Cookie',login.headers['set-cookie']);expect(me.body.id).toBe(login.body.userId);
    });
    it('伪造用户编号不能读取文件',async()=>{
      const response=await request(app).get('/api/fs/read?path=private.txt').set('X-User-Id','victim-files');expect(response.status).toBe(401);
    });
  });
});
