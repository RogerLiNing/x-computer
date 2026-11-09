import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { ChatRunService } from '../chat/ChatRunService.js';
import { RunOwnershipLostError } from '../chat/RunOwnershipStore.js';
import { ScheduledOccurrenceService } from '../scheduler/ScheduledOccurrenceService.js';
import { LivingAIKernel } from './LivingAIKernel.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'living-receipt-'));
  const first = new SqliteAppDatabase(root), second = new SqliteAppDatabase(root);
  const a = new SqliteDatabaseAdapter(first), b = new SqliteDatabaseAdapter(second), sandbox = new SandboxFS(path.join(root, 'files'));
  await mkdir(sandbox.getRoot());
  const content = JSON.stringify({ decision: 'idle', summary: 'SAVED_RECEIPT', goalProgress: 25, messageToUser: '本轮核查完成' });
  const loop = vi.fn(async (params: any) => { await params.onCheckpoint([...params.messages, {role: 'assistant', content}]); return { content, stopReason: 'completed' as const }; });
  const services = (db: SqliteDatabaseAdapter) => {
    const runs = new ChatRunService({ db, orchestrator: {runChatAgentLoop: loop}, getSandboxFS: async () => sandbox, getLLMConfig: async () => ({providerId:'test',modelId:'test'}) });
    const scheduler = new ScheduledOccurrenceService({db, getRuns: () => runs, getSystemPrompt: async () => '', getLLMConfig: async () => ({providerId:'test',modelId:'test'})});
    const credentials = vi.fn(async () => ({providerId:'test',modelId:'test'})), notify = vi.fn();
    const kernel = new LivingAIKernel({db, orchestrator:{getAllTasks:()=>[],runIntentAsPersistedTask:(input:Parameters<ScheduledOccurrenceService['run']>[0])=>scheduler.run(input)} as never, getLLMConfig:credentials, getSystemPrompt:async()=>'', notify, cancelCycles:user=>scheduler.cancelLivingCycles(user), resumeCycle:(user,source,revision,signal)=>scheduler.resumeLivingCycle(user,source,revision,signal)});
    return {runs,scheduler,kernel,credentials,notify};
  };
  const worker = services(a), replacement = services(b);
  const run = a.run.bind(a); let fail = true;
  vi.spyOn(a,'run').mockImplementation(async(sql,params)=>{
    if(fail&&sql.startsWith('UPDATE user_config SET value=?,updated_at=?')&&String(params?.[0]).includes('SAVED_RECEIPT')){fail=false;throw new RunOwnershipLostError('simulated kernel failure after durable result');}
    return run(sql,params);
  });
  await worker.kernel.updateConfig('owner',{quietHours:{enabled:false,startHour:23,endHour:7},allowLowRiskActions:false});
  return {a,b,worker,replacement,loop,close:async()=>{await worker.scheduler.wait();await replacement.scheduler.wait();first.close();second.close();}};
}

