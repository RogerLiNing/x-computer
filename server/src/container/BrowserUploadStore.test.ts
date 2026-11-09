import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,symlink,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {beforeEach,describe,it,expect} from 'vitest';
import {BrowserUploadStore} from './BrowserUploadStore.js';import {SandboxFS} from '../tooling/SandboxFS.js';
describe('upload file boundary',()=>{
 let root:string;let sandbox:SandboxFS;let store:BrowserUploadStore;
 beforeEach(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'browser-upload-'));sandbox=new SandboxFS(path.join(root,'files'));await mkdir(sandbox.getRoot());await mkdir(path.join(root,'computers/users/owner/workspace/.x-browser'),{recursive:true});store=new BrowserUploadStore(path.join(root,'computers'),async()=>sandbox);await writeFile(path.join(sandbox.getRoot(),'测试.txt'),'用户确认的文件');});
 it('binds consent to actual bytes and stages a separate immutable copy',async()=>{
  const file=await store.inspect('owner','测试.txt');const id=randomUUID();await store.stage('owner',id,file);
  expect(await readFile(path.join(root,'computers/users/owner/workspace/.x-browser/imports',id),'utf8')).toBe('用户确认的文件');expect(file.name).toBe('测试.txt');
  await store.removeStage('owner',id);expect(await sandbox.read('测试.txt')).toBe('用户确认的文件');
 });
 it('refuses files changed after the request instead of uploading their new contents',async()=>{
  const file=await store.inspect('owner','测试.txt');await writeFile(path.join(sandbox.getRoot(),'测试.txt'),'后来修改');await expect(store.stage('owner',randomUUID(),file)).rejects.toThrow('已变化');
 });
 it('rejects escapes, file symlinks and oversized files',async()=>{
  await expect(store.inspect('owner','../outside')).rejects.toThrow();await expect(store.inspect('owner','/etc/passwd')).rejects.toThrow();
  await symlink(path.join(sandbox.getRoot(),'测试.txt'),path.join(sandbox.getRoot(),'link'));await expect(store.inspect('owner','link')).rejects.toThrow();
  await writeFile(path.join(sandbox.getRoot(),'large.bin'),Buffer.alloc(6*1024*1024));await expect(store.inspect('owner','large.bin')).rejects.toThrow('大小');
 });
 it('rejects a staged-directory symlink and invalid request identifiers',async()=>{
  const folder=path.join(root,'computers/users/owner/workspace/.x-browser');await mkdir(folder,{recursive:true});await symlink(sandbox.getRoot(),path.join(folder,'imports'));
  const file=await store.inspect('owner','测试.txt');await expect(store.stage('owner',randomUUID(),file)).rejects.toThrow('链接');await expect(store.stage('owner','../x',file)).rejects.toThrow('标识');
 });
 it.skipIf(process.platform==='win32')('rejects named pipes without waiting for a writer',async()=>{
  await promisify(execFile)('mkfifo',[path.join(sandbox.getRoot(),'pipe')]);await expect(store.inspect('owner','pipe')).rejects.toThrow('大小');
 });

});
