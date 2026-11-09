import fs from 'node:fs/promises';import {constants} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import type {SandboxFS} from '../tooling/SandboxFS.js';
export interface UploadFile {path:string;name:string;size:number;sha256:string;mimeType:string;}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const validId=(id:string)=>/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const mime:Record<string,string>={'.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
export class BrowserUploadStore{
 constructor(private computersRoot:string,private sandboxFor:(user:string)=>Promise<SandboxFS>){}
 private owner(user:string){if(!/^[\w-]{1,128}$/.test(user)||user==='anonymous')throw new Error('请先登录');}
 private async read(user:string,file:string){
  this.owner(user);if(!file||file.length>1024||path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw new Error('文件必须位于你的工作区');
  const sandbox=await this.sandboxFor(user);const root=await fs.realpath(sandbox.getRoot());const absolute=path.resolve(root,file);const real=await fs.realpath(absolute);
  if(!real.startsWith(root+path.sep))throw new Error('文件超出工作区');
  const handle=await fs.open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{if(process.platform==='linux'){const opened=await fs.realpath(`/proc/self/fd/${handle.fd}`);if(!opened.startsWith(root+path.sep))throw new Error('文件超出工作区');}const info=await handle.stat();if(!info.isFile()||info.size>5*1024*1024)throw new Error('文件大小不能超过5MB');const bytes=Buffer.alloc(info.size+1);let total=0;while(total<bytes.length){const result=await handle.read(bytes,total,bytes.length-total,null);if(!result.bytesRead)break;total+=result.bytesRead;}if(total>info.size)throw new Error('文件在读取期间已变化');return bytes.subarray(0,total);}finally{await handle.close();}
 }
 async inspect(user:string,file:string):Promise<UploadFile>{const bytes=await this.read(user,file);const name=path.basename(file);if(/[\x00-\x1f]/.test(name))throw new Error('文件名称无效');return {path:file,name,size:bytes.length,sha256:hash(bytes),mimeType:mime[path.extname(name).toLowerCase()]??'application/octet-stream'};}
 private async folder(user:string){this.owner(user);const root=await fs.realpath(this.computersRoot);const base=path.join(root,'users',user,'workspace','.x-browser');if(await fs.realpath(base)!==base)throw new Error('临时上传目录包含链接');const expected=path.join(base,'imports');await fs.mkdir(expected,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});const actual=await fs.realpath(expected);if(actual!==expected)throw new Error('临时上传目录包含链接');return actual;}
 async stage(user:string,id:string,file:UploadFile){
  if(!validId(id))throw new Error('上传标识无效');const bytes=await this.read(user,file.path);const current=await this.inspect(user,file.path);
  if(hash(bytes)!==file.sha256||current.sha256!==file.sha256||current.name!==file.name||current.size!==file.size||current.mimeType!==file.mimeType)throw new Error('文件已变化，请重新申请并确认');
  const destination=path.join(await this.folder(user),id);
  try{await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const handle=await fs.open(destination,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const info=await handle.stat();if(!info.isFile()||info.size!==file.size||hash(await handle.readFile())!==file.sha256)throw new Error('临时文件校验失败');}finally{await handle.close();}}
 }
 async removeStage(user:string,id:string){if(!validId(id))throw new Error('上传标识无效');await fs.unlink(path.join(await this.folder(user),id)).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
