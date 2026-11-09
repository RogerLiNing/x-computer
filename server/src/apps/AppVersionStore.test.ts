import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { mkdtemp,symlink } from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import { SqliteAppDatabase,SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { AppVersionStore } from './AppVersionStore.js';
describe('application source versions',()=>{
  let sqlite:SqliteAppDatabase;let db:SqliteDatabaseAdapter;let sandbox:SandboxFS;let versions:AppVersionStore;
  beforeEach(async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'app-versions-'));sqlite=new SqliteAppDatabase(root);db=new SqliteDatabaseAdapter(sqlite);sandbox=new SandboxFS(path.join(root,'workspace'));await sandbox.init();versions=new AppVersionStore(db);});
  afterEach(()=>sqlite.close());
  it('keeps source and binary assets, restores a separate app and never rolls back current data',async()=>{
    await sandbox.writeOverwrite('apps/counter/index.html','<h1>Original</h1>');
    await sandbox.writeBinary('apps/counter/assets/icon.png',Buffer.from([0,255,128,42]));
    const first=await versions.capture('alice','counter','计数器',sandbox);
    expect(await versions.capture('alice','counter','计数器',sandbox)).toBe(first);
    await sandbox.writeOverwrite('apps/counter/index.html','<h1>Revised</h1>');
    await versions.capture('alice','counter','计数器',sandbox);
    await db.appBackendKvSet('alice','counter','count','9');
    const restored=await versions.restore('alice','counter',first,sandbox);
    expect(await sandbox.read(`${restored.path}/index.html`)).toContain('Original');
    expect(await sandbox.readBinary(`${restored.path}/assets/icon.png`)).toEqual(Buffer.from([0,255,128,42]));
    expect(await sandbox.read('apps/counter/index.html')).toContain('Revised');
    expect(await db.appBackendKvGet('alice','counter','count')).toBe('9');
    expect(await db.appBackendKvGet('alice',restored.id,'count')).toBeUndefined();
    expect(await versions.list('alice','counter')).toHaveLength(2);
    expect(await versions.list('alice',restored.id)).toHaveLength(1);
  });
  it('rejects another owner, differently cased IDs, traversal and linked assets',async()=>{
    await sandbox.writeOverwrite('apps/counter/index.html','safe');const id=await versions.capture('alice','counter','计数器',sandbox);
    expect(await versions.list('bob','counter')).toEqual([]);
    await expect(versions.restore('bob','counter',id,sandbox)).rejects.toThrow();
    await expect(versions.restore('alice','Counter',id,sandbox)).rejects.toThrow();
    await expect(versions.list('alice','../counter')).rejects.toThrow();
    await symlink('../counter/index.html',path.join(sandbox.getRoot(),'apps/counter/linked.html'));
    await expect(versions.capture('alice','counter','计数器',sandbox)).rejects.toThrow('符号链接');
  });
  it('keeps restore aliases when re-registering a copy and preserves other registered applications',async()=>{
    await versions.register('alice',{id:'one',name:'一',path:'apps/one'});
    await sandbox.writeOverwrite('apps/one/index.html','original');const id=await versions.capture('alice','one','一',sandbox);
    const restored=await versions.restore('alice','one',id,sandbox);await versions.register('alice',restored);
    await versions.register('alice',{id:restored.id,name:'改名',path:restored.path});
    expect(await versions.sourceAppId('alice',restored.id)).toBe('one');
    const copyId=(await versions.list('alice',restored.id))[0].id;
    const second=await versions.restore('alice',restored.id,copyId,sandbox);expect(second.sourceAppId).toBe('one');
    expect(JSON.parse(await db.getConfig('alice','x_mini_apps')??'[]')).toHaveLength(2);
  });
  it('fails before saving missing or oversized source',async()=>{
    await sandbox.writeOverwrite('apps/missing/app.js','no index');
    await expect(versions.capture('alice','missing','缺失入口',sandbox)).rejects.toThrow('index.html');
    await sandbox.writeBinary('apps/large/index.html',Buffer.alloc(4*1024*1024+1));
    await expect(versions.capture('alice','large','过大',sandbox)).rejects.toThrow('4 MiB');
    expect(await versions.list('alice','large')).toEqual([]);
  });
});
