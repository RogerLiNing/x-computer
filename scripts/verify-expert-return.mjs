import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../server/dist/server/src/db/database.js';
import {SessionAuth} from '../server/dist/server/src/auth/sessionAuth.js';

const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101';
const out=process.argv[2]??'/Users/rogerlee/.codex/outputs/x-computer-expert-return-20261102';
assert.equal(process.env.X_COMPUTER_CONFIG_PATH,root+'/config.private.json');
assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const model=JSON.parse(await readFile(out+'/real-model.json','utf8'));
assert.equal(model.realModel,true);
const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),sessions=new SessionAuth(db);
const uid='acceptance-20261101',cookie=await sessions.createCookie(uid);
try{
 const deadline=Date.now()+45000;let messages,returned;
 while(Date.now()<deadline){
  messages=await db.getMessages(model.sessionId);
  returned=messages.filter(message=>message.id.startsWith(`return-${model.readerRunId}-`));
  if(returned.length)break;
  await delay(500);
 }
 assert.equal(returned.length,1,'running server must return the outcome without a client delivery call');
 assert.equal(returned[0].role,'assistant');assert.ok(returned[0].content.includes(model.result.path));
 for(const code of Object.values(model.codes))assert.ok(returned[0].content.includes(code));
 assert.equal(messages.filter(message=>message.role==='user').length,1);
 const response=await fetch(`http://127.0.0.1:3000/api/chat/runs/${model.parentRunId}`,{headers:{cookie}});
 assert.equal(response.status,200);const parent=await response.json();
 assert.ok(parent.expertRuns.some(run=>run.id===model.readerRunId&&run.status==='completed'&&!run.returnPending));
 const sourceResponse=await fetch(`http://127.0.0.1:3000/api/chat/runs/${model.readerRunId}`,{headers:{cookie}});
 assert.equal(sourceResponse.status,200);assert.equal((await sourceResponse.json()).review.status,'pending');
 const notices=(await db.getNotifications(uid,{includeRead:true})).filter(notice=>notice.link===`app:chat-session:${model.sessionId}`);
 assert.equal(notices.length,1);
 const source=JSON.parse((await db.queryOne('SELECT metadata_json FROM tasks WHERE id=?',[model.readerRunId])).metadata_json).chatRun;
 assert.ok(source.parentReceipt);assert.notEqual(source.review?.status,'accepted');
 const evidence={success:true,realModelReport:'real-model.json',automaticServerDelivery:true,parentRunId:model.parentRunId,sourceRunId:model.readerRunId,sourceSessionId:source.sessionId,originalSessionId:model.sessionId,returnMessageId:returned[0].id,notificationId:notices[0].id,apiStatus:response.status,noSyntheticUserMessage:true,awaitsHumanReview:true,browserVerified:false,originalMysqlAccessed:false,memoryPolicyChanged:false};
 await writeFile(out+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
 await sessions.logout({headers:{cookie}},{append:()=>{}});sqlite.close();
}
