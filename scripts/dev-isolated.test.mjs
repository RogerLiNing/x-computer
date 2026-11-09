import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareIsolated } from './dev-isolated.mjs';
import { validateIsolatedRuntime } from '../server/src/config/isolatedRuntime.mjs';

test('fresh private SQLite and clean environment; resume preserves bytes', async () => {
  const prepared = await prepareIsolated();
  const config = await readFile(prepared.configPath, 'utf8');
  assert.equal(JSON.parse(config).database.type, 'sqlite');
  assert.equal((await lstat(prepared.configPath)).mode & 0o777, 0o600);
  assert.equal(prepared.env.X_COMPUTER_ISOLATED, '1');
  assert.equal(prepared.env.X_COMPUTER_DEV_ORIGIN,'http://127.0.0.1:3100');
  for (const name of ['MYSQL_HOST', 'MYSQL_PASSWORD', 'STRIPE_SECRET_KEY', 'NODE_OPTIONS', 'X_COMPUTER_ADMIN_EMAILS']) assert.equal(prepared.env[name], undefined);
  const resumed = await prepareIsolated({ resume: prepared.root });
  assert.equal(resumed.root, prepared.root);
  assert.equal(await readFile(prepared.configPath, 'utf8'), config);
});

test('explicit model copy excludes MySQL, SMTP and MCP; source untouched', async () => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'x-isolated-source-'));
  const file = path.join(sourceRoot, 'source.json');
  const value = JSON.stringify({ database: { type: 'mysql' }, email: { smtp: { pass: 'do-not-copy' } }, mcp_servers: [{ command: 'do-not-run' }], llm_config: { providers: [{ id: 'fixture', apiKey: 'test-value' }] } });
  await writeFile(file, value);
  const prepared = await prepareIsolated({ modelConfig: file });
  const copied = JSON.parse(await readFile(prepared.configPath, 'utf8'));
  assert.equal(copied.database.type, 'sqlite'); assert.equal(copied.email, undefined); assert.equal(copied.mcp_servers, undefined);
  assert.equal(copied.llm_config.providers[0].apiKey, 'test-value');
  assert.equal(await readFile(file, 'utf8'), value);
  await assert.rejects(prepareIsolated({ resume: prepared.root, modelConfig: file }));
});

test('refuses unknown directories, wrong database, unsafe permissions, symlink configs and DB', async () => {
  await assert.rejects(prepareIsolated({ resume: await mkdtemp(path.join(os.tmpdir(), 'x-unowned-')) }));
  const prepared = await prepareIsolated();
  const value = JSON.parse(await readFile(prepared.configPath, 'utf8'));
  await writeFile(prepared.configPath, JSON.stringify({ ...value, database: { type: 'mysql' } }));
  await assert.rejects(prepareIsolated({ resume: prepared.root }));
  await writeFile(prepared.configPath, JSON.stringify(value));
  await chmod(prepared.configPath, 0o644);
  await assert.rejects(prepareIsolated({ resume: prepared.root }));
  await chmod(prepared.configPath, 0o600);
  await symlink(prepared.configPath, path.join(prepared.root, 'x-computer.db'));
  await assert.rejects(prepareIsolated({ resume: prepared.root }));
  const other = await prepareIsolated();
  const linkRoot = await mkdtemp(path.join(os.tmpdir(), 'x-linked-'));
  await symlink(other.root, path.join(linkRoot, 'environment'));
  await assert.rejects(prepareIsolated({ resume: path.join(linkRoot, 'environment') }));
  assert.throws(() => validateIsolatedRuntime({ ...other.env, X_COMPUTER_CONFIG_PATH: prepared.configPath }));
});

test('rejects ports, unresolved model env and added external integration', async () => {
  for (const serverPort of ['0', '4000; echo bad', '65536', '3100']) await assert.rejects(prepareIsolated({ serverPort }));
  const prepared = await prepareIsolated();
  const value = JSON.parse(await readFile(prepared.configPath, 'utf8'));
  await writeFile(prepared.configPath, JSON.stringify({ ...value, email: {} }));
  await assert.rejects(prepareIsolated({ resume: prepared.root }));
  const model = path.join(prepared.root, 'missing-env.json');
  await writeFile(model, JSON.stringify({ llm_config: { providers: [{ apiKey: '{env:X_ISOLATED_NONEXISTENT_TEST_KEY}' }] } }));
  await assert.rejects(prepareIsolated({ modelConfig: model }));
});

test('resume rejects user subtree, WAL and hard links without writing through them', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'x-isolated-outside-'));
  const sentinel = path.join(outside, 'original.txt');
  await writeFile(sentinel, 'unchanged');
  for (const name of ['users', 'x-computer.db-wal', 'x-computer.db-shm']) {
    const prepared = await prepareIsolated();
    await symlink(name === 'users' ? outside : sentinel, path.join(prepared.root, name));
    await assert.rejects(prepareIsolated({ resume: prepared.root }));
  }
  const prepared = await prepareIsolated();
  await mkdir(path.join(prepared.root, 'users'));
  await link(sentinel, path.join(prepared.root, 'users', 'linked.txt'));
  await assert.rejects(prepareIsolated({ resume: prepared.root }));
  assert.equal(await readFile(sentinel, 'utf8'), 'unchanged');
  const internal = await prepareIsolated();
  await writeFile(path.join(internal.root, 'material.txt'), 'internal material');
  await link(path.join(internal.root, 'material.txt'), path.join(internal.root, 'material-copy.txt'));
  assert.equal((await prepareIsolated({ resume: internal.root })).root, internal.root);
});

test('CLI fails closed without printing private config contents', () => {
  const result = spawnSync(process.execPath, ['scripts/dev-isolated.mjs', '--resume', '/nonexistent-x-isolated-test'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /未回退到原配置/);
});
