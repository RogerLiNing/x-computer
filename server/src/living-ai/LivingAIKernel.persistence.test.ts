import{describe,it,expect,vi}from'vitest';import{mkdtemp}from'node:fs/promises';import os from'node:os';import path from'node:path';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../db/database.js';import{LivingAIKernel}from'./LivingAIKernel.js';
describe('durable autonomous observation',()=>{
 it('reads jobs saved by another database connection and keeps other users out',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'living-observation-')),first=new SqliteAppDatabase(root),second=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(first),writer=new SqliteDatabaseAdapter(second);
  try{
   for(const user of ['owner','other']){await writer.ensureUser(user);await writer.insertTask({id:`job-${user}`,user_id:user,domain:'chat',title:`title-${user}`,description:'',status:'running',steps_json:'[]',result_json:'{}',metadata_json:'{}',created_at:Date.now(),updated_at:Date.now()});}
   await writer.insertTask({id:'paused-owner',user_id:'owner',domain:'chat',title:'用户暂停的原任务',description:'',status:'paused',steps_json:'[]',result_json:'{}',metadata_json:'{}',created_at:Date.now(),updated_at:Date.now()});
   for(const id of ['finished-running','finished-failed'])await writer.insertTask({id,user_id:'owner',domain:'chat',title:'已完成的任务',description:'',status:'completed',steps_json:'[]',result_json:'{}',metadata_json:'{}',created_at:Date.now(),updated_at:Date.now()});
   const execute=vi.fn(),kernel=new LivingAIKernel({db,orchestrator:{getAllTasks:()=>[{id:'finished-running',title:'旧运行',status:'running',metadata:{userId:'owner'}},{id:'finished-failed',title:'旧失败',status:'failed',metadata:{userId:'owner'}}],runIntentAsPersistedTask:execute} as never,getLLMConfig:async()=>null,getSystemPrompt:async()=>'',notify:async()=>{}});
   const status=await kernel.runCycle('owner','manual'),observation=JSON.parse(status.state.lastObservation!);
   expect(observation.activeTaskCount).toBe(1);expect(observation.runningTasks.map((task:{id:string})=>task.id)).toEqual(['job-owner']);expect(status.state.lastObservation).not.toContain('job-other');expect(execute).not.toHaveBeenCalled();
   expect(observation.waitingTasks.map((task:{id:string})=>task.id)).toEqual(['paused-owner']);
   expect(observation.recentFailures).toEqual([]);
  }finally{first.close();second.close();}
 });
});
