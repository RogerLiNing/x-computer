import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { PluginRegistry } from '../plugins/PluginRegistry.js';
import { createPackagesRouter } from './packages.js';

const raw = new SqliteAppDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'x-packages-db-')));
const db = new SqliteDatabaseAdapter(raw);
afterAll(() => raw.close());

function appFor() {
  const manager = new UserSandboxManager(fs.mkdtempSync(path.join(os.tmpdir(), 'x-packages-ws-')));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = String(req.headers['x-test-user'] ?? 'anonymous'); next(); });
  app.use('/api', createPackagesRouter(db, manager, new PluginRegistry('lightweight', ['billing'])));
  return { app, manager };
}

describe('/api/packages', () => {
  it('migrates legacy apps on first read, lists them with built-in plugins, and lets the owner toggle or remove', async () => {
    const { app, manager } = appFor();
    const { sandboxFS } = await manager.getForUser('roger');
    await sandboxFS.writeOverwrite('apps/counter/index.html', '<h1>1</h1>');
    await db.setConfig('roger', 'x_mini_apps', JSON.stringify([{ id: 'counter', name: '计数器', path: 'apps/counter' }]));

    const list = await request(app).get('/api/packages').set('x-test-user', 'roger');
    expect(list.status).toBe(200);
    expect(list.body.packages.map((row: { manifest: { id: string } }) => row.manifest.id)).toEqual(['counter']);
    expect(list.body.builtin.find((row: { id: string }) => row.id === 'billing').enabled).toBe(true);

    expect((await request(app).post('/api/packages/counter/enabled').set('x-test-user', 'roger').send({ enabled: false })).body.package.enabled).toBe(false);
    expect((await request(app).post('/api/packages/counter/enabled').set('x-test-user', 'roger').send({ enabled: 'no' })).status).toBe(400);
    expect((await request(app).delete('/api/packages/counter').set('x-test-user', 'wife')).status).toBe(404);
    expect((await request(app).delete('/api/packages/counter').set('x-test-user', 'roger')).status).toBe(200);
    expect((await request(app).get('/api/packages').set('x-test-user', 'roger')).body.packages).toEqual([]);
  });

  it('refuses anonymous callers', async () => {
    const { app } = appFor();
    expect((await request(app).get('/api/packages')).status).toBe(401);
  });
});
