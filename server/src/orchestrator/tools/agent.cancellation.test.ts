import { describe, expect, it, vi } from 'vitest';
import { createAgentHandlers } from './agent.js';
import {UncertainToolOutcomeError} from '../../tooling/UncertainToolOutcomeError.js';

describe('nested agent cancellation', () => {
  const records={x_agents:[{id:'first',name:'first'},{id:'second',name:'second'}],x_agent_teams:[{id:'team',name:'team',agentIds:['first','second']}],x_agent_groups:[{id:'group',name:'group',agentIds:['first','second']}]};
  const getConfig=async(_user:string,key:string)=>JSON.stringify(records[key as keyof typeof records]);
  it.each(['agent','team','group'] as const)('uses the saved parent authorization and preserves unknown outcomes for %s delegation',async kind=>{
    const unknown=new UncertainToolOutcomeError('external result unknown');
    const run=vi.fn(async()=>{throw unknown;});const native=vi.fn();const handlers=createAgentHandlers({resolveRunCustomAgentLoop:()=>native,resolveExpertDispatchRunner:()=>run});
    const context={userId:'user',runId:'parent',toolCallId:'call',getConfig,allowedToolNames:['file.read'],blockedToolNames:['file.write'],delegationDepth:2};
    const input={agent_id:'first',team_id:'team',group_id:'group',goal:'complete'};
    const handler=kind==='agent'?handlers.runAgentHandler:kind==='team'?handlers.runTeamHandler:handlers.runGroupHandler;
    await expect(handler(input,context)).rejects.toBe(unknown);
    expect(run).toHaveBeenCalledTimes(1);expect(native).not.toHaveBeenCalled();expect(run).toHaveBeenCalledWith(expect.objectContaining({userId:'user',parentRunId:'parent',toolCallId:'call',waitForResult:true}));
  });
  it.each([
    ['createAgentHandler',{name:'new',system_prompt:'work'}],
    ['updateAgentHandler',{agent_id:'first',name:'updated'}],
    ['createTeamHandler',{name:'team',agent_ids:['first']}],
    ['updateTeamHandler',{team_id:'team',name:'updated'}],
    ['createGroupHandler',{name:'group',agent_ids:['first']}],
    ['updateGroupHandler',{group_id:'group',name:'updated'}],
    ['addAgentsToGroupHandler',{group_id:'group',agent_ids:['second']}],
  ] as const)('waits for durable configuration before acknowledging %s',async(name,input)=>{
    let saved!:()=>void;const pending=new Promise<void>(resolve=>saved=resolve),setConfig=vi.fn(async()=>pending);
    const handlers=createAgentHandlers({resolveRunCustomAgentLoop:()=>undefined});let settled=false;
    const result=(handlers[name] as (input:unknown,ctx:unknown)=>Promise<unknown>)(input,{userId:'user',getConfig,setConfig}).finally(()=>{settled=true;});
    await vi.waitFor(()=>expect(setConfig).toHaveBeenCalled());expect(settled).toBe(false);saved();await result;
    await expect((handlers[name] as (input:unknown,ctx:unknown)=>Promise<unknown>)(input,{userId:'user',getConfig,setConfig:async()=>{throw new Error('write result lost');}})).rejects.toBeInstanceOf(UncertainToolOutcomeError);
  });
  it('does not acknowledge a waiting group before its durable runner settles',async()=>{
    let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>finish=resolve),runner=vi.fn(()=>pending),native=vi.fn(),setConfig=vi.fn();
    const handlers=createAgentHandlers({resolveRunCustomAgentLoop:()=>native,resolveExpertDispatchRunner:()=>runner});let settled=false;
    const result=handlers.runGroupHandler({group_id:'group',goal:'work'},{userId:'user',runId:'parent',toolCallId:'call',getConfig,setConfig}).finally(()=>settled=true);
    await vi.waitFor(()=>expect(runner).toHaveBeenCalled());expect(settled).toBe(false);finish({ok:true,results:[]});await result;
    expect(native).not.toHaveBeenCalled();expect(setConfig).not.toHaveBeenCalled();
  });
  it.each(['runAgentHandler','runTeamHandler','runGroupHandler'] as const)('refuses an unrecorded %s without a native fallback',async name=>{
    const native=vi.fn(),handlers=createAgentHandlers({resolveRunCustomAgentLoop:()=>native});
    await expect(handlers[name]({goal:'work'},{userId:'user',getConfig})).rejects.toThrow('工作记录');expect(native).not.toHaveBeenCalled();
  });
  it('passes the parent signal and does not continue a team after cancellation', async () => {
    const controller = new AbortController();
    const run = vi.fn(async (params) => { expect(params.signal).toBe(controller.signal); controller.abort(); throw new DOMException('stopped', 'AbortError'); });
    const handlers = createAgentHandlers({ resolveRunCustomAgentLoop: () => undefined,resolveExpertDispatchRunner:()=>run });
    const getConfig = vi.fn(async (_user, key) => JSON.stringify(key === 'x_agent_teams'
      ? [{ id: 'team', name: 'team', agentIds: ['first', 'second'] }]
      : [{ id: 'first', name: 'first' }, { id: 'second', name: 'second' }]));
    await expect(handlers.runTeamHandler({ team_id: 'team', goal: 'complete' }, { userId: 'user',runId:'parent',toolCallId:'call', getConfig, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
