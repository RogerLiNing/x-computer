import express from 'express';
import request from 'supertest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createMcpRouter } from './mcp.js';
vi.mock('../config/defaultConfig.js', () => ({ loadDefaultConfig: () => ({ mcp_servers: [{ id: 'platform', headers: { Authorization: 'platform-secret' } }] }) }));
vi.mock('../mcp/loadAndRegister.js', async original => ({
  ...await original<typeof import('../mcp/loadAndRegister.js')>(),
  loadMcpConfig: async () => [{ id: 'platform', url: 'https://platform.invalid/?token=url-secret', env: { API_KEY: 'environment-secret' } }],
  getMcpStatus: () => ({ servers: [{ id: 'platform', url: 'https://platform.invalid/?token=url-secret', displayCommand: '--key command-secret', toolsCount: 2, error: 'provider-error-secret' }], totalTools: 2 }),
}));
describe('MCP inherited configuration privacy', () => {
  async function app(own?: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-config-privacy-'));
    const instance = express(); instance.use((req, _res, next) => { req.userId = 'owner'; next(); });
    instance.use(createMcpRouter({} as never, { getRoot: () => root } as never, { getUserWorkspaceRoot: () => root } as never, { getConfig: async () => own } as never));
    return { instance, root };
  }
  it('reports inherited availability without sending platform URLs, headers or process secrets', async () => {
    const { instance } = await app(); const config = await request(instance).get('/mcp/config');
    expect(config.body.inherited).toBe(true); expect(config.body.servers).toEqual([]);
    const status = await request(instance).get('/mcp/status'); expect(status.body.totalTools).toBe(2);
    for (const secret of ['platform-secret','url-secret','environment-secret','command-secret','provider-error-secret']) {
      expect(config.text).not.toContain(secret); expect(status.text).not.toContain(secret);
    }
  });
  it('preserves editable user-owned configurations without mixing platform defaults', async () => {
    const own = [{ id: 'own', name: 'own', url: 'https://own.invalid', headers: { Authorization: 'own-credential' } }];
    const db = await app(JSON.stringify(own)); expect((await request(db.instance).get('/mcp/config')).body.servers).toEqual(own);
    const file = await app(); await writeFile(path.join(file.root, 'mcp-servers.json'), JSON.stringify({ servers: own }));
    expect((await request(file.instance).get('/mcp/config')).body.servers).toEqual(own);
  });
});
