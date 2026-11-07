import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../server/dist/server/src/db/database.js';
import {RunOwnershipStore} from '../server/dist/server/src/chat/RunOwnershipStore.js';
import {ChatRunService} from '../server/dist/server/src/chat/ChatRunService.js';
import {AgentOrchestrator} from '../server/dist/server/src/orchestrator/AgentOrchestrator.js';
import {AuditLogger} from '../server/dist/server/src/observability/AuditLogger.js';
import {UserSandboxManager} from '../server/dist/server/src/tooling/UserSandboxManager.js';
import {SubscriptionService} from '../server/dist/server/src/subscription/SubscriptionService.js';
import {resolveLLMCredentials} from '../server/dist/server/src/llm/credentialResolver.js';

const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101';
const outputRoot='/Users/rogerlee/.codex/outputs/x-computer-legacy-process-20261102';
assert.equal(process.env.X_COMPUTER_CONFIG_PATH,path.join(root,'config.private.json'));
assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rowsFor=async(db,user)=>(await db.getAllTasks()).filter(row=>row.user_id===user).map(row=>JSON.parse(row.metadata_json).chatRun);

if(process.argv[2]){
 const phase=process.argv[2],casePath=path.resolve(process.argv[3]??'');assert.ok(['start','resume'].includes(phase));
 const test=JSON.parse(await readFile(casePath,'utf8'));assert.match(test.nonce,/^[a-f0-9]{8}$/);assert.equal(test.userId,`legacy-process-${test.nonce}`);
 const out=path.join(outputRoot,test.nonce);assert.equal(casePath,path.join(out,'case.json'));
 const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),loops=[];
 try{
  const plans=new SubscriptionService(db,root),spaces=new UserSandboxManager(root),sandbox=(await spaces.getForUser(test.userId)).sandboxFS;
  assert.deepEqual(await plans.getPlanFeatures(test.userId),['basic_features']);
  const credentials=async(user,providerId,modelId)=>{const config=await resolveLLMCredentials(user,db,plans,{providerId,modelId});assert.ok(config?.apiKey);return config;};
  const config=await credentials(test.userId),orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,spaces,db,undefined,undefined,undefined,plans);
  const runs=new ChatRunService({db,orchestrator,modelBudget:plans,getSandboxFS:async user=>(await spaces.getForUser(user)).sandboxFS,getLLMConfig:credentials});
  orchestrator.setExpertDispatchRunner(request=>runs.expertDispatch(request));
  const original=orchestrator.runChatAgentLoop.bind(orchestrator);let parentId;
  orchestrator.runChatAgentLoop=async input=>{
   loops.push({agentId:input.agentId??'parent',runId:input.runId});
   if(phase==='resume')assert.notEqual(input.agentId,test.writer,'Completed writer must not execute again');
   if(phase==='start'&&input.agentId===test.checker){
    const records=await rowsFor(db,test.userId),writer=records.find(record=>record.expert?.agentId===test.writer);
    assert.equal(writer.status,'completed');const artifact=writer.artifacts.find(file=>file.name==='draft.md');assert.ok(artifact);
    const bytes=await sandbox.readBinaryBounded(artifact.path);assert.ok(bytes.toString().includes(test.marker));
    const checker=records.find(record=>record.id===input.runId),received=checker.inputFiles.find(file=>file.sourcePath===artifact.path);assert.ok(received);assert.equal(received.sha256,hash(bytes));
    const usage=await db.query('SELECT metadata FROM usage_records WHERE user_id=?',[test.userId]);
    const checkpoint={type:'checkpoint',workerPid:process.pid,parentRunId:parentId,coordinatorRunId:writer.expert.parentRunId,writerRunId:writer.id,checkerRunId:checker.id,writerArtifact:artifact.path,writerSha256:hash(bytes),writerProviderAttempts:usage.filter(row=>JSON.parse(row.metadata).runId===writer.id).length,runIds:records.map(record=>record.id).sort(),loops,heldBeforeCheckerModel:true};
    assert.equal(checkpoint.runIds.length,4);assert.ok(checkpoint.writerProviderAttempts>0);process.send(checkpoint);
    await new Promise(()=>{});
   }
   return original(input);
  };
  if(phase==='start'){
   const session=await db.createSession(test.userId,'旧团队进程中断验收');
   const intent=`只调用一次 x.run_team，team_id 为 ${test.teamId}，goal 为“写手先生成 draft.md；审核者实际读取上一环节完整文件，将 CRASH_MARKER 行原样保留在 final.md，并写两句核对说明。各自保留成果。”。得到真实结果后简短回复，不重复交办，不自行写文件。`;
   const run=await runs.accept({userId:test.userId,sessionId:session.id,requestId:test.nonce,messages:[{role:'user',content:intent}],providerId:config.providerId,modelId:config.modelId,systemPrompt:'只做一次用户指定的团队交办，等待真实成果后总结，不得虚构执行或验收结果。',allowedToolNames:['x.run_team','file.extract_text','file.write','file.present'],toolLoadingMode:'all'});
   parentId=run.id;process.send({type:'accepted',parentRunId:parentId});await runs.launch(test.userId,parentId);
   throw new Error('Initial worker should have stopped at the checker checkpoint');
  }
  const checkpoint=JSON.parse(await readFile(path.join(out,'checkpoint.json'),'utf8'));parentId=checkpoint.parentRunId;assert.notEqual(checkpoint.workerPid,process.pid);
  const before=await runs.get(test.userId,parentId);assert.equal(before.status,'interrupted');assert.equal(before.canResume,true);
  await runs.resume(test.userId,parentId);await runs.wait(parentId);const completed=await runs.get(test.userId,parentId);assert.equal(completed.status,'completed');
  const records=await rowsFor(db,test.userId);assert.deepEqual(records.map(record=>record.id).sort(),checkpoint.runIds);
  assert.equal(hash(await sandbox.readBinaryBounded(checkpoint.writerArtifact)),checkpoint.writerSha256);
  const checker=records.find(record=>record.id===checkpoint.checkerRunId),final=checker.artifacts.find(file=>file.name==='final.md');assert.ok(final);assert.ok((await sandbox.read(final.path)).includes(test.marker));
  assert.ok(checker.toolCalls.some(tool=>tool.toolName==='file.extract_text'&&tool.status==='completed'&&tool.output?.sha256===checkpoint.writerSha256));
  const usage=await db.query('SELECT metadata FROM usage_records WHERE user_id=?',[test.userId]);assert.equal(usage.filter(row=>JSON.parse(row.metadata).runId===checkpoint.writerRunId).length,checkpoint.writerProviderAttempts);
  assert.equal(completed.toolCalls.filter(tool=>tool.toolName==='x.run_team').length,1);assert.equal(completed.artifacts.length,2);assert.equal(completed.review.status,'pending');
  assert.ok(records.every(record=>!JSON.stringify(record).includes(config.apiKey)));
  const result={type:'result',success:true,resumePid:process.pid,parentRunId:parentId,coordinatorRunId:checkpoint.coordinatorRunId,runIds:records.map(record=>record.id).sort(),writerSha256:checkpoint.writerSha256,finalArtifact:final.path,writerNotReplayed:true,originalDraftUnchanged:true,checkerReadOriginal:true,sameWaitingToolCall:true,awaitsHumanReview:true,loops};
  await writeFile(path.join(out,'resume-result.json'),JSON.stringify(result,null,2));process.send(result);
 }catch(error){process.send?.({type:'failed',message:error instanceof Error?error.message:String(error)});process.exitCode=1;}
 finally{sqlite.close();process.disconnect?.();}
}else{
 const nonce=randomUUID().slice(0,8),out=path.join(outputRoot,nonce),test={nonce,userId:`legacy-process-${nonce}`,writer:`process-writer-${nonce}`,checker:`process-checker-${nonce}`,teamId:`process-team-${nonce}`,marker:`CRASH_MARKER: PROCESS_${nonce}`};
 await mkdir(out,{recursive:true});const casePath=path.join(out,'case.json');await writeFile(casePath,JSON.stringify(test,null,2));
 const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),children=[];
 const worker=phase=>{
  const child=fork(fileURLToPath(import.meta.url),[phase,casePath],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);let stderr='';child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-65536);});
  let value;const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,pid:child.pid}));});
  const ready=new Promise((resolve,reject)=>{
   child.on('message',message=>{if(message.type==='failed')reject(new Error(message.message));if(message.type==='checkpoint'||message.type==='result'){value=message;resolve(message);}});
   child.once('error',reject);child.once('exit',(code,signal)=>{if(!value)reject(new Error(`worker ended before checkpoint: ${code??signal} ${stderr}`));});
  });return{child,ready,ended};
 };
 try{
  await db.ensureUser(test.userId);await db.setConfig(test.userId,'living_ai_state_v1',JSON.stringify({config:{enabled:false}}));
  await db.setConfig(test.userId,'x_agents',JSON.stringify([{id:test.writer,name:'进程验收写手',systemPrompt:`用 file.write 创建 draft.md，首行严格为 ${test.marker}，再写一段简短说明，file.present 交付。不要创建 final.md。`,toolNames:['file.write','file.present']},{id:test.checker,name:'进程验收审核',systemPrompt:'必须用 file.extract_text 实际读取收到的 draft.md 工作副本，找到 CRASH_MARKER 行并原样复制到 final.md，再写两句核对说明，file.present 交付；不要自行生成标记。',toolNames:['file.extract_text','file.write','file.present']}].map(agent=>({...agent,createdAt:Date.now(),updatedAt:Date.now()}))));
  await db.setConfig(test.userId,'x_agent_teams',JSON.stringify([{id:test.teamId,name:'旧团队独立进程恢复验收',agentIds:[test.writer,test.checker],createdAt:Date.now(),updatedAt:Date.now()}]));
  const first=worker('start'),checkpoint=await first.ready;assert.equal(checkpoint.workerPid,first.child.pid);assert.equal(checkpoint.heldBeforeCheckerModel,true);await writeFile(path.join(out,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
  assert.equal(first.child.kill('SIGKILL'),true);const exit=await first.ended;assert.equal(exit.signal,'SIGKILL');await writeFile(path.join(out,'initial-exit.json'),JSON.stringify(exit,null,2));console.log(JSON.stringify({state:'worker-killed',pid:exit.pid,parentRunId:checkpoint.parentRunId,writerDraftPreserved:true}));
  const leases=new RunOwnershipStore(db);let waited=false;
  while((await db.queryOne(`SELECT COUNT(*) AS total FROM chat_run_ownership WHERE user_id=? AND expires_at>${leases.clock}`,[test.userId])).total>0){waited=true;await delay(250);}
  console.log(JSON.stringify({state:'leases-expired',databaseClock:true,leaseRowsModified:false}));
  const second=worker('resume'),result=await second.ready,secondExit=await second.ended;assert.equal(secondExit.code,0);assert.equal(result.success,true);assert.notEqual(result.resumePid,checkpoint.workerPid);
  const evidence={...result,realModel:true,isolatedUserId:test.userId,initialPid:checkpoint.workerPid,initialExitSignal:exit.signal,naturalLeaseExpiry:true,leaseRowsModified:false,waitedForDatabaseExpiry:waited,basicPlan:true,credentialsNotPersisted:true,browserVerified:false,mysqlVerified:false,originalMysqlAccessed:false};
  await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({success:true,evidence:path.join(out,'evidence.json'),parentRunId:result.parentRunId,writerNotReplayed:true,checkerReadOriginal:true}));
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');sqlite.close();}
}
