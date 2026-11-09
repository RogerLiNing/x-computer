import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../server/dist/server/src/db/database.js';
import {SessionAuth} from '../server/dist/server/src/auth/sessionAuth.js';
const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101',uid='acceptance-20261101',out=process.argv[2]??'/Users/rogerlee/.codex/outputs/x-computer-main-followup-20261102/fixed';
assert.equal(process.env.X_COMPUTER_CONFIG_PATH,root+'/config.private.json');assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const model=JSON.parse(await readFile(out+'/real-model.json','utf8'));assert.equal(model.realModel,true);
const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),auth=new SessionAuth(db),cookie=await auth.createCookie(uid);
try{
 const deadline=Date.now()+90000;let followup;
 while(Date.now()<deadline){
  const rows=await db.query('SELECT metadata_json FROM tasks WHERE user_id=? AND domain=? AND metadata_json LIKE ?',[uid,'chat',`%"rootRunId":"${model.parentRunId}"%`]);
  const runs=rows.map(row=>JSON.parse(row.metadata_json).chatRun).filter(run=>run?.followup?.rootRunId===model.parentRunId);
  assert.ok(runs.length<=2);followup=runs[0];if(followup&&['completed','failed','blocked'].includes(followup.status))break;
  await delay(500);
 }
 assert.equal(followup?.status,'completed',followup?.error??'server did not finish the automatic continuation');
 const extracted=followup.toolCalls.filter(tool=>tool.toolName==='file.extract_text'&&tool.status==='completed');assert.ok(extracted.length>=4);
 const artifact=followup.artifacts.find(file=>file.name==='最终核对报告.md');assert.ok(artifact);assert.ok(artifact.path.startsWith(`agents/main-followup-${model.parentRunId}/runs/${followup.id}/`));
 const workspace=root+'/users/'+uid+'/workspace/',report=await readFile(workspace+artifact.path,'utf8');
 for(const code of Object.values(model.codes))assert.ok(report.includes(code));assert.ok(report.includes(String(model.cachedValue)));
 const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
 for(const file of model.inputs)assert.equal(hash(await readFile(workspace+file.path)),file.sha256);
 const receivedReport=followup.inputFiles.find(file=>file.sourcePath===model.result.path);assert.ok(receivedReport);assert.equal(hash(await readFile(workspace+model.result.path)),receivedReport.sha256);
 assert.ok(followup.allowedToolNames.every(name=>!/^shell\.|^browser\.|^memory\.|^email\./.test(name)));
 assert.equal((await db.getMessages(model.sessionId)).filter(message=>message.role==='user').length,1);
 const response=await fetch(`http://127.0.0.1:3000/api/chat/runs/${followup.id}`,{headers:{cookie}});assert.equal(response.status,200);assert.equal((await response.json()).review.status,'pending');
 const rootResponse=await fetch(`http://127.0.0.1:3000/api/chat/runs/${model.parentRunId}`,{headers:{cookie}});assert.equal((await rootResponse.json()).followupRunId,followup.id);
 const evidence={success:true,realModel:true,automaticServerContinuation:true,parentRunId:model.parentRunId,sourceRunId:model.readerRunId,followupRunId:followup.id,modelReport:'real-model.json',finalArtifact:artifact,materialReadCalls:extracted.length,originalFilesUnchanged:true,expertReportUnchanged:true,noSyntheticUserMessage:true,noExternalWriteTools:true,awaitsHumanReview:true,browserVerified:false,originalMysqlAccessed:false,memoryPolicyChanged:false};
 await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await auth.logout({headers:{cookie}},{append:()=>{}});sqlite.close();}
