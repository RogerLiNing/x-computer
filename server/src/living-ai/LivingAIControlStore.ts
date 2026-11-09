import{v4 as uuid}from'uuid';
import type{AppDatabase}from'../db/database.js';
import type{LivingAIConfig,LivingAIState}from'../../../shared/src/index.js';
import type{RunOwnershipStore}from'../chat/RunOwnershipStore.js';

export const LIVING_STATE_KEY='living_ai_state_v1';
export const LIVING_CONTROL_KEY='living_ai_control_v1';
export interface LivingControl {revision:string;config:LivingAIConfig;deliveryEpoch?:string;}
/** Control changes are independent of cycle snapshots, so late workers cannot enable themselves. */
export class LivingAIControlStore {
 constructor(private db:AppDatabase){}
 async read(user:string):Promise<{raw:string;value:LivingControl}|undefined>{
  const raw=await this.db.getConfig(user,LIVING_CONTROL_KEY);if(raw===undefined)return;
  const value=JSON.parse(raw) as LivingControl;
  if(!value||typeof value.revision!=='string'||typeof value.config?.enabled!=='boolean'||value.deliveryEpoch!==undefined&&typeof value.deliveryEpoch!=='string')throw new Error('自主运行控制配置不可用');
  return{raw,value};
 }
 async patch(user:string,initial:LivingAIConfig,update:(current:LivingAIConfig)=>LivingAIConfig){
  await this.initialize(user,initial);
  for(let attempt=0;attempt<8;attempt++){
   const current=(await this.read(user))!,config=update(current.value.config);
   if(JSON.stringify(config)===JSON.stringify(current.value.config))return current;
   const value:LivingControl={revision:uuid(),config,deliveryEpoch:current.value.config.enabled&&!config.enabled?uuid():current.value.deliveryEpoch??current.value.revision},raw=JSON.stringify(value);
   if(typeof this.db.run==='function'&&typeof this.db.getDialect==='function')await this.db.run('UPDATE user_config SET value=? WHERE user_id=? AND `key`=? AND value=?',[raw,user,LIVING_CONTROL_KEY,current.raw]);
   else{if((await this.read(user))?.raw!==current.raw)continue;await this.db.setConfig(user,LIVING_CONTROL_KEY,raw);}
   if((await this.read(user))?.raw===raw)return{raw,value};
  }
  throw new Error('自主运行设置正在变化，请刷新后重试');
 }
 async initialize(user:string,config:LivingAIConfig){
  const current=await this.read(user);if(current)return current;
  const value:LivingControl={revision:uuid(),config},raw=JSON.stringify(value);
  if(typeof this.db.run==='function'&&typeof this.db.getDialect==='function'){
   const sqlite=this.db.getDialect()==='sqlite';
   await this.db.run(`${sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO user_config(user_id,\`key\`,value,updated_at) VALUES(?,?,?,?)`,[user,LIVING_CONTROL_KEY,raw,sqlite?new Date().toISOString():new Date().toISOString().slice(0,19).replace('T',' ')]);
  }else if(!await this.read(user))await this.db.setConfig(user,LIVING_CONTROL_KEY,raw);
  return(await this.read(user))!;
 }
 async assert(user:string,expected:string,signal:AbortSignal){
  signal.throwIfAborted();const current=await this.read(user);signal.throwIfAborted();
  if(current?.raw!==expected)throw new DOMException('自主运行设置已变化，旧循环已停止','AbortError');
 }
 async saveCycle(user:string,state:LivingAIState,expected:string,signal:AbortSignal,ownership?:{store:RunOwnershipStore;run:string},expectedState?:string){
  await this.assert(user,expected,signal);const body=JSON.stringify(state);
  if(ownership){await ownership.store.writeConfig(ownership.run,LIVING_STATE_KEY,body,{key:LIVING_CONTROL_KEY,value:expected,expectedValue:expectedState});await this.assert(user,expected,signal);return;}
  if(expectedState!==undefined&&await this.db.getConfig(user,LIVING_STATE_KEY)!==expectedState)throw new DOMException('自主状态已变化','AbortError');
  if(typeof this.db.run==='function'&&typeof this.db.getDialect==='function'){
   const sqlite=this.db.getDialect()==='sqlite',stamp=sqlite?new Date().toISOString():new Date().toISOString().slice(0,19).replace('T',' ');
   if(sqlite)await this.db.run('UPDATE user_config SET value=?,updated_at=? WHERE user_id=? AND `key`=? AND EXISTS(SELECT 1 FROM user_config c WHERE c.user_id=? AND c.`key`=? AND c.value=?)',[body,stamp,user,LIVING_STATE_KEY,user,LIVING_CONTROL_KEY,expected]);
   else await this.db.run('UPDATE user_config s JOIN user_config c ON c.user_id=s.user_id AND c.`key`=? SET s.value=?,s.updated_at=? WHERE s.user_id=? AND s.`key`=? AND c.value=?',[LIVING_CONTROL_KEY,body,stamp,user,LIVING_STATE_KEY,expected]);
   await this.assert(user,expected,signal);
   if(await this.db.getConfig(user,LIVING_STATE_KEY)!==body)throw new DOMException('自主运行状态已变化','AbortError');
  }else{await this.assert(user,expected,signal);await this.db.setConfig(user,LIVING_STATE_KEY,body);}
 }
 async permits(user:string,revision?:string){
  const control=await this.read(user);
  if(control)return control.value.config.enabled&&revision===control.value.revision;
  const raw=await this.db.getConfig(user,LIVING_STATE_KEY);if(!raw)return false;
  try{const state=JSON.parse(raw);return revision===undefined&&(state.version===1||state.version===2)&&!!state.identity?.continuityId&&state.config?.enabled===true;}catch{return false;}
 }
}
