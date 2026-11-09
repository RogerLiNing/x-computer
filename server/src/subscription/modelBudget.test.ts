import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,mkdir,copyFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {SubscriptionService} from './SubscriptionService.js';
import {modelFetch,withModelBudget,ModelQuotaError,ModelBudgetUnavailableError} from './modelBudget.js';
import {callLLMWithTools} from '../chat/chatService.js';
import {runMigrations} from '../db/migrate.js';
import {ChatRunService} from '../chat/ChatRunService.js';
import {AgentOrchestrator} from '../orchestrator/AgentOrchestrator.js';
import {AuditLogger} from '../observability/AuditLogger.js';
import {SandboxFS} from '../tooling/SandboxFS.js';
import express from 'express';import request from 'supertest';
import {aiCallsQuota} from './quotaMiddleware.js';

async function fixture(limit=3){
 const root=await mkdtemp(path.join(os.tmpdir(),'model-budget-')),sqlite=new SqliteAppDatabase(root),second=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),other=new SqliteDatabaseAdapter(second);
 const migrations=path.join(root,'migrations');await mkdir(migrations);await copyFile(new URL('../../migrations/001_add_subscriptions.sql',import.meta.url),path.join(migrations,'001_add_subscriptions.sql'));await runMigrations(db,migrations);
 for(const user of ['alice','bob'])await db.ensureUser(user);
 const a=new SubscriptionService(db),b=new SubscriptionService(other);
 for(const service of [a,b])vi.spyOn(service,'getQuotaLimits').mockResolvedValue({aiCallsLimit:limit,storageLimit:1024,concurrentTasksLimit:1});
 const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'完成'}}]}),{headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch);
 const request=(service=a,userId='alice')=>withModelBudget({service,userId,runId:'fixture-run'},()=>modelFetch('https://provider.test/chat',{method:'POST',headers:{Authorization:'Bearer SENSITIVE_KEY'},body:JSON.stringify({model:'fixture-model',messages:[{role:'user',content:'SENSITIVE_PROMPT'}]})})).then(async response=>{await response.text();return response;});
 return {root,db,a,b,fetch,request,close:()=>{sqlite.close();second.close();}};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('outbound model attempt budget',()=>{
 it('does not charge or send when the queue lease expires during budget reservation',async()=>{
  const f=await fixture();try{
   vi.spyOn(f.a,'getCurrentUsage').mockImplementationOnce(async()=>{await f.db.run("UPDATE model_call_queue SET expires_at=0 WHERE status='running'");return{aiCalls:0,storage:0,tasks:0};});
   await expect(f.request()).rejects.toBeInstanceOf(ModelBudgetUnavailableError);expect(f.fetch).not.toHaveBeenCalled();expect((await f.a.getCurrentUsage('alice')).aiCalls).toBe(0);
  }finally{f.close();}
 });
 it('rechecks the queue lease immediately before provider fetch',async()=>{
  const f=await fixture();try{
   const consume=f.a.consumeAiCall.bind(f.a);vi.spyOn(f.a,'consumeAiCall').mockImplementationOnce(async(...args)=>{await consume(...args);await f.db.run("UPDATE model_call_queue SET expires_at=0 WHERE status='running'");});
   await expect(f.request()).rejects.toBeInstanceOf(ModelBudgetUnavailableError);expect(f.fetch).not.toHaveBeenCalled();
  }finally{f.close();}
 });
 it('preserves budget errors raised while reading a JSON response body',async()=>{
  const controller=new AbortController(),release=vi.fn(async()=>{}),service={consumeAiCall:vi.fn(async()=>{}),acquireModelSlot:vi.fn(async()=>({signal:controller.signal,release,assert:async()=>{}}))};
  const fetcher=vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(control){control.enqueue(new TextEncoder().encode('{"choices":'));}}),{headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
  const call=withModelBudget({service,userId:'alice'},()=>callLLMWithTools({providerId:'test',modelId:'model',baseUrl:'https://provider.test',messages:[{role:'user',content:'完成'}]},[])).catch(error=>error);
  await new Promise(resolve=>setTimeout(resolve,0));controller.abort(new ModelBudgetUnavailableError());expect(await call).toBeInstanceOf(ModelBudgetUnavailableError);expect(fetcher).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
 });
 it.each([false,true])('retains HTTP cancellation through the orchestrator with an explicit inner signal: %s',async hasSignal=>{
  const f=await fixture();try{
   const controller=new AbortController();controller.abort();const orchestrator=new AgentOrchestrator(new AuditLogger(),new SandboxFS(f.root),undefined,f.db,undefined,undefined,undefined,f.a);
   await expect(withModelBudget({service:f.a,userId:'alice',signal:controller.signal},()=>orchestrator.runChatAgentLoop({userId:'alice',messages:[{role:'user',content:'完成'}],llmConfig:{providerId:'test',modelId:'model',baseUrl:'https://provider.test',apiKey:'fixture'},signal:hasSignal?new AbortController().signal:undefined,systemPrompt:'',allowedToolNames:[],toolLoadingMode:'all'}))).rejects.toMatchObject({name:'AbortError'});
   expect(f.fetch).not.toHaveBeenCalled();expect((await f.a.getCurrentUsage('alice')).aiCalls).toBe(0);
  }finally{f.close();}
 });
 it('preflights HTTP requests without a second charge and explains exhaustion in plain language',async()=>{
  const f=await fixture(1);try{
   const app=express();app.use((req,_res,next)=>{req.userId='alice';withModelBudget({service:f.a,userId:'alice'},next);});
   app.get('/call',aiCallsQuota(f.a),async(_req,res)=>{await(await modelFetch('https://provider.test/chat',{method:'POST',body:'{}'})).text();res.json({ok:true});});
   expect((await request(app).get('/call')).status).toBe(200);const exhausted=await request(app).get('/call');
   expect(exhausted.status).toBe(429);expect(exhausted.body.message).toContain('进度会保留');
   expect((await f.a.getCurrentUsage('alice')).aiCalls).toBe(1);expect(f.fetch).toHaveBeenCalledTimes(1);
  }finally{f.close();}
 });
 it('does not reserve or send an already cancelled request',async()=>{
  const f=await fixture();try{
   const controller=new AbortController();controller.abort();
   await expect(withModelBudget({service:f.a,userId:'alice'},()=>modelFetch('https://provider.test/chat',{signal:controller.signal}))).rejects.toMatchObject({name:'AbortError'});
   expect(f.fetch).not.toHaveBeenCalled();expect((await f.a.getCurrentUsage('alice')).aiCalls).toBe(0);
  }finally{f.close();}
 });
 it('blocks a durable run between model rounds and resumes without replaying a completed file write',async()=>{
  const f=await fixture(1);try{
   const stream=(delta:unknown)=>new Response(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
   f.fetch.mockResolvedValueOnce(stream({tool_calls:[{index:0,id:'write',type:'function',function:{name:'file.write',arguments:JSON.stringify({path:'kept.txt',content:'saved work'})}}]}));
   const sandbox=new SandboxFS(f.root),orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,undefined,f.db,undefined,undefined,undefined,f.a);
   vi.spyOn(orchestrator,'getLLMToolDefsFiltered').mockResolvedValue([{name:'file.write',description:'save',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}}]);
   const runs=new ChatRunService({db:f.db,orchestrator,modelBudget:f.a,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>({providerId:'test',modelId:'model',baseUrl:'https://provider.test',apiKey:'fixture-key'})});
   const session=await f.db.createSession('alice','额度中断');
   const run=await runs.accept({userId:'alice',sessionId:session.id,requestId:'budget-stop',providerId:'test',modelId:'model',systemPrompt:'完成文件后回复',messages:[{role:'user',content:'使用 file.write 保存 kept.txt 内容 saved work'}],allowedToolNames:['file.write']});
   await runs.launch('alice',run.id);const blocked=await runs.get('alice',run.id);
   expect(blocked.status).toBe('blocked');expect(blocked.canResume).toBe(true);expect(blocked.error).toContain('模型调用次数已用完');
   expect(await sandbox.read('kept.txt')).toBe('saved work');expect(f.fetch).toHaveBeenCalledTimes(1);
   vi.mocked(f.a.getQuotaLimits).mockResolvedValue({aiCallsLimit:2,storageLimit:1024,concurrentTasksLimit:1});
   f.fetch.mockResolvedValueOnce(stream({content:'完成'}));
   await runs.resume('alice',run.id);await runs.wait(run.id);
   const completed=await runs.get('alice',run.id);expect(completed.status).toBe('completed');expect(completed.toolCalls.filter(tool=>tool.toolName==='file.write')).toHaveLength(1);
   expect(await sandbox.read('kept.txt')).toBe('saved work');expect(f.fetch).toHaveBeenCalledTimes(2);
  }finally{f.close();}
 });
 it('reserves atomically across database connections and keeps credentials and prompts out of usage',async()=>{
  const f=await fixture();try{
   const results=await Promise.allSettled(Array.from({length:12},(_,index)=>f.request(index%2?f.a:f.b)));
   expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(3);expect(f.fetch).toHaveBeenCalledTimes(3);
   expect((await f.a.getCurrentUsage('alice')).aiCalls).toBe(3);
   const rows=await f.db.query<{metadata:string}>('SELECT metadata FROM usage_records');
   expect(rows.every(row=>!row.metadata.includes('SENSITIVE'))).toBe(true);
   expect(rows.every(row=>JSON.parse(row.metadata).runId==='fixture-run')).toBe(true);
  }finally{f.close();}
 });
 it('isolates parallel user scopes and rejects anonymous shared-model access',async()=>{
  const f=await fixture(1);try{
   await Promise.all([f.request(f.a,'alice'),f.request(f.b,'bob')]);
   expect((await f.a.getCurrentUsage('alice')).aiCalls).toBe(1);expect((await f.a.getCurrentUsage('bob')).aiCalls).toBe(1);
   await expect(f.request(f.a,'anonymous')).rejects.toBeInstanceOf(ModelQuotaError);expect(f.fetch).toHaveBeenCalledTimes(2);
  }finally{f.close();}
 });
 it('fails closed on database errors and permits a later healthy retry',async()=>{
  const f=await fixture();try{
   vi.spyOn(f.db,'run').mockRejectedValueOnce(new Error('database unavailable'));
   await expect(f.request()).rejects.toBeInstanceOf(ModelBudgetUnavailableError);expect(f.fetch).not.toHaveBeenCalled();
   await f.request();expect(f.fetch).toHaveBeenCalledTimes(1);
  }finally{f.close();}
 });
 it('never sends a provider request after its reservation lease expires',async()=>{
  const f=await fixture();try{
   vi.spyOn(f.a,'getCurrentUsage').mockImplementationOnce(async()=>{await f.db.run('UPDATE chat_run_ownership SET expires_at=0');return {aiCalls:0,storage:0,tasks:0};});
   await expect(f.request()).rejects.toBeInstanceOf(ModelBudgetUnavailableError);
   expect(f.fetch).not.toHaveBeenCalled();expect((await f.a.getCurrentUsage('alice')).aiCalls).toBe(0);
  }finally{f.close();}
 });
 it('preserves a quota error through the chat transport instead of treating it as a retryable provider failure',async()=>{
  const f=await fixture(0);try{
   await expect(withModelBudget({service:f.a,userId:'alice'},()=>callLLMWithTools({providerId:'test',modelId:'model',baseUrl:'https://provider.test',messages:[{role:'user',content:'完成'}]},[{name:'file.read',description:'read',parameters:{type:'object'}}]))).rejects.toBeInstanceOf(ModelQuotaError);
   expect(f.fetch).not.toHaveBeenCalled();
  }finally{f.close();}
 });
});
