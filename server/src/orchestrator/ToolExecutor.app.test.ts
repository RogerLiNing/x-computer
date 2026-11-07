import {describe,it,expect,vi} from 'vitest';import{mkdtemp}from'node:fs/promises';import os from'node:os';import path from'node:path';import{SandboxFS}from'../tooling/SandboxFS.js';import{ToolExecutor}from'./ToolExecutor.js';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {AppVersionStore} from '../apps/AppVersionStore.js';
describe('application handoff persistence',()=>{
 it('keeps the original and new source when an application is updated through the tool',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'app-version-tool-'));const sqlite=new SqliteAppDatabase(root);const db=new SqliteDatabaseAdapter(sqlite);
  try{
   const fs=new SandboxFS(path.join(root,'workspace'));await fs.init();await fs.writeOverwrite('apps/counter/index.html','original');
   const executor=new ToolExecutor(fs,undefined,undefined,undefined,undefined,undefined,db);
   const result=await executor.execute({id:'s',taskId:'t',action:'x.create_app',toolName:'x.create_app',toolInput:{app_id:'counter',name:'计数器',html_content:'<button>修改版</button>'},status:'pending',riskLevel:'low'},'container',{userId:'owner',getConfig:db.getConfig.bind(db),setConfig:db.setConfig.bind(db)});
   expect(result.output).toMatchObject({ok:true,appId:'counter',versionId:expect.any(String)});
   const store=new AppVersionStore(db),versions=await store.list('owner','counter');expect(versions).toHaveLength(2);
   const original=await store.restore('owner','counter',versions.find(item=>item.id!==(result.output as {versionId:string}).versionId)!.id,fs);
   expect(await fs.read(`${original.path}/index.html`)).toBe('original');
   expect(JSON.parse(await db.getConfig('owner','x_mini_apps')??'[]')).toContainEqual({id:'counter',name:'计数器',path:'apps/counter'});
  }finally{sqlite.close();}
 });
 it('does not report creation before the registration write settles',async()=>{
  const fs=new SandboxFS(await mkdtemp(path.join(os.tmpdir(),'app-register-')));await fs.init();const executor=new ToolExecutor(fs);
  let saved!:()=>void;const gate=new Promise<void>(resolve=>saved=resolve);const setConfig=vi.fn(async()=>gate);
  let settled=false;const result=executor.execute({id:'s',taskId:'t',action:'x.create_app',toolName:'x.create_app',toolInput:{app_id:'new-counter',name:'计数器',html_content:'<button>增加</button>'},status:'pending',riskLevel:'low'},'container',{userId:'owner',getConfig:async()=>undefined,setConfig}).then(value=>{settled=true;return value;});
  await vi.waitFor(()=>expect(setConfig).toHaveBeenCalled());expect(settled).toBe(false);saved();expect((await result).output).toMatchObject({ok:true,appId:'new-counter'});
 });
});
