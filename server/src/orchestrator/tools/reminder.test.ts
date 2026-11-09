import {describe,it,expect,afterEach,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../../db/database.js';
import {ChatRunService} from '../../chat/ChatRunService.js';import {SandboxFS} from '../../tooling/SandboxFS.js';
import {XScheduler,setDefaultScheduler} from '../../scheduler/XScheduler.js';
import {createReminderHandler} from './reminder.js';
afterEach(()=>{setDefaultScheduler(null);vi.unstubAllEnvs();});

describe('source-bound reminder tool',()=>{
  it('binds the reminder to the authenticated run session and rejects forged context',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'reminder-tool-')),native=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(native);try{
      await db.ensureUser('owner');const session=await db.createSession('owner','原对话');
      const runs=new ChatRunService({db,orchestrator:{runChatAgentLoop:async()=>{throw Error('no model');}},getSandboxFS:async()=>new SandboxFS(root),getLLMConfig:async()=>{throw Error('no model');}});
      const run=await runs.accept({userId:'owner',sessionId:session.id,requestId:'request',messages:[{role:'user',content:'提醒我'}],providerId:'test',modelId:'test',systemPrompt:''});
      const scheduler=new XScheduler(async()=>{throw Error('must not execute now');});setDefaultScheduler(scheduler);
      const handler=createReminderHandler(db),result=await handler({message:'整理书包',in_minutes:1,sessionId:'forged'},{userId:'owner',runId:run.id}) as {sessionId:string;mode:string};
      expect(result.sessionId).toBe(session.id);expect(result.mode).toBe('reminder');expect(scheduler.listJobs('owner')[0].sessionId).toBe(session.id);
      await expect(handler({message:'test',in_minutes:1},{userId:'other',runId:run.id})).rejects.toThrow('无权');
      await expect(handler({message:'test',in_minutes:1,at:Date.now()},{userId:'owner',runId:run.id})).rejects.toThrow('一种');
      expect(scheduler.listJobs()).toHaveLength(1);
      vi.stubEnv('X_COMPUTER_BACKGROUND_AUTOSTART','false');
      const paused=await handler({message:'暂停时保留的提醒',in_minutes:2},{userId:'owner',runId:run.id});
      expect(paused).toMatchObject({ok:true,backgroundPaused:true,message:expect.stringContaining('恢复后台运行后')});
      expect(scheduler.listJobs()).toHaveLength(2);
    }finally{native.close();}
  });
});
