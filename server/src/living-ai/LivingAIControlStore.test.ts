import{describe,it,expect,vi}from'vitest';import{mkdtemp}from'node:fs/promises';import os from'node:os';import path from'node:path';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../db/database.js';import{LivingAIKernel}from'./LivingAIKernel.js';import{LivingAIControlStore,LIVING_STATE_KEY}from'./LivingAIControlStore.js';
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'living-control-')),a=new SqliteAppDatabase(root),b=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(a),other=new SqliteDatabaseAdapter(b);
 const kernel=new LivingAIKernel({db,orchestrator:{getAllTasks:()=>[]} as never,getLLMConfig:async()=>null,getSystemPrompt:async()=>''});
 const state=(await kernel.getStatus('owner')).state,first=new LivingAIControlStore(db),second=new LivingAIControlStore(other),control=await first.initialize('owner',state.config);
 return{a,b,db,other,kernel,state,first,second,control,close:()=>{a.close();b.close();}};
}
describe('persistent autonomous control generations',()=>{
 it('rejects a late snapshot if a different connection changes control after the precheck',async()=>{
  const f=await fixture();try{
   const write=f.db.run.bind(f.db);let changed=false;
   vi.spyOn(f.db,'run').mockImplementation(async(sql,params)=>{if(!changed&&sql.startsWith('UPDATE user_config SET value=?,updated_at=?')){changed=true;await f.second.patch('owner',f.state.config,current=>({...current,enabled:false}));}return write(sql,params);});
   f.state.lastAction='STALE_RESULT';await expect(f.first.saveCycle('owner',f.state,f.control.raw,new AbortController().signal)).rejects.toMatchObject({name:'AbortError'});
   expect(JSON.parse((await f.db.getConfig('owner',LIVING_STATE_KEY))!).lastAction).not.toBe('STALE_RESULT');expect((await f.kernel.getStatus('owner')).state.config.enabled).toBe(false);
  }finally{f.close();}
 });
 it('merges concurrent setting changes rather than replacing another connection changes',async()=>{
  const f=await fixture();try{
   await Promise.all([f.first.patch('owner',f.state.config,current=>({...current,cycleIntervalMinutes:10})),f.second.patch('owner',f.state.config,current=>({...current,maxActionsPerCycle:2}))]);
   const current=(await f.first.read('owner'))!;expect(current.value.config.cycleIntervalMinutes).toBe(10);expect(current.value.config.maxActionsPerCycle).toBe(2);
  }finally{f.close();}
 });
});
