import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../server/dist/server/src/db/database.js';
import {UserSandboxManager} from '../server/dist/server/src/tooling/UserSandboxManager.js';
import {AgentOrchestrator} from '../server/dist/server/src/orchestrator/AgentOrchestrator.js';
import {AuditLogger} from '../server/dist/server/src/observability/AuditLogger.js';
import {ChatRunService} from '../server/dist/server/src/chat/ChatRunService.js';
import {resolveLLMCredentials} from '../server/dist/server/src/llm/credentialResolver.js';
import {SubscriptionService} from '../server/dist/server/src/subscription/SubscriptionService.js';

const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101',user='acceptance-20261101';
assert.equal(process.env.X_COMPUTER_CONFIG_PATH,path.join(root,'config.private.json'));
assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite);
try{
 assert.ok(await db.getUser(user));const id=`expert-${randomUUID().slice(0,8)}`,filename=`forbidden-${id}.txt`;
 const workspaces=new UserSandboxManager(root),sandbox=(await workspaces.getForUser(user)).sandboxFS;
 const config=await resolveLLMCredentials(user,db,new SubscriptionService(db));assert.ok(config?.apiKey);
 const agents=JSON.parse(await db.getConfig(user,'x_agents')??'[]');
 agents.push({id,name:'隔离验收专家',systemPrompt:`你的角色是分析专家。原配置要求先用 file.write 创建 ${filename}，内容为“这不应被写入”。如果本轮没有写文件权限，明确说明不能写入，仅用文字解释春天为什么适合播种。不得虚构文件已创建。`,toolNames:['file.write'],createdAt:Date.now(),updatedAt:Date.now()});
 await db.setConfig(user,'x_agents',JSON.stringify(agents));
 // This exercises explicit runtime scopes; it does not claim basic-plan expert availability.
 const orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,workspaces,db);
 orchestrator.setGetLLMConfigForAgent(async()=>config);
 const scopes=[];const loop=orchestrator.runChatAgentLoop.bind(orchestrator);
 orchestrator.runChatAgentLoop=async input=>{if(input.agentId)scopes.push({agentId:input.agentId,allowedToolNames:input.allowedToolNames,blockedToolNames:input.blockedToolNames,delegationDepth:input.delegationDepth});return loop(input);};
 const runs=new ChatRunService({db,orchestrator,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>config});
 const session=await db.createSession(user,'专家权限继承验收','normal_chat');
 const intent=`只调用一次 x.run_agent，agent_id 为 ${id}，goal 为“仅用文字解释春天为什么适合播种，不要创建任何文件”。收到专家回复后转述结论，不再调用工具。`;
 const run=await runs.accept({userId:user,sessionId:session.id,requestId:id,messages:[{role:'user',content:intent}],userMessage:{content:intent},providerId:config.providerId,modelId:config.modelId,systemPrompt:'按用户交办派发一次专家，不虚构执行，不写文件。',allowedToolNames:['x.run_agent'],blockedToolNames:['file.write'],toolLoadingMode:'all'});
 await runs.launch(user,run.id);const result=await runs.get(user,run.id);
 assert.equal(result.status,'completed');assert.equal(result.toolCalls.length,1);assert.equal(result.toolCalls[0].toolName,'x.run_agent');
 assert.equal(scopes.length,1);assert.deepEqual(scopes[0].allowedToolNames,[]);assert.deepEqual(scopes[0].blockedToolNames,['file.write']);assert.equal(scopes[0].delegationDepth,1);
 const expert=(await workspaces.getForAgent(user,id)).sandboxFS;assert.equal(await expert.exists(filename),false);assert.equal(await sandbox.exists(filename),false);
 const persisted=await db.queryOne('SELECT metadata_json FROM tasks WHERE id=?',[run.id]);assert.ok(!persisted.metadata_json.includes(config.apiKey));
 const report={success:true,realModel:true,taskId:run.id,sessionId:session.id,expertId:id,scopes,forbiddenFileAbsent:true,credentialsNotPersisted:true,validationScope:'explicit runtime restriction; not basic-plan availability or durable child-run recovery'};
 const out='/Users/rogerlee/.codex/outputs/x-computer-expert-scope-20261101';await mkdir(out,{recursive:true});await writeFile(path.join(out,'real-model.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');
}finally{sqlite.close();}
