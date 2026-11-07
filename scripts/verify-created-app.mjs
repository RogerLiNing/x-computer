import assert from 'node:assert/strict';import{createHash,randomUUID}from'node:crypto';import{readFile,readdir,writeFile,mkdir}from'node:fs/promises';import path from'node:path';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../server/dist/server/src/db/database.js';
import{UserSandboxManager}from'../server/dist/server/src/tooling/UserSandboxManager.js';import{SandboxFS}from'../server/dist/server/src/tooling/SandboxFS.js';
import{AgentOrchestrator}from'../server/dist/server/src/orchestrator/AgentOrchestrator.js';import{AuditLogger}from'../server/dist/server/src/observability/AuditLogger.js';
import{ChatRunService}from'../server/dist/server/src/chat/ChatRunService.js';import{resolveLLMCredentials}from'../server/dist/server/src/llm/credentialResolver.js';import{SubscriptionService}from'../server/dist/server/src/subscription/SubscriptionService.js';
const root='/tmp/x-computer-browser-isolated-20261030',user='acceptance-20261030';
assert.equal(process.env.X_COMPUTER_CONFIG_PATH,'/tmp/x-computer-browser-config-20261030.json');assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database?.type,'sqlite');
const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite);const id='counter-live-'+randomUUID().slice(0,8);
const digest=async dir=>{const result={};for(const entry of await readdir(dir,{withFileTypes:true})){const filename=path.join(dir,entry.name);result[entry.name]=entry.isDirectory()?await digest(filename):createHash('sha256').update(await readFile(filename)).digest('hex');}return result;};
try{
 assert.ok(await db.getUser(user));const subscriptions=new SubscriptionService(db);const features=await subscriptions.getPlanFeatures(user);assert.ok(!features.includes('advanced_tools'),'This acceptance must use the basic account');
 const workspaces=new UserSandboxManager(root,{useContainer:true,subscriptionService:subscriptions});const sandbox=(await workspaces.getForUser(user)).sandboxFS;
 const before=await digest(path.join(sandbox.getRoot(),'memory'));const config=await resolveLLMCredentials(user,db,subscriptions);assert.ok(config?.apiKey);
 const orchestrator=new AgentOrchestrator(new AuditLogger(),new SandboxFS(sandbox.getRoot()),workspaces,db,undefined,undefined,undefined,subscriptions);
 const runs=new ChatRunService({db,orchestrator,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>config});
 const session=await db.createSession(user,'真实模型创建隔离应用','normal_chat');
 const intent=`帮我创建一个新的桌面小程序“计数小帮手”，app_id 必须是 ${id}。请用 x.create_app 的 html_content 快速模式一次创建完整单页 HTML（内联 CSS 和 JS），不要写 plan 或其他文件。页面使用中文、大按钮，只有“增加一次”按钮和当前次数；通过 localStorage 保存次数，关闭再打开应恢复。不能使用 CDN、外部资源、网络请求、弹窗或记忆工具。完成后简短说明应用名称。`;
 const run=await runs.accept({userId:user,sessionId:session.id,requestId:id,messages:[{role:'user',content:intent}],userMessage:{content:intent},providerId:config.providerId,modelId:config.modelId,systemPrompt:'使用授权的应用创建工具完成交办，不调用其他工具，不虚构执行结果。',allowedToolNames:['x.create_app'],toolLoadingMode:'all'});
 await runs.launch(user,run.id);const result=await runs.get(user,run.id);assert.equal(result.status,'completed');assert.equal(result.toolCalls.length,1);assert.equal(result.toolCalls[0].toolName,'x.create_app');assert.equal(result.toolCalls[0].output.appId,id);
 const apps=JSON.parse(await db.getConfig(user,'x_mini_apps')??'[]');assert.ok(apps.some(app=>app.id===id));const html=await sandbox.read(`apps/${id}/index.html`);assert.ok(html.includes('localStorage'));
 assert.deepEqual(await digest(path.join(sandbox.getRoot(),'memory')),before);
 const row=await db.queryOne('SELECT metadata_json FROM tasks WHERE id=?',[run.id]);assert.ok(!row.metadata_json.includes(config.apiKey));
 const report={success:true,taskId:run.id,sessionId:session.id,appId:id,name:'计数小帮手',toolCalls:result.toolCalls.length,features,memoryUnchanged:true,registered:true,htmlExists:true,status:result.status,content:result.content};
 const out='/Users/rogerlee/.codex/outputs/x-computer-app-isolation-20261031';await mkdir(out,{recursive:true});await writeFile(path.join(out,`real-created-${id}.json`),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');
}finally{sqlite.close();}
