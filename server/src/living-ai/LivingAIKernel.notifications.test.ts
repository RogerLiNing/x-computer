import {expect,it,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import request from 'supertest';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {LivingAIKernel} from './LivingAIKernel.js';
import {RunOwnershipLostError} from '../chat/RunOwnershipStore.js';
import {createXProactiveRouter} from '../routes/xProactive.js';

async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'living-notice-')),first=new SqliteAppDatabase(root),second=new SqliteAppDatabase(root),a=new SqliteDatabaseAdapter(first),b=new SqliteDatabaseAdapter(second);
 const execute=vi.fn(async()=>({content:JSON.stringify({decision:'idle',summary:'DONE',messageToUser:'通知验收'})}));
 const create=(db:SqliteDatabaseAdapter,now?:()=>number)=>{const notify=vi.fn(),kernel=new LivingAIKernel({db,orchestrator:{getAllTasks:()=>[],runIntentAsPersistedTask:execute} as never,getLLMConfig:async()=>({providerId:'test',modelId:'test'}),getSystemPrompt:async()=>'',notify,now});return{kernel,notify};};
 const one=create(a),two=create(b);await one.kernel.updateConfig('owner',{quietHours:{enabled:false,startHour:23,endHour:7}});
 return{a,b,one,two,execute,create,close:()=>{first.close();second.close();}};
}
it('recovers an unsent notice after result commit without another model or cycle',async()=>{
 const f=await fixture();try{
  const run=f.a.run.bind(f.a);let fail=true;
  vi.spyOn(f.a,'run').mockImplementation(async(sql,params)=>{if(fail&&sql.startsWith('INSERT OR IGNORE INTO notifications')){fail=false;throw new Error('delivery unavailable');}return run(sql,params);});
  await f.one.kernel.runCycle('owner');const before=(await f.one.kernel.getStatus('owner')).state;
  expect(before.episodes).toHaveLength(1);expect(before.phase).toBe('sleeping');expect(before.lastError).toBeNull();expect(await f.a.getNotifications('owner',{includeRead:true})).toHaveLength(0);
  await f.two.kernel.recoverNotifications('owner');const after=(await f.two.kernel.getStatus('owner')).state;
  expect(f.execute).toHaveBeenCalledTimes(1);expect(after.cycleCount).toBe(before.cycleCount);expect(after.episodes).toHaveLength(1);expect(await f.b.getNotifications('owner',{includeRead:true})).toHaveLength(1);expect(f.two.notify).toHaveBeenCalledTimes(1);
 }finally{f.close();}
});
it('retries lost acknowledgement with one durable notice and persistent read state',async()=>{
 const f=await fixture();try{
  const run=f.a.run.bind(f.a);let fail=true;
  vi.spyOn(f.a,'run').mockImplementation(async(sql,params)=>{
   if(fail&&sql.startsWith('UPDATE user_config SET value=?,updated_at=?')){const state=JSON.parse(String(params?.[0]));if(state.episodes?.length===1&&state.pendingNotices?.length===0){fail=false;throw new RunOwnershipLostError('ack lost');}}
   return run(sql,params);
  });
  await f.one.kernel.runCycle('owner');const [notice]=await f.a.getNotifications('owner',{includeRead:true});expect(notice).toBeTruthy();
  const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).userId=req.headers['x-test-user'];next();});app.use(createXProactiveRouter(f.b));
  expect((await request(app).get('/x/proactive-messages').set('x-test-user','other')).body.messages).toEqual([]);
  await request(app).post('/x/proactive-messages/read').set('x-test-user','other').send({id:notice.id});expect((await f.b.getNotifications('owner',{includeRead:true}))[0].read).toBe(0);
  await request(app).post('/x/proactive-messages/read').set('x-test-user','owner').send({id:notice.id});
  const competitor=f.create(f.a);await Promise.all([f.two.kernel.recoverNotifications('owner'),competitor.kernel.recoverNotifications('owner')]);
  expect(await f.b.getNotifications('owner',{includeRead:true})).toHaveLength(1);expect((await f.b.getNotifications('owner',{includeRead:true}))[0].read).toBe(1);
  const messages=(await request(app).get('/x/proactive-messages').set('x-test-user','owner')).body.messages;expect(messages).toHaveLength(1);expect(messages[0]).toMatchObject({id:notice.id,content:'通知验收',read:true});expect(f.execute).toHaveBeenCalledTimes(1);
 }finally{f.close();}
});
it('does not send a queued notice after its autonomy generation is disabled',async()=>{
 const f=await fixture();try{
  const run=f.a.run.bind(f.a);vi.spyOn(f.a,'run').mockImplementation(async(sql,params)=>{if(sql.startsWith('INSERT OR IGNORE INTO notifications'))throw new Error('deferred');return run(sql,params);});
  await f.one.kernel.runCycle('owner');await f.two.kernel.updateConfig('owner',{enabled:false});await f.two.kernel.updateConfig('owner',{enabled:true});
  await f.two.kernel.recoverNotifications('owner');expect(f.two.notify).not.toHaveBeenCalled();expect(await f.b.getNotifications('owner',{includeRead:true})).toEqual([]);expect(f.execute).toHaveBeenCalledTimes(1);
 }finally{f.close();}
});

it('continues due work during quiet hours and delivers queued notices afterwards',async()=>{
 const f=await fixture();let now=Date.parse('2026-11-02T23:00:00+08:00');const worker=f.create(f.a,()=>now);
 try{
  await worker.kernel.updateConfig('owner',{cycleIntervalMinutes:5,quietHours:{enabled:true,startHour:23,endHour:7}});
  await worker.kernel.runCycle('owner');expect(worker.notify).not.toHaveBeenCalled();
  now+=6*60*1000;await (worker.kernel as any).tick();await (worker.kernel as any).activeCycles.get('owner');
  expect(f.execute).toHaveBeenCalledTimes(2);expect(await f.a.getNotifications('owner',{includeRead:true})).toHaveLength(0);
  now=Date.parse('2026-11-03T10:00:00+08:00');await worker.kernel.recoverNotifications('owner');
  expect(worker.notify).toHaveBeenCalledTimes(2);expect(await f.a.getNotifications('owner',{includeRead:true})).toHaveLength(2);expect(f.execute).toHaveBeenCalledTimes(2);
 }finally{f.close();}
});

it('changing quiet hours does not discard a completed queued notice',async()=>{
 const f=await fixture();const worker=f.create(f.a,()=>Date.parse('2026-11-02T23:00:00+08:00'));
 try{
  await worker.kernel.updateConfig('owner',{quietHours:{enabled:true,startHour:23,endHour:7}});await worker.kernel.runCycle('owner');
  expect(worker.notify).not.toHaveBeenCalled();await worker.kernel.updateConfig('owner',{quietHours:{enabled:false,startHour:23,endHour:7}});await worker.kernel.recoverNotifications('owner');
  expect(worker.notify).toHaveBeenCalledTimes(1);expect(await f.a.getNotifications('owner',{includeRead:true})).toHaveLength(1);expect(f.execute).toHaveBeenCalledTimes(1);
 }finally{f.close();}
});
