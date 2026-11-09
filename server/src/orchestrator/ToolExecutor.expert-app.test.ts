import {describe,it,expect} from 'vitest';import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';import {UserSandboxManager} from '../tooling/UserSandboxManager.js';import {ToolExecutor} from './ToolExecutor.js';
describe('expert desktop application delivery',()=>{
 it('publishes quick HTML in the user application directory rather than the private agent folder',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'expert-app-')),sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),workspaces=new UserSandboxManager(root);
  try{
   const {sandboxFS}=await workspaces.getForUser('owner'),executor=new ToolExecutor(sandboxFS,workspaces,undefined,undefined,undefined,undefined,db);
   const result=await executor.execute({id:'create',taskId:'task',action:'x.create_app',toolName:'x.create_app',toolInput:{app_id:'expert-counter',name:'专家计数器',html_content:'<button>增加</button>'},status:'pending',riskLevel:'low'},'container',{userId:'owner',agentId:'writer',getConfig:db.getConfig.bind(db),setConfig:db.setConfig.bind(db)});
   expect(result.output).toMatchObject({ok:true,appId:'expert-counter'});expect(await sandboxFS.read('apps/expert-counter/index.html')).toContain('增加');
   expect(await (await workspaces.getForAgent('owner','writer')).sandboxFS.exists('apps/expert-counter/index.html')).toBe(false);
  }finally{sqlite.close();}
 });
});
