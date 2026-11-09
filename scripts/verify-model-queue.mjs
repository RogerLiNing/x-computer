import assert from 'node:assert/strict';import {fork} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,open} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';

const role=process.argv[2],user='model-queue-acceptance';
if(role==='first'||role==='second'){
 const {SqliteAppDatabase,SqliteDatabaseAdapter}=await import('../server/dist/server/src/db/database.js');
 const {SubscriptionService}=await import('../server/dist/server/src/subscription/SubscriptionService.js');
 const {AgentOrchestrator}=await import('../server/dist/server/src/orchestrator/AgentOrchestrator.js');
 const {AuditLogger}=await import('../server/dist/server/src/observability/AuditLogger.js');
 const {UserSandboxManager}=await import('../server/dist/server/src/tooling/UserSandboxManager.js');
 const {ChatRunService}=await import('../server/dist/server/src/chat/ChatRunService.js');
 const {resolveLLMCredentials}=await import('../server/dist/server/src/llm/credentialResolver.js');
 const root=process.env.MODEL_QUEUE_ROOT,native=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(native),originalFetch=globalThis.fetch;let requests=0,runs,runId;
 const command=()=>new Promise(resolve=>process.once('message',resolve));
 try{
  if(role==='first'){const {runMigrations}=await import('../server/dist/server/src/db/migrate.js');const dir=path.join(root,'probe-migrations');await mkdir(dir);await copyFile(new URL('../server/migrations/001_add_subscriptions.sql',import.meta.url),path.join(dir,'001_add_subscriptions.sql'));await runMigrations(db,dir);await db.ensureUser(user);}
  const plans=new SubscriptionService(db,root),spaces=new UserSandboxManager(root),config=await resolveLLMCredentials(user,db,plans);assert.ok(config?.apiKey);const origin=new URL(config.baseUrl).origin;
  const orchestrator=new AgentOrchestrator(new AuditLogger(),undefined,spaces,db,undefined,undefined,undefined,plans);
  runs=new ChatRunService({db,orchestrator,modelBudget:plans,getSandboxFS:async uid=>(await spaces.getForUser(uid)).sandboxFS,getLLMConfig:async()=>config});
  globalThis.fetch=async(url,init)=>{
   if(new URL(String(url)).origin!==origin||init?.method!=='POST')return originalFetch(url,init);
   requests++;assert.equal(requests,1);const response=await originalFetch(url,init);assert.equal(response.status,200);
   if(role==='first'){const bytes=await response.arrayBuffer(),release=command();process.send({phase:'held',pid:process.pid,runId,requests,bytes:bytes.byteLength});await release;return new Response(bytes,{status:response.status,headers:response.headers});}
   return response;
  };
  const session=await db.createSession(user,'排队验收-'+role),run=await runs.accept({userId:user,sessionId:session.id,requestId:'model-queue-'+role,messages:[{role:'user',content:role==='first'?'只回复：第一件已核对。':'只回复：第二件已核对。'}],providerId:config.providerId,modelId:config.modelId,systemPrompt:'这是隔离的并发排队验收，不使用工具或联系外部。只返回用户要求的简短文字。',allowedToolNames:[],toolLoadingMode:'all'});runId=run.id;
  const execution=runs.launch(user,runId);
  if(role==='second'){
   const deadline=Date.now()+15000;let queued;
   do{queued=await runs.get(user,runId);if(queued.waitingForModel)break;assert.ok(Date.now()<deadline);await delay(50);}while(true);
   assert.equal(requests,0);process.send({phase:'queued',pid:process.pid,runId,waitingForModel:true,requests,usage:(await plans.getCurrentUsage(user)).aiCalls});
   const action=await command();assert.equal(action.waitStopped,true);await execution;const paused=await runs.get(user,runId);assert.equal(paused.status,'paused');assert.equal(requests,0);
   const next=command();process.send({phase:'stopped',pid:process.pid,runId,status:paused.status,requests,usage:(await plans.getCurrentUsage(user)).aiCalls});await next;
   await runs.resume(user,runId);await runs.wait(runId);
  }else await execution;
  const done=await runs.get(user,runId);assert.equal(done.status,'completed');assert.ok(done.content.trim());process.send({phase:'completed',role,pid:process.pid,runId,requests,status:done.status,usage:(await plans.getCurrentUsage(user)).aiCalls,taskCount:(await db.getAllTasks()).length});
 }catch(error){process.send({phase:'failed',role,errorName:error.name});process.exitCode=1;}
 finally{globalThis.fetch=originalFetch;native.close();process.disconnect();}
}else{
 const config=process.env.X_COMPUTER_CONFIG_PATH;assert.ok(config,'必须显式使用专用验收配置');assert.equal(JSON.parse(await readFile(config,'utf8')).database.type,'sqlite');
 const root=await mkdtemp(path.join(os.tmpdir(),'x-model-queue-real-')),out=await mkdtemp(path.join(os.tmpdir(),'x-model-queue-proof-')),children=[],logs=[];
 const receipt=child=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clear();reject(new Error('owned worker timed out'));},90000),message=data=>{clear();data.phase==='failed'?reject(new Error('owned worker failed: '+data.errorName)):resolve(data);},exit=()=>{clear();reject(new Error('owned worker exited before receipt'));};function clear(){clearTimeout(timer);child.off('message',message);child.off('exit',exit);}child.once('message',message);child.once('exit',exit);});
 async function start(worker){const log=await open(path.join(out,worker+'.log'),'wx',0o600);logs.push(log);const child=fork(fileURLToPath(import.meta.url),[worker],{env:{PATH:process.env.PATH,HOME:root,TMPDIR:root,X_COMPUTER_CONFIG_PATH:config,DATABASE_TYPE:'sqlite',MODEL_QUEUE_ROOT:root},stdio:['ignore',log.fd,log.fd,'ipc']});children.push(child);return child;}
 try{
  const first=await start('first'),held=await receipt(first);assert.equal(held.phase,'held');const second=await start('second'),queued=await receipt(second);assert.equal(queued.phase,'queued');assert.equal(queued.usage,1);
  const {SqliteAppDatabase,SqliteDatabaseAdapter}=await import('../server/dist/server/src/db/database.js');const {ChatRunService}=await import('../server/dist/server/src/chat/ChatRunService.js');
  const controlNative=new SqliteAppDatabase(root),control=new ChatRunService({db:new SqliteDatabaseAdapter(controlNative),orchestrator:{runChatAgentLoop:async()=>{throw new Error('control process must not call a model');}},getSandboxFS:async()=>{throw new Error('control process must not access files');},getLLMConfig:async()=>{throw new Error('control process must not resolve model credentials');}});
  try{assert.equal((await control.stop(user,queued.runId)).status,'stopping');}finally{controlNative.close();}
  const stopping=receipt(second);second.send({waitStopped:true});
  const completing=receipt(first);first.send({release:true});const finished=await completing;assert.equal(finished.phase,'completed');
  const stopped=await stopping;assert.equal(stopped.phase,'stopped');assert.equal(stopped.requests,0);assert.equal(stopped.usage,1);
  const resuming=receipt(second);second.send({resume:true});const resumed=await resuming;assert.equal(resumed.phase,'completed');assert.equal(resumed.runId,stopped.runId);assert.equal(resumed.usage,2);assert.equal(resumed.taskCount,2);
  const evidence={success:true,root,database:'isolated SQLite',distinctOsProcesses:first.pid!==second.pid,stopIssuedBySeparateControlInstance:true,heldOriginalProviderResponse:held,queued,stopped,finished,resumed,queueStopAddedCharge:false,sameRunResumed:true,realProviderAttempts:held.requests+resumed.requests,originalMysqlAccessed:false,memoryManagementChanged:false,browserVerified:false,realMysqlVerified:false};await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({success:true,evidence:path.join(out,'evidence.json')}));
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');for(const log of logs)await log.close();}
}
