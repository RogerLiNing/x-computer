import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {SandboxFS}from'../tooling/SandboxFS.js';
export interface ExpertInputFile {sourcePath:string;path:string;relativePath:string;name:string;size:number;sha256:string}
const MAX_FILE=16*1024*1024,MAX_TOTAL=32*1024*1024;
const digest=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex');
async function read(root:string,relative:string){try{return await new SandboxFS(root).readBinaryBounded(relative,MAX_FILE);}catch(error){if(error instanceof Error&&error.message.includes('普通文件'))throw new Error('交接材料须为不超过 16 MiB 的普通文件');throw error;}}
async function publish(target:string,data:Buffer,stored:(bytes:number)=>void):Promise<void>{
 await directory(path.dirname(target));
 const staged=path.join(path.dirname(target),`.capture-${randomUUID()}`),file=await fs.open(staged,'wx',0o600);
 try{await file.writeFile(data);await file.sync();}finally{await file.close();}
 stored(data.length);
 // Keep the completed capture as audit evidence; link publishes it without overwriting an existing snapshot.
 try{await fs.link(staged,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
}
async function directory(dir:string):Promise<void>{
 let ancestor=dir;
 while(true){try{await fs.lstat(ancestor);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;ancestor=path.dirname(ancestor);}}
 if(await fs.realpath(ancestor)!==ancestor)throw new Error('材料目录不能使用符号链接');
 await fs.mkdir(dir,{recursive:true,mode:0o700});if(await fs.realpath(dir)!==dir)throw new Error('材料目录不能使用符号链接');
}
/** Private captures survive source changes; only working copies enter the model's workspace. */
export async function prepareExpertInputs(workspace:Pick<SandboxFS,'getRoot'|'recordStorageChange'>,runId:string,targetDirectory:string,sources:string[],guard:()=>Promise<void>=async()=>{}):Promise<ExpertInputFile[]>{
 if(!/^[\w-]{1,64}$/.test(runId)||sources.length>32)throw new Error('每次最多交接 32 份材料');
 if(!targetDirectory||path.isAbsolute(targetDirectory)||targetDirectory.split('/').includes('..')||targetDirectory.includes('\\')||targetDirectory.includes('\0'))throw new Error('材料副本目录无效');
 const root=await fs.realpath(workspace.getRoot()),privateRoot=path.join(path.dirname(root),'.expert-inputs',runId),stored=(bytes:number)=>workspace.recordStorageChange(bytes);
 await directory(privateRoot);
 const files:ExpertInputFile[]=[];let total=0;
 for(const [index,sourcePath] of sources.entries()){
  await guard();
  if(typeof sourcePath!=='string'||!sourcePath||path.isAbsolute(sourcePath)||sourcePath.split('/').includes('..')||sourcePath.includes('\\')||sourcePath.includes('\0'))throw new Error('交接材料路径无效');
  const slot=String(index+1).padStart(2,'0');let data:Buffer;
  try{data=await read(privateRoot,slot);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const source=await read(root,sourcePath);if(total+source.length>MAX_TOTAL)throw new Error('本次交接材料合计超过 32 MiB');await publish(path.join(privateRoot,slot),source,stored);data=await read(privateRoot,slot);}
  total+=data.length;if(total>MAX_TOTAL)throw new Error('本次交接材料合计超过 32 MiB');
  const relativePath=`输入/${slot}/${path.basename(sourcePath)}`,target=`${targetDirectory}/${relativePath}`,hash=digest(data);
  await guard();
  try{const current=await read(root,target);if(digest(current)!==hash)throw new Error('材料副本已变化，系统不会覆盖，请核实后重新交办');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await publish(path.resolve(root,target),data,stored);if(digest(await read(root,target))!==hash)throw new Error('材料副本校验失败');}
  files.push({sourcePath,path:target,relativePath,name:path.basename(sourcePath),size:data.length,sha256:hash});
 }
 return files;
}
