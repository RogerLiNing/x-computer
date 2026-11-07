import express from 'express';import request from 'supertest';
import { mkdtemp,mkdir,writeFile,symlink } from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { SqliteAppDatabase,SqliteDatabaseAdapter } from '../db/database.js';
import { UserSandboxManager } from '../tooling/UserSandboxManager.js';import { SessionAuth } from '../auth/sessionAuth.js';
import { userContextMiddleware } from '../middleware/userContext.js';import { createAppsRouter } from './apps.js';
import {AppVersionStore} from '../apps/AppVersionStore.js';
describe('opaque generated previews and scoped data',()=>{
 let root:string;let sqlite:SqliteAppDatabase;let db:SqliteDatabaseAdapter;let app:express.Express;let cookie:string;
 beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'app-previews-'));sqlite=new SqliteAppDatabase(root);db=new SqliteDatabaseAdapter(sqlite);
  for(const owner of ['alice','bob'])for(const id of ['one','two']){const dir=path.join(root,'users',owner,'workspace/apps',id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'index.html'),'<!doctype html><html><head></head><body><script src="app.js"></script><button>保存</button></body></html>');await writeFile(path.join(dir,'app.js'),'document.body.dataset.ready="yes";');}
  app=express();app.locals.sessions=new SessionAuth(db);app.use(express.json());app.use(userContextMiddleware(false));
  app.use('/api',createAppsRouter({} as never,new UserSandboxManager(root),db));cookie=await app.locals.sessions.createCookie('alice');
 });
 afterEach(()=>sqlite.close());
 const mint=()=>request(app).post('/api/apps/preview').set('Cookie',cookie).set('Origin','http://127.0.0.1:3000').send({appId:'one'});
 it('lists only owned versions and restores an authenticated independent application',async()=>{
  const workspaces=new UserSandboxManager(root),store=new AppVersionStore(db);const {sandboxFS}=await workspaces.getForUser('alice');
  const id=await store.capture('alice','one','原始应用',sandboxFS);
  expect((await request(app).get('/api/apps/one/versions')).status).toBe(401);
  expect((await request(app).get('/api/apps/one/versions').set('Cookie',cookie).set('Origin','null')).status).toBe(403);
  const bob=await app.locals.sessions.createCookie('bob');
  expect((await request(app).get('/api/apps/one/versions').set('Cookie',bob)).body.versions).toEqual([]);
  expect((await request(app).post(`/api/apps/one/versions/${id}/restore`).set('Cookie',bob)).status).toBe(400);
  const restored=await request(app).post(`/api/apps/one/versions/${id}/restore`).set('Cookie',cookie);
  expect(restored.status).toBe(200);expect(restored.body.app.id).not.toBe('one');
  expect(JSON.parse(await db.getConfig('alice','x_mini_apps')??'[]')).toContainEqual(restored.body.app);
  expect((await request(app).post('/api/apps/preview').set('Cookie',cookie).send({appId:restored.body.app.id})).status).toBe(200);
 });
 it('delegates only scoped assets without needing the account cookie and applies sandbox on every HTML entry',async()=>{
  const created=await mint();expect(created.status).toBe(200);const url=created.body.url;
  const html=await request(app).get(url).set('Origin','null');expect(html.status).toBe(200);
  expect(html.headers['content-security-policy']).toContain('sandbox allow-scripts');expect(html.headers['content-security-policy']).not.toContain('allow-same-origin');
  expect(html.text).toContain('Object.defineProperty(window,');expect(html.text).not.toContain(cookie);
  expect((await request(app).get(url.replace('index.html','app.js')).set('Origin','null')).text).toContain('dataset.ready');
    const standalone=await request(app).get(url).set('Sec-Fetch-Dest','document');expect(standalone.status).toBe(302);expect(standalone.headers.location).toContain('/__viewer');
    const viewer=await request(app).get(url.replace('index.html','__viewer')).set('Sec-Fetch-Dest','document');expect(viewer.status).toBe(200);expect(viewer.headers['content-security-policy']).toContain('frame-src');expect(viewer.text).not.toContain('allow-same-origin');
  expect((await request(app).get(url.replace('/alice/','/bob/')).set('Origin','null')).status).toBe(403);
  expect((await request(app).get('/api/apps/sandbox/alice/apps/one/index.html').set('Cookie',cookie)).headers['content-security-policy']).toContain('sandbox allow-scripts');
 });
 it('rejects expired/revoked capabilities, null-origin account calls and forged capability names',async()=>{
  const url=(await mint()).body.url;
  expect((await request(app).post('/api/apps/preview').set('Cookie',cookie).set('Origin','null').send({appId:'two'})).status).toBe(403);
  expect((await request(app).get('/api/apps').set('Cookie',cookie).set('Origin','null')).status).toBe(403);
  await app.locals.sessions.logout({headers:{cookie}} as never,{append:()=>{}} as never);
  expect((await request(app).get(url)).status).toBe(403);
  expect((await request(app).get('/api/apps/preview/alice/'+ 'a'.repeat(43)+'/index.html')).status).toBe(403);
 });
 it('persists app-local storage and proxies own backend data without granting other operations',async()=>{
  const url=(await mint()).body.url;const runtime=url.replace('index.html','__runtime');
  const run=(op:string,args:unknown)=>request(app).post(runtime).set('Origin','null').send({op,args});
  expect((await run('storage.set',{key:'count',value:'3',appId:'two'})).status).toBe(200);
    expect((await run('storage.set',{key:'Count',value:'separate-case'})).status).toBe(200);
  expect(await db.appBackendKvGet('alice','two','__browser_storage__:count')).toBeUndefined();
  expect((await request(app).get(url).set('Origin','null')).text).toContain('"count":"3"');
    expect((await request(app).get(url).set('Origin','null')).text).toContain('"Count":"separate-case"');
    expect(await db.appBackendKvList('alice','one')).not.toContain('__browser_storage__:count');
  expect((await run('backend',{kind:'kv',suffix:'',method:'PUT',key:'name',body:{value:{ok:true}},appId:'two'})).status).toBe(200);
  expect((await run('backend',{kind:'kv',suffix:'',method:'GET',key:'name'})).body.raw).toBe('{"ok":true}');
  expect((await run('backend',{kind:'kv',suffix:'/public-read-token',method:'POST'})).status).toBe(403);
    expect((await run('backend',{kind:'queue',suffix:'/work/push',method:'POST',body:{payload:'own-message'}})).status).toBe(200);
    expect((await run('backend',{kind:'queue',suffix:'/work/len',method:'GET'})).body.body.length).toBe(1);
    expect((await run('backend',{kind:'queue',suffix:'/work/pop',method:'GET'})).body.body.payload).toBe('own-message');
  expect((await run('fetch',{url:'/api/users/me/config'})).status).toBe(403);
  expect((await run('storage.set',{key:'big',value:'x'.repeat(16385)})).status).toBe(403);
    await db.appBackendKvSet('bob','two','shared','"explicitly-shared"');
    const shared=await db.createAppPublicReadToken('bob','two');
    expect((await run('public.read',{appId:'two',token:shared,key:'shared'})).body.raw).toBe('"explicitly-shared"');
    expect((await run('public.read',{appId:'one',token:shared,key:'shared'})).status).toBe(403);
    const ownShared=await db.createAppPublicReadToken('alice','one');
    expect((await run('public.read',{appId:'one',token:ownShared,key:'__browser_storage__:count'})).status).toBe(403);
  const reopened=(await mint()).body.url;expect((await request(app).get(reopened)).text).toContain('"count":"3"');
 });
 it('rejects symlinks and cross-app paths within the same user workspace',async()=>{
  const url=(await mint()).body.url;
  const dir=path.join(root,'users/alice/workspace/apps/one');await symlink('../two/app.js',path.join(dir,'cross.js'));
  expect((await request(app).get(url.replace('index.html','cross.js'))).status).toBe(403);
  expect((await request(app).get(url.replace('index.html','%2e%2e%2ftwo%2fapp.js'))).status).toBe(403);
 });
 it('compiles JSX without evaluating model code on the server and gives content no data capability',async()=>{
  const created=await request(app).post('/api/apps/preview').set('Cookie',cookie).set('Origin','http://127.0.0.1:3000').send({mode:'react',content:'export default function Message(){return <button onClick={()=>parent.document.body.remove()}>计数</button>}'});
  expect(created.status).toBe(200);const page=await request(app).get(created.body.url);expect(page.status).toBe(200);expect(page.text).toContain('__xCreateRoot');
  expect((await request(app).post(created.body.url.replace('index.html','__runtime')).set('Origin','null').send({op:'storage.set',args:{key:'a',value:'b'}})).status).toBe(403);
 });
});
