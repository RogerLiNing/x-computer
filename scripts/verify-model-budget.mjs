import assert from'node:assert/strict';import{readFile,writeFile,mkdir}from'node:fs/promises';import{randomUUID,createHash}from'node:crypto';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../server/dist/server/src/db/database.js';
import{SubscriptionService}from'../server/dist/server/src/subscription/SubscriptionService.js';
import{resolveLLMCredentials}from'../server/dist/server/src/llm/credentialResolver.js';
import{UserSandboxManager}from'../server/dist/server/src/tooling/UserSandboxManager.js';
import{AgentOrchestrator}from'../server/dist/server/src/orchestrator/AgentOrchestrator.js';import{AuditLogger}from'../server/dist/server/src/observability/AuditLogger.js';import{ChatRunService}from'../server/dist/server/src/chat/ChatRunService.js';

const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101';
assert.equal(process.env.X_COMPUTER_CONFIG_PATH,root+'/config.private.json');assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const nonce=randomUUID().slice(0,8),uid=`budget-acceptance-${nonce}`,plan=`budget-fixture-${nonce}`,out=`/Users/rogerlee/.codex/outputs/x-computer-model-budget-20261102/${nonce}`,sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite);
try{
 await db.ensureUser(uid);await db.setConfig(uid,'living_ai_state_v1',JSON.stringify({config:{enabled:false}}));
 const now=Date.now();
 await db.run('INSERT INTO plans(id,name,display_name_en,display_name_zh,ai_calls_limit,storage_limit,concurrent_tasks_limit,features,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[plan,plan,'Isolated quota fixture','独立额度验收',1,1024*1024,1,JSON.stringify(['basic_features']),0,now,now]);
 await db.run('INSERT INTO subscriptions(id,user_id,plan_id,status,billing_cycle,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[`budget-sub-${nonce}`,uid,plan,'active','monthly',now-1000,now+24*60*60*1000,0,now,now]);
 const plans=new SubscriptionService(db,root),spaces=new UserSandboxManager(root),sandbox=(await spaces.getForUser(uid)).sandboxFS,config=await resolveLLMCredentials(uid,db,plans);assert.ok(config?.apiKey);
 const orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,spaces,db,undefined,undefined,undefined,plans),runs=new ChatRunService({db,orchestrator,modelBudget:plans,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>config});
 const session=await db.createSession(uid,'真实模型额度中断恢复'),file=`预算验收-${nonce}.txt`,content=`quota-checkpoint-${nonce}`;
 const run=await runs.accept({userId:uid,sessionId:session.id,requestId:nonce,providerId:config.providerId,modelId:config.modelId,systemPrompt:'调用一次 file.write 保存指定文件。工具成功后不要再次写入，只用一句话回复完成。',messages:[{role:'user',content:`请调用 file.write，path 为 ${file}，content 为 ${content}，只写一次。`}],allowedToolNames:['file.write'],toolLoadingMode:'all'});
 await runs.launch(uid,run.id);const blocked=await runs.get(uid,run.id);assert.equal(blocked.status,'blocked');assert.equal(blocked.canResume,true);assert.match(blocked.error,/模型调用次数已用完/);assert.equal((await plans.getCurrentUsage(uid)).aiCalls,1);
 const before=await sandbox.readBinary(file),hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(before.toString(),content);assert.equal(blocked.toolCalls.filter(tool=>tool.toolName==='file.write'&&tool.status==='completed').length,1);
 await db.run('UPDATE plans SET ai_calls_limit=?,updated_at=? WHERE id=?',[2,Date.now(),plan]);
 await runs.resume(uid,run.id);await runs.wait(run.id);const completed=await runs.get(uid,run.id);assert.equal(completed.status,'completed');assert.equal((await plans.getCurrentUsage(uid)).aiCalls,2);assert.equal(completed.toolCalls.filter(tool=>tool.toolName==='file.write').length,1);assert.equal(hash(await sandbox.readBinary(file)),hash(before));
 const stored=await db.queryOne('SELECT metadata_json FROM tasks WHERE id=?',[run.id]);assert.ok(!stored.metadata_json.includes(config.apiKey));
 const usage=await db.query('SELECT metadata FROM usage_records WHERE user_id=?',[uid]);assert.equal(usage.length,2);assert.ok(usage.every(row=>JSON.parse(row.metadata).runId===run.id&&!row.metadata.includes(config.apiKey)));
 const evidence={success:true,realModel:true,isolatedUserId:uid,isolatedPlanId:plan,runId:run.id,initialLimit:1,blockedAfterAttempts:1,limitAfterFixtureUpdate:2,finalAttempts:2,writeCalls:1,checkpointResumed:true,sha256:hash(before),artifactPath:file,credentialsNotPersisted:true,browserVerified:false,originalMysqlAccessed:false,existingUserPlansModified:false};
 await mkdir(out,{recursive:true});await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({success:true,evidence:out+'/evidence.json',runId:run.id,initialStatus:blocked.status,finalStatus:completed.status,writeCalls:1,finalAttempts:2}));
}finally{sqlite.close();}