it('recovers a completed original run without another model call or cycle increment',async()=>{
  const f=await fixture();try{
    await f.worker.kernel.runCycle('owner');
    const pending=JSON.parse((await f.a.getConfig('owner','living_ai_state_v1'))!);
    expect(pending.pendingCycle.sourceId).toBeTruthy();expect(pending.episodes).toHaveLength(0);
    const records=await f.worker.scheduler.list('owner');expect(records).toHaveLength(1);
    const recovered=(await f.replacement.kernel.runCycle('owner')).state;
    expect(f.loop).toHaveBeenCalledTimes(1);expect(f.replacement.credentials).not.toHaveBeenCalled();
    expect(recovered.cycleCount).toBe(pending.cycleCount);expect(recovered.lastAction).toBe('SAVED_RECEIPT');expect(recovered.episodes).toHaveLength(1);
    expect(JSON.parse((await f.b.getConfig('owner','living_ai_state_v1'))!).pendingCycle).toBeUndefined();
    expect((await f.replacement.scheduler.list('owner'))[0].run_id).toBe(records[0].run_id);expect(f.replacement.notify).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
});

it('does not overwrite a user goal edit racing with receipt commit',async()=>{
  const f=await fixture();try{
    await f.worker.kernel.runCycle('owner');const run=f.b.run.bind(f.b);let edited=false;
    vi.spyOn(f.b,'run').mockImplementation(async(sql,params)=>{
      if(!edited&&sql.startsWith('UPDATE user_config SET value=?,updated_at=?')&&String(params?.[0]).includes('SAVED_RECEIPT')){
        edited=true;const latest=JSON.parse((await f.a.getConfig('owner','living_ai_state_v1'))!);latest.goals.find((goal:any)=>goal.id===latest.pendingCycle.goalId).description='USER_EDIT';await f.a.setConfig('owner','living_ai_state_v1',JSON.stringify(latest));
      }return run(sql,params);
    });
    await f.replacement.kernel.runCycle('owner');
    const latest=JSON.parse((await f.b.getConfig('owner','living_ai_state_v1'))!);
    expect(edited).toBe(true);expect(latest.goals.some((goal:any)=>goal.description==='USER_EDIT')).toBe(true);expect(latest.episodes).toHaveLength(0);expect(latest.pendingCycle).toBeTruthy();expect(f.replacement.notify).not.toHaveBeenCalled();
    await f.replacement.kernel.runCycle('owner');expect(f.loop).toHaveBeenCalledTimes(1);
    expect((await f.replacement.kernel.getStatus('owner')).state.goals.some(goal=>goal.description==='USER_EDIT')).toBe(true);
  }finally{await f.close();}
});

it('preserves a paused original task instead of creating a replacement',async()=>{
  const f=await fixture();let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  f.loop.mockImplementationOnce(async(params:any)=>{entered();await new Promise<void>(resolve=>params.signal.addEventListener('abort',()=>resolve(),{once:true}));return{content:'',stopReason:'completed'};});
  let cycle:Promise<unknown>|undefined;
  try{
    cycle=f.worker.kernel.runCycle('owner');await started;
    const row=(await f.worker.scheduler.list('owner'))[0];await f.worker.runs.stop('owner',row.run_id!);await cycle;
    await f.replacement.kernel.runCycle('owner');expect(f.loop).toHaveBeenCalledTimes(1);expect(await f.b.getAllTasks()).toHaveLength(1);
    expect((await f.replacement.runs.get('owner',row.run_id!)).status).toBe('paused');
  }finally{await cycle;await f.close();}
});

it('keeps user goals when model fields have unexpected JSON types',async()=>{
  const f=await fixture();vi.mocked(f.a.run).mockRestore();
  f.loop.mockImplementationOnce(async(params:any)=>{
    await f.replacement.kernel.addGoal('owner',{title:'USER_ADDED_WHILE_RUNNING'});
    const content=JSON.stringify({decision:'idle',summary:42,reflection:[],messageToUser:4,completeGoal:'false',newGoal:{title:99}});
    await params.onCheckpoint([...params.messages,{role:'assistant',content}]);return{content,stopReason:'completed'};
  });
  try{
    const state=(await f.worker.kernel.runCycle('owner')).state;
    expect(state.goals.some(goal=>goal.title==='USER_ADDED_WHILE_RUNNING')).toBe(true);
    expect(state.goals.some(goal=>goal.status==='completed')).toBe(false);expect(state.episodes).toHaveLength(1);expect(f.worker.notify).not.toHaveBeenCalled();
  }finally{await f.close();}
});

it('ordinary execution errors update only the latest state and preserve concurrent user goals',async()=>{
  const f=await fixture();vi.mocked(f.a.run).mockRestore();
  f.loop.mockImplementationOnce(async()=>{await f.replacement.kernel.addGoal('owner',{title:'USER_GOAL_DURING_FAILURE'});throw new Error('provider fixture failure');});
  try{
    const state=(await f.worker.kernel.runCycle('owner')).state;
    expect(state.goals.some(goal=>goal.title==='USER_GOAL_DURING_FAILURE')).toBe(true);
    expect(state.phase).toBe('error');await f.replacement.kernel.runCycle('owner');expect(f.loop).toHaveBeenCalledTimes(1);expect(await f.b.getAllTasks()).toHaveLength(1);
  }finally{await f.close();}
});

it('does not automatically redispatch a legacy acting cycle without a checkpoint',async()=>{
  const f=await fixture();try{
    const state=(await f.worker.kernel.getStatus('owner')).state;state.phase='acting';state.cycleCount=7;
    await f.a.setConfig('owner','living_ai_state_v1',JSON.stringify(state));
    await f.replacement.kernel.runCycle('owner');await f.replacement.kernel.runCycle('owner');
    expect(f.loop).not.toHaveBeenCalled();expect((await f.replacement.kernel.getStatus('owner')).state.cycleCount).toBe(7);expect(await f.b.getAllTasks()).toEqual([]);
  }finally{await f.close();}
});

it('retains the same cycle when a crash occurs before creating the background occurrence',async()=>{
  const f=await fixture();try{
    vi.spyOn(f.worker.scheduler,'run').mockRejectedValueOnce(new RunOwnershipLostError('before journaling'));
    await f.worker.kernel.runCycle('owner');const before=JSON.parse((await f.a.getConfig('owner','living_ai_state_v1'))!);
    expect(before.pendingCycle).toBeTruthy();expect(await f.a.getAllTasks()).toHaveLength(0);expect(f.loop).not.toHaveBeenCalled();
    const after=(await f.replacement.kernel.runCycle('owner')).state;
    expect(after.cycleCount).toBe(before.cycleCount);expect(after.goals.find(goal=>goal.id===before.pendingCycle.goalId)?.attemptCount).toBe(before.goals.find((goal:any)=>goal.id===before.pendingCycle.goalId).attemptCount);
    expect(f.loop).toHaveBeenCalledTimes(1);expect(await f.b.getAllTasks()).toHaveLength(1);expect(after.episodes).toHaveLength(1);
  }finally{await f.close();}
});
