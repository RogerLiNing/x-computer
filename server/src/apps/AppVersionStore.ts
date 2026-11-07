import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppDatabase } from '../db/database.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { RunOwnershipStore } from '../chat/RunOwnershipStore.js';

interface Version { id:string; app_id:string; name:string; created_at:number; digest:string }
export interface AppVersion { id:string; name:string; createdAt:number }
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const validId=(id:string)=>/^[a-zA-Z0-9_-]{1,64}$/.test(id);

/** Source snapshots live in the database, outside the assistant's writable workspace. */
export class AppVersionStore {
  private ready:Promise<void>;
  constructor(private db:AppDatabase){
    this.ready=db.run(`CREATE TABLE IF NOT EXISTS app_source_versions (id VARCHAR(64) PRIMARY KEY,user_id VARCHAR(128) NOT NULL,app_key VARCHAR(64) NOT NULL,app_id VARCHAR(64) NOT NULL,name VARCHAR(255) NOT NULL,created_at BIGINT NOT NULL,digest VARCHAR(64) NOT NULL,bundle ${db.getDialect()==='mysql'?'MEDIUMTEXT':'TEXT'} NOT NULL)`);
    void this.ready.catch(()=>{});
  }
  private async rows(user:string,app:string){
    if(!validId(app))throw new Error('应用编号无效');
    await this.ready;
    return (await this.db.query<Version>('SELECT id,app_id,name,created_at,digest FROM app_source_versions WHERE user_id=? AND app_key=? ORDER BY created_at DESC,id DESC',[user,hash(app)])).filter(row=>row.app_id===app);
  }
  async list(user:string,app:string):Promise<AppVersion[]>{
    return (await this.rows(user,app)).map(row=>({id:row.id,name:row.name,createdAt:Number(row.created_at)}));
  }
  async register(user:string,app:{id:string;name:string;path:string}){
    const lease=new RunOwnershipStore(this.db);await lease.init();
    const scope=`app-registry:${hash(user).slice(0,40)}`;
    if(!await lease.acquire(user,scope,scope,'record'))throw new Error('应用列表正在更新，请稍后重试');
    try{
      const apps=JSON.parse(await this.db.getConfig(user,'x_mini_apps')??'[]');
      if(!Array.isArray(apps))throw new Error('应用列表无效');
      const index=apps.findIndex(item=>item?.id===app.id);
      if(index<0)apps.push(app);else apps[index]={...apps[index],...app};
      await lease.assert(scope);
      await this.db.setConfig(user,'x_mini_apps',JSON.stringify(apps));
    }finally{await lease.release(scope,'record');}
  }
  async sourceAppId(user:string,app:string):Promise<string|undefined>{
    const apps=JSON.parse(await this.db.getConfig(user,'x_mini_apps')??'[]');
    const source=Array.isArray(apps)?apps.find(item=>item?.id===app)?.sourceAppId:undefined;
    return typeof source==='string'&&validId(source)?source:undefined;
  }
  async capture(user:string,app:string,name:string,sandbox:SandboxFS){
    if(!validId(app)||!name||name.length>255)throw new Error('应用编号或名称无效');
    const root=path.join(await fs.realpath(sandbox.getRoot()),'apps',app);
    if(await fs.realpath(root)!==root)throw new Error('应用目录不能使用符号链接');
    const peers=await fs.readdir(path.dirname(root));
    if(peers.some(peer=>peer!==app&&peer.toLowerCase()===app.toLowerCase()))throw new Error('应用编号大小写冲突');
    const files:Record<string,string>=Object.create(null);let size=0;let entries=0;
    const visit=async(dir:string,depth:number):Promise<void>=>{
      if(depth>12)throw new Error('应用目录层级过深');
      for(const item of (await fs.readdir(path.join(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        if(item.name.startsWith('.'))continue;
        if(++entries>256)throw new Error('应用文件过多，无法保留版本');
        const relative=dir?`${dir}/${item.name}`:item.name;
        if(item.isSymbolicLink())throw new Error('版本不能包含符号链接');
        if(item.isDirectory()){await visit(relative,depth+1);continue;}
        const target=path.join(root,relative);
        if(await fs.realpath(target)!==target)throw new Error('应用资源路径已变化');
        const file=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{
          const before=await file.stat();
          if(!before.isFile()||size+before.size>4*1024*1024)throw new Error('应用源码和资源总量超过 4 MiB');
          const chunks:Buffer[]=[];let bytes=0;
          for await(const chunk of file.createReadStream({autoClose:false})){
            bytes+=chunk.length;if(size+bytes>4*1024*1024)throw new Error('应用资源过大');chunks.push(Buffer.from(chunk));
          }
          const after=await file.stat(),current=await fs.stat(target);
          if(await fs.realpath(target)!==target||before.ino!==current.ino||before.dev!==current.dev||before.mtimeMs!==after.mtimeMs||before.size!==bytes)throw new Error('应用正在变化，请稍后重试');
          files[relative]=Buffer.concat(chunks).toString('base64');size+=bytes;
        }finally{await file.close();}
      }
    };
    await visit('',0);
    if(!Object.hasOwn(files,'index.html'))throw new Error('应用缺少 index.html');
    const bundle=JSON.stringify(files),digest=hash(bundle);
    const previous=(await this.rows(user,app)).find(row=>row.digest===digest&&row.name===name);
    if(previous)return previous.id;
    const id=randomUUID();
    await this.db.run('INSERT INTO app_source_versions(id,user_id,app_key,app_id,name,created_at,digest,bundle) VALUES(?,?,?,?,?,?,?,?)',[id,user,hash(app),app,name,Date.now(),digest,bundle]);
    return id;
  }
  async restore(user:string,app:string,id:string,sandbox:SandboxFS){
    if(!validId(app))throw new Error('应用编号无效');await this.ready;
    const row=await this.db.queryOne<Version&{bundle:string}>('SELECT id,app_id,name,created_at,digest,bundle FROM app_source_versions WHERE user_id=? AND app_key=? AND id=?',[user,hash(app),id]);
    if(!row||row.app_id!==app||hash(row.bundle)!==row.digest)throw new Error('版本不存在或校验失败');
    const files=JSON.parse(row.bundle) as Record<string,string>;
    const restoredId=`restored-${randomUUID()}`;
    // Restore into a new directory: never roll back current source or user data.
    await sandbox.mkdir('apps');
    const apps=path.join(await fs.realpath(sandbox.getRoot()),'apps');
    if(await fs.realpath(apps)!==apps)throw new Error('应用目录无效');
    await fs.mkdir(path.join(apps,restoredId));
    for(const [relative,content] of Object.entries(files)){
      if(relative.split('/').some(part=>!part||part.startsWith('.'))||relative.includes('\\')||relative.includes('\0')||typeof content!=='string')throw new Error('版本资源路径无效');
      await sandbox.writeBinary(`apps/${restoredId}/${relative}`,Buffer.from(content,'base64'));
    }
    const name=`${row.name.slice(0,235)}（恢复副本）`;
    await this.capture(user,restoredId,name,sandbox);
    return {id:restoredId,name,path:`apps/${restoredId}`,sourceAppId:await this.sourceAppId(user,app)??app};
  }
}
