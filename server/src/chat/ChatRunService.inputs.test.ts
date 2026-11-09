import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';import {mkdtemp,rename} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import{createHash}from'node:crypto';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../db/database.js';import{UserSandboxManager}from'../tooling/UserSandboxManager.js';import{ChatRunService}from'./ChatRunService.js';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};}
describe('durable expert material admission',()=>{
 let sqlite:SqliteAppDatabase,db:SqliteDatabaseAdapter,spaces:UserSandboxManager,runs:ChatRunService,parentId:string,release:ReturnType<typeof gate>,active:Promise<unknown>,child:ReturnType<typeof vi.fn>;
 const bytes=Buffer.concat([Buffer.alloc(96*1024,0xff),Buffer.from('END_OF_FULL_INPUT')]);
 const make=()=>new ChatRunService({db,orchestrator:{runChatAgentLoop:async(p:any)=>child(p)} as never,getSandboxFS:async uid=>(await spaces.getForUser(uid)).sandboxFS,getLLMConfig:async()=>({providerId:'test',modelId:'test'})});
 beforeEach(async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'expert-material-'));sqlite=new SqliteAppDatabase(root);db=new SqliteDatabaseAdapter(sqlite);spaces=new UserSandboxManager(root);await db.ensureUser('owner');
  const sandbox=(await spaces.getForUser('owner')).sandboxFS;await sandbox.writeBinary('资料/source.bin',bytes);await sandbox.writeOverwrite('other.txt','not attached');
  await db.setConfig('owner','x_agents',JSON.stringify([{id:'reader',name:'材料专家',systemPrompt:'读取材料',toolNames:['file.read']} ]));
  release=gate();const entered=gate();child=vi.fn(async(p:any)=>{await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:[{id:'delegate',name:'x.dispatch_agent',arguments:{}}]}]);entered.resolve();await release.promise;return {content:'已交办',stopReason:'completed'};});
  runs=make();const session=await db.createSession('owner','材料交办'),parent=await runs.accept({userId:'owner',sessionId:session.id,requestId:'parent',messages:[{role:'user',content:'帮我读取材料'}],userMessage:{content:'帮我读取材料',attachedFiles:[{name:'友好名称.bin',path:'资料/source.bin'}]},providerId:'test',modelId:'test',systemPrompt:'',allowedToolNames:['x.dispatch_agent','file.read']});parentId=parent.id;active=runs.launch('owner',parentId);await entered.promise;child.mockClear();
 });
 afterEach(async()=>{await runs.stop('owner',parentId);release.resolve();await active;for(const row of await db.getAllTasks())await runs.wait(row.id);sqlite.close();});
 const dispatch=(inputFiles?:string[])=>runs.expertDispatch({action:'dispatch',userId:'owner',parentRunId:parentId,toolCallId:'delegate',agentId:'reader',goal:'读取完整材料',inputFiles}) as Promise<any>;
 it('copies complete attachments before model execution and preserves their display name and fingerprint',async()=>{
  child.mockImplementation(async p=>{
   const message=p.messages.find((m:any)=>m.content.startsWith('交接材料的完整工作副本'));
   const files=JSON.parse(message.content.slice(message.content.indexOf('\n')+1));expect(files[0].name).toBe('友好名称.bin');
   const sandbox=(await spaces.getForAgent('owner','reader',p.agentRunId)).sandboxFS;expect(await sandbox.readBinary(files[0].path)).toEqual(bytes);return {content:'材料已完整收到',stopReason:'completed'};
  });
  const receipt=await dispatch();await runs.wait(receipt.runId);const result=await runs.get('owner',receipt.runId);expect(result.status).toBe('completed');
  expect(result.inputFiles?.[0]).toMatchObject({name:'友好名称.bin',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});expect(result.inputFiles![0].path).toContain(`/runs/${result.id}/输入/`);
  expect(await (await spaces.getForUser('owner')).sandboxFS.readBinary('资料/source.bin')).toEqual(bytes);
 });
 it('does not grant unrelated files or accept changed material lists on a repeated dispatch',async()=>{
  child.mockResolvedValue({content:'received',stopReason:'completed'});await expect(dispatch(['other.txt'])).rejects.toThrow('本轮附件');const first=await dispatch();await runs.wait(first.runId);
  await expect(dispatch([])).rejects.toThrow('其他任务');expect(child).toHaveBeenCalledTimes(1);
 });
 it('keeps the original snapshot across stop and service reconstruction when the source changes',async()=>{
  const entered=gate();child.mockImplementationOnce(async p=>{entered.resolve();await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));}).mockImplementationOnce(async p=>{
   const inputs=p.messages.filter((m:any)=>m.content.startsWith('交接材料的完整工作副本'));expect(inputs).toHaveLength(1);const file=JSON.parse(inputs[0].content.slice(inputs[0].content.indexOf('\n')+1))[0];expect(await (await spaces.getForAgent('owner','reader',p.agentRunId)).sandboxFS.readBinary(file.path)).toEqual(bytes);return {content:'恢复后完整收到',stopReason:'completed'};
  });
  const receipt=await dispatch();await entered.promise;await runs.stop('owner',receipt.runId);await runs.wait(receipt.runId);
  const sandbox=(await spaces.getForUser('owner')).sandboxFS;await rename(path.join(sandbox.getRoot(),'资料/source.bin'),path.join(sandbox.getRoot(),'资料/original-preserved.bin'));await sandbox.writeBinary('资料/source.bin',Buffer.from('new version'));
  const fresh=make();await fresh.resume('owner',receipt.runId);await fresh.wait(receipt.runId);expect((await fresh.get('owner',receipt.runId)).status).toBe('completed');expect(child).toHaveBeenCalledTimes(2);
 });
});
