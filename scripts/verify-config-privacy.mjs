import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../server/dist/server/src/db/database.js';
import { SessionAuth } from '../server/dist/server/src/auth/sessionAuth.js';

const root = '/tmp/x-computer-browser-isolated-20261030';
const user = 'acceptance-20261030';
const config = JSON.parse(await readFile('/tmp/x-computer-browser-config-20261030.json', 'utf8'));
assert.equal(config.database?.type, 'sqlite');
const sqlite = new SqliteAppDatabase(root); const db = new SqliteDatabaseAdapter(sqlite);
try {
  assert.ok(await db.getUser(user), 'Dedicated acceptance account must exist');
  const cookie = await new SessionAuth(db).createCookie(user);
  const secrets = [];
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(apikey|password|pass|clientsecret|secret|authorization|accesstoken|refreshtoken)$/i.test(key.replace(/[-_]/g, '')) && typeof child === 'string' && child.length > 5) secrets.push(child);
      else collect(child);
    }
  };
  collect(config);
  assert.ok(secrets.length, 'This verification requires a genuinely configured server');
  const get = async route => {
    const response = await fetch(`http://127.0.0.1:4000/api${route}`, { headers: { Cookie: cookie } });
    const body = await response.text(); for (const secret of secrets) assert.ok(!body.includes(secret), 'A server credential was exposed');
    return { status: response.status, body: JSON.parse(body) };
  };
  const all = await get('/users/me/config'); assert.equal(all.status, 200);
  assert.ok(all.body.llm_config.providers.some(provider => provider.apiKeyConfigured));
  for (const key of ['email', 'oauth', 'mcp_servers', 'database', 'container', 'auth']) assert.ok(!Object.hasOwn(all.body, key));
  assert.ok(!Object.keys(all.body).some(key => key.startsWith('auth_session:')));
  assert.equal((await get('/users/me/config/llm_config')).status, 200);
  const publicModels = await get('/llm/config'); assert.equal(publicModels.status, 200);
  for (const provider of publicModels.body.providers) assert.ok(!Object.hasOwn(provider, 'apiKey'));
  for (const key of ['oauth', 'email', 'mcp_servers']) assert.equal((await get(`/users/me/config/${key}`)).status, 403);
  const report = { success: true, database: 'isolated-sqlite', configuredProviderVisible: true,
    testedSecretCount: secrets.length, serverSecretsAbsentFromResponses: true, reservedDefaultsDenied: true, authSessionsHidden: true };
  const out = '/Users/rogerlee/.codex/outputs/x-computer-config-boundary-20261031';
  await mkdir(out, { recursive: true }); await writeFile(`${out}/live-api.json`, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + '\n');
} finally { sqlite.close(); }
