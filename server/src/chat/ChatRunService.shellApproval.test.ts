import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { shellApprovalRequest, ShellApprovalRequiredError, ShellExecutionDeniedError } from '../tooling/shellApproval.js';
import { createShellRunHandler } from '../orchestrator/tools/shell/run.js';
import { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { AuditLogger } from '../observability/AuditLogger.js';
import { ChatRunService } from './ChatRunService.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
import { SandboxShell } from '../tooling/SandboxShell.js';

async function fixture() {
  const root=await mkdtemp(path.join(os.tmpdir(),'shell-consent-')),native=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(native),sandbox=new SandboxFS(root);
  await sandbox.init();await db.ensureUser('owner');await db.ensureUser('other');
  const orchestrator=new AgentOrchestrator(new AuditLogger(),sandbox,undefined,db);
  const handler=createShellRunHandler({resolveFS:async()=>sandbox} as never);
  const loop=vi.spyOn(orchestrator,'runChatAgentLoop').mockImplementation(async params=>{
    if(params.messages.some(message=>message.role==='tool'))return {content:'命令回执已核对',stopReason:'completed'};
    const calls=[{id:'shell-call',name:'shell.run',arguments:{command:'printf tick >> approved.txt'}},{id:'unstarted',name:'file.write',arguments:{path:'must-not-exist.txt',content:'no'}}];
    await params.onCheckpoint?.([...params.messages,{role:'assistant',content:'',tool_calls:calls}]);
    await params.onToolEvent?.({type:'tool_start',id:'shell-call',toolName:'shell.run',input:calls[0].arguments});
    await handler(calls[0].arguments,{userId:'owner',runId:params.runId,toolCallId:'shell-call',signal:params.signal});
    throw new Error('unapproved command must never execute');
  });
  const executed=vi.spyOn(orchestrator,'runApprovedShell');
  const make=(database=db)=>new ChatRunService({db:database,orchestrator,getSandboxFS:async()=>sandbox,getLLMConfig:async()=>({providerId:'test',modelId:'test',apiKey:'fixture-only'})});
  const runs=make(),session=await db.createSession('owner','命令确认');
  const run=await runs.accept({userId:'owner',sessionId:session.id,requestId:'consent',providerId:'test',modelId:'test',messages:[{role:'user',content:'写一份测试结果'}],systemPrompt:'test',allowedToolNames:['shell.run']});
  await runs.launch('owner',run.id);const pending=await runs.get('owner',run.id);
  const decision={approvalId:pending.shellApproval!.id,hash:pending.shellApproval!.hash,expectedUpdatedAt:pending.updatedAt,decision:'approve'};
  return {root,native,db,sandbox,orchestrator,loop,executed,make,runs,pending,decision};
}

describe('durable, exact-command Shell approvals',()=>{
  it('revokes a stopped pending command so stale approval cannot restart it',async()=>{
    const f=await fixture();try{
      const stopped=await f.runs.stop('owner',f.pending.id);expect(stopped.shellApproval?.status).toBe('rejected');await expect(f.runs.decideShell('owner',f.pending.id,f.decision)).rejects.toThrow('已变化');expect(f.executed).not.toHaveBeenCalled();
    }finally{f.native.close();}
  });
  it('lets a later stop win between consent persistence and execution admission',async()=>{
    const f=await fixture(),other=f.make(),resume=f.runs.resume.bind(f.runs);try{
      vi.spyOn(f.runs,'resume').mockImplementationOnce(async(user,id,options)=>{await other.stop(user,id);return resume(user,id,options);});
      await expect(f.runs.decideShell('owner',f.pending.id,f.decision)).rejects.toThrow('确认已失效');expect(f.executed).not.toHaveBeenCalled();expect(await f.sandbox.exists('approved.txt')).toBe(false);
    }finally{f.native.close();}
  });
  it('reports revoked permissions as definitely unexecuted, without treating them as a lost receipt',async()=>{
    const f=await fixture();try{
      f.executed.mockRejectedValueOnce(new ShellExecutionDeniedError('无权，尚未执行'));await f.runs.decideShell('owner',f.pending.id,f.decision);await f.runs.wait(f.pending.id);
      const result=await f.runs.get('owner',f.pending.id);expect(result.error).toContain('尚未执行');expect(result.error).not.toContain('结果未知');expect(await f.sandbox.exists('approved.txt')).toBe(false);
    }finally{f.native.close();}
  });
  it('preserves unknown command transport outcomes and forbids replay',async()=>{
    const f=await fixture();try{
      f.executed.mockRejectedValueOnce(new UncertainToolOutcomeError('回执丢失'));
      await f.runs.decideShell('owner',f.pending.id,f.decision);await f.runs.wait(f.pending.id);
      const result=await f.runs.get('owner',f.pending.id);expect(result.canResume).toBe(false);expect(result.error).toContain('结果未知');await expect(f.runs.resume('owner',f.pending.id)).rejects.toThrow('结果未知');expect(f.executed).toHaveBeenCalledTimes(1);
    }finally{f.native.close();}
  });
  it('does not execute while waiting, cannot resume around consent, and rejects forged arguments',async()=>{
    const f=await fixture();try{
      expect(f.pending.status).toBe('blocked');expect(f.pending.canResume).toBe(false);expect(await f.sandbox.exists('approved.txt')).toBe(false);
      expect((await f.runs.attention('owner')).some(item=>item.sourceId===f.pending.id)).toBe(true);
      await expect(f.runs.resume('owner',f.pending.id)).rejects.toThrow('不能恢复');
      await expect(f.runs.decideShell('other',f.pending.id,f.decision)).rejects.toThrow();
      await expect(f.runs.decideShell('owner',f.pending.id,{...f.decision,hash:'forged'})).rejects.toThrow('已变化');
      await expect(f.runs.decideShell('owner',f.pending.id,{...f.decision,expectedUpdatedAt:0})).rejects.toThrow('已变化');
      expect(f.executed).not.toHaveBeenCalled();expect(await f.sandbox.exists('must-not-exist.txt')).toBe(false);
    }finally{f.native.close();}
  });
  it('uses only the stored command, dispatches once and preserves a durable result across restart',async()=>{
    const f=await fixture();try{
      await f.runs.decideShell('owner',f.pending.id,{...f.decision,command:'printf bad > wrong.txt'} as never);await f.runs.wait(f.pending.id);
      expect(await f.sandbox.read('approved.txt')).toBe('tick');expect(await f.sandbox.exists('wrong.txt')).toBe(false);expect(f.executed).toHaveBeenCalledTimes(1);
      const restored=await f.make().get('owner',f.pending.id);expect(restored.status).toBe('completed');expect(restored.shellApproval?.status).toBe('completed');
      await expect(f.runs.decideShell('owner',f.pending.id,f.decision)).rejects.toThrow();expect(await f.sandbox.read('approved.txt')).toBe('tick');
    }finally{f.native.close();}
  });
  it('rejects without executing and leaves discussion resumable',async()=>{
    const f=await fixture();try{
      const denied=await f.runs.decideShell('owner',f.pending.id,{...f.decision,decision:'reject'});expect(denied.shellApproval?.status).toBe('rejected');expect(denied.canResume).toBe(true);
      expect((await f.db.getNotifications('owner',{limit:10,includeRead:true})).find(notice=>notice.id===`shell-approval-${f.pending.shellApproval!.id}`)?.read).toBeTruthy();
      await f.runs.resume('owner',f.pending.id);await f.runs.wait(f.pending.id);expect(f.executed).not.toHaveBeenCalled();expect(await f.sandbox.exists('approved.txt')).toBe(false);
    }finally{f.native.close();}
  });
  it('allows only one concurrent decision from independent database connections',async()=>{
    const f=await fixture(),secondNative=new SqliteAppDatabase(f.root),other=f.make(new SqliteDatabaseAdapter(secondNative));try{
      const decisions=await Promise.allSettled([f.runs.decideShell('owner',f.pending.id,f.decision),other.decideShell('owner',f.pending.id,f.decision)]);
      expect(decisions.filter(result=>result.status==='fulfilled')).toHaveLength(1);await Promise.all([f.runs.wait(f.pending.id),other.wait(f.pending.id)]);
      expect(f.executed).toHaveBeenCalledTimes(1);expect(await f.sandbox.read('approved.txt')).toBe('tick');
    }finally{secondNative.close();f.native.close();}
  });
  it('never automatically retries a crash after dispatch was marked started',async()=>{
    const f=await fixture();try{
      const row=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.pending.id]),metadata=JSON.parse(row!.metadata_json);
      metadata.chatRun.status='running';metadata.chatRun.shellApproval.status='executing';await f.db.run('UPDATE tasks SET status=?,metadata_json=? WHERE id=?',['running',JSON.stringify(metadata),f.pending.id]);
      const restarted=f.make(),unknown=await restarted.get('owner',f.pending.id);expect(unknown.canResume).toBe(false);expect(unknown.error).toContain('结果未知');
      await expect(restarted.resume('owner',f.pending.id)).rejects.toThrow('结果未知');expect(f.executed).not.toHaveBeenCalled();
    }finally{f.native.close();}
  });
  it('expires consent and rechecks permissions at actual dispatch',async()=>{
    const f=await fixture();try{
      const row=await f.db.queryOne<{metadata_json:string}>('SELECT metadata_json FROM tasks WHERE id=?',[f.pending.id]),metadata=JSON.parse(row!.metadata_json);
      metadata.chatRun.shellApproval.expiresAt=0;await f.db.run('UPDATE tasks SET metadata_json=? WHERE id=?',[JSON.stringify(metadata),f.pending.id]);
      await expect(f.runs.decideShell('owner',f.pending.id,f.decision)).rejects.toThrow('过期');expect(f.executed).not.toHaveBeenCalled();
      await expect(f.orchestrator.runApprovedShell({userId:'owner',runId:f.pending.id,toolCallId:'shell-call',signal:new AbortController().signal,approvedShellHash:f.decision.hash,input:{command:'printf no'},blockedToolNames:['shell.run']})).rejects.toThrow('无权');
    }finally{f.native.close();}
  });
});

