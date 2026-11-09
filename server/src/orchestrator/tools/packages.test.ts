import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../../db/database.js';
import { SandboxFS } from '../../tooling/SandboxFS.js';
import { UserSandboxManager } from '../../tooling/UserSandboxManager.js';
import { withSpaceFolders } from '../../spaces/SpaceAwareFS.js';
import { getSpaceStore } from '../../spaces/SpaceStore.js';
import { PackageRegistry } from '../../packages/PackageRegistry.js';
import { PackageCatalog } from '../../packages/catalog.js';
import { manifestForMiniApp } from '../../packages/manifest.js';
import { createPackageToolHandlers } from './packages.js';

describe('package tools', () => {
  let sqlite: SqliteAppDatabase; let db: SqliteDatabaseAdapter; let manager: UserSandboxManager; let registry: PackageRegistry;
  const onChanged = vi.fn(async () => {});
  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pkg-tools-'));
    sqlite = new SqliteAppDatabase(root); db = new SqliteDatabaseAdapter(sqlite);
    manager = new UserSandboxManager(path.join(root, 'users'));
    registry = new PackageRegistry(db);
    onChanged.mockClear();
  });
  afterEach(() => sqlite.close());

  const fsFor = async (userId: string): Promise<SandboxFS> => withSpaceFolders((await manager.getForUser(userId)).sandboxFS, userId, db, manager.getBasePath());
  const handlers = () => createPackageToolHandlers({
    registry, catalog: new PackageCatalog([]), spaces: getSpaceStore(db),
    resolveFS: (context) => fsFor((context as { userId: string }).userId), onChanged,
  });

  it('shares a package into a space folder and lets another member install it', async () => {
    const store = getSpaceStore(db);
    const space = await store.createSpace('roger', '家庭');
    await store.joinByCode('wife', (await store.createInvite('roger', space.id)).code);
    const rogerFs = await fsFor('roger');
    await rogerFs.writeOverwrite('apps/counter/index.html', '<h1>1</h1>');
    await rogerFs.writeOverwrite('apps/counter/assets/icon.txt', 'icon');
    await registry.install('roger', manifestForMiniApp({ id: 'counter', name: '计数器', path: 'apps/counter' }), { source: 'generated', path: 'apps/counter' });

    const tools = handlers();
    const shared = await tools['x.package_share']({ package_id: 'counter', space: '家庭' }, { userId: 'roger' }) as { ok: boolean; path: string };
    expect(shared).toMatchObject({ ok: true, path: '共享空间/家庭/packages/counter' });
    expect(await rogerFs.read('共享空间/家庭/packages/counter/x-package.json')).toContain('"counter"');

    const refused = await tools['x.package_install']({ source: 'space:家庭/counter', confirm: false }, { userId: 'wife' }) as { ok: boolean };
    expect(refused.ok).toBe(false);
    const installed = await tools['x.package_install']({ source: 'space:家庭/counter', confirm: true }, { userId: 'wife' }) as { ok: boolean; package: { source: string } };
    expect(installed).toMatchObject({ ok: true, package: { id: 'counter', source: 'space' } });
    const wifeFs = await fsFor('wife');
    expect(await wifeFs.read('apps/counter/index.html')).toBe('<h1>1</h1>');
    expect(await wifeFs.read('apps/counter/assets/icon.txt')).toBe('icon');
    expect((await registry.listApps('wife')).map((app) => app.id)).toEqual(['counter']);
    expect(onChanged).toHaveBeenCalledWith('wife');

    await expect(tools['x.package_install']({ source: 'space:家庭/counter', confirm: true }, { userId: 'wife' })).rejects.toThrow(/overwrite/);
    await expect(tools['x.package_install']({ source: 'space:家庭/counter', confirm: true }, { userId: 'stranger' })).rejects.toThrow();
  });

  it('lists, toggles and removes packages and reports a missing catalog', async () => {
    await registry.install('roger', manifestForMiniApp({ id: 'a', name: 'A', path: 'apps/a' }), { source: 'generated', path: 'apps/a' });
    const tools = handlers();
    expect((await tools['x.package_list']({}, { userId: 'roger' }) as { packages: Array<{ id: string }> }).packages.map((row) => row.id)).toEqual(['a']);
    expect(await tools['x.package_set_enabled']({ package_id: 'a', enabled: false }, { userId: 'roger' })).toMatchObject({ ok: true, enabled: false });
    expect((await registry.get('roger', 'a'))?.enabled).toBe(false);
    expect(await tools['x.package_search']({ query: 'x' }, { userId: 'roger' })).toMatchObject({ packages: [] });
    await expect(tools['x.package_install']({ source: 'catalog:a', confirm: true }, { userId: 'roger' })).rejects.toThrow(/目录/);
    expect(await tools['x.package_remove']({ package_id: 'a' }, { userId: 'roger' })).toMatchObject({ ok: true });
    await expect(tools['x.package_remove']({ package_id: 'a' }, { userId: 'roger' })).rejects.toThrow();
    await expect(tools['x.package_list']({}, { userId: 'anonymous' })).rejects.toThrow();
  });
});
