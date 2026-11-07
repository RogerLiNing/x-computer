import {randomUUID} from 'node:crypto';
import type {AppDatabase} from '../db/database.js';
export class RunOwnershipLostError extends Error {}
interface Grant {scope:string;user:string;run:string;token:string;kind:'session'|'record'}
interface TaskRow {id:string;user_id:string;domain:string;title:string;description:string;status:string;steps_json:string;result_json:string;metadata_json:string;created_at:number;updated_at:number;}
/** Database clock and conditional writes fence processes that no longer own a run. */
export class RunOwnershipStore {
 private held=new Map<string,Grant>();
 private sqlite:boolean;
 readonly clock:string;
 constructor(private db:Pick<AppDatabase,'getDialect'|'run'|'queryOne'|'query'>,readonly ttlMs=30000){
  this.sqlite=db.getDialect()==='sqlite';
  this.clock=this.sqlite?"CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)":'CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)';
 }
 async init(){
  await this.db.run(`CREATE TABLE IF NOT EXISTS chat_run_ownership (scope_id VARCHAR(256) PRIMARY KEY,user_id VARCHAR(128) NOT NULL,run_id VARCHAR(64) NOT NULL,owner_token VARCHAR(64) NOT NULL,expires_at BIGINT NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0)${this.sqlite?'':' ENGINE=InnoDB'}`);
  if(!this.sqlite){const tables=await this.db.query<{engine:string}>("SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tasks','chat_messages','chat_sessions','chat_run_ownership')");if(tables.length!==4||tables.some(table=>table.engine?.toLowerCase()!=='innodb'))throw new Error('运行执行权要求任务与会话表使用 InnoDB');}
 }
 owns(id:string,kind?:Grant['kind']){const grant=this.held.get(id);return !!grant&&(!kind||kind===grant.kind);}
 private fence(grant:Grant){return `scope_id=? AND user_id=? AND run_id=? AND owner_token=? AND expires_at>${this.clock}`;}
 private args(grant:Grant){return [grant.scope,grant.user,grant.run,grant.token];}
 async acquire(user:string,run:string,session:string,kind:Grant['kind']='session'){
  const prior=this.held.get(run);
  if(prior){if(prior.kind!==kind)return false;try{await this.assert(run);return true;}catch{this.held.delete(run);}}
  const grant:Grant={scope:`${kind}:${kind==='session'?session:run}`,user,run,token:randomUUID(),kind};
  await this.db.run(`${this.sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO chat_run_ownership (scope_id,user_id,run_id,owner_token,expires_at,cancel_requested) VALUES (?,?,?,?,${this.clock}+?,0)`,[grant.scope,user,run,grant.token,this.ttlMs]);
  await this.db.run(`UPDATE chat_run_ownership SET run_id=?,owner_token=?,expires_at=${this.clock}+?,cancel_requested=0 WHERE scope_id=? AND user_id=? AND expires_at<=${this.clock}`,[run,grant.token,this.ttlMs,grant.scope,user]);
  const current=await this.db.queryOne<{owner_token:string}>(`SELECT owner_token FROM chat_run_ownership WHERE ${this.fence(grant)}`,this.args(grant));
  if(current?.owner_token!==grant.token)return false;
  this.held.set(run,grant);return true;
 }
 async assert(run:string){
  const grant=this.held.get(run);if(!grant)throw new RunOwnershipLostError('当前进程没有运行写入权');
  const current=await this.db.queryOne<{cancel_requested:number}>(`SELECT cancel_requested FROM chat_run_ownership WHERE ${this.fence(grant)}`,this.args(grant));
  if(!current)throw new RunOwnershipLostError('运行执行权已失效，请读取最新状态');return {cancelled:!!current.cancel_requested};
 }
 async renew(run:string){const grant=this.held.get(run);if(!grant)throw new RunOwnershipLostError('执行权已失效');await this.db.run(`UPDATE chat_run_ownership SET expires_at=${this.clock}+? WHERE ${this.fence(grant)}`,[this.ttlMs,...this.args(grant)]);return this.assert(run);}
 async release(run:string,kind:Grant['kind']='session'){
  const grant=this.held.get(run);if(!grant||grant.kind!==kind)return;
  this.held.delete(run);await this.db.run('UPDATE chat_run_ownership SET owner_token=?,expires_at=0,cancel_requested=0 WHERE scope_id=? AND owner_token=?',['',grant.scope,grant.token]);
 }
 async execution(user:string,run:string){return this.db.queryOne<{cancel_requested:number}>(`SELECT cancel_requested FROM chat_run_ownership WHERE user_id=? AND run_id=? AND scope_id LIKE 'session:%' AND expires_at>${this.clock}`,[user,run]);}
 async activeRuns(){return new Set((await this.db.query<{run_id:string}>(`SELECT run_id FROM chat_run_ownership WHERE scope_id LIKE 'session:%' AND expires_at>${this.clock}`)).map(row=>row.run_id));}
 async writeConfig(run:string,key:string,value:string,condition:{key:string;value:string;expectedValue?:string}){
  const grant=this.held.get(run);if(!grant)throw new RunOwnershipLostError('缺少状态写入权');
  const stamp=this.sqlite?new Date().toISOString():new Date().toISOString().slice(0,19).replace('T',' ');
  const prior=condition.expectedValue===undefined?[]:[condition.expectedValue];
  if(this.sqlite)await this.db.run(`UPDATE user_config SET value=?,updated_at=? WHERE user_id=? AND \`key\`=? AND EXISTS(SELECT 1 FROM chat_run_ownership WHERE ${this.fence(grant)}) AND EXISTS(SELECT 1 FROM user_config c WHERE c.user_id=? AND c.\`key\`=? AND c.value=?)${prior.length?' AND value=?':''}`,[value,stamp,grant.user,key,...this.args(grant),grant.user,condition.key,condition.value,...prior]);
  else await this.db.run(`UPDATE user_config s JOIN chat_run_ownership g ON g.user_id=s.user_id JOIN user_config c ON c.user_id=s.user_id AND c.\`key\`=? SET s.value=?,s.updated_at=? WHERE s.user_id=? AND s.\`key\`=? AND g.scope_id=? AND g.user_id=? AND g.run_id=? AND g.owner_token=? AND g.expires_at>${this.clock} AND c.value=?${prior.length?' AND s.value=?':''}`,[condition.key,value,stamp,grant.user,key,...this.args(grant),condition.value,...prior]);
  await this.assert(run);
  const saved=await this.db.queryOne<{value:string}>('SELECT value FROM user_config WHERE user_id=? AND `key`=?',[grant.user,key]);
  if(saved?.value!==value)throw new RunOwnershipLostError('状态或自主运行设置已变化');
 }
 async notification(run:string,notice:{id:string;body:string;createdAt:number},condition:{controlKey:string;controlValue:string;stateKey:string;stateValue:string}){
  const grant=this.held.get(run);if(!grant)throw new RunOwnershipLostError('缺少通知写入权');
  await this.db.run(`${this.sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO notifications(id,user_id,type,title,body,link,\`read\`,created_at) SELECT ?,?,'info','助手有新进展',?,'app:x',0,? FROM chat_run_ownership WHERE ${this.fence(grant)} AND EXISTS(SELECT 1 FROM user_config c WHERE c.user_id=? AND c.\`key\`=? AND c.value=?) AND EXISTS(SELECT 1 FROM user_config s WHERE s.user_id=? AND s.\`key\`=? AND s.value=?)${this.sqlite?'':' FOR SHARE'}`,[notice.id,grant.user,notice.body,notice.createdAt,...this.args(grant),grant.user,condition.controlKey,condition.controlValue,grant.user,condition.stateKey,condition.stateValue]);
  await this.assert(run);
  const saved=await this.db.queryOne<{user_id:string;body:string;created_at:number}>('SELECT user_id,body,created_at FROM notifications WHERE id=?',[notice.id]);
  if(saved?.user_id!==grant.user||saved.body!==notice.body||Number(saved.created_at)!==notice.createdAt)throw new RunOwnershipLostError('通知尚未保存或编号冲突');
 }
 async cancel(user:string,run:string){await this.db.run(`UPDATE chat_run_ownership SET cancel_requested=1 WHERE user_id=? AND run_id=? AND scope_id LIKE 'session:%' AND expires_at>${this.clock}`,[user,run]);return this.execution(user,run);}
 async read(user:string,id:string){return this.db.queryOne<{id:string;user_id:string;metadata_json:string}>('SELECT id,user_id,metadata_json FROM tasks WHERE id=? AND user_id=?',[id,user]);}
 async reserveAiUsage(scope:string,row:{id:string;userId:string;periodStart:number;periodEnd:number;metadata:string;createdAt:number},queue?:{id:string;token:string}){
  const grant=this.held.get(scope);if(!grant||grant.user!==row.userId)throw new RunOwnershipLostError('缺少模型额度写入权');
  const queueArgs=queue?[queue.id,queue.token,row.userId]:[];
  await this.db.run(`INSERT INTO usage_records (id,user_id,resource_type,amount,period_start,period_end,metadata,created_at) SELECT ?,?,'ai_calls',1,?,?,?,? FROM chat_run_ownership WHERE ${this.fence(grant)}${queue?` AND EXISTS(SELECT 1 FROM model_call_queue q WHERE q.id=? AND q.owner_token=? AND q.user_id=? AND q.status='running' AND q.expires_at>${this.clock})`:''}${this.sqlite?'':' FOR SHARE'}`,[row.id,row.userId,row.periodStart,row.periodEnd,row.metadata,row.createdAt,...this.args(grant),...queueArgs]);
  await this.assert(scope);
  const saved=await this.db.queryOne<{user_id:string;amount:number}>('SELECT user_id,amount FROM usage_records WHERE id=?',[row.id]);
  if(saved?.user_id!==row.userId||Number(saved.amount)!==1)throw new RunOwnershipLostError('模型额度尚未保存');
 }
 async admitModelCall(run:string,id:string,token:string,ttlMs:number){
  const grant=this.held.get(run);if(!grant)throw new RunOwnershipLostError('缺少模型排队执行权');
  await this.db.run(`UPDATE model_call_queue SET status='running',expires_at=${this.clock}+? WHERE id=? AND owner_token=? AND status='queued' AND expires_at>${this.clock} AND EXISTS(SELECT 1 FROM chat_run_ownership WHERE ${this.fence(grant)})`,[ttlMs,id,token,...this.args(grant)]);
  await this.assert(run);
  const row=await this.db.queryOne<{status:string;owner_token:string}>('SELECT status,owner_token FROM model_call_queue WHERE id=?',[id]);
  return row?.status==='running'&&row.owner_token===token;
 }
 async enqueueModelCall(run:string,row:{id:string;user:string;runId?:string;token:string;limit:number},ttlMs:number){
  const grant=this.held.get(run);if(!grant)throw new RunOwnershipLostError('缺少模型排队写入权');
  await this.db.run(`INSERT INTO model_call_queue(id,user_id,run_id,owner_token,status,user_limit,expires_at) SELECT ?,?,?,?,'queued',?,${this.clock}+? FROM chat_run_ownership WHERE ${this.fence(grant)}${this.sqlite?'':' FOR SHARE'}`,[row.id,row.user,row.runId??null,row.token,row.limit,ttlMs,...this.args(grant)]);
  await this.assert(run);
  const saved=await this.db.queryOne<{owner_token:string}>('SELECT owner_token FROM model_call_queue WHERE id=?',[row.id]);
  if(saved?.owner_token!==row.token)throw new RunOwnershipLostError('排队记录尚未保存');
 }
 async insert(row:TaskRow){
  const grant=this.held.get(row.id);if(!grant)throw new RunOwnershipLostError('缺少交办写入权');await this.assert(row.id);
  const fields=['id','user_id','domain','title','description','status','steps_json','result_json','metadata_json','created_at','updated_at'] as const;
  await this.db.run(`${this.sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO tasks (${fields.join(',')}) SELECT ${fields.map(()=>'?').join(',')} FROM chat_run_ownership WHERE ${this.fence(grant)}${this.sqlite?'':' FOR SHARE'}`,[...fields.map(key=>row[key]),...this.args(grant)]);
  return this.read(row.user_id,row.id);
 }
 async write(row:TaskRow){
  const grant=this.held.get(row.id);if(!grant||grant.user!==row.user_id)throw new RunOwnershipLostError('缺少运行写入权');
  const values=[row.status,row.steps_json,row.result_json,row.metadata_json,row.updated_at,row.id,row.user_id,...this.args(grant)];
  if(this.sqlite)await this.db.run(`UPDATE tasks SET status=?,steps_json=?,result_json=?,metadata_json=?,updated_at=? WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM chat_run_ownership WHERE ${this.fence(grant)})`,values);
  else await this.db.run(`UPDATE tasks t JOIN chat_run_ownership g ON g.run_id=t.id SET t.status=?,t.steps_json=?,t.result_json=?,t.metadata_json=?,t.updated_at=? WHERE t.id=? AND t.user_id=? AND g.scope_id=? AND g.user_id=? AND g.run_id=? AND g.owner_token=? AND g.expires_at>${this.clock}`,values);
  await this.assert(row.id);const saved=await this.read(row.user_id,row.id);if(saved?.metadata_json!==row.metadata_json)throw new RunOwnershipLostError('运行记录已变化或已删除');
 }
 async assistant(user:string,run:string,session:string,id:string,content:string,tools:string){
  const grant=this.held.get(run);if(!grant||grant.user!==user)throw new RunOwnershipLostError('缺少结果写入权');
  const update=[content,tools,id,session,...this.args(grant)];
  if(this.sqlite)await this.db.run(`UPDATE chat_messages SET content=?,tool_calls_json=? WHERE id=? AND session_id=? AND role='assistant' AND EXISTS(SELECT 1 FROM chat_run_ownership WHERE ${this.fence(grant)})`,update);
  else await this.db.run(`UPDATE chat_messages m JOIN chat_run_ownership g ON g.run_id=? SET m.content=?,m.tool_calls_json=? WHERE m.id=? AND m.session_id=? AND m.role='assistant' AND g.scope_id=? AND g.user_id=? AND g.run_id=? AND g.owner_token=? AND g.expires_at>${this.clock}`,[run,...update]);
  await this.db.run(`${this.sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO chat_messages (id,session_id,role,content,tool_calls_json,created_at) SELECT ?,?,'assistant',?,?,? FROM chat_run_ownership WHERE ${this.fence(grant)}${this.sqlite?'':' FOR SHARE'}`,[id,session,content,tools,this.sqlite?new Date().toISOString():new Date().toISOString().slice(0,19).replace('T',' '),...this.args(grant)]);
  await this.assert(run);
  const saved=await this.db.queryOne<{session_id:string;role:string;content:string}>('SELECT session_id,role,content FROM chat_messages WHERE id=?',[id]);
  if(saved?.session_id!==session||saved.role!=='assistant'||saved.content!==content)throw new RunOwnershipLostError('结果消息归属或内容已变化');
  await this.db.run(`UPDATE chat_sessions SET updated_at=${this.sqlite?"strftime('%Y-%m-%dT%H:%M:%fZ','now')":'CURRENT_TIMESTAMP(3)'} WHERE id=? AND user_id=?`,[session,user]);
 }
}
