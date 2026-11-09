import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {AsyncDatabase} from '../db/database.js';
import {RunOwnershipStore} from '../chat/RunOwnershipStore.js';
import {ModelBudgetUnavailableError} from './modelBudget.js';

const GLOBAL_LIMIT=4,LEASE_MS=30000,MAX_WAIT_MS=180000;
export interface ModelCallLease {signal:AbortSignal;release:()=>Promise<void>;assert:()=>Promise<void>;ticket?:{id:string;token:string};}
/** Tickets contain only ownership metadata, never provider credentials or messages. */
export class ModelCallQueue {
 private ready:Promise<void>;
 private clock:string;
 constructor(private db:AsyncDatabase,private userLimit:(user:string)=>Promise<number>){
  const sqlite=db.getDialect()==='sqlite';
  this.clock=sqlite?"CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)":'CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)';
  this.ready=Promise.resolve().then(async()=>{
    await db.run(`CREATE TABLE IF NOT EXISTS model_call_queue(ticket ${sqlite?'INTEGER PRIMARY KEY AUTOINCREMENT':'BIGINT PRIMARY KEY AUTO_INCREMENT'},id VARCHAR(64) NOT NULL UNIQUE,user_id VARCHAR(128) NOT NULL,run_id VARCHAR(64),owner_token VARCHAR(64) NOT NULL,status VARCHAR(32) NOT NULL,user_limit INTEGER NOT NULL,expires_at BIGINT NOT NULL)${sqlite?'':' ENGINE=InnoDB'}`);
    for(const [name,columns]of[['idx_model_queue_status','status,expires_at'],['idx_model_queue_user','user_id,status,expires_at']]){
      try{await db.run(`CREATE INDEX ${sqlite?'IF NOT EXISTS ':''}${name} ON model_call_queue(${columns})`);}catch(error){if(sqlite||(error as {errno?:number}).errno!==1061)throw error;}
    }
  });
  void this.ready.catch(()=>{});
 }
 async waiting(user:string,run:string){
  await this.ready;
  return !!await this.db.queryOne(`SELECT id FROM model_call_queue WHERE user_id=? AND run_id=? AND status='queued' AND expires_at>${this.clock} LIMIT 1`,[user,run]);
 }
 async acquire(user:string,run:string|undefined,signal?:AbortSignal):Promise<ModelCallLease>{
  const id=randomUUID(),token=randomUUID(),controller=new AbortController(),gate=new RunOwnershipStore(this.db),scope='model-call-admission';
  let released=false,timer:ReturnType<typeof setInterval>|undefined,deadlineTimer:ReturnType<typeof setTimeout>|undefined,renewing:Promise<void>|undefined;
  const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});
  const release=async()=>{
    if(released)return;released=true;if(timer)clearInterval(timer);if(deadlineTimer)clearTimeout(deadlineTimer);signal?.removeEventListener('abort',abort);await renewing;
    try{await this.db.run("UPDATE model_call_queue SET status=?,expires_at=0 WHERE id=? AND owner_token=? AND status IN ('queued','running')",[controller.signal.aborted?'cancelled':'released',id,token]);}catch{/* Expired leases are reclaimed without replaying the call. */}
  };
  const check=async()=>{
    const row=await this.db.queryOne<{status:string;alive:number}>(`SELECT status,expires_at>${this.clock} AS alive FROM model_call_queue WHERE id=? AND owner_token=?`,[id,token]);
    if(!row||!row.alive||!['queued','running'].includes(row.status))throw new ModelBudgetUnavailableError('刚才排队中断了，进度已保留，可以稍后继续做。');
    return row;
  };
  try{
   signal?.throwIfAborted();await this.ready;await gate.init();
   const rawLimit=await this.userLimit(user),limit=rawLimit===Infinity?GLOBAL_LIMIT:Math.min(GLOBAL_LIMIT,rawLimit);
   if(!Number.isSafeInteger(limit)||limit<1)throw new ModelBudgetUnavailableError('当前没有可用模型并发额度，进度会保留。');
   while(!await gate.acquire('system-model-queue',scope,scope,'record')){signal?.throwIfAborted();await delay(50,undefined,{signal});}
   try{
    await this.db.run(`UPDATE model_call_queue SET status='expired' WHERE status IN ('queued','running') AND expires_at<=${this.clock}`);
    const queued=await this.db.queryOne<{total:number;own:number}>("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END),0) AS own FROM model_call_queue WHERE status='queued'",[user]);
    if(!queued||![queued.total,queued.own].every(value=>Number.isSafeInteger(Number(value))&&Number(value)>=0))throw new ModelBudgetUnavailableError();
    if(Number(queued?.total)>=256||Number(queued?.own)>=16)throw new ModelBudgetUnavailableError('排队的事情较多，进度已保留，请稍后继续。');
    await gate.enqueueModelCall(scope,{id,user,runId:run,token,limit},LEASE_MS);
   }finally{await gate.release(scope,'record');}
   let queuedAt=Date.now();
   deadlineTimer=setTimeout(()=>controller.abort(new ModelBudgetUnavailableError('等待模型资源较久，进度已保留，可以稍后继续。')),MAX_WAIT_MS);deadlineTimer.unref();
   timer=setInterval(()=>{
    if(controller.signal.aborted){if(timer)clearInterval(timer);return;}
    if(renewing||released)return;
    renewing=(async()=>{await this.db.run(`UPDATE model_call_queue SET expires_at=${this.clock}+? WHERE id=? AND owner_token=? AND status IN ('queued','running') AND expires_at>${this.clock}`,[LEASE_MS,id,token]);await check();})().catch(()=>controller.abort(new ModelBudgetUnavailableError())).finally(()=>renewing=undefined);
   },1000);timer.unref();
   for(;;){
    controller.signal.throwIfAborted();await check();
    if(Date.now()-queuedAt>MAX_WAIT_MS)throw new ModelBudgetUnavailableError('等待模型资源较久，进度已保留，可以稍后继续。');
    const capacity=await this.db.queryOne<{total:number;own:number}>(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN user_id=? THEN 1 ELSE 0 END),0) AS own FROM model_call_queue WHERE status='running' AND expires_at>${this.clock}`,[user]);
    if(!capacity||![capacity.total,capacity.own].every(value=>Number.isSafeInteger(Number(value))&&Number(value)>=0))throw new ModelBudgetUnavailableError();
    if(Number(capacity.total)<GLOBAL_LIMIT&&Number(capacity.own)<limit&&await gate.acquire('system-model-queue',scope,scope,'record')){
     try{
      const active=await this.db.queryOne<{total:number}>(`SELECT COUNT(*) AS total FROM model_call_queue WHERE status='running' AND expires_at>${this.clock}`);
      if(Number(active?.total)<GLOBAL_LIMIT){
       const next=await this.db.queryOne<{id:string}>(`SELECT q.id FROM model_call_queue q WHERE q.status='queued' AND q.expires_at>${this.clock} AND (SELECT COUNT(*) FROM model_call_queue a WHERE a.user_id=q.user_id AND a.status='running' AND a.expires_at>${this.clock})<q.user_limit ORDER BY (SELECT COUNT(*) FROM model_call_queue a WHERE a.user_id=q.user_id AND a.status='running' AND a.expires_at>${this.clock}),q.ticket LIMIT 1`);
       const current=next?.id===id?await this.userLimit(user):undefined;
       if(current!==undefined){
        const cap=current===Infinity?GLOBAL_LIMIT:Math.min(current,GLOBAL_LIMIT),own=await this.db.queryOne<{total:number}>(`SELECT COUNT(*) AS total FROM model_call_queue WHERE user_id=? AND status='running' AND expires_at>${this.clock}`,[user]);
        controller.signal.throwIfAborted();
        if(!Number.isSafeInteger(cap)||cap<1)throw new ModelBudgetUnavailableError('当前没有可用模型并发额度，进度会保留。');
        if(Number(own?.total)>=cap){await this.db.run("UPDATE model_call_queue SET user_limit=? WHERE id=? AND owner_token=? AND status='queued'",[cap,id,token]);continue;}
       }
       if(next?.id===id&&await gate.admitModelCall(scope,id,token,LEASE_MS)){
        controller.signal.throwIfAborted();if(deadlineTimer)clearTimeout(deadlineTimer);
        deadlineTimer=setTimeout(()=>controller.abort(new ModelBudgetUnavailableError('模型响应等待较久，进度已保留，请稍后继续。')),MAX_WAIT_MS);deadlineTimer.unref();
        return{signal:controller.signal,release,ticket:{id,token},assert:async()=>{
          controller.signal.throwIfAborted();
          try{
            await this.db.run(`UPDATE model_call_queue SET expires_at=${this.clock}+? WHERE id=? AND owner_token=? AND status='running' AND expires_at>${this.clock}`,[LEASE_MS,id,token]);
            if((await check()).status!=='running')throw new ModelBudgetUnavailableError();controller.signal.throwIfAborted();
          }catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw new ModelBudgetUnavailableError();}
        }};
       }
      }
     }finally{await gate.release(scope,'record');}
    }
    await delay(250,undefined,{signal:controller.signal});
   }
  }catch(error){await release();if(signal?.aborted)throw signal.reason;if(error instanceof Error&&['AbortError','ModelBudgetUnavailableError'].includes(error.name))throw error;throw new ModelBudgetUnavailableError();}
 }
}
