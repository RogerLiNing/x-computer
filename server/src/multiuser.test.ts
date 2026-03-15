import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { createApp } from './app.js';
import { clearDefaultConfigCache } from './config/defaultConfig.js';

/**
 * 多用户基础设施测试：覆盖用户上下文中间件、用户隔离、配置 API、聊天会话 API。
 */
describe('多用户基础设施', () => {
  const workspaceRoot = path.join(os.tmpdir(), `x-computer-multiuser-test-${Date.now()}`);
  let app: any, sandboxFS: any, userSandboxManager: any, db: any;

  const USER_A = 'test-user-a-' + Date.now();
  const USER_B = 'test-user-b-' + Date.now();

  beforeAll(async () => {
    const result = await createApp({
      workspaceRoot,
      allowAnonymous: false,
      databaseType: 'sqlite',
    });
    app = result.app;
    sandboxFS = result.sandboxFS;
    userSandboxManager = result.userSandboxManager;
    db = result.db;
    await sandboxFS.init();
  });

  afterAll(() => {
    if (db?.close) db.close();
  });

  // ── 中间件测试 ──

  describe('用户上下文中间件', () => {
    it('无 X-User-Id 时返回 401', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/X-User-Id/i);
    });

    it('携带 X-User-Id 时正常响应', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('非法格式 userId 返回 400', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('X-User-Id', 'has spaces!@#');
      expect(res.status).toBe(400);
    });
  });

  // ── 允许匿名模式 ──

  describe('匿名模式', () => {
    let anonApp: any, anonFS: any, anonDb: any;

    beforeAll(async () => {
      const result = await createApp({
        workspaceRoot: path.join(os.tmpdir(), `x-computer-anon-test-${Date.now()}`),
        allowAnonymous: true,
        databaseType: 'sqlite',
      });
      anonApp = result.app;
      anonFS = result.sandboxFS;
      anonDb = result.db;
      await anonFS.init();
    });

    afterAll(() => {
      if (anonDb?.close) anonDb.close();
    });

    it('无 X-User-Id 时使用 anonymous', async () => {
      const res = await request(anonApp).get('/api/health');
      expect(res.status).toBe(200);
    });
  });

  // ── 用户 API ──

  describe('用户信息 API', () => {
    it('GET /api/users/me 自动创建用户', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(USER_A);
      expect(res.body).toHaveProperty('createdAt');
    });
  });

  // ── 用户配置 API ──

  describe('用户配置 API', () => {
    it('PUT /api/users/me/config 批量写入配置', async () => {
      const res = await request(app)
        .put('/api/users/me/config')
        .set('X-User-Id', USER_A)
        .send({
          desktop_layout: { icons: [] },
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('非专业版用户 PUT llm_config 返回 403', async () => {
      const res = await request(app)
        .put('/api/users/me/config')
        .set('X-User-Id', USER_A)
        .send({ llm_config: { providers: [{ id: 'openai' }] } });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/专业版|升级/i);
    });

    it('GET /api/users/me/config 读取配置', async () => {
      const res = await request(app)
        .get('/api/users/me/config')
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(200);
      expect(res.body.desktop_layout).toEqual({ icons: [] });
    });

    it('用户 B 读不到用户 A 的配置', async () => {
      // 确保该用例中 loadDefaultConfig() 返回 {}，否则本地/CI 的 .x-config.json 会合并进响应导致断言失败
      clearDefaultConfigCache();
      const emptyConfigPath = path.join(workspaceRoot, '.x-config-empty-test.json');
      await fs.writeFile(emptyConfigPath, '{}', 'utf-8');
      const prev = process.env.X_COMPUTER_CONFIG_PATH;
      process.env.X_COMPUTER_CONFIG_PATH = emptyConfigPath;
      try {
        const res = await request(app)
          .get('/api/users/me/config')
          .set('X-User-Id', USER_B);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
      } finally {
        process.env.X_COMPUTER_CONFIG_PATH = prev;
        clearDefaultConfigCache();
        await fs.unlink(emptyConfigPath).catch(() => {});
      }
    });

    it('PUT /api/users/me/config/:key 更新单个配置', async () => {
      const res = await request(app)
        .put('/api/users/me/config/theme')
        .set('X-User-Id', USER_A)
        .send({ value: 'dark' });
      expect(res.status).toBe(200);
    });

    it('GET /api/users/me/config/:key 读取单个配置', async () => {
      const res = await request(app)
        .get('/api/users/me/config/theme')
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(200);
      expect(res.body.value).toBe('dark');
    });

    it('DELETE /api/users/me/config/:key 删除配置', async () => {
      await request(app)
        .delete('/api/users/me/config/theme')
        .set('X-User-Id', USER_A);
      const res = await request(app)
        .get('/api/users/me/config/theme')
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(404);
    });
  });

  // ── 聊天会话 API ──

  describe('聊天会话 API', () => {
    let sessionId: string;

    it('POST /api/chat/sessions 创建会话', async () => {
      const res = await request(app)
        .post('/api/chat/sessions')
        .set('X-User-Id', USER_A)
        .send({ title: '测试会话' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('测试会话');
      expect(res.body).toHaveProperty('id');
      sessionId = res.body.id;
    });

    it('GET /api/chat/sessions 列出会话', async () => {
      const res = await request(app)
        .get('/api/chat/sessions')
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].id).toBe(sessionId);
    });

    it('用户 B 看不到用户 A 的会话', async () => {
      const res = await request(app)
        .get('/api/chat/sessions')
        .set('X-User-Id', USER_B);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(0);
    });

    it('POST /api/chat/sessions/:id/messages 追加消息', async () => {
      const res = await request(app)
        .post(`/api/chat/sessions/${sessionId}/messages`)
        .set('X-User-Id', USER_A)
        .send({ role: 'user', content: '你好' });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('user');
      expect(res.body.content).toBe('你好');
    });

    it('POST 追加 assistant 消息（含 toolCalls）', async () => {
      const res = await request(app)
        .post(`/api/chat/sessions/${sessionId}/messages`)
        .set('X-User-Id', USER_A)
        .send({
          role: 'assistant',
          content: '你好！',
          toolCalls: [{ name: 'file.list', input: { path: '/' } }],
        });
      expect(res.status).toBe(201);
      expect(res.body.toolCalls).toEqual([{ name: 'file.list', input: { path: '/' } }]);
    });

    it('GET /api/chat/sessions/:id/messages 获取消息', async () => {
      const res = await request(app)
        .get(`/api/chat/sessions/${sessionId}/messages`)
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].role).toBe('user');
      expect(res.body[1].role).toBe('assistant');
    });

    it('用户 B 无权访问用户 A 的会话消息', async () => {
      const res = await request(app)
        .get(`/api/chat/sessions/${sessionId}/messages`)
        .set('X-User-Id', USER_B);
      expect(res.status).toBe(403);
    });

    it('PUT /api/chat/sessions/:id 更新标题', async () => {
      const res = await request(app)
        .put(`/api/chat/sessions/${sessionId}`)
        .set('X-User-Id', USER_A)
        .send({ title: '新标题' });
      expect(res.status).toBe(200);
    });

    it('DELETE /api/chat/sessions/:id 删除会话', async () => {
      const res = await request(app)
        .delete(`/api/chat/sessions/${sessionId}`)
        .set('X-User-Id', USER_A);
      expect(res.status).toBe(200);
      // 验证已删除
      const check = await request(app)
        .get(`/api/chat/sessions/${sessionId}`)
        .set('X-User-Id', USER_A);
      expect(check.status).toBe(404);
    });
  });

  // ── 文件系统隔离 ──

  describe('文件系统用户隔离', () => {
    it('用户 A 写文件后，用户 B 看不到', async () => {
      // 用户 A 写文件
      await request(app)
        .post('/api/fs/write')
        .set('X-User-Id', USER_A)
        .send({ path: 'test-isolation.txt', content: 'hello from A' });

      // 用户 A 能读到
      const readA = await request(app)
        .get('/api/fs/read')
        .set('X-User-Id', USER_A)
        .query({ path: 'test-isolation.txt' });
      expect(readA.status).toBe(200);
      expect(readA.body.content).toBe('hello from A');

      // 用户 B 读不到（不同的沙箱）
      const readB = await request(app)
        .get('/api/fs/read')
        .set('X-User-Id', USER_B)
        .query({ path: 'test-isolation.txt' });
      expect(readB.status).toBe(400); // file not found
    });
  });

  // ── UserSandboxManager ──

  describe('UserSandboxManager', () => {
    it('为不同用户创建隔离的沙箱', async () => {
      const sbA = await userSandboxManager.getForUser(USER_A);
      const sbB = await userSandboxManager.getForUser(USER_B);

      expect(sbA.sandboxFS.getRoot()).not.toBe(sbB.sandboxFS.getRoot());
      expect(sbA.sandboxFS.getRoot()).toContain(USER_A);
      expect(sbB.sandboxFS.getRoot()).toContain(USER_B);
    });

    it('listUsers 返回已创建的用户', async () => {
      const users = await userSandboxManager.listUsers();
      expect(users).toContain(USER_A);
      expect(users).toContain(USER_B);
    });
  });
});
