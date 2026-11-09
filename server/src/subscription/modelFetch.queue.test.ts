import {afterEach,expect,it,vi} from 'vitest';import http from 'node:http';
import {mkdtemp,mkdir,copyFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {runMigrations} from '../db/migrate.js';
import {SubscriptionService} from './SubscriptionService.js';
import {modelFetch,withModelBudget} from './modelBudget.js';
import {createApp} from '../app.js';
import {ChatRunService} from '../chat/ChatRunService.js';
import {SandboxFS} from '../tooling/SandboxFS.js';
import {callLLMStream} from '../chat/chatService.js';
afterEach(()=>vi.restoreAllMocks());
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'fetch-queue-')),native=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(native);
 const migrations=path.join(root,'migrations');await mkdir(migrations);await copyFile(new URL('../../migrations/001_add_subscriptions.sql',import.meta.url),path.join(migrations,'001_add_subscriptions.sql'));await runMigrations(db,migrations);await db.ensureUser('alice');
 const service=new SubscriptionService(db);const responses:http.ServerResponse[]=[];
 const server=http.createServer((req,res)=>{responses.push(res);const stream=req.url?.includes('chat/completions');res.writeHead(200,{'content-type':stream?'text/event-stream':'application/json'});res.write(stream?'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n':'{"ok":');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/provider`;
 const send=(id:string,signal?:AbortSignal)=>withModelBudget({service,userId:'alice',runId:id},()=>modelFetch(url,{method:'POST',body:JSON.stringify({model:'fixture',messages:[{role:'user',content:'PRIVATE_PROMPT'}]}),headers:{Authorization:'PRIVATE_KEY'},signal}));
 return{root,db,service,responses,url,send,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));native.close();}};
}
it('holds a real HTTP slot after headers and cancels queued work without charging or sending it',async()=>{
 const f=await fixture(),controller=new AbortController();let first:Response|undefined,queued:Promise<any>|undefined;
 try{
  first=await f.send('first');expect(first.url).toBe(f.url);queued=f.send('queued',controller.signal).catch(error=>error);
  await vi.waitFor(async()=>expect(await f.service.waitingForModel('alice','queued')).toBe(true));expect(f.responses).toHaveLength(1);expect((await f.service.getCurrentUsage('alice')).aiCalls).toBe(1);
  controller.abort();expect(await queued).toMatchObject({name:'AbortError'});await first.body!.cancel();
  expect((await f.service.getCurrentUsage('alice')).aiCalls).toBe(1);expect(JSON.stringify(await f.db.query('SELECT * FROM model_call_queue'))).not.toContain('PRIVATE_');
 }finally{controller.abort();await queued;await first?.body?.cancel().catch(()=>{});await f.close();}
});

it.each([true,false])('keeps a durable queued run independent of its viewer with its own budget service: %s',async ownBudget=>{
 const f=await fixture(),blocker=await f.service.acquireModelSlot('alice','blocker'),viewer=new AbortController();
 const loop=vi.fn(async(params:any)=>{const response=await modelFetch(f.url,{method:'POST',body:'{"model":"fixture"}',signal:params.signal});await response.json();return{content:'完成',stopReason:'completed' as const};});
 const runs=new ChatRunService({db:f.db,modelBudget:ownBudget?f.service:undefined,orchestrator:{runChatAgentLoop:loop},getSandboxFS:async()=>new SandboxFS(f.root),getLLMConfig:async()=>({providerId:'test',modelId:'fixture'})});let execution:Promise<unknown>|undefined;
 try{
  const session=await f.db.createSession('alice','queue'),run=await runs.accept({userId:'alice',sessionId:session.id,requestId:'queued-stop',messages:[{role:'user',content:'核对一次'}],providerId:'test',modelId:'fixture',systemPrompt:'',allowedToolNames:[]});
  execution=withModelBudget({service:f.service,userId:'alice',signal:viewer.signal},()=>runs.launch('alice',run.id));
  await vi.waitFor(async()=>expect(await f.service.waitingForModel('alice',run.id)).toBe(true));if(ownBudget)expect((await runs.get('alice',run.id)).waitingForModel).toBe(true);viewer.abort();
  expect((await runs.get('alice',run.id)).status).toBe('running');expect(f.responses).toHaveLength(0);
  await runs.stop('alice',run.id);await execution;expect((await runs.get('alice',run.id)).status).toBe('paused');expect((await f.service.getCurrentUsage('alice')).aiCalls).toBe(0);
  await blocker.release();await withModelBudget({service:f.service,userId:'alice'},()=>runs.resume('alice',run.id));await vi.waitFor(()=>expect(f.responses).toHaveLength(1));f.responses[0].end('true}');await runs.wait(run.id);
  expect((await runs.get('alice',run.id)).status).toBe('completed');expect(await f.db.getAllTasks()).toHaveLength(1);expect((await f.service.getCurrentUsage('alice')).aiCalls).toBe(1);
 }finally{viewer.abort();await blocker.release();await execution;await f.close();}
});

it('honors a stop from another ChatRun instance before a queued run reaches the provider',async()=>{
 const f=await fixture(),blocker=await f.service.acquireModelSlot('alice','blocker'),otherNative=new SqliteAppDatabase(f.root),otherDb=new SqliteDatabaseAdapter(otherNative);
 const loop=vi.fn(async(params:any)=>{await(await modelFetch(f.url,{method:'POST',body:'{}',signal:params.signal})).json();return{content:'完成',stopReason:'completed' as const};});
 const create=(db:SqliteDatabaseAdapter)=>new ChatRunService({db,modelBudget:f.service,orchestrator:{runChatAgentLoop:loop},getSandboxFS:async()=>new SandboxFS(f.root),getLLMConfig:async()=>({providerId:'test',modelId:'fixture'})});
 const owner=create(f.db),remote=create(otherDb);let id:string|undefined,execution:Promise<unknown>|undefined;
 try{
  const session=await f.db.createSession('alice','remote stop'),run=await owner.accept({userId:'alice',sessionId:session.id,requestId:'remote-queued-stop',messages:[{role:'user',content:'核对一次'}],providerId:'test',modelId:'fixture',systemPrompt:'',allowedToolNames:[]});id=run.id;execution=owner.launch('alice',id);
  await vi.waitFor(async()=>expect((await owner.get('alice',run.id)).waitingForModel).toBe(true));await remote.stop('alice',run.id);expect((await owner.get('alice',run.id)).status).toBe('stopping');await blocker.release();await execution;
  expect((await owner.get('alice',run.id)).status).toBe('paused');expect(f.responses).toHaveLength(0);expect((await f.service.getCurrentUsage('alice')).aiCalls).toBe(0);
 }finally{if(id)await owner.stop('alice',id).catch(()=>{});await blocker.release();await execution;otherNative.close();await f.close();}
});

it('removes a non-durable HTTP request from the queue when its connection closes',async()=>{
 const f=await fixture(),blocker=await f.service.acquireModelSlot('alice','blocker');
 const result=await createApp({workspaceRoot:f.root,databaseType:'sqlite',runtimeProfile:'lightweight',useContainerIsolation:false,allowAnonymous:false});
 result.app.get('/api/queue-cancel-fixture',async(_req,res)=>{try{await(await modelFetch(f.url,{method:'POST',body:'{}'})).text();res.json({ok:true});}catch{if(!res.destroyed)res.status(503).end();}});
 const server=http.createServer(result.app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const cookie=await result.app.locals.sessions.createCookie('alice');
 const client=http.get(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/queue-cancel-fixture`,{headers:{Cookie:cookie}});client.on('error',()=>{});
 try{
  await vi.waitFor(async()=>expect((await f.db.queryOne<{n:number}>("SELECT COUNT(*) AS n FROM model_call_queue WHERE status='queued'"))?.n).toBe(1));client.destroy();
  await vi.waitFor(async()=>expect((await f.db.queryOne<{n:number}>("SELECT COUNT(*) AS n FROM model_call_queue WHERE status='queued'"))?.n).toBe(0));
  expect(f.responses).toHaveLength(0);expect((await f.service.getCurrentUsage('alice')).aiCalls).toBe(0);
 }finally{client.destroy();await blocker.release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await result.db.close();await f.close();}
});
it('releases the body before the next same-user request starts and preserves response bytes',async()=>{
 const f=await fixture();let one:Response|undefined,two:Response|undefined,queued:Promise<Response>|undefined;
 try{
  one=await f.send('one');queued=f.send('two');await vi.waitFor(async()=>expect(await f.service.waitingForModel('alice','two')).toBe(true));
  const body=one.json();f.responses[0].end('true}');expect(await body).toEqual({ok:true});two=await queued;
  expect(f.responses).toHaveLength(2);const next=two.json();f.responses[1].end('true}');expect(await next).toEqual({ok:true});
  expect((await f.service.getCurrentUsage('alice')).aiCalls).toBe(2);expect(await f.db.query("SELECT id FROM model_call_queue WHERE status='running'")).toEqual([]);
 }finally{await one?.body?.cancel().catch(()=>{});await two?.body?.cancel().catch(()=>{});await f.close();}
});
it('releases a streaming slot when its generator consumer finishes early',async()=>{
 const f=await fixture();try{
  await withModelBudget({service:f.service,userId:'alice',runId:'stream'},async()=>{
   const stream=callLLMStream({providerId:'test',modelId:'fixture',baseUrl:f.url,apiKey:'fixture-only',messages:[{role:'user',content:'hi'}]});
   expect((await stream.next()).value).toBe('hello');await stream.return(undefined);
  });
  expect(await f.db.query("SELECT id FROM model_call_queue WHERE status='running'")).toEqual([]);
 }finally{await f.close();}
});
