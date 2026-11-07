import {mkdtemp,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';import {SandboxFS} from '../tooling/SandboxFS.js';
import {ChatRunService} from './ChatRunService.js';import {RunOwnershipStore} from './RunOwnershipStore.js';
describe('independent ChatRun workers sharing a database',()=>{
 let sqliteA:SqliteAppDatabase;let sqliteB:SqliteAppDatabase;let dbA:SqliteDatabaseAdapter;let dbB:SqliteDatabaseAdapter;let sandbox:SandboxFS;let sid:string;
 const releases:Array<()=>void>=[];const pending:Promise<unknown>[]=[];
 beforeEach(async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'chat-workers-'));sqliteA=new SqliteAppDatabase(root);sqliteB=new SqliteAppDatabase(root);dbA=new SqliteDatabaseAdapter(sqliteA);dbB=new SqliteDatabaseAdapter(sqliteB);sid=sqliteA.createSession('owner','workers').id;sandbox=new SandboxFS(path.join(root,'files'));await mkdir(sandbox.getRoot());});
 afterEach(async()=>{for(const release of releases.splice(0))release();await Promise.allSettled(pending.splice(0));sqliteA.close();sqliteB.close();});
 const input=()=>({userId:'owner',sessionId:sid,requestId:'shared-request',messages:[{role:'user' as const,content:'执行一次'}],providerId:'test',modelId:'test',systemPrompt:'test'});
 function create(db:SqliteDatabaseAdapter,loop:ReturnType<typeof vi.fn>){return new ChatRunService({db,ownership:new RunOwnershipStore(db,1500),orchestrator:{runChatAgentLoop:loop} as never,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>({providerId:'test',modelId:'test',apiKey:'do-not-persist'})});}
 const completed=()=>vi.fn(async(params)=>{await params.onCheckpoint([...params.messages,{role:'assistant',content:'完成'}]);return {content:'完成',stopReason:'completed'};});
 function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);releases.push(resolve);return {promise,resolve};}
 it('does not interrupt or execute another worker live run during startup and polling',async()=>{
  const entered=gate();const finish=gate();const loopA=vi.fn(async params=>{entered.resolve();await finish.promise;await params.onCheckpoint([...params.messages,{role:'assistant',content:'完成'}]);return {content:'完成',stopReason:'completed'};});
  const a=create(dbA,loopA);const run=await a.accept(input());const active=a.launch('owner',run.id);pending.push(active);await entered.promise;
  const loopB=completed();const b=create(dbB,loopB);expect((await b.get('owner',run.id)).status).toBe('running');
  expect((await b.accept(input())).id).toBe(run.id);expect(await b.launch('owner',run.id)).toBe(false);expect(loopB).not.toHaveBeenCalled();
  await expect(b.accept({...input(),requestId:'different'})).rejects.toThrow('已有');finish.resolve();await active;expect((await b.get('owner',run.id)).status).toBe('completed');
  const rows=await dbA.query<{id:string}>('SELECT id FROM chat_messages WHERE session_id=? AND role=?',[sid,'user']);expect(rows).toHaveLength(1);
 });
 it('serializes simultaneous same-process admissions and rejects changed content',async()=>{
  const loop=completed();const a=create(dbA,loop);
  const [first,second]=await Promise.all([a.accept(input()),a.accept(input())]);expect(first.id).toBe(second.id);
  await Promise.all([a.launch('owner',first.id),a.launch('owner',second.id)]);expect(loop).toHaveBeenCalledTimes(1);
  await expect(a.accept({...input(),messages:[{role:'user',content:'different'}]})).rejects.toThrow('其他交办');
  expect((await a.get('owner',first.id)).content).toBe('完成');
 });
 it('cancels from another instance, settles, and resumes from the saved checkpoint',async()=>{
  const entered=gate();let effects=0;
  const loopA=vi.fn(async params=>{const history=[...params.messages,{role:'assistant',content:'',tool_calls:[{id:'done',name:'test.effect',arguments:{}}]}];await params.onCheckpoint(history);await params.onToolEvent({type:'tool_start',id:'done',toolName:'test.effect',input:{}});effects++;await params.onCheckpoint([...history,{role:'tool',content:'{"done":true}',tool_call_id:'done'}]);await params.onToolEvent({type:'tool_complete',id:'done',toolName:'test.effect',output:{done:true},duration:1});entered.resolve();await new Promise((resolve,reject)=>{releases.push(()=>resolve(null));params.signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true});});return {content:'',stopReason:'completed'};});
  const a=create(dbA,loopA);const run=await a.accept(input());const active=a.launch('owner',run.id);pending.push(active);await entered.promise;
  const loopB=completed();const b=create(dbB,loopB);expect((await b.stop('owner',run.id)).status).toBe('stopping');
  await vi.waitFor(async()=>expect((await b.get('owner',run.id)).status).toBe('paused'),{timeout:3000,interval:50});await active;
  await b.resume('owner',run.id);const resumed=b.wait(run.id);pending.push(resumed);await resumed;
  expect(loopB.mock.calls[0][0].messages.some((message:any)=>message.tool_call_id==='done')).toBe(true);expect(effects).toBe(1);expect((await a.get('owner',run.id)).status).toBe('completed');
 });
 it('fences a stale model response after a new owner resumes known-safe work',async()=>{
  const entered=gate();const stale=gate();let effects=0;
  const loopA=vi.fn(async params=>{entered.resolve();await stale.promise;await params.onCheckpoint([...params.messages,{role:'assistant',content:'stale'}]);effects++;return {content:'stale',stopReason:'completed'};});
  const a=create(dbA,loopA);const run=await a.accept(input());const active=a.launch('owner',run.id);pending.push(active);await entered.promise;
  await dbB.run("UPDATE chat_run_ownership SET expires_at=0 WHERE scope_id LIKE 'session:%'");
  const loopB=completed();const b=create(dbB,loopB);expect((await b.get('owner',run.id)).canResume).toBe(true);await b.resume('owner',run.id);const resumed=b.wait(run.id);pending.push(resumed);await resumed;
  stale.resolve();await active;expect(effects).toBe(0);expect((await a.get('owner',run.id)).content).toBe('完成');
  const message=await dbA.queryOne<{content:string}>('SELECT content FROM chat_messages WHERE id=?',[run.assistantMessageId]);expect(message?.content).toBe('完成');
 });
 it('does not replay a tool whose result was lost when its owner expired',async()=>{
  const entered=gate();const finish=gate();let effects=0;
  const loopA=vi.fn(async params=>{await params.onCheckpoint([...params.messages,{role:'assistant',content:'',tool_calls:[{id:'uncertain',name:'test.effect',arguments:{}}]}]);await params.onToolEvent({type:'tool_start',id:'uncertain',toolName:'test.effect',input:{}});effects++;entered.resolve();await finish.promise;await params.onCheckpoint([...params.messages,{role:'assistant',content:'late'}]);return {content:'late',stopReason:'completed'};});
  const a=create(dbA,loopA);const run=await a.accept(input());const active=a.launch('owner',run.id);pending.push(active);await entered.promise;await dbB.run("UPDATE chat_run_ownership SET expires_at=0 WHERE scope_id LIKE 'session:%'");
  const loopB=completed();const b=create(dbB,loopB);expect((await b.get('owner',run.id)).canResume).toBe(false);
  expect((await b.stop('owner',run.id)).canResume).toBe(false);
  await expect(b.resume('owner',run.id)).rejects.toThrow('未知');expect(loopB).not.toHaveBeenCalled();expect(effects).toBe(1);finish.resolve();await active;
 });
 it('keeps an accepted remote stop paused after its owner expires, until explicit resume',async()=>{
  const loopA=completed();const a=create(dbA,loopA);const run=await a.accept(input());
  const loopB=completed();const b=create(dbB,loopB);
  expect((await b.stop('owner',run.id)).status).toBe('stopping');
  await dbB.run("UPDATE chat_run_ownership SET expires_at=0 WHERE scope_id LIKE 'session:%'");
  expect((await b.get('owner',run.id)).status).toBe('paused');
  expect(await b.launch('owner',run.id)).toBe(false);
  expect(loopA).not.toHaveBeenCalled();expect(loopB).not.toHaveBeenCalled();
  await b.resume('owner',run.id);await b.wait(run.id);
  expect((await a.get('owner',run.id)).status).toBe('completed');expect(loopB).toHaveBeenCalledTimes(1);
 });
});
