import {describe,it,expect,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {UserSandboxManager} from '../tooling/UserSandboxManager.js';
import {ChatRunService} from './ChatRunService.js';

async function fixture(failSource=false){
 const dir=await mkdtemp(path.join(os.tmpdir(),'main-followup-')),sqlite=new SqliteAppDatabase(dir),db=new SqliteDatabaseAdapter(sqlite),spaces=new UserSandboxManager(dir);
 await db.ensureUser('owner');const session=await db.createSession('owner','原任务'),expertSession=await db.createSession('owner','专家任务');
 const loop=vi.fn(async(p:any)=>{if(p.agentId==='writer'&&failSource){failSource=false;throw new Error('首次读取失败');}return {content:p.agentId?.startsWith('main-followup-')?'已核对专家成果，等待验收':'完成',stopReason:'completed' as const};});
 const make=()=>new ChatRunService({db,orchestrator:{runChatAgentLoop:loop},getSandboxFS:async user=>(await spaces.getForUser(user)).sandboxFS,getLLMConfig:async()=>({providerId:'test',modelId:'test',apiKey:'fixture-private'})});
 const runs=make(),base={userId:'owner',providerId:'test',modelId:'test',systemPrompt:'原系统规则',messages:[{role:'user' as const,content:'核对并整理办公材料'}],allowedToolNames:['file.read','file.extract_text','file.write','file.present','office.edit_copy','email.send','shell.run'],blockedToolNames:['file.delete']};
 const root=await runs.accept({...base,sessionId:session.id,requestId:'root'});await runs.launch('owner',root.id);
 const source=await runs.accept({...base,sessionId:expertSession.id,requestId:'source',returnToParent:true,allowFollowup:true,expert:{parentRunId:root.id,agentId:'writer',agentName:'整理专家',depth:1}});await runs.launch('owner',source.id);
 const rootRow=await db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[root.id]),storedRoot=JSON.parse(rootRow!.metadata_json);
 storedRoot.chatRun.toolCalls=[{id:'dispatch',toolName:'x.dispatch_agent',status:'completed',output:{ok:true,runId:source.id,agentName:'整理专家'}}];
 await db.run('UPDATE tasks SET metadata_json=? WHERE id=?',[JSON.stringify(storedRoot),root.id]);
 await runs.deliverExpertReturns();
 const list=async()=> (await db.getAllTasks()).map(row=>JSON.parse(row.metadata_json??'{}').chatRun).filter(run=>run?.followup);
 return{sqlite,db,runs,make,loop,spaces,root,source,session,base,list};
}
describe('bounded durable main-assistant continuation',()=>{
 it('recovers a persisted dispatch receipt without another model call or another expert',async()=>{
  const f=await fixture();try{
   const row=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.root.id]);const stored=JSON.parse(row!.metadata_json),record=stored.chatRun;
   record.status='interrupted';delete record.modelCompleted;delete record.finalContent;
   record.checkpoint=[...record.messages,{role:'assistant',content:'',tool_calls:[{id:'old-failure',name:'file.read',arguments:{path:'missing'}}]},{role:'tool',tool_call_id:'old-failure',content:JSON.stringify({error:'not found'})},{role:'assistant',content:'',tool_calls:[{id:'dispatch',name:'x.dispatch_agent',arguments:{}}]},{role:'tool',tool_call_id:'dispatch',content:JSON.stringify({ok:true,runId:f.source.id,agentName:'专家'})}];
   await f.db.run('UPDATE tasks SET status=?,metadata_json=? WHERE id=?',['paused',JSON.stringify(stored),f.root.id]);
   const restarted=f.make();await restarted.resume('owner',f.root.id);await restarted.wait(f.root.id);
   expect((await restarted.get('owner',f.root.id)).status).toBe('completed');expect(f.loop).toHaveBeenCalledTimes(2);
  }finally{f.sqlite.close();}
 });
 it('requires a receipt for the current successful outcome after an explicitly resumed failure',async()=>{
  const f=await fixture(true);try{
   await f.runs.resume('owner',f.source.id);await f.runs.wait(f.source.id);
   expect(await f.runs.continueExpertReturns()).toBe(0);expect(await f.list()).toHaveLength(0);
   await f.runs.deliverExpertReturns();await f.runs.continueExpertReturns();
   await vi.waitFor(async()=>expect((await f.list())[0]?.status).toBe('completed'));
   expect(await f.list()).toHaveLength(1);
  }finally{f.sqlite.close();}
 });
 it('starts once across services, retains scope and uses an independent workspace without adding a user message',async()=>{
  const f=await fixture();try{
   await Promise.all([f.runs.continueExpertReturns(),f.make().continueExpertReturns()]);
   await vi.waitFor(async()=>expect((await f.list())[0]?.status).toBe('completed'));
   await f.make().continueExpertReturns();const list=await f.list();expect(list).toHaveLength(1);
   const followup=list[0],call=f.loop.mock.calls.find(([p])=>p.runId===followup.id)![0];
   expect(call.allowedToolNames).toEqual(['file.read','file.extract_text','file.present','file.write','office.edit_copy']);
   expect(call.blockedToolNames).toEqual(['file.delete']);expect(call.agentId).toBe(`main-followup-${f.root.id}`);expect(call.agentRunId).toBe(followup.id);
   expect(call.maxSteps).toBe(12);expect(call.systemPrompt).toContain('不得重复已经完成的发送');
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.role==='user')).toHaveLength(1);
   expect((await f.runs.get('owner',f.root.id)).followupRunId).toBe(followup.id);
   expect((await f.runs.get('owner',followup.id)).review?.status).toBe('pending');expect(f.loop).toHaveBeenCalledTimes(3);
  }finally{f.sqlite.close();}
 });
 it('preserves the main report and manual feedback through revision, with an independent review version',async()=>{
  const f=await fixture();try{
   const writeReport=async(p:any,text:string)=>{
    const {sandboxFS}=await f.spaces.getForAgent('owner',p.agentId,p.agentRunId);
    if(text==='修改后的报告')expect(await sandboxFS.read('输入/01/最终核对报告.md')).toBe('原始报告');
    await sandboxFS.writeOverwrite('最终核对报告.md',text);
    await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:[{id:'write',name:'file.write',arguments:{path:'最终核对报告.md'}}]},{role:'tool',tool_call_id:'write',content:JSON.stringify({path:'最终核对报告.md'})},{role:'assistant',content:text}]);
    return{content:text,stopReason:'completed' as const};
   };
   f.loop.mockImplementationOnce(p=>writeReport(p,'原始报告'));await f.runs.continueExpertReturns();
   await vi.waitFor(async()=>expect((await f.list())[0]?.status).toBe('completed'));
   const first=await f.runs.get('owner',(await f.list())[0].id),original=first.artifacts[0].path;
   expect((await f.runs.attention('owner')).some(item=>item.sourceId===f.source.id)).toBe(false);
   await f.runs.reviewRun('owner',first.id,{decision:'changes_requested',feedback:'补充结尾',expectedUpdatedAt:first.updatedAt});
   f.loop.mockImplementationOnce(p=>writeReport(p,'修改后的报告'));const revision=await f.runs.revise('owner',first.id);await f.runs.wait(revision.id);
   expect((await f.runs.get('owner',f.root.id)).followupRunId).toBe(revision.id);
   const {sandboxFS}=await f.spaces.getForUser('owner');expect(await sandboxFS.read(original)).toBe('原始报告');
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.role==='user')).toHaveLength(2);
   const row=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.source.id]),stored=JSON.parse(row!.metadata_json);
   stored.chatRun.parentReceipt.at=Date.now()+1000;await f.db.run('UPDATE tasks SET metadata_json=? WHERE id=?',[JSON.stringify(stored),f.source.id]);
   const current=await f.runs.get('owner',revision.id);expect(current.conversationUpdatedAt).toBeGreaterThan(current.updatedAt);
   expect((await f.runs.reviewRun('owner',revision.id,{decision:'accepted',expectedUpdatedAt:current.updatedAt})).review?.status).toBe('accepted');
  }finally{f.sqlite.close();}
 });
 it('waits behind a real newer user request, then keeps that request and its messages',async()=>{
  const f=await fixture();try{
   const next=await f.runs.accept({...f.base,sessionId:f.session.id,requestId:'new-request'});
   const log=vi.spyOn(console,'error').mockImplementation(()=>{});expect(await f.runs.continueExpertReturns()).toBe(0);log.mockRestore();
   expect(await f.list()).toHaveLength(0);await f.runs.launch('owner',next.id);await f.runs.continueExpertReturns();
   await vi.waitFor(async()=>expect((await f.list())[0]?.status).toBe('completed'));
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.role==='user')).toHaveLength(2);
  }finally{f.sqlite.close();}
 });
 it('does not start after stop or human acceptance',async()=>{
  const f=await fixture();try{
   await f.runs.stop('owner',f.root.id);expect(await f.runs.continueExpertReturns()).toBe(0);expect(await f.list()).toHaveLength(0);
  }finally{f.sqlite.close();}
  const g=await fixture();try{
   const source=await g.runs.get('owner',g.source.id);await g.runs.reviewRun('owner',source.id,{decision:'accepted',expectedUpdatedAt:source.updatedAt});
   expect(await g.runs.continueExpertReturns()).toBe(0);expect(await g.list()).toHaveLength(0);
  }finally{g.sqlite.close();}
  const rejected=await fixture();try{
   const source=await rejected.runs.get('owner',rejected.source.id);
   await rejected.runs.reviewRun('owner',source.id,{decision:'changes_requested',feedback:'先改这份成果',expectedUpdatedAt:source.updatedAt});
   expect(await rejected.runs.continueExpertReturns()).toBe(0);expect(await rejected.list()).toHaveLength(0);
  }finally{rejected.sqlite.close();}
 });
 it('enforces a root budget even when different experts return results',async()=>{
  const f=await fixture();try{
   await f.runs.continueExpertReturns();await vi.waitFor(async()=>expect((await f.list())[0]?.status).toBe('completed'));
   for(const index of [2,3]){
    const session=await f.db.createSession('owner',`专家 ${index}`);
    const source=await f.runs.accept({...f.base,sessionId:session.id,requestId:`source-${index}`,returnToParent:true,allowFollowup:true,expert:{parentRunId:f.root.id,agentId:'writer',agentName:'整理专家',depth:1}});
    await f.runs.launch('owner',source.id);await f.runs.deliverExpertReturns();await f.runs.continueExpertReturns();
    if(index===2)await vi.waitFor(async()=>expect((await f.list()).every(run=>run.status==='completed')).toBe(true));
   }
   expect(await f.list()).toHaveLength(2);expect(f.loop).toHaveBeenCalledTimes(6);
  }finally{f.sqlite.close();}
 });
 it('stops an active continuation with the root and leaves an explicitly paused continuation stopped',async()=>{
  const f=await fixture();try{
   let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
   f.loop.mockImplementationOnce(async(p:any)=>{entered();await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));return{content:'',stopReason:'completed' as const};});
   await f.runs.continueExpertReturns();await started;const followup=(await f.list())[0];
   await f.runs.stop('owner',f.root.id);await f.runs.wait(followup.id);
   expect((await f.runs.get('owner',followup.id)).status).toBe('paused');
   await f.runs.continueExpertReturns();expect(f.loop).toHaveBeenCalledTimes(3);
   await expect(f.runs.resume('owner',followup.id)).rejects.toThrow('原交办已停止');
  }finally{f.sqlite.close();}
 });
 it('recovers admission after a crash before the source receipt was linked',async()=>{
  const f=await fixture();try{
   const write=f.db.run.bind(f.db);let failed=false;
   vi.spyOn(f.db,'run').mockImplementation(async(sql,params)=>{
    if(!failed&&sql.startsWith('UPDATE tasks SET')&&params?.some(value=>typeof value==='string'&&value.includes('"followupRunId"'))){failed=true;throw new Error('simulated receipt write failure');}
    return write(sql,params);
   });
   const log=vi.spyOn(console,'error').mockImplementation(()=>{});await f.runs.continueExpertReturns();log.mockRestore();
   await vi.waitFor(async()=>expect((await f.list())[0]?.status).toBe('completed'));
   await f.make().continueExpertReturns();expect(await f.list()).toHaveLength(1);expect(f.loop).toHaveBeenCalledTimes(3);
  }finally{f.sqlite.close();}
 });
});
