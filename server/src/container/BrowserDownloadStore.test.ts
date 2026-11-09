import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {beforeEach,describe,it,expect} from 'vitest';
import {BrowserDownloadStore} from './BrowserDownloadStore.js';
import {SandboxFS} from '../tooling/SandboxFS.js';

describe('browser download delivery',()=>{
 let root:string;let sandbox:SandboxFS;let store:BrowserDownloadStore;let folder:string;
 const bytes=Buffer.from('浏览器生成的真实成果');
 const hash=createHash('sha256').update(bytes).digest('hex');
 beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'browser-delivery-'));sandbox=new SandboxFS(path.join(root,'work'));
  await mkdir(sandbox.getRoot());folder=path.join(root,'computers','users','owner','workspace','.x-browser','exports');await mkdir(folder,{recursive:true});
  store=new BrowserDownloadStore(path.join(root,'computers'),async()=>sandbox);
 });
 async function fixture(name='成果.md',size=bytes.length){
  const id=randomUUID();await writeFile(path.join(folder,id),bytes);
  await writeFile(path.join(folder,'manifest.json'),JSON.stringify([{id,name,size,sha256:hash,createdAt:Date.now()}]));return id;
 }
 it('copies verified bytes, returns a deliverable and reuses it on retry without changing the source',async()=>{
  const id=await fixture();const first=await store.present('owner',id);const second=await store.present('owner',id);
  expect(second).toEqual(first);expect(first.presented).toBe(true);expect(await sandbox.readBinary(first.path)).toEqual(bytes);expect(await readFile(path.join(folder,id))).toEqual(bytes);
 });
 it('atomically handles simultaneous delivery requests without leaving partial copies',async()=>{
  const id=await fixture();const results=await Promise.all([store.present('owner',id),store.present('owner',id)]);
  expect(results[0]).toEqual(results[1]);expect(await sandbox.readBinary(results[0].path)).toEqual(bytes);
 });
 it('does not expose another user or accept paths as download identifiers',async()=>{
  const id=await fixture();await expect(store.present('other',id)).rejects.toThrow('不存在');await expect(store.present('owner','../manifest.json')).rejects.toThrow('标识');
 });
 it('rejects oversized, tampered and symlinked sources',async()=>{
  const id=await fixture('成果.md',11*1024*1024);await expect(store.present('owner',id)).rejects.toThrow('大小');
  await fixture();const current=(await store.list('owner'))[0];await writeFile(path.join(folder,current.id),'changed');await expect(store.present('owner',current.id)).rejects.toThrow('校验');
  const link=await fixture();await symlink(path.join(folder,link),path.join(folder,'outside-link'));
  const meta={id:randomUUID(),name:'fake.md',size:bytes.length,sha256:hash,createdAt:Date.now()};await symlink(path.join(folder,link),path.join(folder,meta.id));await writeFile(path.join(folder,'manifest.json'),JSON.stringify([meta]));await expect(store.present('owner',meta.id)).rejects.toThrow('链接');
 });
 it('preserves changed destination files rather than overwriting them',async()=>{
  const id=await fixture();const delivered=await store.present('owner',id);await writeFile(path.join(sandbox.getRoot(),delivered.path),'用户修改过的内容');
  await expect(store.present('owner',id)).rejects.toThrow('已修改');expect(await sandbox.read(delivered.path)).toBe('用户修改过的内容');
 });
 it('rejects malicious manifest names and a symlinked destination directory',async()=>{
  const id=await fixture('../../secret');await expect(store.present('owner',id)).rejects.toThrow('名称');
  await fixture();await symlink(folder,path.join(sandbox.getRoot(),'下载'));const current=(await store.list('owner'))[0];await expect(store.present('owner',current.id)).rejects.toThrow();
 });
});
