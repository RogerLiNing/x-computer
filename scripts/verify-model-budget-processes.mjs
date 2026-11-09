import assert from'node:assert/strict';import{readFile,writeFile,mkdir}from'node:fs/promises';import{randomUUID}from'node:crypto';import{fork}from'node:child_process';import{fileURLToPath}from'node:url';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../server/dist/server/src/db/database.js';import{SubscriptionService}from'../server/dist/server/src/subscription/SubscriptionService.js';
const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101';assert.equal(process.env.X_COMPUTER_CONFIG_PATH,root+'/config.private.json');assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const nonce=randomUUID().slice(0,8),uid=`budget-race-${nonce}`,plan=`budget-race-plan-${nonce}`,out=`/Users/rogerlee/.codex/outputs/x-computer-model-budget-20261102/processes-${nonce}`,sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),children=[];
try{
 const now=Date.now();await db.ensureUser(uid);await db.setConfig(uid,'living_ai_state_v1',JSON.stringify({config:{enabled:false}}));
 await db.run('INSERT INTO plans(id,name,display_name_en,display_name_zh,ai_calls_limit,storage_limit,concurrent_tasks_limit,features,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[plan,plan,'Process race fixture','独立进程额度验收',3,1024,1,JSON.stringify(['basic_features']),0,now,now]);
 await db.run('INSERT INTO subscriptions(id,user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[`budget-race-sub-${nonce}`,uid,plan,'active','monthly',now-1000,now+24*60*60*1000,0,now,now]);
 const waiting=Array.from({length:2},()=>{
  const child=fork(fileURLToPath(new URL('./model-budget-worker.mjs',import.meta.url)),[uid],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);
  let result;let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
  const done=new Promise((resolve,reject)=>{
   child.on('error',reject);child.on('message',message=>{if(message.type==='ready')readyResolve();else if(message.type==='result')result=message;else if(message.type==='failed')reject(new Error(message.error));});
   child.on('exit',code=>code===0&&result?resolve(result):reject(new Error(`worker exit ${code}`)));
  });return{child,ready,done};
 });
 await Promise.all(waiting.map(item=>item.ready));for(const item of waiting)item.child.send('start');
 const results=await Promise.all(waiting.map(item=>item.done)),success=results.reduce((sum,item)=>sum+item.success,0),attempts=results.reduce((sum,item)=>sum+item.success+item.denied,0);
 const usage=await new SubscriptionService(db).getCurrentUsage(uid);assert.equal(success,3);assert.equal(usage.aiCalls,3);assert.equal(attempts,12);assert.notEqual(results[0].pid,results[1].pid);
 const evidence={success:true,osProcessContentionVerified:true,providerCallsMade:false,isolatedUserId:uid,isolatedPlanId:plan,processResults:results,quotaLimit:3,totalAttempts:attempts,successfulReservations:success,persistedUsage:usage.aiCalls,originalMysqlAccessed:false};
 await mkdir(out,{recursive:true});await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({success:true,evidence:out+'/evidence.json',osProcessContentionVerified:true,totalAttempts:attempts,successfulReservations:success}));
}finally{for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');sqlite.close();}
