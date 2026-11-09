import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{mkdir,copyFile,writeFile,readFile}from'node:fs/promises';import path from'node:path';import{setTimeout as delay}from'node:timers/promises';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../server/dist/server/src/db/database.js';import{runMigrations}from'../server/dist/server/src/db/migrate.js';import{SubscriptionService}from'../server/dist/server/src/subscription/SubscriptionService.js';import{resolveLLMCredentials}from'../server/dist/server/src/llm/credentialResolver.js';import{UserSandboxManager}from'../server/dist/server/src/tooling/UserSandboxManager.js';import{AgentOrchestrator}from'../server/dist/server/src/orchestrator/AgentOrchestrator.js';import{AuditLogger}from'../server/dist/server/src/observability/AuditLogger.js';import{ChatRunService}from'../server/dist/server/src/chat/ChatRunService.js';import{ScheduledOccurrenceService}from'../server/dist/server/src/scheduler/ScheduledOccurrenceService.js';import{LivingAIKernel}from'../server/dist/server/src/living-ai/LivingAIKernel.js';
const privateConfig='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101/config.private.json';assert.equal(process.env.X_COMPUTER_CONFIG_PATH,privateConfig);assert.equal(JSON.parse(await readFile(privateConfig,'utf8')).database.type,'sqlite');
const nonce=randomUUID().slice(0,8),uid=`autonomy-stop-${nonce}`,root=`/Users/rogerlee/.codex/runtime/x-computer-autonomy-stop-${nonce}`,out=`/Users/rogerlee/.codex/outputs/x-computer-autonomy-stop-20261102/${nonce}`;
await mkdir(root,{recursive:true,mode:0o700});await mkdir(out,{recursive:true,mode:0o700});
const first=new SqliteAppDatabase(root),second=new SqliteAppDatabase(root),a=new SqliteDatabaseAdapter(first),b=new SqliteDatabaseAdapter(second),spaces=new UserSandboxManager(root),originalFetch=globalThis.fetch;
let release;const delivered=new Promise(resolve=>release=resolve);let receivedResolve,receivedReject;const received=new Promise((resolve,reject)=>{receivedResolve=resolve;receivedReject=reject});let responseSignal,requestCount=0,notifyCount=0,cycle,timer,remote,worker;
try{
 const migrations=path.join(root,'migrations');await mkdir(migrations);await copyFile(new URL('../server/migrations/001_add_subscriptions.sql',import.meta.url),path.join(migrations,'001_add_subscriptions.sql'));await runMigrations(a,migrations);await a.ensureUser(uid);
 const plans=new SubscriptionService(a,root),config=await resolveLLMCredentials(uid,a,plans);assert.ok(config?.apiKey);const origin=new URL(config.baseUrl).origin;
 const services=db=>{const subscription=new SubscriptionService(db,root);const orchestrator=new AgentOrchestrator(new AuditLogger(),undefined,spaces,db,undefined,undefined,undefined,subscription);
  const credentials=async(user,providerId,modelId)=>{const value=await resolveLLMCredentials(user,db,subscription,{providerId,modelId});assert.ok(value);return value;};
  const runs=new ChatRunService({db,orchestrator,modelBudget:subscription,getSandboxFS:async user=>(await spaces.getForUser(user)).sandboxFS,getLLMConfig:credentials});orchestrator.setExpertDispatchRunner(request=>runs.expertDispatch(request));
  const scheduler=new ScheduledOccurrenceService({db,getRuns:()=>runs,getLLMConfig:(user,selection)=>credentials(user,selection?.providerId,selection?.modelId),getSystemPrompt:async()=>''});orchestrator.setBackgroundIntentRunner(input=>scheduler.run(input));
  const kernel=new LivingAIKernel({db,orchestrator,getLLMConfig:user=>credentials(user),getSystemPrompt:async()=> '本次仅验证暂停。不要调用工具或联系外部，最终返回要求的JSON。',notify:()=>notifyCount++,cancelCycles:user=>scheduler.cancelLivingCycles(user)});return{kernel,scheduler,runs,subscription};};
 worker=services(a);remote=services(b);
 await remote.kernel.updateConfig(uid,{enabled:false,allowLowRiskActions:false,autonomyMode:'observe',quietHours:{enabled:false,startHour:23,endHour:7}});
 const marker=`LATE_REPLY_${nonce}`,goal=(await remote.kernel.addGoal(uid,{title:'暂停控制验收',description:`不执行任何工具或外部操作。用JSON返回decision为idle，summary为${marker}，不要完成目标或添加新目标，不要通知用户。`,priority:100})).state.goals.find(goal=>goal.title==='暂停控制验收');assert.ok(goal);
 globalThis.fetch=async(url,init)=>{
  if(new URL(String(url)).origin===origin&&init?.method==='POST'){
   requestCount++;assert.equal(requestCount,1);responseSignal=init.signal;
   try{const response=await originalFetch(url,init),bytes=await response.arrayBuffer();assert.equal(response.ok,true);assert.ok(bytes.byteLength>0);
    receivedResolve({status:response.status,bytes:bytes.byteLength,markerPresent:Buffer.from(bytes).toString().includes(marker)});await delivered;
    return new Response(bytes,{status:response.status,headers:response.headers});
   }catch(error){receivedReject(error);throw error;}
  }
  return originalFetch(url,init);
 };
 await remote.kernel.updateConfig(uid,{enabled:true});cycle=worker.kernel.runCycle(uid,'manual');void cycle.then(status=>{if(requestCount===0)receivedReject(new Error(status.state.lastError??'cycle ended before provider request'));},receivedReject);timer=setTimeout(()=>receivedReject(new Error('provider response verification timed out')),90000);
 const reply=await received;clearTimeout(timer);
 await remote.kernel.updateConfig(uid,{enabled:false});assert.ok(responseSignal);
 const deadline=Date.now()+10000;while(!responseSignal.aborted&&Date.now()<deadline)await delay(20);assert.equal(responseSignal.aborted,true);
 release();await cycle;await worker.scheduler.wait();
 const paused=(await worker.kernel.getStatus(uid)).state,records=await worker.scheduler.list(uid);assert.equal(paused.config.enabled,false);assert.equal(paused.phase,'paused');assert.equal(paused.episodes.length,0);assert.equal(paused.goals.find(item=>item.id===goal.id).progress,0);assert.equal(notifyCount,0);assert.equal(records.length,1);assert.equal(records[0].cancelled,1);
 const run=await worker.runs.get(uid,records[0].run_id);assert.equal(run.status,'paused');assert.equal((await plans.getCurrentUsage(uid)).aiCalls,1);
 await remote.kernel.updateConfig(uid,{enabled:true});await worker.scheduler.recover();await remote.scheduler.recover();assert.equal(requestCount,1);assert.equal((await a.getAllTasks()).length,1);await remote.kernel.updateConfig(uid,{enabled:false});
 assert.ok(!(await a.getAllTasks()).some(row=>row.metadata_json.includes(config.apiKey)));
 const evidence={success:true,actualProviderResponseReceived:true,responseWasHeldForLateDelivery:true,providerResponse:reply,providerRequestAttempts:requestCount,providerSignalAborted:true,durableRunPaused:true,cancelledOccurrence:true,lateDecisionApplied:false,lateNotifications:notifyCount,oldWorkNotRestartedAfterEnable:true,isolatedSqliteRoot:root,isolatedUserId:uid,runId:run.id,serviceInstances:2,browserVerified:false,mysqlVerified:false,originalMysqlAccessed:false,memoryManagementChanged:false};
 await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({success:true,evidence:out+'/evidence.json',runId:run.id,providerRequestAttempts:requestCount,lateDecisionApplied:false}));
}finally{
 if(timer)clearTimeout(timer);if(remote)await remote.kernel.updateConfig(uid,{enabled:false}).catch(()=>{});release();await cycle?.catch(()=>{});await worker?.scheduler.wait();globalThis.fetch=originalFetch;first.close();second.close();
}
