import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';import {RunOwnershipStore} from './RunOwnershipStore.js';
describe('database run ownership',()=>{
 let sqlite:SqliteAppDatabase;let db:SqliteDatabaseAdapter;let a:RunOwnershipStore;let b:RunOwnershipStore;let session:string;
 beforeEach(async()=>{sqlite=new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(),'run-ownership-')));db=new SqliteDatabaseAdapter(sqlite);session=sqlite.createSession('owner','lease').id;a=new RunOwnershipStore(db);b=new RunOwnershipStore(db);await a.init();await b.init();});
 afterEach(()=>sqlite.close());
 const row=(id:string)=>({id,user_id:'owner',domain:'chat',title:'test',description:'test',status:'running',steps_json:'[]',result_json:'{}',metadata_json:'{"version":1}',created_at:1,updated_at:1});
 it('permits one execution in a session across independent workers',async()=>{expect(await a.acquire('owner','run-a',session)).toBe(true);expect(await b.acquire('owner','run-a',session)).toBe(false);expect(await b.acquire('owner','run-b',session)).toBe(false);await a.release('run-a');expect(await b.acquire('owner','run-b',session)).toBe(true);});
 it('uses database time and rejects stale-owner writes after takeover',async()=>{
  await a.acquire('owner','run',session);await a.insert(row('run'));await db.run('UPDATE chat_run_ownership SET expires_at=0');
  expect(await b.acquire('owner','run',session)).toBe(true);await b.write({...row('run'),metadata_json:'{"new":true}'});await expect(a.write({...row('run'),metadata_json:'{"stale":true}'})).rejects.toThrow();
  expect((await b.read('owner','run'))?.metadata_json).toBe('{"new":true}');
 });
 it('communicates cancellation without exposing or replacing another worker token',async()=>{await a.acquire('owner','run',session);expect(await b.cancel('other','run')).toBeUndefined();await b.cancel('owner','run');expect((await a.renew('run')).cancelled).toBe(true);});
 it('fences assistant results as well as task metadata',async()=>{
  await a.acquire('owner','run',session);await a.insert(row('run'));await a.assistant('owner','run',session,'message','old','[]');await db.run('UPDATE chat_run_ownership SET expires_at=0');await b.acquire('owner','run',session);await b.assistant('owner','run',session,'message','new','[]');await expect(a.assistant('owner','run',session,'message','stale','[]')).rejects.toThrow();
  expect((await db.queryOne<{content:string}>('SELECT content FROM chat_messages WHERE id=?',['message']))?.content).toBe('new');
 });
 it('never overwrites a user message when an assistant message identifier conflicts',async()=>{
  await a.acquire('owner','run',session);await db.upsertRunMessage(session,'conflict','user','keep this');await expect(a.assistant('owner','run',session,'conflict','overwrite','[]')).rejects.toThrow('归属');
  expect((await db.queryOne<{content:string}>('SELECT content FROM chat_messages WHERE id=?',['conflict']))?.content).toBe('keep this');
 });

});
