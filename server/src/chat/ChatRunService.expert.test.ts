import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {UserSandboxManager} from '../tooling/UserSandboxManager.js';
import {ChatRunService} from './ChatRunService.js';
import type {ChatMessage} from './chatService.js';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve};}

describe('durable independent expert work',()=>{
  let sqlite:SqliteAppDatabase,db:SqliteDatabaseAdapter,workspaces:UserSandboxManager,runs:ChatRunService,parentId:string;
  const config={providerId:'test',modelId:'model',apiKey:'private-fixture-key'};
  const make=(loop:(params:any)=>Promise<any>)=>new ChatRunService({db,orchestrator:{runChatAgentLoop:loop} as never,getSandboxFS:async user=>(await workspaces.getForUser(user)).sandboxFS,getLLMConfig:async()=>config});
  const input={agentId:'writer',goal:'整理一份报告',action:'dispatch' as const,userId:'owner',toolCallId:'dispatch-one'};
  const promises:Promise<unknown>[]=[];let childLoop:ReturnType<typeof vi.fn>;
  let parentRelease:ReturnType<typeof gate>;
  beforeEach(async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'expert-runs-'));sqlite=new SqliteAppDatabase(root);db=new SqliteDatabaseAdapter(sqlite);workspaces=new UserSandboxManager(root);
    await db.ensureUser('owner');await db.setConfig('owner','x_agents',JSON.stringify([{id:'writer',name:'写作专家',systemPrompt:'完成报告',toolNames:['file.write','file.present']} ]));
    const session=await db.createSession('owner','主交办');
    childLoop=vi.fn(async()=>({content:'完成',stopReason:'completed'}));
    const calls=['dispatch-one','dispatch-two','dispatch-three'].map(id=>({id,name:'x.dispatch_agent',arguments:{}}));
    parentRelease=gate();const parentEntered=gate();
    runs=make(async p=>{
      if(p.agentId)return childLoop(p);
      await p.onCheckpoint([...p.messages,{role:'assistant',content:'',tool_calls:calls}]);parentEntered.resolve();await parentRelease.promise;
      return {content:'已交办',stopReason:'completed'};
    });
    const history:ChatMessage[]=[{role:'user',content:'帮我安排专家'}];
    const parent=await runs.accept({userId:'owner',sessionId:session.id,requestId:'parent',providerId:'test',modelId:'model',systemPrompt:'',messages:history,allowedToolNames:['x.dispatch_agent','file.write','file.present'],blockedToolNames:['file.delete']});parentId=parent.id;
    promises.push(runs.launch('owner',parentId));await parentEntered.promise;
  });
  afterEach(async()=>{await runs.stop('owner',parentId);parentRelease.resolve();await Promise.allSettled(promises.splice(0));sqlite.close();});
  const dispatch=(extra={})=>runs.expertDispatch({...input,parentRunId:parentId,...extra}) as Promise<any>;
  it('honors handoff-only requests and rejects changed follow-up consent on a duplicate dispatch',async()=>{
    const first=await dispatch({followUp:false});await runs.wait(first.runId);
    const row=await db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[first.runId]);
    expect(JSON.parse(row!.metadata_json).chatRun.allowFollowup).toBe(false);
    await expect(dispatch({followUp:true})).rejects.toThrow('其他任务');
    await expect(dispatch({followUp:'invalid'})).rejects.toThrow('跟进选项无效');
  });
  it('deduplicates dispatch, retains expert restrictions, and returns verified files in user-visible paths',async()=>{
    let finish!:()=>void;const gate=new Promise<void>(resolve=>finish=resolve);
    childLoop.mockImplementation(async p=>{
      expect(p.agentId).toBe('writer');expect(p.allowedToolNames).toEqual(['file.write','file.present']);expect(p.blockedToolNames).toEqual(['file.delete']);
      p.signal.addEventListener('abort',finish,{once:true});await gate;p.signal.throwIfAborted();const {sandboxFS}=await workspaces.getForAgent('owner','writer',p.agentRunId);await sandboxFS.writeOverwrite('文档/报告.md','真实报告');
      await p.onToolEvent({type:'tool_start',id:'write',toolName:'file.write',input:{path:'文档/报告.md'}});
      const messages=[...p.messages,{role:'assistant',content:'',tool_calls:[{id:'write',name:'file.write',arguments:{path:'文档/报告.md'}}]},{role:'tool',tool_call_id:'write',content:JSON.stringify({path:'文档/报告.md'})},{role:'assistant',content:'报告完成'}];
      await p.onCheckpoint(messages);return {content:'报告完成',stopReason:'completed'};
    });
    const first=await dispatch();const again=await dispatch();expect(again.runId).toBe(first.runId);await vi.waitFor(()=>expect(childLoop).toHaveBeenCalledTimes(1));
    finish();await runs.wait(first.runId);const result=await runs.get('owner',first.runId);
    expect(result.artifacts).toEqual([{path:`agents/writer/runs/${first.runId}/文档/报告.md`,name:'报告.md',size:Buffer.byteLength('真实报告')}]);expect(result.expert?.parentRunId).toBe(parentId);
    expect((await runs.workbench('owner')).finished.some(row=>row.id===first.runId)).toBe(true);
    const stored=await db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[first.runId]);expect(stored!.metadata_json).not.toContain(config.apiKey);
    const fresh=make(async()=>{throw new Error('must not restart completed work');});expect((await fresh.get('owner',first.runId)).content).toBe('报告完成');
  });
  it('stops child work with its parent and resumes only the saved child checkpoint',async()=>{
    const entered=gate();
    childLoop.mockImplementationOnce(async p=>{
      await p.onCheckpoint([...p.messages,{role:'assistant',content:'已完成第一步',tool_calls:[{id:'read',name:'file.read',arguments:{path:'input.txt'}}]},{role:'tool',tool_call_id:'read',content:'已读取'}]);entered.resolve();
      await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));
    }).mockImplementationOnce(async p=>{expect(p.messages.some((m:ChatMessage)=>m.content==='已完成第一步')).toBe(true);return {content:'继续完成',stopReason:'completed'};});
    const first=await dispatch();await entered.promise;await runs.stop('owner',parentId);await runs.wait(first.runId);
    expect((await runs.get('owner',first.runId)).status).toBe('paused');
    const fresh=make(async p=>childLoop(p));await fresh.resume('owner',first.runId);await fresh.wait(first.runId);
    expect((await fresh.get('owner',first.runId)).status).toBe('completed');expect(childLoop).toHaveBeenCalledTimes(2);
  });
  it('limits active experts, rejects foreign access and mismatched duplicate requests',async()=>{
    childLoop.mockImplementation(async p=>{await new Promise((_resolve,reject)=>p.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));});
    const first=await dispatch();const second=await dispatch({toolCallId:'dispatch-two'});
    await vi.waitFor(()=>expect(childLoop).toHaveBeenCalledTimes(2));
    await expect(dispatch({toolCallId:'dispatch-three'})).rejects.toThrow('其他交办');
    await expect(dispatch({goal:'different'})).rejects.toThrow('其他任务');
    await expect(dispatch({userId:'other'})).rejects.toThrow('无权');
    await runs.stop('owner',first.runId);await runs.stop('owner',second.runId);await runs.wait(first.runId);await runs.wait(second.runId);
  });
  it('cancels a newly saved child when the parent stop arrives during admission',async()=>{
    const read=db.getConfig.bind(db);let checks=0;
    vi.spyOn(db,'getConfig').mockImplementation(async(user,key)=>{
      if(key===`chat_run_cancel:${parentId}`&&++checks===2)return 'true';
      return read(user,key);
    });
    await expect(dispatch()).rejects.toMatchObject({name:'AbortError'});
    const row=(await db.getAllTasks()).find(task=>JSON.parse(task.metadata_json??'{}').chatRun?.expert?.parentRunId===parentId)!;
    expect(row).toBeDefined();expect((await runs.get('owner',row.id)).status).toBe('paused');expect(childLoop).not.toHaveBeenCalled();
  });
});
