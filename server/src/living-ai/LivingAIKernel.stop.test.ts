import{describe,it,expect,vi}from'vitest';import{mkdtemp,mkdir}from'node:fs/promises';import os from'node:os';import path from'node:path';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../db/database.js';import{SandboxFS}from'../tooling/SandboxFS.js';import{ChatRunService}from'../chat/ChatRunService.js';import{ScheduledOccurrenceService}from'../scheduler/ScheduledOccurrenceService.js';import{LivingAIKernel}from'./LivingAIKernel.js';
describe('autonomous stop across service instances',()=>{
 it('stops the durable caller-owned task and never recovers it after off-on',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'living-stop-')),first=new SqliteAppDatabase(root),second=new SqliteAppDatabase(root),a=new SqliteDatabaseAdapter(first),b=new SqliteDatabaseAdapter(second),sandbox=new SandboxFS(path.join(root,'files'));
  await mkdir(sandbox.getRoot());let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  const loop=vi.fn(async(p:any)=>{entered();await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));return{content:'',stopReason:'completed' as const};});
  const services=(db:SqliteDatabaseAdapter)=>{
   const runs=new ChatRunService({db,orchestrator:{runChatAgentLoop:loop},getSandboxFS:async()=>sandbox,getLLMConfig:async()=>({providerId:'test',modelId:'test'})});
   const scheduler=new ScheduledOccurrenceService({db,getRuns:()=>runs,getSystemPrompt:async()=>'',getLLMConfig:async()=>({providerId:'test',modelId:'test'})});return{runs,scheduler};
  };
  const worker=services(a),control=services(b);
  const kernel=(db:SqliteDatabaseAdapter,scheduler:ScheduledOccurrenceService)=>new LivingAIKernel({db,orchestrator:{getAllTasks:()=>[],runIntentAsPersistedTask:(input:Parameters<ScheduledOccurrenceService['run']>[0])=>scheduler.run(input)} as never,getLLMConfig:async()=>({providerId:'test',modelId:'test'}),getSystemPrompt:async()=>'',cancelCycles:user=>scheduler.cancelLivingCycles(user)});
  const active=kernel(a,worker.scheduler),remote=kernel(b,control.scheduler);let cycle:Promise<unknown>|undefined;
  try{
   cycle=active.runCycle('owner');await started;await remote.updateConfig('owner',{enabled:false});await cycle;await worker.scheduler.wait();
   const records=await worker.scheduler.list('owner');expect(records).toHaveLength(1);expect(records[0].cancelled).toBe(1);expect((await worker.runs.get('owner',records[0].run_id!)).status).toBe('paused');
   expect((await active.getStatus('owner')).state.config.enabled).toBe(false);
   await remote.updateConfig('owner',{enabled:true});await worker.scheduler.recover();await control.scheduler.recover();expect(loop).toHaveBeenCalledTimes(1);expect((await a.getAllTasks())).toHaveLength(1);
  }finally{await remote.updateConfig('owner',{enabled:false});await cycle;await worker.scheduler.wait();first.close();second.close();}
 });
});
