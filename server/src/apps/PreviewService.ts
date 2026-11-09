import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '../db/database.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';

interface Preview { token_hash:string; user_id:string; app_id:string|null; session_key:string; expires_at:number; origin:string; html:string|null }
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const APP_STORAGE_PREFIX='__browser_storage__:';
export class PreviewService {
  private ready:Promise<void>;
  constructor(private db:AppDatabase,private workspaces:UserSandboxManager){
    this.ready=db.run(`CREATE TABLE IF NOT EXISTS app_previews(token_hash VARCHAR(64) PRIMARY KEY,user_id VARCHAR(128) NOT NULL,app_id VARCHAR(128),session_key VARCHAR(128) NOT NULL,expires_at BIGINT NOT NULL,origin VARCHAR(512) NOT NULL,html ${db.getDialect()==='mysql'?'MEDIUMTEXT':'TEXT'})`);
    void this.ready.catch(()=>{});
  }
  async mint(userId:string,session:{token:string;expiresAt:number},origin:string,input:{appId?:string;html?:string}){
    await this.ready;
    const base=new URL(origin);if(!['http:','https:'].includes(base.protocol)||base.origin!==origin)throw new Error('预览来源无效');
    if(!!input.appId===!!input.html)throw new Error('预览内容无效');
    if(input.appId)await this.readAppAsset(userId,input.appId,'index.html');
    if(input.html!==undefined&&(typeof input.html!=='string'||Buffer.byteLength(input.html)>1024*1024))throw new Error('预览内容过大');
    const token=randomBytes(32).toString('base64url');const expires=Math.min(session.expiresAt,Date.now()+4*60*60*1000);
    await this.db.run('INSERT INTO app_previews(token_hash,user_id,app_id,session_key,expires_at,origin,html) VALUES(?,?,?,?,?,?,?)',[hash(token),userId,input.appId??null,`auth_session:${hash(session.token)}`,expires,origin,input.html??null]);
    // Only expiring preview capabilities created by this service are pruned.
    await this.db.run('DELETE FROM app_previews WHERE expires_at<?',[Date.now()]);
    return {url:`/api/apps/preview/${encodeURIComponent(userId)}/${token}/index.html`,expiresAt:expires};
  }
  async resolve(userId:string,token:string):Promise<Preview>{
    await this.ready;if(!/^[\w-]{1,128}$/.test(userId)||! /^[\w-]{43}$/.test(token))throw new Error('预览不存在');
    const preview=await this.db.queryOne<Preview>('SELECT token_hash,user_id,app_id,session_key,expires_at,origin,html FROM app_previews WHERE token_hash=? AND user_id=?',[hash(token),userId]);
    if(!preview||preview.expires_at<=Date.now())throw new Error('预览已过期');
    let session:{expiresAt:number};try{session=JSON.parse(await this.db.getConfig(userId,preview.session_key)??'');}catch{throw new Error('登录已失效');}
    if(!session.expiresAt||session.expiresAt<=Date.now())throw new Error('登录已失效');
    return preview;
  }
  async readAppAsset(userId:string,appId:string,asset:string):Promise<Buffer>{
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(appId)||!asset||asset.split('/').some(part=>!part||part.startsWith('.'))||asset.includes('\\')||asset.includes('\0'))throw new Error('应用资源路径无效');
    const workspace=await fs.realpath(this.workspaces.getUserWorkspaceRoot(userId));
    const peers=await fs.readdir(path.join(workspace,'apps'));if(peers.some(name=>name!==appId&&name.toLowerCase()===appId.toLowerCase()))throw new Error('应用编号大小写冲突');
    const root=path.join(workspace,'apps',appId);if(await fs.realpath(root)!==root)throw new Error('应用目录不能使用符号链接');
    const target=path.resolve(root,asset);if(!target.startsWith(root+path.sep)||await fs.realpath(target)!==target)throw new Error('禁止跨应用读取资源');
    const file=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const stat=await file.stat();if(!stat.isFile()||stat.size>10*1024*1024)throw new Error('资源类型或大小不支持');
      const actual=process.platform==='linux'?await fs.realpath(`/proc/self/fd/${file.fd}`):await fs.realpath(target);
      const current=await fs.stat(target);if(actual!==target||stat.ino!==current.ino||stat.dev!==current.dev)throw new Error('应用资源已变化');
      const chunks:Buffer[]=[];let size=0;
      for(;;){const chunk=Buffer.alloc(65536);const {bytesRead}=await file.read(chunk,0,chunk.length,null);if(!bytesRead)break;size+=bytesRead;if(size>10*1024*1024)throw new Error('资源过大');chunks.push(chunk.subarray(0,bytesRead));}
      return Buffer.concat(chunks);
    }finally{await file.close();}
  }
  async storage(userId:string,appId:string):Promise<Record<string,string>>{
    const scope=this.storageScope(appId);const stored=await this.db.appBackendKvList(userId,scope);const seen=new Set<string>();
    const result:Record<string,string>=Object.create(null);
    for(const name of stored){try{const value=JSON.parse(await this.db.appBackendKvGet(userId,scope,name)??'null');if(typeof value?.key==='string'){seen.add(value.key);if(typeof value.value==='string')result[value.key]=value.value;}}catch{}}
    // Preserve the development runtime's earlier values without deleting or publishing them.
    const keys=(await this.db.appBackendKvList(userId,appId,APP_STORAGE_PREFIX)).filter(key=>key.startsWith(APP_STORAGE_PREFIX));if(keys.length>128)throw new Error('应用存档数量过多');
    for(const key of keys){try{const original=key.slice(APP_STORAGE_PREFIX.length);const value=JSON.parse(await this.db.appBackendKvGet(userId,appId,key)??'null');if(!seen.has(original)&&typeof value==='string')result[original]=value;}catch{}}
    return result;
  }
  private storageScope(appId:string){return '@storage:'+hash(appId).slice(0,40);}
  async store(userId:string,appId:string,key:unknown,value:unknown){
    if(typeof key!=='string'||key.length>256||(value!==null&&typeof value!=='string')||(typeof value==='string'&&Buffer.byteLength(value)>16384))throw new Error('存档名称或大小无效');
    const scope=this.storageScope(appId),name=hash(key);const keys=await this.db.appBackendKvList(userId,scope);if(keys.length>=128&&!keys.includes(name))throw new Error('应用存档数量已达到上限');
    await this.db.appBackendKvSet(userId,scope,name,JSON.stringify({key,value}));
  }
}
