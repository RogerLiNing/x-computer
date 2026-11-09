import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {setTimeout as delay} from 'node:timers/promises';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';import {UserSandboxManager} from '../tooling/UserSandboxManager.js';
import {ChatRunService} from './ChatRunService.js';import {UncertainToolOutcomeError} from '../tooling/UncertainToolOutcomeError.js';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};}
describe('durable team and group coordination',()=>{
 let sqlite:SqliteAppDatabase,db:SqliteDatabaseAdapter,workspaces:UserSandboxManager,runs:ChatRunService,parentId:string,release:ReturnType<typeof gate>;
 let parentPromise:Promise<unknown>,loop:ReturnType<typeof vi.fn>;
 const config={providerId:'test',modelId:'test',apiKey:'private-key'};
 const make=()=>new ChatRunService({db,orchestrator:{runChatAgentLoop:async(p:any)=>loop(p)} as never,getSandboxFS:async user=>(await workspaces.getForUser(user)).sandboxFS,getLLMConfig:async()=>config});
 beforeEach(async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'team-runs-'));sqlite=new SqliteAppDatabase(root);db=new SqliteDatabaseAdapter(sqlite);workspaces=new UserSandboxManager(root);await db.ensureUser('owner');
  await db.setConfig('owner','x_agents',JSON.stringify(['writer','checker','third','fourth'].map(id=>({id,name:id,systemPrompt:id,toolNames:['file.write','file.read','file.present']}))));
  await db.setConfig('owner','x_agent_teams',JSON.stringify([{id:'team',name:'写作接力',agentIds:['writer','checker']}]));
  await db.setConfig('owner','x_agent_groups',JSON.stringify([{id:'group',name:'四人协作',agentIds:['writer','checker','third','fourth']}]));
  release=gate();const entered=gate();
  loop=vi.fn(async p=>{
   if(!p.agentId){await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:[{id:'team-call',name:'x.dispatch_team',arguments:{}},{id:'group-call',name:'x.dispatch_group',arguments:{}},{id:'status-call',name:'x.get_agent_run',arguments:{}}]}]);entered.resolve();await release.promise;return {content:'已交办',stopReason:'completed'};}
   return {content:p.agentId,stopReason:'completed'};
  });
  runs=make();const session=await db.createSession('owner','主交办');
  const parent=await runs.accept({userId:'owner',sessionId:session.id,requestId:'parent',providerId:'test',modelId:'test',systemPrompt:'',messages:[{role:'user',content:'安排团队'}],allowedToolNames:['x.dispatch_team','x.dispatch_group','file.write','file.read','file.present']});parentId=parent.id;
  parentPromise=runs.launch('owner',parentId);await entered.promise;
 });
 afterEach(async()=>{await runs.stop('owner',parentId);release.resolve();await parentPromise;sqlite.close();});
 const dispatch=(mode:'team'|'group')=>runs.expertDispatch({action:mode,userId:'owner',parentRunId:parentId,toolCallId:`${mode}-call`,teamId:'team',groupId:'group',goal:'交付报告'}) as Promise<any>;
 async function write(p:any,content:string){
  const {sandboxFS}=await workspaces.getForAgent('owner',p.agentId,p.agentRunId);await sandboxFS.writeOverwrite('result.md',content);
  await p.onCheckpoint([...p.messages,{role:'assistant',content:'保存',tool_calls:[{id:'write',name:'file.write',arguments:{path:'result.md'}}]},{role:'tool',tool_call_id:'write',content:JSON.stringify({path:'result.md'})},{role:'assistant',content:'已交付文件'}]);
  return {content:'已交付文件',stopReason:'completed'};
 }
 it('passes verified source text to the next member and keeps both files reviewable',async()=>{
  loop.mockImplementation(async p=>{expect(p.systemPrompt).toContain('不得编造');if(p.agentId==='checker')expect(p.messages[0].content).toContain('SOURCE_314');return write(p,p.agentId==='writer'?'SOURCE_314':'最终报告');});
  const run=await dispatch('team');await runs.wait(run.runId);const result=await runs.get('owner',run.runId);
  expect(result.status).toBe('completed');expect(result.review?.status).toBe('pending');expect(result.artifacts.map(item=>item.name)).toEqual(['result.md','result.md']);expect(result.artifacts[0].path).toContain('agents/writer/runs/');expect(result.artifacts[1].path).toContain('agents/checker/runs/');
  expect(loop.mock.calls.filter(([p])=>p.agentId==='writer')).toHaveLength(1);expect(loop.mock.calls.filter(([p])=>p.agentId==='checker')).toHaveLength(1);
  const before=await runs.workbench('owner');expect(before.finished.filter(item=>item.id!==parentId)).toHaveLength(1);
  await runs.reviewRun('owner',result.id,{decision:'accepted',expectedUpdatedAt:result.updatedAt});
  expect((await runs.get('owner',result.expertRuns![0].id)).review?.status).toBe('accepted');
  expect((await runs.attention('owner')).some(item=>item.sourceId===result.expertRuns![0].id)).toBe(false);
 });
 it('runs a group in bounded parallel batches and collects every real result',async()=>{
  let active=0,peak=0;loop.mockImplementation(async p=>{active++;peak=Math.max(peak,active);await delay(40);active--;return {content:`${p.agentId}完成`,stopReason:'completed'};});
  const run=await dispatch('group');await runs.wait(run.runId);const result=await runs.get('owner',run.runId);
  expect(result.status).toBe('completed');expect(peak).toBe(2);for(const name of ['writer','checker','third','fourth'])expect(result.content).toContain(`${name}完成`);
 });
 it('hands binary artifacts to the next member without relying on text excerpts',async()=>{
  const data=Buffer.concat([Buffer.alloc(96*1024,0xff),Buffer.from('BINARY_TAIL')]);let received=false;
  loop.mockImplementation(async p=>{
   const sandbox=(await workspaces.getForAgent('owner',p.agentId,p.agentRunId)).sandboxFS;
   if(p.agentId==='writer'){
    await sandbox.writeBinary('bundle.bin',data);await p.onCheckpoint([...p.messages,{role:'assistant',content:'交付',tool_calls:[{id:'binary',name:'file.present',arguments:{path:'bundle.bin'}}]},{role:'tool',tool_call_id:'binary',content:JSON.stringify({presented:true,path:'bundle.bin'})},{role:'assistant',content:'二进制成果已交付'}]);return {content:'二进制成果已交付',stopReason:'completed'};
   }
   const instruction=p.messages.find((message:any)=>message.content.startsWith('交接材料的完整工作副本'));const files=JSON.parse(instruction.content.slice(instruction.content.indexOf('\n')+1));
   expect(await sandbox.readBinary(files[0].path)).toEqual(data);received=true;return write(p,'完整收到二进制材料');
  });
  const run=await dispatch('team');await runs.wait(run.runId);const result=await runs.get('owner',run.runId);expect(result.status).toBe('completed');expect(received).toBe(true);expect(result.artifacts.some(file=>file.name==='bundle.bin')).toBe(true);
 });
 it('resumes a failed member after service reconstruction without rerunning completed members',async()=>{
  let attempts=0;loop.mockImplementation(async p=>{if(p.agentId==='checker'&&attempts++===0)throw new Error('temporary model failure');return write(p,'saved result');});
  const run=await dispatch('team');await runs.wait(run.runId);expect((await runs.get('owner',run.runId)).status).toBe('blocked');expect((await runs.get('owner',run.runId)).artifacts[0].path).toContain('agents/writer/runs/');
  const fresh=make();await fresh.resume('owner',run.runId);await fresh.wait(run.runId);expect((await fresh.get('owner',run.runId)).status).toBe('completed');
  expect(loop.mock.calls.filter(([p])=>p.agentId==='writer')).toHaveLength(1);expect(attempts).toBe(2);
 });
 it('keeps the completed stage visible and resumes only the stopped member',async()=>{
  const entered=gate();let checks=0;
  loop.mockImplementation(async p=>{
   if(p.agentId==='checker'&&checks++===0){entered.resolve();await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));}
   return write(p,'阶段成果');
  });
  const run=await dispatch('team');await entered.promise;await runs.stop('owner',run.runId);await runs.wait(run.runId);
  const paused=await runs.get('owner',run.runId);expect(paused.status).toBe('paused');expect(paused.artifacts[0].path).toContain('agents/writer/runs/');
  const fresh=make();await fresh.resume('owner',run.runId);await fresh.wait(run.runId);expect((await fresh.get('owner',run.runId)).status).toBe('completed');
  expect(loop.mock.calls.filter(([p])=>p.agentId==='writer')).toHaveLength(1);expect(checks).toBe(2);
 });
 it('runs requested revisions in new workspaces and keeps original delivered files unchanged',async()=>{
  loop.mockImplementation(async p=>write(p,p.messages[0].content.includes('修改版标识')?'修订正文':'原始正文'));
  const run=await dispatch('team');await runs.wait(run.runId);const original=await runs.get('owner',run.runId);
  await runs.reviewRun('owner',run.runId,{decision:'changes_requested',feedback:'请加入修改版标识',expectedUpdatedAt:original.updatedAt});
  const revision=await runs.revise('owner',run.runId);await runs.wait(revision.id);const updated=await runs.get('owner',revision.id);expect(updated.status).toBe('completed');
  const sandbox=(await workspaces.getForUser('owner')).sandboxFS;
  for(const file of original.artifacts)expect(await sandbox.read(file.path)).toBe('原始正文');
  for(const file of updated.artifacts){expect(file.path).not.toBe(original.artifacts[0].path);expect(await sandbox.read(file.path)).toBe('修订正文');}
  expect(updated.artifacts).toHaveLength(2);
  const latest=await runs.expertDispatch({action:'status',userId:'owner',parentRunId:parentId,toolCallId:'status-call',runId:run.runId});
  expect(latest.runId).toBe(revision.id);expect(latest.artifacts.map(file=>file.path)).toEqual(updated.artifacts.map(file=>file.path));
 });
 it('repairs a lost dispatch receipt using the same child record rather than executing it again',async()=>{
  loop.mockImplementation(async p=>({content:p.agentId,stopReason:'completed'}));const run=await dispatch('team');await runs.wait(run.runId);
  const row=await db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[run.runId]);const metadata=JSON.parse(row!.metadata_json),record=metadata.chatRun;
  record.status='interrupted';record.modelCompleted=false;record.checkpoint=record.checkpoint.filter((m:any)=>!(m.role==='tool'&&m.tool_call_id==='member-0'));
  await db.run('UPDATE tasks SET metadata_json=? WHERE id=?',[JSON.stringify(metadata),run.runId]);
  const before=loop.mock.calls.length,fresh=make();expect((await fresh.get('owner',run.runId)).canResume).toBe(true);await fresh.resume('owner',run.runId);await fresh.wait(run.runId);
  expect((await fresh.get('owner',run.runId)).status).toBe('completed');expect(loop.mock.calls).toHaveLength(before);
 });
 it('does not replay a member with an uncertain side effect when the team is continued',async()=>{
  loop.mockImplementation(async p=>{await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:[{id:'unknown',name:'file.write',arguments:{path:'uncertain.md'}}]}]);throw new UncertainToolOutcomeError('outcome unknown');});
  const run=await dispatch('team');await runs.wait(run.runId);expect((await runs.get('owner',run.runId)).status).toBe('blocked');
  const before=loop.mock.calls.length,fresh=make();await fresh.resume('owner',run.runId);await fresh.wait(run.runId);
  expect((await fresh.get('owner',run.runId)).status).toBe('blocked');expect(loop.mock.calls).toHaveLength(before);
 });
});
