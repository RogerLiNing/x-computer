import {describe,it,expect,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {SandboxFS} from '../tooling/SandboxFS.js';
import {ChatRunService} from './ChatRunService.js';

async function fixture(fail=false){
 const root=await mkdtemp(path.join(os.tmpdir(),'expert-return-')),sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),sandbox=new SandboxFS(root);
 await db.ensureUser('owner');const session=await db.createSession('owner','原交办'),expertSession=await db.createSession('owner','专家');
 const loop=vi.fn(async(p:any)=>{if(p.agentId&&fail){fail=false;throw new Error('读取材料需要处理');}return {content:p.agentId?'已完成报告':'已交给专家',stopReason:'completed' as const};});
 const make=()=>new ChatRunService({db,orchestrator:{runChatAgentLoop:loop},getSandboxFS:async()=>sandbox,getLLMConfig:async()=>({providerId:'test',modelId:'test',apiKey:'not-persisted'})});
 const runs=make(),base={userId:'owner',providerId:'test',modelId:'test',systemPrompt:'',messages:[{role:'user' as const,content:'整理报告'}]};
 const parent=await runs.accept({...base,sessionId:session.id,requestId:'parent'});await runs.launch('owner',parent.id);
 const child=await runs.accept({...base,sessionId:expertSession.id,requestId:'child',returnToParent:true,expert:{parentRunId:parent.id,agentId:'writer',agentName:'写作专家',depth:1}});await runs.launch('owner',child.id);
 const row=await db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[parent.id]);const stored=JSON.parse(row!.metadata_json);
 stored.chatRun.toolCalls=[{id:'dispatch',toolName:'x.dispatch_agent',status:'completed',output:{runId:child.id,agentName:'写作专家'}}];
 await db.run('UPDATE tasks SET metadata_json=? WHERE id=?',[JSON.stringify(stored),parent.id]);
 return{sqlite,db,runs,make,loop,parent,child,session};
}
describe('expert outcomes return durably to the original conversation',()=>{
 it('returns once across restart and concurrent processes without running another model or accepting work',async()=>{
  const f=await fixture();try{
   await Promise.all([f.runs.deliverExpertReturns(),f.make().deliverExpertReturns()]);
   await f.make().deliverExpertReturns();
   const messages=await f.db.getMessages(f.session.id);
   expect(messages.filter(message=>message.id.startsWith('return-'))).toHaveLength(1);
   expect(messages.find(message=>message.id.startsWith('return-'))?.content).toContain('已完成报告');
   expect(messages.filter(message=>message.role==='user')).toHaveLength(1);
   const notifications=await f.db.getNotifications('owner',{includeRead:true});expect(notifications).toHaveLength(1);
   expect(notifications[0].link).toBe(`app:chat-session:${f.session.id}`);
   expect((await f.runs.get('owner',f.child.id)).review?.status).toBe('pending');
   expect(f.loop).toHaveBeenCalledTimes(2);
  }finally{f.sqlite.close();}
 });
 it('repairs a crash after the return message without duplicating it',async()=>{
  const f=await fixture();try{
   vi.spyOn(f.db,'createNotification').mockRejectedValueOnce(new Error('notification store unavailable'));
   const log=vi.spyOn(console,'error').mockImplementation(()=>{});
   await f.runs.deliverExpertReturns();
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.id.startsWith('return-'))).toHaveLength(1);
   await f.make().deliverExpertReturns();
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.id.startsWith('return-'))).toHaveLength(1);
   expect(await f.db.getNotifications('owner')).toHaveLength(1);log.mockRestore();
  }finally{f.sqlite.close();}
 });
 it('suppresses return after the user stops the parent and never returns a child to a foreign session',async()=>{
  const f=await fixture();try{
   await f.runs.stop('owner',f.parent.id);await f.runs.deliverExpertReturns();
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.id.startsWith('return-'))).toHaveLength(0);
   expect(await f.db.getNotifications('owner')).toHaveLength(0);
  }finally{f.sqlite.close();}
  const other=await fixture();try{
   await other.db.run('UPDATE chat_sessions SET user_id=? WHERE id=?',['other',other.session.id]);
   await other.runs.deliverExpertReturns();expect(await other.db.getNotifications('owner')).toHaveLength(0);
  }finally{other.sqlite.close();}
 });
 it('follows a returned draft through revision and leaves acceptance to the user',async()=>{
  const f=await fixture();try{
   await f.runs.deliverExpertReturns();const child=await f.runs.get('owner',f.child.id);
   await f.runs.reviewRun('owner',child.id,{decision:'changes_requested',feedback:'补充说明',expectedUpdatedAt:child.updatedAt});
   const revision=await f.runs.revise('owner',child.id);await f.runs.wait(revision.id);
   const restarted=f.make();expect((await restarted.get('owner',f.parent.id)).expertRuns?.[0].id).toBe(revision.id);
   await restarted.deliverExpertReturns();
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.id.startsWith('return-'))).toHaveLength(2);
   expect((await restarted.get('owner',revision.id)).review?.status).toBe('pending');
  }finally{f.sqlite.close();}
 });
 it('reports a failure once and returns the actual result only after explicit resume',async()=>{
  const f=await fixture(true);try{
   await f.runs.deliverExpertReturns();await f.runs.deliverExpertReturns();
   expect(await f.db.getNotifications('owner')).toHaveLength(1);expect(f.loop).toHaveBeenCalledTimes(2);
   await f.runs.resume('owner',f.child.id);await f.runs.wait(f.child.id);await f.runs.deliverExpertReturns();
   expect(await f.db.getNotifications('owner')).toHaveLength(2);
   expect((await f.db.getMessages(f.session.id)).filter(message=>message.id.startsWith('return-'))).toHaveLength(2);
  }finally{f.sqlite.close();}
 });
 it('waits while a newer user request owns the original conversation, then returns without losing its message',async()=>{
  const f=await fixture();try{
   const next=await f.runs.accept({userId:'owner',sessionId:f.session.id,requestId:'new-user-request',providerId:'test',modelId:'test',systemPrompt:'',messages:[{role:'user',content:'另一件事'}]});
   expect(await f.runs.deliverExpertReturns()).toBe(0);expect(await f.db.getNotifications('owner')).toHaveLength(0);
   await f.runs.launch('owner',next.id);await f.runs.deliverExpertReturns();
   const messages=await f.db.getMessages(f.session.id);
   expect(messages.some(message=>message.role==='user'&&message.content==='另一件事')).toBe(true);
   expect(messages.filter(message=>message.id.startsWith('return-'))).toHaveLength(1);
  }finally{f.sqlite.close();}
 });
});