describe('Shell approval hash binding',()=>{
  it('preserves unknown Docker outcomes through both Shell wrappers',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'shell-unknown-')),sandbox=new SandboxFS(root),execute=vi.fn(async()=>{throw new UncertainToolOutcomeError('lost receipt');});
    const runner=new SandboxShell(root,60000,{userId:'owner',useContainer:true,containerManager:{execInContainer:execute} as never});
    const handler=createShellRunHandler({resolveFS:async()=>sandbox,userSandboxManager:{getForUser:async()=>({sandboxFS:sandbox,sandboxShell:runner})}} as never);
    const context={userId:'owner',runId:'run',toolCallId:'call'},input={command:'printf no'};
    const proposal=await shellApprovalRequest(input,root,context,'container');
    await expect(handler(input,{...context,approvedShellHash:proposal.hash})).rejects.toBeInstanceOf(UncertainToolOutcomeError);expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not trust model-provided confirmation flags or hashes for changed parameters',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'shell-bind-')),sandbox=new SandboxFS(root),context={userId:'owner',runId:'run',toolCallId:'call'};
    const handler=createShellRunHandler({resolveFS:async()=>sandbox} as never),input={command:'printf ok > version.txt'};
    await expect(handler({...input,confirmed:true,approvedShellHash:'fake'},context)).rejects.toBeInstanceOf(ShellApprovalRequiredError);
    const proposal=await shellApprovalRequest(input,root,context);
    const containerProposal=await shellApprovalRequest(input,root,context,'container');
    expect(containerProposal.hash).not.toBe(proposal.hash);
    await expect(handler(input,{...context,approvedShellHash:containerProposal.hash})).rejects.toBeInstanceOf(ShellApprovalRequiredError);
    for(const change of [{command:'printf different > version.txt'},{timeout:5000}])await expect(handler({...input,...change},{...context,approvedShellHash:proposal.hash})).rejects.toBeInstanceOf(ShellApprovalRequiredError);
    expect(await sandbox.exists('version.txt')).toBe(false);
  });
});
