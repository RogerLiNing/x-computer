import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { PackageRegistry } from './PackageRegistry.js';
import { MANIFEST_FILE, manifestForMiniApp } from './manifest.js';

describe('PackageRegistry', () => {
  let sqlite: SqliteAppDatabase; let db: SqliteDatabaseAdapter; let sandbox: SandboxFS; let registry: PackageRegistry;
  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'x-packages-'));
    sqlite = new SqliteAppDatabase(root); db = new SqliteDatabaseAdapter(sqlite);
    sandbox = new SandboxFS(path.join(root, 'workspace')); await sandbox.init();
    registry = new PackageRegistry(db);
  });
  afterEach(() => sqlite.close());

  it('installs a validated manifest, lists it per user and refuses an invalid one', async () => {
    const manifest = manifestForMiniApp({ id: 'counter', name: '计数器', path: 'apps/counter' });
    const record = await registry.install('alice', manifest, { source: 'generated', path: 'apps/counter' });
    expect(record).toMatchObject({ userId: 'alice', enabled: true, source: 'generated', path: 'apps/counter' });
    expect((await registry.list('alice')).map((row) => row.manifest.id)).toEqual(['counter']);
    expect(await registry.list('bob')).toEqual([]);
    await expect(registry.install('alice', { ...manifest, version: 'nope' }, { source: 'generated' })).rejects.toThrow(/version/);
  });

  it('upserts on reinstall, keeps the enabled flag, and toggles or removes without touching other users', async () => {
    const manifest = manifestForMiniApp({ id: 'counter', name: '计数器', path: 'apps/counter' });
    await registry.install('alice', manifest, { source: 'generated', path: 'apps/counter' });
    await registry.install('bob', manifest, { source: 'generated', path: 'apps/counter' });
    expect(await registry.setEnabled('alice', 'counter', false)).toBe(true);
    await registry.install('alice', { ...manifest, name: '新计数器', version: '0.2.0' }, { source: 'generated', path: 'apps/counter' });
    const alice = await registry.get('alice', 'counter');
    expect(alice).toMatchObject({ enabled: false, manifest: { name: '新计数器', version: '0.2.0' } });
    expect((await registry.get('bob', 'counter'))?.enabled).toBe(true);
    expect(await registry.remove('alice', 'counter')).toBe(true);
    expect(await registry.remove('alice', 'counter')).toBe(false);
    expect(await registry.setEnabled('alice', 'missing', true)).toBe(false);
    expect((await registry.list('bob')).length).toBe(1);
  });

  it('migrates legacy x_mini_apps entries once, writing a manifest file beside each app', async () => {
    await sandbox.writeOverwrite('apps/counter/index.html', '<h1>hi</h1>');
    await sandbox.writeOverwrite('apps/notes/index.html', '<h1>notes</h1>');
    await db.setConfig('alice', 'x_mini_apps', JSON.stringify([
      { id: 'counter', name: '计数器', path: 'apps/counter' },
      { id: 'notes', name: '笔记', path: 'apps/notes' },
      { id: 'bad id', name: 'x', path: 'apps/bad' },
    ]));
    const migrated = await registry.migrateMiniApps('alice', sandbox);
    expect(migrated.map((row) => row.manifest.id).sort()).toEqual(['counter', 'notes']);
    expect(JSON.parse(await sandbox.read(`apps/counter/${MANIFEST_FILE}`))).toMatchObject({ id: 'counter', kinds: ['ui'] });
    expect(await registry.migrateMiniApps('alice', sandbox)).toEqual([]);
    expect((await registry.list('alice')).length).toBe(2);
  });

  it('prefers a manifest file the model already wrote when migrating', async () => {
    await sandbox.writeOverwrite('apps/todo/index.html', '<h1>todo</h1>');
    await sandbox.writeOverwrite(`apps/todo/${MANIFEST_FILE}`, JSON.stringify({ format: 1, id: 'todo', name: '待办', version: '2.0.0', kinds: ['ui'], ui: { entry: 'index.html' }, permissions: [] }));
    await db.setConfig('alice', 'x_mini_apps', JSON.stringify([{ id: 'todo', name: '旧名', path: 'apps/todo' }]));
    const [row] = await registry.migrateMiniApps('alice', sandbox);
    expect(row.manifest).toMatchObject({ name: '待办', version: '2.0.0' });
  });

  it('lists only enabled ui packages as openable apps, in legacy shape', async () => {
    await registry.install('alice', manifestForMiniApp({ id: 'a', name: 'A', path: 'apps/a' }), { source: 'generated', path: 'apps/a' });
    await registry.install('alice', manifestForMiniApp({ id: 'b', name: 'B', path: 'apps/b' }), { source: 'generated', path: 'apps/b' });
    await registry.setEnabled('alice', 'b', false);
    expect(await registry.listApps('alice')).toEqual([{ id: 'a', name: 'A', path: 'apps/a' }]);
  });
});
