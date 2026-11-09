import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {mkdtemp,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../server/dist/server/src/db/database.js';
import {RunOwnershipStore} from '../server/dist/server/src/chat/RunOwnershipStore.js';
if(process.argv[2]==='worker'){
 const sqlite=new SqliteAppDatabase(process.argv[3]);const ownership=new RunOwnershipStore(new SqliteDatabaseAdapter(sqlite));await ownership.init();
 process.once('message',async()=>{try{const won=await ownership.acquire('owner',`worker-${process.pid}`,process.argv[4]);process.send({pid:process.pid,won});}finally{sqlite.close();process.disconnect();}});process.send({ready:true});
}else{
 const root=await mkdtemp(path.join(os.tmpdir(),'ownership-processes-'));await writeFile(path.join(root,'config.json'),'{"database":{"type":"sqlite"}}');
 const sqlite=new SqliteAppDatabase(root);const session=sqlite.createSession('owner','process ownership').id;await new RunOwnershipStore(new SqliteDatabaseAdapter(sqlite)).init();sqlite.close();
 const children=[0,1].map(()=>{
  const child=fork(fileURLToPath(import.meta.url),['worker',root,session],{env:{...process.env,X_COMPUTER_WORKSPACE:root,X_COMPUTER_CONFIG_PATH:path.join(root,'config.json')},stdio:['ignore','ignore','inherit','ipc']});
  let readyResolve,resultResolve;let rejectReady,rejectResult;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;rejectReady=reject;});const result=new Promise((resolve,reject)=>{resultResolve=resolve;rejectResult=reject;});
  child.on('message',message=>{if(message.ready)readyResolve();else resultResolve(message);});child.on('error',error=>{rejectReady(error);rejectResult(error);});child.on('exit',code=>{if(code!==0){rejectReady(new Error(`Worker exited ${code}`));rejectResult(new Error(`Worker exited ${code}`));}});
  return {child,ready,result};
 });
 const timer=setTimeout(()=>{for(const {child} of children)child.kill();},15000);
 try{await Promise.all(children.map(worker=>worker.ready));for(const {child} of children)child.send('acquire');const results=await Promise.all(children.map(worker=>worker.result));assert.equal(new Set(results.map(result=>result.pid)).size,2);assert.equal(results.filter(result=>result.won).length,1);process.stdout.write(JSON.stringify({success:true,distinctProcesses:results.length,winners:results.filter(result=>result.won).length,workers:results,database:'dedicated-temporary-sqlite'},null,2)+'\n');}
 finally{clearTimeout(timer);}
}
