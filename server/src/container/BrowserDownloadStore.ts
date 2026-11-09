import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {SandboxFS} from '../tooling/SandboxFS.js';

export interface BrowserDownload { id:string; name:string; size:number; sha256:string; createdAt:number; }
const MAX_SIZE=10*1024*1024;
const validId=(id:string)=>/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

/** Only opaque download IDs cross the API. Browser profiles are never importable. */
export class BrowserDownloadStore {
 constructor(private computersRoot:string,private sandboxFor:(userId:string)=>Promise<SandboxFS>){}
 private async folder(userId:string){
  if(!/^[\w-]{1,128}$/.test(userId)||userId==='anonymous')throw new Error('请先登录');
  const root=await fs.realpath(this.computersRoot);
  const expected=path.join(root,'users',userId,'workspace','.x-browser','exports');
  const actual=await fs.realpath(expected);
  if(actual!==expected)throw new Error('浏览器下载目录包含链接');
  return actual;
 }
 private async read(file:string,limit:number):Promise<Buffer>{
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)throw new Error('文件大小超出限制');return await handle.readFile();}
  finally{await handle.close();}
 }
 async list(userId:string):Promise<BrowserDownload[]>{
  let bytes:Buffer;
  try{bytes=await this.read(path.join(await this.folder(userId),'manifest.json'),256*1024);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const rows:unknown=JSON.parse(bytes.toString());
  if(!Array.isArray(rows)||rows.length>100)throw new Error('浏览器下载记录无效');
  return rows.map((item:BrowserDownload)=>{
   if(!item||typeof item.id!=='string'||!validId(item.id))throw new Error('下载标识无效');
   if(typeof item.name!=='string'||!item.name||item.name.length>120||/[\\/\x00-\x1f]/.test(item.name)||item.name==='.'||item.name==='..')throw new Error('下载名称无效');
   if(!Number.isSafeInteger(item.size)||item.size<0||item.size>MAX_SIZE)throw new Error('文件大小超出限制');
   if(!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isFinite(item.createdAt))throw new Error('下载记录校验无效');
   return {id:item.id,name:item.name,size:item.size,sha256:item.sha256,createdAt:item.createdAt};
  });
 }
 async present(userId:string,id:string){
  if(!validId(id))throw new Error('下载标识无效');
  const item=(await this.list(userId)).find(row=>row.id===id);
  if(!item)throw new Error('下载文件不存在或无权访问');
  let bytes:Buffer;
  try{bytes=await this.read(path.join(await this.folder(userId),id),MAX_SIZE);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ELOOP')throw new Error('下载文件不能是链接');throw error;}
  if(bytes.length!==item.size||digest(bytes)!==item.sha256)throw new Error('下载文件内容校验失败');
  const sandbox=await this.sandboxFor(userId);await sandbox.mkdir('下载');
  const root=await fs.realpath(sandbox.getRoot());const directory=await fs.realpath(path.join(root,'下载'));
  if(directory!==path.join(root,'下载'))throw new Error('下载目标目录包含链接');
  const relative=path.posix.join('下载',`${id}-${item.name}`);const target=path.join(root,relative);
  const temporary=path.join(directory,`.browser-import-${randomUUID()}.tmp`);
  const handle=await fs.open(temporary,'wx',0o600);
  try{
   try{await handle.writeFile(bytes);}finally{await handle.close();}
   try{await fs.link(temporary,target);}
   catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const previous=await this.read(target,MAX_SIZE);
    if(digest(previous)!==item.sha256)throw new Error('已交付文件已修改，请保留当前内容并重新交办');
   }
  }finally{await fs.unlink(temporary);}
  return {presented:true,path:relative,name:item.name,size:item.size};
 }
}
