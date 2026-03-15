/**
 * 工作流 REST API 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';
import { WorkflowStore } from './store.js';
import { WorkflowRunner } from './runner.js';
import { createRouter } from './routes.js';

describe('Workflow API', () => {
  let app: express.Express;
  let store: WorkflowStore;
  const dbPath = path.join(os.tmpdir(), `wf-api-test-${Date.now()}.sqlite`);

  beforeEach(() => {
    store = new WorkflowStore(dbPath);
    const runner = new WorkflowRunner({ store });
    const router = createRouter({ store, runner });
    app = express();
    app.use(express.json());
    app.use('/api', router);
  });

  afterEach(() => {
    store.close();
  });

  const userId = 'user-123';
  const def = {
    id: 'wf-api-001',
    name: 'API 测试',
    version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 't1', type: 'task', taskType: 'script' },
    ],
    edges: [{ from: 'start', to: 't1' }],
  };

  it('POST /deploy 需要 X-User-Id', async () => {
    const res = await request(app).post('/api/deploy').send(def);
    expect(res.status).toBe(401);
  });

  it('POST /deploy 成功', async () => {
    const res = await request(app)
      .post('/api/deploy')
      .set('X-User-Id', userId)
      .send(def);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.definitionId).toBe('wf-api-001');
  });

  it('GET /definitions 列出流程', async () => {
    await request(app).post('/api/deploy').set('X-User-Id', userId).send(def);
    const res = await request(app).get('/api/definitions').set('X-User-Id', userId);
    expect(res.status).toBe(200);
    expect(res.body.definitions).toHaveLength(1);
  });

  it('POST /start 启动实例', async () => {
    await request(app).post('/api/deploy').set('X-User-Id', userId).send(def);
    const res = await request(app)
      .post('/api/start')
      .set('X-User-Id', userId)
      .send({ definitionId: 'wf-api-001' });
    expect(res.status).toBe(200);
    expect(res.body.instanceId).toMatch(/^inst-/);
  });

  it('GET /instances/:id 获取实例', async () => {
    await request(app).post('/api/deploy').set('X-User-Id', userId).send(def);
    const startRes = await request(app)
      .post('/api/start')
      .set('X-User-Id', userId)
      .send({ definitionId: 'wf-api-001' });
    const instanceId = startRes.body.instanceId;
    const res = await request(app).get(`/api/instances/${instanceId}`).set('X-User-Id', userId);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(instanceId);
    expect(res.body.status).toMatch(/running|completed/);
  });

  it('POST /instances/:id/variables 设置变量', async () => {
    await request(app).post('/api/deploy').set('X-User-Id', userId).send(def);
    const startRes = await request(app)
      .post('/api/start')
      .set('X-User-Id', userId)
      .send({ definitionId: 'wf-api-001' });
    const instanceId = startRes.body.instanceId;
    const res = await request(app)
      .post(`/api/instances/${instanceId}/variables`)
      .set('X-User-Id', userId)
      .send({ price: 2000 });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(2000);
  });
});
