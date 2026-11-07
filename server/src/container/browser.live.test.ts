import {BrowserUploadStore} from './BrowserUploadStore.js';
import { BrowserDownloadStore } from './BrowserDownloadStore.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import {describe,expect,it} from 'vitest';
import {UserContainerManager} from './UserContainerManager.js';
import {BrowserComputer} from './BrowserComputer.js';

const image=process.env.X_BROWSER_TEST_IMAGE;
describe.skipIf(!image)('real container browser handoff',()=>{
 it('shows real pages, excludes concurrent agent input, invalidates old snapshots and recovers safely',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'x-browser-live-'));
  const manager=new UserContainerManager(root,{imageName:image,namePrefix:`x-browser-test-${Date.now()}`,networkMode:'none',memoryLimit:'1g',pidsLimit:256,idleTimeout:0,maxIdleTime:0});
  const sandbox=new SandboxFS(path.join(root,'main-user'));await mkdir(sandbox.getRoot());
  const computer=new BrowserComputer(manager,new BrowserDownloadStore(root,async()=>sandbox),new BrowserUploadStore(root,async()=>sandbox));const uid='acceptance';
  const call=(actor:'human'|'agent',input:Record<string,unknown>)=>computer.request(uid,actor,input);
  try{
   await expect.poll(async()=>{try{await call('human',{action:'start'});return true;}catch{return false;}},{timeout:30000}).toBe(true);
   await call('human',{action:'demo'});
   const frame=await call('human',{action:'frame'});expect(Buffer.from(frame.image,'base64').subarray(0,2).toString('hex')).toBe('ffd8');
   await expect(call('agent',{action:'snapshot'})).rejects.toThrow('用户正在操作');
   await call('human',{action:'release'});
   const first=await call('agent',{action:'snapshot'});const field=first.elements.find((e:any)=>e.tag==='INPUT').index;
   await call('agent',{action:'type',target:field,text:'助手已经接着做了',snapshot:first.snapshot});
   await expect(call('agent',{action:'click',target:field,snapshot:first.snapshot})).rejects.toThrow('页面已变化');
   const next=await call('agent',{action:'snapshot'});const button=next.elements.find((e:any)=>e.tag==='BUTTON').index;
   await call('agent',{action:'click',target:button,snapshot:next.snapshot});
   expect((await call('agent',{action:'snapshot'})).text).toContain('助手已经接着做了');
   await call('human',{action:'take'});
   await expect(call('agent',{action:'type',target:field,text:'不应执行',snapshot:next.snapshot})).rejects.toThrow('用户正在操作');
   await expect(call('human',{action:'navigate',url:'http://127.0.0.1:7788'})).rejects.toThrow('未获管理员允许');
   await call('human',{action:'release'});
   const readyDownload=await call('agent',{action:'snapshot'});const downloadButton=readyDownload.elements.find((e:any)=>e.label==='下载成果').index;
   await call('agent',{action:'click',target:downloadButton,snapshot:readyDownload.snapshot});
   await expect.poll(async()=>{const state=await call('agent',{action:'state'});if(state.downloadError)throw new Error(state.downloadError);return (await call('agent',{action:'downloads'})).downloads.length;},{timeout:15000}).toBe(1);
   const saved=(await call('agent',{action:'downloads'})).downloads[0];
   const delivered=await call('agent',{action:'present_download',id:saved.id});
   expect(await sandbox.read(delivered.path)).toBe('助手已经接着做了');
   expect(await call('agent',{action:'present_download',id:saved.id})).toEqual(delivered);
   await writeFile(path.join(sandbox.getRoot(),'上传.txt'),'授权文件内容');
   const uploadView=await call('agent',{action:'snapshot'});const uploadTarget=uploadView.elements.find((item:any)=>item.type==='file').index;
   const asked=await computer.requestUpload(uid,{path:'上传.txt',target:uploadTarget,snapshot:uploadView.snapshot});
   await expect(call('agent',{action:'upload_approve',id:asked.requestId})).rejects.toThrow('用户确认');
   expect((await call('human',{action:'state'})).uploadRequests.find((item:any)=>item.id===asked.requestId).status).toBe('pending');
   await computer.approveUpload(uid,asked.requestId);
   expect((await call('agent',{action:'snapshot'})).text).toContain('网页读取：授权文件内容');
   await expect(computer.approveUpload(uid,asked.requestId)).rejects.toThrow('已处理');
   const processed=await call('agent',{action:'snapshot'});const processedDownload=processed.elements.find((item:any)=>item.label==='下载成果').index;
   await call('agent',{action:'click',target:processedDownload,snapshot:processed.snapshot});
   await expect.poll(async()=> (await call('agent',{action:'downloads'})).downloads.length,{timeout:15000}).toBe(2);
   const resultFile=(await call('agent',{action:'downloads'})).downloads.at(-1);const resultDelivery=await call('agent',{action:'present_download',id:resultFile.id});expect(await sandbox.read(resultDelivery.path)).toContain('授权文件内容');
   await writeFile(path.join(sandbox.getRoot(),'拒绝.txt'),'拒绝的内容不得提供');
   const rejectView=await call('agent',{action:'snapshot'});const denied=await computer.requestUpload(uid,{path:'拒绝.txt',target:uploadTarget,snapshot:rejectView.snapshot});
   await call('human',{action:'upload_reject',id:denied.requestId});
   await expect(computer.approveUpload(uid,denied.requestId)).rejects.toThrow('已处理');
   expect((await call('agent',{action:'snapshot'})).text).not.toContain('拒绝的内容不得提供');
   const staleView=await call('agent',{action:'snapshot'});const stale=await computer.requestUpload(uid,{path:'上传.txt',target:uploadTarget,snapshot:staleView.snapshot});
   await call('human',{action:'take'});await expect(computer.approveUpload(uid,stale.requestId)).rejects.toThrow('已处理');await call('human',{action:'release'});
   const changedView=await call('agent',{action:'snapshot'});const changedFile=await computer.requestUpload(uid,{path:'上传.txt',target:uploadTarget,snapshot:changedView.snapshot});
   await writeFile(path.join(sandbox.getRoot(),'上传.txt'),'修改后的内容');await expect(computer.approveUpload(uid,changedFile.requestId)).rejects.toThrow('已变化');
   const restartView=await call('agent',{action:'snapshot'});const pending=await computer.requestUpload(uid,{path:'上传.txt',target:uploadTarget,snapshot:restartView.snapshot});
   const id=await manager.getOrCreateContainer({userId:uid});const container=new Docker().getContainer(id);
   const info=await container.inspect();expect(info.HostConfig.NetworkMode).toBe('none');expect(info.HostConfig.Privileged).toBe(false);expect(Object.keys(info.NetworkSettings.Ports??{})).toHaveLength(0);
   await container.stop();await container.start();
   await expect.poll(async()=>{try{return (await call('human',{action:'state'})).holder;}catch{return 'starting';}},{timeout:20000}).toBe('human');
   expect((await call('human',{action:'state'})).uploadRequests.find((item:any)=>item.id===pending.requestId).status).toBe('expired');
   await expect(computer.approveUpload(uid,pending.requestId)).rejects.toThrow('已处理');
  }finally{manager.stopMonitoring();const id=await manager.getOrCreateContainer({userId:uid});await new Docker().getContainer(id).stop().catch(()=>{});}
 },90000);
 it.skipIf(process.env.X_BROWSER_PUBLIC_TEST!=='1')('reads an allowed public HTTPS site through the pinned proxy',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'x-browser-public-'));
  const manager=new UserContainerManager(root,{imageName:image,namePrefix:`x-browser-public-${Date.now()}`,networkMode:'bridge',browserAllowedOrigins:['https://demo.playwright.dev'],browserDnsMode:'cloudflare',memoryLimit:'1g',pidsLimit:256,idleTimeout:0,maxIdleTime:0});
  const computer=new BrowserComputer(manager);const uid='public-test';
  try{
   await computer.request(uid,'human',{action:'start'});
   // This known static GET fixture is safe to read again; never retry the following input actions.
   try{await computer.request(uid,'human',{action:'navigate',url:'https://demo.playwright.dev/todomvc/'});}
   catch{await computer.request(uid,'human',{action:'navigate',url:'https://demo.playwright.dev/todomvc/'});}
   await computer.request(uid,'human',{action:'release'});
   const observed=await computer.request(uid,'agent',{action:'snapshot'});
   expect(new URL(observed.url).origin).toBe('https://demo.playwright.dev');expect(new URL(observed.url).pathname).toBe('/todomvc/');
   const input=observed.elements.find((element:any)=>element.tag==='INPUT' && /needs.*done/i.test(element.label));expect(input).toBeTruthy();
   await computer.request(uid,'agent',{action:'type',target:input.index,text:'X browser public acceptance',snapshot:observed.snapshot});
   const typed=await computer.request(uid,'agent',{action:'snapshot'});
   await computer.request(uid,'agent',{action:'key',key:'Enter',snapshot:typed.snapshot});
   expect((await computer.request(uid,'agent',{action:'snapshot'})).text).toContain('X browser public acceptance');
   await expect(computer.request(uid,'human',{action:'navigate',url:'http://127.0.0.1:7788'})).rejects.toThrow();
   await computer.request(uid,'human',{action:'take'});
   await expect(computer.request(uid,'human',{action:'navigate',url:'https://example.org'})).rejects.toThrow('未获管理员允许');
   expect((await computer.request(uid,'human',{action:'frame'})).image).toBeTruthy();
  }finally{manager.stopMonitoring();const id=await manager.getOrCreateContainer({userId:uid});await new Docker().getContainer(id).stop({t:2}).catch(()=>{});}
 },60000);

});
