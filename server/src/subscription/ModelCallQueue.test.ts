import {expect,it,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {ModelCallQueue,type ModelCallLease} from './ModelCallQueue.js';
import {ModelBudgetUnavailableError} from './modelBudget.js';
async function fixture(limit=1){
 const root=await mkdtemp(path.join(os.tmpdir(),'model-queue-')),first=new SqliteAppDatabase(root),second=new SqliteAppDatabase(root),a=new SqliteDatabaseAdapter(first),b=new SqliteDatabaseAdapter(second);
 return{a,b,one:new ModelCallQueue(a,async()=>limit),two:new ModelCallQueue(b,async()=>limit),close:()=>{first.close();second.close();}};
}
it('serializes one user while letting another user use idle capacity',async()=>{
 const f=await fixture(),leases:ModelCallLease[]=[],controller=new AbortController();let pending:Promise<unknown>|undefined;
 try{
  leases.push(await f.one.acquire('alice','first'));pending=f.two.acquire('alice','second',controller.signal).catch(error=>error);
  await vi.waitFor(async()=>expect(await f.one.waiting('alice','second')).toBe(true));leases.push(await f.two.acquire('bob','other'));
  expect(await f.a.query("SELECT id FROM model_call_queue WHERE status='running'")).toHaveLength(2);
  controller.abort();expect(await pending).toMatchObject({name:'AbortError'});
 }finally{controller.abort();await pending;await Promise.all(leases.map(lease=>lease.release()));f.close();}
});
it('caps global work at four and gives idle users a turn ahead of a busy user backlog',async()=>{
 const f=await fixture(4),leases:ModelCallLease[]=[],cancelAlice=new AbortController(),cancelBob=new AbortController();let alice:Promise<any>|undefined,bob:Promise<any>|undefined;
 try{
  for(let index=0;index<4;index++)leases.push(await f.one.acquire('alice','active-'+index));
  alice=f.one.acquire('alice','older-backlog',cancelAlice.signal).catch(error=>error);await vi.waitFor(async()=>expect(await f.one.waiting('alice','older-backlog')).toBe(true));
  bob=f.two.acquire('bob','new-user',cancelBob.signal).catch(error=>error);await vi.waitFor(async()=>expect(await f.one.waiting('bob','new-user')).toBe(true));
  await leases.shift()!.release();const next=await bob;expect(next.signal).toBeInstanceOf(AbortSignal);leases.push(next);
  expect(await f.one.waiting('alice','older-backlog')).toBe(true);expect(await f.a.query("SELECT id FROM model_call_queue WHERE status='running'")).toHaveLength(4);
 }finally{cancelAlice.abort();cancelBob.abort();await alice;await bob;await Promise.all(leases.map(lease=>lease.release()));f.close();}
});
it('does not insert a queue ticket after its admission gate expires',async()=>{
 const f=await fixture();let changed=false;const run=f.a.run.bind(f.a);
 vi.spyOn(f.a,'run').mockImplementation(async(sql,params)=>{if(!changed&&sql.startsWith('INSERT INTO model_call_queue')){changed=true;await f.b.run('UPDATE chat_run_ownership SET expires_at=0');}return run(sql,params);});
 try{await expect(f.one.acquire('alice','fenced')).rejects.toBeInstanceOf(ModelBudgetUnavailableError);expect(await f.a.query('SELECT * FROM model_call_queue')).toEqual([]);}
 finally{f.close();}
});
it('aborts a holder whose lease expires and does not revive the expired record',async()=>{
 const f=await fixture(),lease=await f.one.acquire('alice','expired');let replacement:ModelCallLease|undefined;
 try{
  await f.b.run("UPDATE model_call_queue SET expires_at=0 WHERE status='running'");await vi.waitFor(()=>expect(lease.signal.aborted).toBe(true),{timeout:2500});
  replacement=await f.two.acquire('bob','replacement');expect((await f.a.queryOne<{status:string}>("SELECT status FROM model_call_queue WHERE run_id='expired'"))?.status).toBe('expired');
 }finally{await lease.release();await replacement?.release();f.close();}
});
it('bounds pending work per user and globally without removing prior records',async()=>{
 const f=await fixture();try{
  await f.one.waiting('alice','none');
  for(let index=0;index<256;index++)await f.a.run("INSERT INTO model_call_queue(id,user_id,run_id,owner_token,status,user_limit,expires_at) VALUES(?,?,?,?, 'queued',1,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)+30000)",['seed-'+index,index<16?'alice':'other-'+index,'seed-'+index,'seed-token-'+index]);
  await expect(f.one.acquire('alice','over-user-limit')).rejects.toBeInstanceOf(ModelBudgetUnavailableError);
  await expect(f.two.acquire('new-user','over-global-limit')).rejects.toBeInstanceOf(ModelBudgetUnavailableError);
  expect(await f.a.query('SELECT id FROM model_call_queue')).toHaveLength(256);
 }finally{f.close();}
});
it('does not keep renewing cancelled queued work while a quota lookup is still returning',async()=>{
 const f=await fixture();let calls=0,entered!:()=>void,release!:()=>void;
 const stalled=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve),controller=new AbortController();
 const queue=new ModelCallQueue(f.a,async()=>{if(++calls===2){entered();await hold;}return 1;});
 const run=f.a.run.bind(f.a);let renewals=0;vi.spyOn(f.a,'run').mockImplementation(async(sql,params)=>{if(sql.startsWith('UPDATE model_call_queue SET expires_at='))renewals++;return run(sql,params);});
 const pending=queue.acquire('alice','slow-quota',controller.signal).catch(error=>error);
 try{await stalled;controller.abort();await new Promise(resolve=>setTimeout(resolve,1100));expect(renewals).toBe(0);release();expect(await pending).toMatchObject({name:'AbortError'});}
 finally{controller.abort();release();await pending;f.close();}
});
