import {describe,expect,it,vi} from 'vitest';
import {mkdtemp} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {callLLMWithToolsStream} from './chatService.js';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../db/database.js';
import {UserSandboxManager} from '../tooling/UserSandboxManager.js';
import {AgentOrchestrator} from '../orchestrator/AgentOrchestrator.js';import {AuditLogger} from '../observability/AuditLogger.js';
import {ChatRunService} from './ChatRunService.js';
vi.mock('./chatService.js',()=>({callLLMWithToolsStream:vi.fn(),callLLMWithTools:vi.fn(),callLLM:vi.fn(),callLLMGenerateImage:vi.fn()}));
it('keeps the main and child runtime ownership separate while returning a saved file',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'expert-runtime-')),sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),workspaces=new UserSandboxManager(root);
 try{
  await db.ensureUser('owner');await db.setConfig('owner','x_agents',JSON.stringify([{id:'writer',name:'写作专家',systemPrompt:'EXPERT',toolNames:['file.write','file.present']} ]));
  const sandbox=(await workspaces.getForUser('owner')).sandboxFS,orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,workspaces,db);
  const config={providerId:'test',modelId:'test',apiKey:'not-persisted'};
  const runs=new ChatRunService({db,orchestrator,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>config});orchestrator.setExpertDispatchRunner(request=>runs.expertDispatch(request));
  vi.mocked(callLLMWithToolsStream).mockImplementation(async(p:any)=>{
    if(p.messages.some((m:any)=>m.role==='tool'))return {content:'完成',toolCalls:[]};
    if(p.messages[0].content.startsWith('EXPERT'))return {content:'保存报告',toolCalls:[{id:'write',name:'file.write',arguments:{path:'report.md',content:'真实正文'}}]};
    return {content:'安排专家',toolCalls:[{id:'dispatch',name:'x.dispatch_agent',arguments:{agent_id:'writer',goal:'report'}}]};
  });
  const session=await db.createSession('owner','主助手'),parent=await runs.accept({userId:'owner',sessionId:session.id,requestId:'parent',messages:[{role:'user',content:'交给专家'}],providerId:'test',modelId:'test',systemPrompt:'MAIN',allowedToolNames:['x.dispatch_agent','file.write','file.present']});
  await runs.launch('owner',parent.id);const main=await runs.get('owner',parent.id);expect(main.status).toBe('completed');
  expect(main.expertRuns).toHaveLength(1);
  const childId=(main.toolCalls[0].output as {runId:string}).runId;await runs.wait(childId);
  const child=await runs.get('owner',childId);expect(child.status).toBe('completed');expect(child.artifacts[0].path).toBe(`agents/writer/runs/${childId}/report.md`);expect(await sandbox.read(child.artifacts[0].path)).toBe('真实正文');
 }finally{sqlite.close();}
});

it('forwards original image bytes through the real expert runtime and main followup',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'expert-vision-runtime-')),sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite),workspaces=new UserSandboxManager(root);
 try{
  await db.ensureUser('owner');await db.setConfig('owner','x_agents',JSON.stringify([{id:'reader',name:'看图专家',systemPrompt:'EXPERT',toolNames:['file.write','file.present']} ]));
  const sandbox=(await workspaces.getForUser('owner')).sandboxFS;
  const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('native image fixture')]);
  await sandbox.writeBinaryNew('photo.png',image);
  const orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,workspaces,db);
  const runs=new ChatRunService({db,orchestrator,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>({providerId:'test',modelId:'test',apiKey:'fixture'})});
  orchestrator.setExpertDispatchRunner(request=>runs.expertDispatch(request));
  const seen=new Set<string>();
  vi.mocked(callLLMWithToolsStream).mockImplementation(async(p:any)=>{
   const followup=p.messages.some((m:any)=>m.role==='user'&&m.content.includes('后台结果事件'));
   const stage=followup?'followup':p.messages[0].content.startsWith('EXPERT')?'expert':'main';
   expect(p.inputImages).toEqual([{mediaType:'image/png',data:image.toString('base64')}]);seen.add(stage);
   if(followup||p.messages.some((m:any)=>m.role==='tool'))return {content:'完成',toolCalls:[]};
   if(stage==='expert')return {content:'保存看图结果',toolCalls:[{id:'write',name:'file.write',arguments:{path:'result.md',content:'图片核对成果'}}]};
   return {content:'请专家看图',toolCalls:[{id:'dispatch',name:'x.dispatch_agent',arguments:{agent_id:'reader',goal:'读取原图'}}]};
  });
  const session=await db.createSession('owner'),parent=await runs.accept({userId:'owner',sessionId:session.id,requestId:'vision-parent',messages:[{role:'user',content:'请看图并核对专家结果'}],userMessage:{content:'请看图并核对专家结果',images:['photo.png']},providerId:'test',modelId:'test',systemPrompt:'MAIN',allowedToolNames:['x.dispatch_agent','file.write','file.present']});
  await runs.launch('owner',parent.id);
  const childId=(await runs.get('owner',parent.id)).expertRuns![0].id;await runs.wait(childId);
  expect((await runs.get('owner',childId)).status).toBe('completed');
  await runs.deliverExpertReturns();await runs.continueExpertReturns();
  const followupId=(await runs.get('owner',parent.id)).followupRunId!;expect(followupId).toBeTruthy();await runs.wait(followupId);
  expect((await runs.get('owner',followupId)).status).toBe('completed');
  expect([...seen].sort()).toEqual(['expert','followup','main']);
  const followup=await runs.get('owner',followupId);
  await runs.reviewRun('owner',followupId,{decision:'changes_requested',feedback:'请复核原图',expectedUpdatedAt:followup.updatedAt});
  const revision=await runs.revise('owner',followupId);await runs.wait(revision.id);
  expect((await runs.get('owner',revision.id)).status).toBe('completed');
  const saved=await db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[revision.id]);
  expect(JSON.parse(saved!.metadata_json).chatRun.imageInputs[0].path).toContain(`/runs/${revision.id}/`);
 }finally{sqlite.close();}
});
