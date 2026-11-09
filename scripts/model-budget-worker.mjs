import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../server/dist/server/src/db/database.js';import{SubscriptionService}from'../server/dist/server/src/subscription/SubscriptionService.js';
const root='/Users/rogerlee/.codex/runtime/x-computer-acceptance-20261101',uid=process.argv[2];
assert.match(uid,/^budget-race-[a-f0-9]{8}$/);assert.equal(process.env.X_COMPUTER_CONFIG_PATH,root+'/config.private.json');assert.equal(JSON.parse(await readFile(process.env.X_COMPUTER_CONFIG_PATH,'utf8')).database.type,'sqlite');
const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),service=new SubscriptionService(db);
process.once('message',async message=>{
 try{assert.equal(message,'start');const attempts=await Promise.allSettled(Array.from({length:6},()=>service.consumeAiCall(uid,{source:'isolated-process-race'})));
 const success=attempts.filter(item=>item.status==='fulfilled').length;const denied=attempts.filter(item=>item.status==='rejected'&&item.reason?.name==='ModelQuotaError').length;
 process.send({type:'result',pid:process.pid,success,denied});
 }catch(error){process.send({type:'failed',error:error instanceof Error?error.message:String(error)});process.exitCode=1;}
 finally{sqlite.close();process.disconnect();}
});
process.send({type:'ready',pid:process.pid});
