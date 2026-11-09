import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {mkdir,readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../server/dist/server/src/db/database.js';
import {UserSandboxManager} from '../server/dist/server/src/tooling/UserSandboxManager.js';
import {AgentOrchestrator} from '../server/dist/server/src/orchestrator/AgentOrchestrator.js';import {AuditLogger} from '../server/dist/server/src/observability/AuditLogger.js';
import {ChatRunService} from '../server/dist/server/src/chat/ChatRunService.js';import {resolveLLMCredentials} from '../server/dist/server/src/llm/credentialResolver.js';import {SubscriptionService} from '../server/dist/server/src/subscription/SubscriptionService.js';
const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101',user='acceptance-20261101',out='/Users/rogerlee/.codex/outputs/x-computer-team-runs-20261102';
assert.equal(process.env.X_COMPUTER_CONFIG_PATH,path.join(root,'config.private.json'));assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const phase=process.argv[2];assert.ok(['crash','resume'].includes(phase));await mkdir(out,{recursive:true});const reportPath=path.join(out,'real-model.json');
const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite);
try{
 const subscriptions=new SubscriptionService(db),features=await subscriptions.getPlanFeatures(user);assert.ok(!features.includes('advanced_tools'));
 const config=await resolveLLMCredentials(user,db,subscriptions);assert.ok(config?.apiKey);const workspaces=new UserSandboxManager(root),sandbox=(await workspaces.getForUser(user)).sandboxFS;
 const orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,workspaces,db,undefined,undefined,undefined,subscriptions);
 const runs=new ChatRunService({db,orchestrator,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>config});orchestrator.setExpertDispatchRunner(request=>runs.expertDispatch(request));
 let report=phase==='resume'?JSON.parse(await readFile(reportPath,'utf8')):{nonce:randomUUID().slice(0,8),features,workerPid:process.pid};
 const original=orchestrator.runChatAgentLoop.bind(orchestrator),called=[];let checkerEntered;const entered=new Promise(resolve=>checkerEntered=resolve);
 orchestrator.runChatAgentLoop=async input=>{
  if(input.agentId){called.push(input.agentId);if(phase==='resume')assert.notEqual(input.agentId,report.writer,'Completed writer must never run after recovery');}
  if(input.agentId===report.checker){
   assert.ok(input.messages[0].content.includes(report.token||'RELAY_TOKEN:'),'Prior artifact text must reach the checker');
   if(phase==='crash'){checkerEntered();await new Promise(()=>{});}
  }
  return original(input);
 };
 const handoff=async(action,id,goal)=>{
  const intent=`只调用一次 ${action}，${action==='x.dispatch_team'?'team_id':'group_id'} 为 ${id}，goal 为 ${JSON.stringify(goal)}。得到接单回执后简短说明已交办并结束，不等待、不自行写文件或查询。`;
  const session=await db.createSession(user,phase==='crash'?'团队真实进程中断验收':'群组真实模型协作验收','normal_chat');
  const parent=await runs.accept({userId:user,sessionId:session.id,requestId:randomUUID(),messages:[{role:'user',content:intent}],userMessage:{content:intent},providerId:config.providerId,modelId:config.modelId,systemPrompt:'按交办只调用一次后台团队工具，不虚构成果。',allowedToolNames:[action,'file.write','file.present'],toolLoadingMode:'all'});
  await runs.launch(user,parent.id);const main=await runs.get(user,parent.id);assert.equal(main.status,'completed');assert.equal(main.toolCalls.length,1);assert.ok(main.toolCalls[0].output.runId);
  return {parentRunId:parent.id,runId:main.toolCalls[0].output.runId,sessionId:session.id};
 };
 if(phase==='crash'){
  const n=report.nonce;Object.assign(report,{writer:`writer-${n}`,checker:`checker-${n}`,groupMembers:[`group-a-${n}`,`group-b-${n}`],teamId:`team-${n}`,groupId:`group-${n}`});
  const agents=JSON.parse(await db.getConfig(user,'x_agents')??'[]');const now=Date.now();
  for(const [id,name,prompt] of [[report.writer,'起草专家','只做写手部分。用 file.write 创建 draft.md，首行严格为 RELAY_TOKEN: 后接你自行选的至少八位英文字母口令，不用反引号；正文简述春季播种。不要创建 final.md。'],[report.checker,'审核专家','只做审核部分。必须根据上一环节文件摘录，原样复制 RELAY_TOKEN 行到 final.md，再写两句审核意见。不可自行生成新口令。'],...report.groupMembers.map((id,index)=>[id,`协作专家${index+1}`,'按目标用 file.write 创建 group.md，写一段中文报告，不操作记忆或其他文件。'])])agents.push({id,name,systemPrompt:prompt,toolNames:['file.write','file.present'],createdAt:now,updatedAt:now});
  await db.setConfig(user,'x_agents',JSON.stringify(agents));
  for(const [key,value] of [['x_agent_teams',{id:report.teamId,name:'写作审核接力验收',agentIds:[report.writer,report.checker]}],['x_agent_groups',{id:report.groupId,name:'双专家群组验收',agentIds:report.groupMembers}]]){const list=JSON.parse(await db.getConfig(user,key)??'[]');list.push(value);await db.setConfig(user,key,JSON.stringify(list));}
  const task=await handoff('x.dispatch_team',report.teamId,'写手先生成 draft.md 并自行选定 RELAY_TOKEN 口令。审核员从上一环节文件摘录原样复制口令到 final.md，并完成审核意见。各自保留成果。');await entered;
  const firstArtifact=(await runs.get(user,task.runId)).artifacts.find(file=>file.name==='draft.md'&&file.path.startsWith(`agents/${report.writer}/`));assert.ok(firstArtifact);const first=await sandbox.read(firstArtifact.path);report.token=first.match(/RELAY_TOKEN:\s*([a-zA-Z]{8,})/)?.[1];assert.ok(report.token);
  Object.assign(report,{team:task,firstArtifact:firstArtifact.path,firstArtifactSha256:createHash('sha256').update(first).digest('hex'),state:'ready_for_forced_process_exit',heldBeforeCheckerModelCall:true});
  await writeFile(reportPath,JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({state:report.state,workerPid:process.pid,teamRunId:task.runId})+'\n');await new Promise(()=>{});
 }else{
  assert.equal(report.state,'ready_for_forced_process_exit');assert.notEqual(report.workerPid,process.pid);
  const deadline=Date.now()+40000;let current=await runs.get(user,report.team.runId);
  while(['running','stopping'].includes(current.status)&&Date.now()<deadline){await delay(200);current=await runs.get(user,report.team.runId);}
  const alreadyRecovered=current.status==='completed';
  if(!alreadyRecovered){assert.equal(current.status,'interrupted');assert.ok(current.canResume);await runs.resume(user,current.id);await runs.wait(current.id);}
  const result=await runs.get(user,current.id);assert.equal(result.status,'completed');
  const delivered=result.artifacts.find(file=>file.name==='final.md'&&file.path.startsWith(`agents/${report.checker}/`));assert.ok(delivered);
  const final=await sandbox.read(delivered.path);assert.ok(final.includes(report.token));assert.equal(createHash('sha256').update(await sandbox.read(report.firstArtifact)).digest('hex'),report.firstArtifactSha256);
  const group=await handoff('x.dispatch_group',report.groupId,'每人独立创建 group.md，内容含“群组真实验收”，简述春季播种的一项准备工作。');await runs.wait(group.runId);const grouped=await runs.get(user,group.runId);assert.equal(grouped.status,'completed');assert.equal(grouped.artifacts.length,report.groupMembers.length);
  for(const member of report.groupMembers){const artifact=grouped.artifacts.find(file=>file.name==='group.md'&&file.path.startsWith(`agents/${member}/`));assert.ok(artifact);assert.ok((await sandbox.read(artifact.path)).includes('群组真实验收'));}
  for(const id of [report.team.runId,group.runId])assert.ok(!(await db.queryOne('SELECT metadata_json FROM tasks WHERE id=?',[id])).metadata_json.includes(config.apiKey));
  Object.assign(report,{success:true,state:'completed',verificationPid:process.pid,recoveredBeforeValidationRetry:alreadyRecovered,completedWriterNotReplayed:true,tokenRelayed:true,finalArtifact:delivered.path,group,groupArtifacts:grouped.artifacts,modelAgentsThisVerificationProcess:called,credentialsNotPersisted:true});
  await writeFile(reportPath,JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({success:true,teamRunId:report.team.runId,groupRunId:group.runId,completedWriterNotReplayed:true,tokenRelayed:true})+'\n');
 }
}finally{sqlite.close();}
