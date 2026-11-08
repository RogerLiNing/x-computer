import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFSRouter } from './fs.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { getSpaceStore } from '../spaces/SpaceStore.js';

const raw = new SqliteAppDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'x-fs-spaces-db-')));
const db = new SqliteDatabaseAdapter(raw);
afterAll(() => raw.close());

function appFor(manager: UserSandboxManager) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = String(req.headers['x-test-user'] ?? 'anonymous'); next(); });
  app.use('/fs', createFSRouter(new SandboxFS(fs.mkdtempSync(path.join(os.tmpdir(), 'x-fs-default-'))), manager, db));
  return app;
}

describe('网页文件管理里的共享空间', () => {
  it('一人上传和新建文件夹，另一位成员能看到，非成员看不到', async () => {
    const manager = new UserSandboxManager(fs.mkdtempSync(path.join(os.tmpdir(), 'x-fs-spaces-')));
    const app = appFor(manager);
    const store = getSpaceStore(db);
    const space = await store.createSpace('web-roger', '家庭');
    await store.joinByCode('web-wife', (await store.createInvite('web-roger', space.id)).code);

    const root = await request(app).get('/fs').query({ path: '/' }).set('x-test-user', 'web-roger');
    expect(root.body.entries.map((e: { name: string }) => e.name)).toContain('共享空间');

    expect((await request(app).post('/fs/mkdir').set('x-test-user', 'web-roger').send({ path: '共享空间/家庭/产检' })).status).toBe(200);
    const upload = await request(app).post('/fs/upload').set('x-test-user', 'web-roger')
      .field('path', '共享空间/家庭/产检/B超.txt').attach('file', Buffer.from('一切正常'), 'B超.txt');
    expect(upload.status).toBe(200);

    const listed = await request(app).get('/fs').query({ path: '/共享空间/家庭/产检' }).set('x-test-user', 'web-wife');
    expect(listed.body.entries.map((e: { name: string }) => e.name)).toEqual(['B超.txt']);
    const read = await request(app).get('/fs/read').query({ path: '共享空间/家庭/产检/B超.txt' }).set('x-test-user', 'web-wife');
    expect(read.body.content).toBe('一切正常');

    const outsider = await request(app).get('/fs/read').query({ path: '共享空间/家庭/产检/B超.txt' }).set('x-test-user', 'web-stranger');
    expect(outsider.status).toBe(400);
    expect(outsider.body.error).toContain('找不到共享空间');
  });
});
