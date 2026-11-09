import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { ChatRunService } from '../chat/ChatRunService.js';
import { ScheduledOccurrenceService, type ChannelReplyAddress } from './ScheduledOccurrenceService.js';
import { SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { setBroadcastToUser } from '../wsBroadcast.js';
const digest = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(),'channel-scope-')), first = new SqliteAppDatabase(root), second = new SqliteAppDatabase(root);
  const db = new SqliteDatabaseAdapter(first), other = new SqliteDatabaseAdapter(second); await db.ensureUser('owner');
  let account = 'A'; const emitted: Array<{account:string;text:string}> = [];
  const loop = vi.fn(async (p: any) => ({content:'答复：'+p.messages.at(-1).content,stopReason:'completed'}));
  const createRuns = () => new ChatRunService({db,orchestrator:{runChatAgentLoop:loop} as never,getSandboxFS:async()=>new SandboxFS(root),getLLMConfig:async()=>({providerId:'fixture',modelId:'fixture'})});
  const runs = createRuns();
  const validate = async (_uid:string,address:ChannelReplyAddress) => { if (!address.accountId || address.legacyUnbound || address.accountId!==account) throw new SendExecutionDeniedError('账号未就绪，尚未回复'); };
  const sender = vi.fn(async (uid:string,address:ChannelReplyAddress,text:string,assertActive?:()=>Promise<void>) => { await validate(uid,address);await assertActive?.(); emitted.push({account,text});return true; });
  const make = (connection=db) => new ScheduledOccurrenceService({db:connection,getRuns:()=>runs,getSystemPrompt:async()=>'',getLLMConfig:async()=>({providerId:'fixture',modelId:'fixture'}),validateChannelReply:validate,sendChannelReply:sender});
  const service = make(), address = (acct=account):ChannelReplyAddress => ({channel:'telegram',target:'same-peer',accountId:acct,sourceScope:acct,configDigest:'fixture-config'});
  return {db,other,runs,createRuns,service,make,address,loop,sender,emitted,setAccount:(next:string)=>{account=next;},close:async()=>{await service.wait();first.close();second.close();}};
}
const waitStatus = async(f:Awaited<ReturnType<typeof fixture>>,status:string,count=1) => vi.waitFor(async()=>expect((await f.service.list('owner')).filter(row=>row.status===status)).toHaveLength(count));
it('retains channel work while background autostart is paused, then recovers it once',async()=>{
  vi.stubEnv('X_COMPUTER_BACKGROUND_AUTOSTART','false');const f=await fixture();try{
    const recovery=vi.spyOn(f.service,'recover');
    await f.service.enqueueChannel('owner','paused-startup','A_PRIVATE',f.address('A'));
    const [saved]=await f.service.list('owner');expect(saved.status).toBe('queued');
    expect(recovery).not.toHaveBeenCalled();expect(f.loop).not.toHaveBeenCalled();expect(f.sender).not.toHaveBeenCalled();
    vi.stubEnv('X_COMPUTER_BACKGROUND_AUTOSTART','true');await f.service.recover();await waitStatus(f,'completed');
    expect((await f.service.list('owner'))[0].id).toBe(saved.id);expect(f.loop).toHaveBeenCalledOnce();expect(f.sender).toHaveBeenCalledOnce();
  }finally{await f.close();vi.unstubAllEnvs();}
});
it('separates equal message IDs and conversation history across accounts',async()=>{
  const f=await fixture();try{
    await f.service.enqueueChannel('owner','same-id','A_PRIVATE',f.address('A'));await waitStatus(f,'completed');
    f.setAccount('B');await f.service.enqueueChannel('owner','same-id','B_PRIVATE',f.address('B'));await waitStatus(f,'completed',2);
    expect(f.loop.mock.calls[1][0].messages).toEqual([{role:'user',content:'B_PRIVATE'}]);
    await f.service.enqueueChannel('owner','second-id','B_NEXT',f.address('B'));await waitStatus(f,'completed',3);
    const history=JSON.stringify(f.loop.mock.calls[2][0].messages);expect(history).toContain('B_PRIVATE');expect(history).not.toContain('A_PRIVATE');
    expect(f.emitted.map(row=>row.account)).toEqual(['A','B','B']);
  }finally{await f.close();}
});
it('parks before the model while the wrong account is active, then resumes the same occurrence',async()=>{
  const f=await fixture();try{
    f.setAccount('B');await f.service.enqueueChannel('owner','blocked','A_PRIVATE',f.address('A'));await waitStatus(f,'needs_attention');
    expect(f.loop).not.toHaveBeenCalled();expect(f.sender).not.toHaveBeenCalled();
    f.setAccount('A');await f.service.recover();await waitStatus(f,'completed');expect(f.loop).toHaveBeenCalledOnce();expect(f.emitted).toEqual([{account:'A',text:'答复：A_PRIVATE'}]);
    expect(await f.service.list('owner')).toHaveLength(1);
  }finally{await f.close();}
});
it('keeps automatic channel replies out of the workbench and human acceptance queue',async()=>{
  const f=await fixture();try{
    await f.service.enqueueChannel('owner','plain-reply','请整理一句回答，不要写入长期记忆',f.address());await waitStatus(f,'completed');
    const row=(await f.service.list('owner'))[0], run=await f.runs.get('owner',row.run_id!);
    expect(run.review).toBeUndefined();
    expect(await f.runs.workbench('owner')).toMatchObject({active:[],finished:[],attention:[]});
    expect(await f.createRuns().workbench('owner')).toMatchObject({active:[],finished:[],attention:[]});
    await expect(f.runs.reviewRun('owner',run.id,{decision:'changes_requested',feedback:'不应退回自动回复',expectedUpdatedAt:run.updatedAt})).rejects.toThrow('自动回复无需验收');
    expect(f.emitted).toHaveLength(1);
  }finally{await f.close();}
});
it('resolves the attention notice when an unsent channel occurrence is cancelled',async()=>{
  const f=await fixture();try{
    f.setAccount('B');await f.service.enqueueChannel('owner','cancel-waiting','A_PRIVATE',f.address('A'));await waitStatus(f,'needs_attention');
    const [row]=await f.service.list('owner');await f.service.cancel('owner',row.id);
    expect(await f.db.getNotifications('owner')).toEqual([]);
    expect((await f.db.getNotifications('owner',{includeRead:true}))[0].read).toBeTruthy();
    f.setAccount('A');await f.service.recover();expect(f.sender).not.toHaveBeenCalled();expect(f.loop).not.toHaveBeenCalled();
    expect((await f.service.list('owner'))[0].status).toBe('cancelled');
  }finally{await f.close();}
});
it('retains a prepared result after switching accounts and recovers it through another database connection',async()=>{
  const published=vi.fn();setBroadcastToUser(published);
  const f=await fixture();let release!:()=>void;let entered!:()=>void;const begun=new Promise<void>(resolve=>{entered=resolve;});
  f.loop.mockImplementationOnce(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return {content:'A_READY_RESULT',stopReason:'completed'};});
  try{
    await f.service.enqueueChannel('owner','during-model','A_PRIVATE',f.address('A'));await begun;f.setAccount('B');release();await f.service.wait();await waitStatus(f,'needs_attention');
    expect(f.emitted).toEqual([]);expect((await f.db.queryOne<{status:string}>('SELECT status FROM channel_reply_receipts'))?.status).toBe('not_sent');
    const workbench=await f.runs.workbench('owner');expect(workbench.finished).toEqual([]);
    expect(workbench.attention).toEqual([expect.objectContaining({source:'notification',title:'渠道消息需要你处理'})]);
    const occurrence=(await f.service.list('owner'))[0];
    expect(workbench.attention[0]).toMatchObject({link:`app:scheduled-run:${occurrence.id}`,detail:expect.stringContaining('恢复原渠道账号')});
    f.setAccount('A');await f.make(f.other).recover();await waitStatus(f,'completed');expect(f.loop).toHaveBeenCalledOnce();expect(f.emitted).toEqual([{account:'A',text:'A_READY_RESULT'}]);
    expect(await f.db.getNotifications('owner')).toEqual([]);
    expect(published).toHaveBeenCalledWith('owner',expect.objectContaining({type:'notification_updated'}));
  }finally{release?.();await f.close();setBroadcastToUser(()=>{});}
});
it('never retries a reply with an unknown transport outcome',async()=>{
  const f=await fixture();try{
    f.sender.mockImplementationOnce(async()=>{throw new Error('response lost');});await f.service.enqueueChannel('owner','unknown','text',f.address());await vi.waitFor(()=>expect(f.sender).toHaveBeenCalledOnce());await f.service.wait();
    await f.service.recover();await f.service.recover();expect(f.sender).toHaveBeenCalledOnce();expect((await f.db.queryOne<{status:string}>('SELECT status FROM channel_reply_receipts'))?.status).toBe('unknown');
    const [row]=await f.service.list('owner');expect(row).toMatchObject({status:'completed',replyStatus:'unknown'});
    expect((await f.db.getNotifications('owner'))[0]).toMatchObject({link:`app:scheduled-run:${row.id}`,body:expect.stringContaining('暂时别再发一次')});
  }finally{await f.close();}
});
it('persists the unknown-delivery warning before resolving the account warning',async()=>{
  const f=await fixture();try{
    f.setAccount('B');await f.service.enqueueChannel('owner','unknown-after-wait','A_PRIVATE',f.address('A'));await waitStatus(f,'needs_attention');
    const write=f.db.run.bind(f.db);let fail=true;
    const stored=vi.spyOn(f.db,'run').mockImplementation(async(sql,args)=>{
      if(fail&&sql.includes('INTO notifications')&&args?.[2]==='渠道回复未确认'){fail=false;throw new Error('notification persistence unavailable');}
      return write(sql,args);
    });
    f.sender.mockImplementationOnce(async()=>{throw new Error('transport receipt lost');});
    f.setAccount('A');await f.service.recover();await vi.waitFor(()=>expect(f.sender).toHaveBeenCalledOnce());await f.service.wait();
    expect(await f.db.getNotifications('owner')).toEqual([expect.objectContaining({title:'渠道消息需要你处理'})]);
    stored.mockRestore();await f.service.recover();
    expect(await f.db.getNotifications('owner')).toEqual([expect.objectContaining({title:'渠道回复未确认'})]);
    expect(f.sender).toHaveBeenCalledOnce();expect(f.loop).toHaveBeenCalledOnce();
  }finally{await f.close();}
});
it('does not recreate a dismissed attention notice when the same prepared reply is parked again',async()=>{
  const f=await fixture();let release!:()=>void;let entered!:()=>void;
  const begun=new Promise<void>(resolve=>{entered=resolve;});
  f.loop.mockImplementationOnce(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return {content:'A_READY_RESULT',stopReason:'completed'};});
  try{
    f.setAccount('B');await f.service.enqueueChannel('owner','dismissed-notice','A_PRIVATE',f.address('A'));await waitStatus(f,'needs_attention');
    const notices=await f.db.getNotifications('owner');expect(notices).toHaveLength(1);
    await f.db.deleteNotification(notices[0].id,'owner');
    f.setAccount('A');await f.service.recover();await begun;
    f.setAccount('B');release();await f.service.wait();await waitStatus(f,'needs_attention');
    await f.service.recover();expect(await f.db.getNotifications('owner',{includeRead:true})).toEqual([]);
    f.setAccount('A');await f.service.recover();await waitStatus(f,'completed');
    expect(f.loop).toHaveBeenCalledOnce();expect(f.emitted).toEqual([{account:'A',text:'A_READY_RESULT'}]);
    expect(await f.db.getNotifications('owner',{includeRead:true})).toEqual([]);
  }finally{release?.();await f.close();}
});
it('quarantines a scoped replay of a legacy message without changing its historical row',async()=>{
  const f=await fixture();try{
    await f.service.recover();const id=digest(['owner','telegram','same-peer',undefined,undefined,'legacy-id']);
    await f.db.run("INSERT INTO scheduled_occurrences(id,user_id,job_id,scheduled_at,job_json,status,created_at) VALUES(?,?,?,?,?,'completed',?)",[id,'owner','channel:legacy',1,JSON.stringify({id:'legacy',userId:'owner',intent:'old',runAt:1,createdAt:1,channelReply:{channel:'telegram',target:'same-peer',configDigest:'old'}}),1]);
    const original=await f.db.queryOne('SELECT * FROM scheduled_occurrences WHERE id=?',[id]);
    expect((await f.service.list('owner')).find(row=>row.id===id)).toMatchObject({status:'completed',replyStatus:'unknown'});
    expect(await f.db.queryOne('SELECT * FROM scheduled_occurrences WHERE id=?',[id])).toEqual(original);
    await f.service.enqueueChannel('owner','legacy-id','new',f.address());await waitStatus(f,'needs_attention');
    expect(f.loop).not.toHaveBeenCalled();expect(f.sender).not.toHaveBeenCalled();expect((await f.db.queryOne<{status:string}>('SELECT status FROM scheduled_occurrences WHERE id=?',[id]))?.status).toBe('completed');
  }finally{await f.close();}
});
it('fences cancellation after the reply claim and before transport',async()=>{
  const f=await fixture();try{
    f.sender.mockImplementationOnce(async(_u,_a,_text,check)=>{const row=(await f.service.list('owner'))[0];await f.service.cancel('owner',row.id);await check?.();return true;});
    await f.service.enqueueChannel('owner','cancel','text',f.address());await vi.waitFor(()=>expect(f.sender).toHaveBeenCalledOnce());await f.service.wait();await f.service.recover();
    expect(f.emitted).toEqual([]);expect(f.sender).toHaveBeenCalledOnce();expect((await f.service.list('owner'))[0].cancelled).toBe(1);
  }finally{await f.close();}
});
