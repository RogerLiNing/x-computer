import { createLLMRouter } from './llm.js';
import { fetchModelsFromProvider } from '../llm/fetchModels.js';
import express from 'express';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { createUserRouter } from './user.js';
import { SessionAuth } from '../auth/sessionAuth.js';
import { userContextMiddleware } from '../middleware/userContext.js';
vi.mock('../llm/fetchModels.js', () => ({ fetchModelsFromProvider: vi.fn() }));
vi.mock('../config/defaultConfig.js', () => ({ loadDefaultConfig: () => ({
  llm_config: { providers: [{ id: 'platform', name: '平台模型', apiKey: 'platform-key', baseUrl: 'https://gateway.invalid/v1?token=url-secret' }], defaultByModality: { chat: { providerId: 'platform', modelId: 'default' } } },
  email: { smtp: { pass: 'smtp-password' } }, oauth: { github: { clientSecret: 'oauth-secret' } },
  mcp_servers: [{ env: { API_KEY: 'mcp-key' } }], container: { imageName: 'private-image' },
  future_backend_option: { secret: 'future-secret' },
}) }));

describe('authenticated user configuration privacy', () => {
  let sqlite: SqliteAppDatabase; let db: SqliteDatabaseAdapter; let app: express.Express;
  let alice: string; let bob: string;
  beforeEach(async () => {
    sqlite = new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(), 'private-config-'))); db = new SqliteDatabaseAdapter(sqlite);
    const sessions = new SessionAuth(db); alice = await sessions.createCookie('alice'); bob = await sessions.createCookie('bob');
    app = express(); app.locals.sessions = sessions; app.use(express.json()); app.use(userContextMiddleware(false));
    app.use('/api/users', createUserRouter(db));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); sqlite.close(); });
  it('lets a basic-plan admin save and import from their own provider without returning the key', async () => {
    vi.stubEnv('X_COMPUTER_ADMIN_EMAILS', 'admin@example.test');
    await db.ensureUser('alice');
    await db.createAuthAccount('admin@example.test', 'fixture-hash', 'alice');
    const admin = await app.locals.sessions.createCookie('alice');
    const subscription = { getUserSubscription: async () => ({ planId: 'trial' }) } as never;
    const server = express();
    server.locals.sessions = app.locals.sessions;
    server.use(express.json());
    server.use(userContextMiddleware(false));
    server.use('/api/users', createUserRouter(db, subscription));
    server.use('/api/llm', createLLMRouter(db, subscription));
    vi.mocked(fetchModelsFromProvider).mockResolvedValue([{ id: 'deepseek-chat' }]);

    const url = '/api/users/me/config/llm_config';
    const provider = { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' };
    const secret = 'fixture-private-deepseek-key';
    const result = await request(server).put(url).set('Cookie', admin).send({ value: { providers: [{ ...provider, apiKey: secret }] } });
    expect(result.status).toBe(200);
    expect(result.body.value.providers[0]).toMatchObject({ id: 'deepseek', apiKeyConfigured: true });
    expect(result.text).not.toContain(secret);
    const read = await request(server).get(url).set('Cookie', admin);
    expect(read.body.value.providers[0].apiKeyConfigured).toBe(true);
    expect(read.text).not.toContain(secret);
    expect((await request(server).post('/api/llm/import-models').set('Cookie', admin).send({ providerId: 'deepseek' })).body.models)
      .toEqual([{ id: 'deepseek-chat' }]);
    expect(fetchModelsFromProvider).toHaveBeenCalledWith(provider.baseUrl, secret, false);
    expect((await request(server).put(url).set('Cookie', bob).send({ value: { providers: [provider] } })).status).toBe(403);
  });

  it('keeps a rotated key when an older metadata save races it', async () => {
    const provider = { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' };
    await db.setConfig('alice', 'llm_config', JSON.stringify({ providers: [{ ...provider, apiKey: 'old-fixture' }] }));
    const run = db.run.bind(db);
    let raced = false;
    const write = vi.spyOn(db, 'run').mockImplementation(async (sql, params) => {
      if (!raced && sql.startsWith('UPDATE user_config SET value=')) {
        raced = true;
        await db.setConfig('alice', 'llm_config', JSON.stringify({ providers: [{ ...provider, apiKey: 'rotated-fixture' }] }));
      }
      return run(sql, params);
    });
    try {
      const response = await request(app).put('/api/users/me/config/llm_config').set('Cookie', alice)
        .send({ value: { providers: [{ ...provider, name: 'DeepSeek 个人配置' }] } });
      expect(response.status).toBe(200);
      expect(raced).toBe(true);
      expect(JSON.parse((await db.getConfig('alice', 'llm_config'))!).providers[0])
        .toMatchObject({ name: 'DeepSeek 个人配置', apiKey: 'rotated-fixture' });
      expect(response.text).not.toContain('rotated-fixture');
    } finally { write.mockRestore(); }
  });

  it('never merges platform secrets or new backend options into browser settings', async () => {
    await db.setConfig('alice', 'theme', 'light');
    const response = await request(app).get('/api/users/me/config').set('Cookie', alice);
    expect(response.status).toBe(200); expect(response.body.theme).toBe('light');
    expect(response.body.llm_config.providers[0]).toMatchObject({ id: 'platform', apiKeyConfigured: true });
    for (const secret of ['platform-key', 'smtp-password', 'oauth-secret', 'url-secret', 'mcp-key', 'future-secret', 'auth_session:']) expect(response.text).not.toContain(secret);
    for (const key of ['email', 'oauth', 'mcp_servers', 'database', 'container', 'auth']) expect((await request(app).get(`/api/users/me/config/${key}`).set('Cookie', alice)).status).toBe(403);
    expect((await request(app).get('/api/users/me/config/future_backend_option').set('Cookie', alice)).status).toBe(404);
    const model = await request(app).get('/api/users/me/config/llm_config').set('Cookie', alice); expect(model.text).not.toContain('platform-key');
  });
  it('returns configured flags for owned models and preserves saved credentials across both update paths', async () => {
    await db.setConfig('alice', 'llm_config', JSON.stringify({ providers: [{ id: 'own', name: 'mine', apiKey: 'owned-key', baseUrl: 'https://own.invalid/v1' }], defaultByModality: { chat: { providerId: 'own', modelId: 'model' } } }));
    const first = await request(app).get('/api/users/me/config/llm_config').set('Cookie', alice);
    expect(first.text).not.toContain('owned-key'); expect(first.body.value.providers[0].apiKeyConfigured).toBe(true);
    first.body.value.providers[0].name = 'renamed';
    expect((await request(app).put('/api/users/me/config/llm_config').set('Cookie', alice).send({ value: first.body.value })).status).toBe(200);
    expect(JSON.parse((await db.getConfig('alice', 'llm_config'))!).providers[0]).toMatchObject({ name: 'renamed', apiKey: 'owned-key' });
    expect((await request(app).put('/api/users/me/config').set('Cookie', alice).send({ llm_config: first.body.value })).status).toBe(200);
    expect(JSON.parse((await db.getConfig('alice', 'llm_config'))!).providers[0].apiKey).toBe('owned-key');
    first.body.value.providers[0].apiKey = '';
    await request(app).put('/api/users/me/config/llm_config').set('Cookie', alice).send({ value: first.body.value });
    expect(JSON.parse((await db.getConfig('alice', 'llm_config'))!).providers[0].apiKey).toBe('');
  });
  it('validates the whole model update before writing other settings and refuses reserved keys', async () => {
    const bad = await request(app).put('/api/users/me/config').set('Cookie', alice).send({ theme: 'changed', llm_config: { providers: 'bad' } });
    expect(bad.status).toBe(400); expect(await db.getConfig('alice', 'theme')).toBeUndefined();
    for (const key of ['oauth', 'auth_session:forged', 'auth_password_reset_v1', '__proto__']) {
      expect((await request(app).put('/api/users/me/config').set('Cookie', alice).set('Content-Type', 'application/json').send(JSON.stringify({ [key]: { value: 'forged' } }))).status).toBe(403);
    }
  });
  it('keeps account boundaries and existing model eligibility', async () => {
    await db.setConfig('alice', 'email_smtp_config', JSON.stringify({ pass: 'alice-owned-password' }));
    expect((await request(app).get('/api/users/me/config').set('Cookie', bob)).text).not.toContain('alice-owned-password');
    expect((await request(app).get('/api/users/me/config').set('Cookie', alice).set('X-User-Id', 'bob')).status).toBe(403);
    expect((await request(app).get('/api/users/me/config')).status).toBe(401);
    const free = express(); free.locals.sessions = app.locals.sessions; free.use(express.json()); free.use(userContextMiddleware(false));
    free.use('/api/users', createUserRouter(db, { getUserSubscription: async () => ({ planId: 'free' }) } as never));
    expect((await request(free).put('/api/users/me/config/llm_config').set('Cookie', alice).send({ value: { providers: [] } })).status).toBe(403);
    expect((await request(free).get('/api/users/me/config/llm_config').set('Cookie', alice)).body.value.providers[0].id).toBe('platform');
  });
  it('protects reset and credential keys after path parsing, including trailing slashes and case variants',async()=>{
    await db.setConfig('alice','auth_password_reset_v1','1');
    for(const key of ['auth_password_reset_v1/','%61uth_password_reset_v1/','AUTH_PASSWORD_RESET_V1/','auth_password_reset_v1%20/',encodeURIComponent('auth_paſſword_reset_v1')+'/','auth_session%3Aforged/','oauth/']){
      const url='/api/users/me/config/'+key;
      expect((await request(app).get(url).set('Cookie',alice)).status).toBe(403);
      expect((await request(app).put(url).set('Cookie',alice).send({value:'forged'})).status).toBe(403);
      expect((await request(app).delete(url).set('Cookie',alice)).status).toBe(403);
    }
    expect(await db.getConfig('alice','auth_password_reset_v1')).toBe('1');
  });
});
