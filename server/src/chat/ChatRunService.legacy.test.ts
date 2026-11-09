import{describe,it,expect,vi}from'vitest';import{mkdtemp}from'node:fs/promises';import path from'node:path';import os from'node:os';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../db/database.js';import{UserSandboxManager}from'../tooling/UserSandboxManager.js';
import{ChatRunService}from'./ChatRunService.js';import{createAgentHandlers}from'../orchestrator/tools/agent.js';import{UncertainToolOutcomeError}from'../tooling/UncertainToolOutcomeError.js';
function gate(){let resolve!:()=>void;return{promise:new Promise<void>(done=>resolve=done),resolve:()=>resolve()};}
async function fixture(kind:'agent'|'team'|'group',child?:(p:any)=>Promise<any>){
 const root=await mkdtemp(path.join(os.tmpdir(),'legacy-delegation-')),sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),spaces=new UserSandboxManager(root);
 await db.ensureUser('owner');await db.setConfig('owner','x_agents',JSON.stringify(['writer','checker'].map(id=>({id,name:id,systemPrompt:'写报告',toolNames:['file.write','file.present']}))));
 for(const key of ['x_agent_teams','x_agent_groups'])await db.setConfig('owner',key,JSON.stringify([{id:kind==='team'?'team':'group',name:kind,agentIds:['writer','checker']}]));
 const write=async(p:any)=>{const fs=(await spaces.getForAgent('owner',p.agentId,p.agentRunId)).sandboxFS;await fs.writeOverwrite('report.md',`${p.agentId} report`);await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:[{id:'write',name:'file.write',arguments:{path:'report.md'}}]},{role:'tool',tool_call_id:'write',content:JSON.stringify({path:'report.md'})},{role:'assistant',content:`${p.agentId} done`}]);return{content:`${p.agentId} done`,stopReason:'completed' as const};};
 const member=vi.fn(child??write),progress=vi.fn(),native=vi.fn();let receipt:any;
 const tool=`x.run_${kind}`,input={agent_id:'writer',team_id:'team',group_id:'group',goal:'整理报告'};
 const make=()=>{
  let service:ChatRunService;
  const handlers=createAgentHandlers({resolveRunCustomAgentLoop:()=>native,resolveExpertDispatchRunner:()=>request=>service.expertDispatch(request)});
  service=new ChatRunService({db,getSandboxFS:async()=>(await spaces.getForUser('owner')).sandboxFS,getLLMConfig:async()=>({providerId:'mock',modelId:'test'}),orchestrator:{runChatAgentLoop:async(p:any)=>{
   if(p.agentId)return member(p);
   if(p.messages.some((message:any)=>message.role==='tool'&&message.tool_call_id==='legacy-call'))return{content:'已接回真实成果',stopReason:'completed'};
   const history=[...p.messages,{role:'assistant',content:'交给专家',tool_calls:[{id:'legacy-call',name:tool,arguments:input}]}];await p.onCheckpoint(history);
   const handler=kind==='agent'?handlers.runAgentHandler:kind==='team'?handlers.runTeamHandler:handlers.runGroupHandler;
   receipt=await handler(input,{userId:'owner',runId:p.runId,toolCallId:'legacy-call',signal:p.signal,onGroupRunProgress:(_user:string,data:unknown)=>progress(data)});
   await p.onCheckpoint([...history,{role:'tool',tool_call_id:'legacy-call',content:JSON.stringify(receipt)},{role:'assistant',content:'已接回真实成果'}]);return{content:'已接回真实成果',stopReason:'completed'};
  }} as never});return service;
 };
 const runs=make(),session=await db.createSession('owner','旧入口'),run=await runs.accept({userId:'owner',sessionId:session.id,requestId:'legacy',providerId:'mock',modelId:'test',systemPrompt:'',messages:[{role:'user',content:'整理报告'}],allowedToolNames:[tool,'file.write','file.present'],blockedToolNames:['file.delete']});
 const children=async()=> (await db.getAllTasks()).map(row=>JSON.parse(row.metadata_json??'{}').chatRun).filter(record=>record?.expert?.parentRunId===run.id);
 return{sqlite,db,runs,make,run,session,spaces,member,write,native,progress,children,getReceipt:()=>receipt};
}
describe('legacy tools share the durable expert runtime',()=>{
 it('waits for the child final commit before acknowledging the result',async()=>{
  const f=await fixture('agent'),entered=gate(),release=gate(),write=f.db.run.bind(f.db);let held=false;
  vi.spyOn(f.db,'run').mockImplementation(async(sql,params)=>{
   const value=params?.[3];const record=typeof value==='string'&&value.startsWith('{"chatRun":')?JSON.parse(value).chatRun:undefined;
   if(!held&&sql.startsWith('UPDATE tasks SET')&&record?.expert&&record.status==='completed'){held=true;entered.resolve();await release.promise;}
   return write(sql,params);
  });
  const active=f.runs.launch('owner',f.run.id);
  try{
   await entered.promise;await new Promise(resolve=>setTimeout(resolve,150));expect((await f.runs.get('owner',f.run.id)).status).toBe('running');
   release.resolve();await active;expect(f.getReceipt().status).toBe('completed');
  }finally{release.resolve();await active;f.sqlite.close();}
 });
 it.each(['agent','team','group']as const)('retains %s result shape and exposes actual independent artifacts',async kind=>{
  const f=await fixture(kind);try{
   await f.runs.launch('owner',f.run.id);const result=await f.runs.get('owner',f.run.id),receipt=f.getReceipt();
   expect(result.status).toBe('completed');expect(receipt.ok).toBe(true);expect(result.artifacts.length).toBeGreaterThan(0);expect(f.native).not.toHaveBeenCalled();
   expect(f.member.mock.calls.every(([p])=>JSON.stringify(p.allowedToolNames)===JSON.stringify(['file.write','file.present']))).toBe(true);
   expect(result.expertRuns?.[0].id).toBe(receipt.runId);expect(await f.runs.deliverExpertReturns()).toBe(0);expect(await f.children()).toHaveLength(1);
   if(kind==='team'){expect(receipt.content).toBe('checker done');expect(receipt.steps).toHaveLength(2);}
   if(kind==='group'){expect(receipt.results).toHaveLength(2);expect(f.progress).toHaveBeenCalled();expect((await f.runs.groupHistory('owner','group'))[0].runId).toBe(receipt.runId);}
  }finally{f.sqlite.close();}
 });
 it('stops and reconstructs a waiting team without rerunning the completed first member',async()=>{
  const f=await fixture('team'),entered=gate();let checks=0;
  f.member.mockImplementation(async p=>{if(p.agentId==='checker'&&checks++===0){entered.resolve();await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));}return f.write(p);});
  try{
   const active=f.runs.launch('owner',f.run.id);await entered.promise;await f.runs.stop('owner',f.run.id);await active;
   await vi.waitFor(async()=>expect((await f.runs.get('owner',(await f.children())[0].id)).status).toBe('paused'));
   expect((await f.runs.get('owner',f.run.id)).canResume).toBe(true);
   const restored=f.make();await restored.resume('owner',f.run.id);await restored.wait(f.run.id);
   expect((await restored.get('owner',f.run.id)).status).toBe('completed');expect(await f.children()).toHaveLength(1);
   expect(f.member.mock.calls.filter(([p])=>p.agentId==='writer')).toHaveLength(1);expect(checks).toBe(2);
  }finally{f.sqlite.close();}
 });
 it('blocks the waiting parent when its child has an unknown external result',async()=>{
  let effects=0;const f=await fixture('agent',async p=>{await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:[{id:'effect',name:'external.write',arguments:{}}]}]);effects++;throw new UncertainToolOutcomeError('结果未知');});
  try{await f.runs.launch('owner',f.run.id);const result=await f.runs.get('owner',f.run.id);expect(result.canResume).toBe(false);expect(result.error).toContain('结果未知');await expect(f.runs.resume('owner',f.run.id)).rejects.toThrow('未知');expect(effects).toBe(1);}
  finally{f.sqlite.close();}
 });
 it('automatic parent recovery preserves a user-paused child and old unjournaled calls remain uncertain',async()=>{
  const f=await fixture('agent'),entered=gate();
  f.member.mockImplementation(async p=>{entered.resolve();await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));return f.write(p);});
  try{
   const active=f.runs.launch('owner',f.run.id);await entered.promise;const source=(await f.children())[0];await f.runs.stop('owner',source.id);await active;
   const row=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.run.id]),stored=JSON.parse(row!.metadata_json);
   stored.chatRun.status='interrupted';stored.chatRun.resumeDelegations=true;
   await f.db.run('UPDATE tasks SET status=?,metadata_json=? WHERE id=?',['paused',JSON.stringify(stored),f.run.id]);
   const automatic=f.make();await automatic.resume('owner',f.run.id,{automatic:true});await automatic.wait(f.run.id);
   expect((await automatic.get('owner',source.id)).status).toBe('paused');expect(f.member).toHaveBeenCalledTimes(1);
   expect(await f.db.getConfig('owner',`chat_run_cancel:${source.id}`)).toBe('true');
   const latest=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.run.id]),old=JSON.parse(latest!.metadata_json);
   delete old.chatRun.durableDelegation;old.chatRun.status='running';
   await f.db.run('UPDATE tasks SET status=?,metadata_json=? WHERE id=?',['running',JSON.stringify(old),f.run.id]);
   const legacy=f.make();expect((await legacy.get('owner',f.run.id)).canResume).toBe(false);await expect(legacy.resume('owner',f.run.id)).rejects.toThrow('未知');expect(f.member).toHaveBeenCalledTimes(1);
  }finally{f.sqlite.close();}
 });
 it('a resumed parent refreshes an already received draft to the actual reviewed revision',async()=>{
  const f=await fixture('agent');try{
   await f.runs.launch('owner',f.run.id);const source=await f.runs.get('owner',(await f.children())[0].id),original=source.artifacts[0].path;
   await f.runs.reviewRun('owner',source.id,{decision:'changes_requested',feedback:'补充修改说明',expectedUpdatedAt:source.updatedAt});
   const revised=await f.runs.revise('owner',source.id);await f.runs.wait(revised.id);
   const row=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.run.id]),stored=JSON.parse(row!.metadata_json);
   stored.chatRun.status='interrupted';delete stored.chatRun.modelCompleted;delete stored.chatRun.finalContent;
   await f.db.run('UPDATE tasks SET status=?,metadata_json=? WHERE id=?',['paused',JSON.stringify(stored),f.run.id]);
   const restored=f.make();await restored.resume('owner',f.run.id);await restored.wait(f.run.id);const parent=await restored.get('owner',f.run.id);
   expect(parent.status).toBe('completed');expect((parent.toolCalls[0].output as {runId:string}).runId).toBe(revised.id);
   expect(parent.artifacts[0].path).not.toBe(original);const {sandboxFS}=await f.spaces.getForUser('owner');expect(await sandboxFS.read(original)).toBe('writer report');
  }finally{f.sqlite.close();}
 });
 it('a changed revision with an unknown result blocks the parent even after an older receipt was saved',async()=>{
  const f=await fixture('agent');let effects=0;
  try{
   await f.runs.launch('owner',f.run.id);const source=await f.runs.get('owner',(await f.children())[0].id);
   await f.runs.reviewRun('owner',source.id,{decision:'changes_requested',feedback:'修改',expectedUpdatedAt:source.updatedAt});
   f.member.mockImplementationOnce(async p=>{await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:[{id:'unknown',name:'external.write',arguments:{}}]}]);effects++;throw new UncertainToolOutcomeError('unknown');});
   const revision=await f.runs.revise('owner',source.id);await f.runs.wait(revision.id);
   const row=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.run.id]),stored=JSON.parse(row!.metadata_json);stored.chatRun.status='interrupted';delete stored.chatRun.modelCompleted;delete stored.chatRun.finalContent;
   await f.db.run('UPDATE tasks SET status=?,metadata_json=? WHERE id=?',['paused',JSON.stringify(stored),f.run.id]);
   const restored=f.make();await restored.resume('owner',f.run.id);await restored.wait(f.run.id);
   expect((await restored.get('owner',f.run.id)).canResume).toBe(false);expect(effects).toBe(1);
  }finally{f.sqlite.close();}
 });
});
