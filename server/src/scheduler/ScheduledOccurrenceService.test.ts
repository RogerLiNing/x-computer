import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { ChatRunService } from '../chat/ChatRunService.js';
import { ScheduledOccurrenceService } from './ScheduledOccurrenceService.js';
import {setBroadcastToUser} from '../wsBroadcast.js';
import { XScheduler, setDefaultScheduler, type ScheduledJob } from './XScheduler.js';
import { ToolExecutor } from '../orchestrator/ToolExecutor.js';
import{LivingAIKernel}from'../living-ai/LivingAIKernel.js';
import{LivingAIControlStore}from'../living-ai/LivingAIControlStore.js';

describe('durable scheduled occurrences with real SQLite connections', () => {
  let sqliteA: SqliteAppDatabase; let sqliteB: SqliteAppDatabase;
  let dbA: SqliteDatabaseAdapter; let dbB: SqliteDatabaseAdapter; let sandbox: SandboxFS;
  const pending: Promise<unknown>[] = []; const releases: Array<() => void> = [];
  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'scheduled-occurrences-'));
    sqliteA = new SqliteAppDatabase(root); sqliteB = new SqliteAppDatabase(root);
    dbA = new SqliteDatabaseAdapter(sqliteA); dbB = new SqliteDatabaseAdapter(sqliteB);
    sandbox = new SandboxFS(path.join(root, 'files')); await mkdir(sandbox.getRoot());
  });
  afterEach(async () => {
    setDefaultScheduler(null);
    setBroadcastToUser(() => {});
    for (const release of releases.splice(0)) release();
    await Promise.allSettled(pending.splice(0)); sqliteA.close(); sqliteB.close();
  });
  function services(db: SqliteDatabaseAdapter, loop = vi.fn(async params => {
    await params.onCheckpoint([...params.messages, { role: 'assistant', content: '完成' }]);
    return { content: '完成', stopReason: 'completed' };
  }), sendChannelReply?: (userId: string, address: unknown, text: string) => Promise<boolean>) {
    const runs = new ChatRunService({ db, orchestrator: { runChatAgentLoop: loop } as never,
      getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'test', modelId: 'test', apiKey: 'private-key' }) });
    const service = new ScheduledOccurrenceService({ db, getRuns: () => runs, getSystemPrompt: async () => 'test', sendChannelReply, validateChannelReply: async () => {},
      getLLMConfig: async () => ({ providerId: 'test', modelId: 'test', apiKey: 'private-key' }) });
    return { runs, service, loop };
  }
  async function job(fields: Partial<ScheduledJob> = {}) {
    const value: ScheduledJob = { id: 'plan', userId: 'owner', intent: '帮我整理任务', runAt: 100, createdAt: 1, ...fields };
    await dbA.insertScheduledJob({ id: value.id, user_id: value.userId, intent: value.intent, run_at: value.runAt,
      cron: value.cron ?? null, created_at: value.createdAt, session_id: value.sessionId, scope_json: value.scopeJson });
    return value;
  }
  async function completed(service: ScheduledOccurrenceService) {
    await vi.waitFor(async () => expect((await service.list('owner'))[0]?.status).toBe('completed'));
  }
  it.each(['signal-cancel',''])('cancels a caller-owned active background occurrence without replaying it: %s',async(sourceId)=>{
    let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),controller=new AbortController();
    const a=services(dbA,vi.fn(async params=>{entered();await new Promise((_resolve,reject)=>params.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));return{content:'',stopReason:'completed'};}));
    const execution=a.service.run({userId:'owner',source:'event_driven',sourceId,intent:'test cancellation',llmConfig:{providerId:'test',modelId:'test'},systemPrompt:'',signal:controller.signal});
    const observed=execution.catch(error=>error);pending.push(observed);await started;controller.abort();expect((await observed).name).toBe('AbortError');await a.service.wait();
    const rows=await a.service.list('owner');expect(rows[0].cancelled).toBe(1);expect((await a.runs.get('owner',rows[0].run_id!)).status).toBe('paused');await a.service.recover();expect(a.loop).toHaveBeenCalledTimes(1);
  });
  it('rejects queued autonomous work while disabled and rejects the previous generation after re-enable',async()=>{
    const a=services(dbA),kernel=new LivingAIKernel({db:dbA,orchestrator:{getAllTasks:()=>[]} as never,getLLMConfig:async()=>null,getSystemPrompt:async()=>''});
    const state=(await kernel.getStatus('owner')).state,controls=new LivingAIControlStore(dbA),initial=await controls.initialize('owner',state.config);
    await controls.patch('owner',state.config,current=>({...current,enabled:false}));
    const input={userId:'owner',intent:'自主循环验收',title:'X 自主生命循环',source:'event_driven' as const,llmConfig:{providerId:'test',modelId:'test'},systemPrompt:'',metadata:{livingAI:true,livingAIRevision:initial.value.revision}};
    await expect(a.service.run({...input,sourceId:'disabled-cycle'})).rejects.toThrow('取消');
    await controls.patch('owner',state.config,current=>({...current,enabled:true}));
    await expect(a.service.run({...input,sourceId:'old-generation'})).rejects.toThrow('取消');
    expect(a.loop).not.toHaveBeenCalled();expect(await dbA.getAllTasks()).toEqual([]);
  });
  it('queues a channel message once, binds its reply and isolates each address and Slack thread', async () => {
    const send = vi.fn(async () => true);
    const a = services(dbA, undefined, send);
    const b = services(dbB, undefined, send);
    const slack = { channel: 'slack' as const, target: 'ROOM', thread: 'thread-a', configDigest: 'account', accountId: 'fixture-account' };
    await Promise.all([
      a.service.enqueueChannel('owner', 'message-one', '同行讨论', slack),
      b.service.enqueueChannel('owner', 'message-one', '同行讨论', slack),
    ]);
    await completed(a.service);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('owner', slack, '完成', expect.any(Function));
    expect(await a.service.list('owner')).toHaveLength(1);
    await expect(a.service.enqueueChannel('owner', 'message-one', '同行讨论', { ...slack, configDigest: 'replaced' })).rejects.toThrow('不一致');
    const first = a.loop.mock.calls[0]?.[0] ?? b.loop.mock.calls[0]?.[0];
    expect(first.allowedToolNames).toEqual([]);
    expect(first.messages).toEqual([{ role: 'user', content: '同行讨论' }]);

    const next = services(dbA, undefined, send);
    await next.service.enqueueChannel('owner', 'message-two', '继续解释', slack);
    await vi.waitFor(async () => expect((await next.service.list('owner')).filter(row => row.status === 'completed')).toHaveLength(2));
    expect(next.loop.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: '同行讨论' }, { role: 'assistant', content: '完成' }, { role: 'user', content: '继续解释' },
    ]);

    const other = services(dbB, undefined, send);
    const differentThread = { ...slack, thread: 'thread-b' };
    await other.service.enqueueChannel('owner', 'message-three', '不相关的群聊', differentThread);
    await vi.waitFor(async () => expect((await other.service.list('owner')).filter(row => row.status === 'completed')).toHaveLength(3));
    expect(other.loop.mock.calls[0][0].messages).toEqual([{ role: 'user', content: '不相关的群聊' }]);
    expect(send).toHaveBeenLastCalledWith('owner', differentThread, '完成', expect.any(Function));
    expect(await dbA.getNotifications('owner')).toEqual([]);
  });

  it('keeps a lost channel send receipt visible and never replays the send', async () => {
    const send = vi.fn(async () => { throw new Error('disconnect after send'); });
    const a = services(dbA, undefined, send);
    const address = { channel: 'telegram' as const, target: 'peer-a', configDigest: 'account', accountId: 'fixture-account' };
    await a.service.enqueueChannel('owner', 'message-1', '请帮我解释一道题', address);
    await completed(a.service);
    const [occurrence] = await a.service.list('owner');
    const [notice] = await dbA.getNotifications('owner');
    expect(notice).toMatchObject({ title: '渠道回复未确认', link: `app:scheduled-run:${occurrence.id}` });
    expect(occurrence.replyStatus).toBe('unknown');
    const b = services(dbB, undefined, send);
    await b.service.enqueueChannel('owner', 'message-1', '请帮我解释一道题', address);
    await b.service.recover();
    expect(send).toHaveBeenCalledOnce();
    expect(b.loop).not.toHaveBeenCalled();
    expect(await dbB.getNotifications('owner')).toHaveLength(1);
  });

  it('recovers a send claim left behind after the provider accepted the reply', async () => {
    const send = vi.fn(async () => true);
    const a = services(dbA, undefined, send);
    const run = dbA.run.bind(dbA);
    vi.spyOn(dbA, 'run').mockImplementation(async (sql, args) => {
      if (sql.startsWith('UPDATE channel_reply_receipts SET status=')) throw new Error('lost persistence after send');
      return run(sql, args);
    });
    const address = { channel: 'discord' as const, target: 'peer-b', configDigest: 'account', accountId: 'fixture-account' };
    await a.service.enqueueChannel('owner', 'message-2', '请帮我写一句问候', address);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await a.service.wait();
    expect((await a.service.list('owner'))[0]).toMatchObject({status:'attached',replyStatus:'sending'});
    const b = services(dbB, undefined, send);
    await b.service.recover();
    expect(send).toHaveBeenCalledOnce();
    expect(await dbB.getNotifications('owner')).toEqual([]);
    await dbB.run('UPDATE channel_reply_receipts SET started_at=0 WHERE user_id=?', ['owner']);
    await b.service.recover();
    await completed(b.service);
    expect((await b.service.list('owner'))[0]).toMatchObject({status:'completed',replyStatus:'unknown'});
    expect(send).toHaveBeenCalledOnce();
    expect(b.loop).not.toHaveBeenCalled();
    expect(await dbB.getNotifications('owner')).toEqual([expect.objectContaining({ title: '渠道回复未确认' })]);
  });

  it('two dispatchers enqueue and run only one occurrence and preserve the completed plan', async () => {
    const a = services(dbA); const b = services(dbB); const plan = await job();
    await Promise.all([a.service.queue(plan, null), b.service.queue(plan, null)]);
    await Promise.all([a.service.recover(), b.service.recover()]); await completed(a.service);
    expect(a.loop.mock.calls.length + b.loop.mock.calls.length).toBe(1);
    expect(await dbA.query('SELECT * FROM scheduled_occurrences')).toHaveLength(1);
    expect((await dbA.getAllScheduledJobs())[0].enabled).toBe(0);
    expect(await a.service.list('other')).toEqual([]);
    const tasks = await dbA.getAllTasks(); expect(tasks).toHaveLength(1);
    expect(tasks[0].metadata_json).not.toContain('private-key');
    const [occurrence] = await a.service.list('owner');
    expect((await a.runs.get('owner', occurrence.run_id!)).review?.status).toBe('pending');
    const notices = await dbB.getNotifications('owner', { includeRead: true });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: 'success', title: '定时交办做好了', link: `app:chat-session:${occurrence.execution_session_id}` });
    expect(await dbA.getNotifications('other')).toEqual([]);
    await dbA.markNotificationRead(notices[0].id, 'owner');
    await Promise.all([a.service.recover(), b.service.recover()]);
    expect(await dbA.getNotifications('owner', { includeRead: true })).toEqual([expect.objectContaining({ id: notices[0].id, read: 1 })]);
  });
  it('retries a completion notice after restart without running the model again', async () => {
    const a = services(dbA);
    await a.service.queue(await job(), null);
    const run = dbA.run.bind(dbA);
    vi.spyOn(dbA, 'run').mockImplementation(async (sql, args) => {
      if (sql.startsWith('INSERT OR IGNORE INTO notifications')) throw new Error('notice storage unavailable');
      return run(sql, args);
    });
    await a.service.recover();
    await a.service.wait();
    expect((await a.service.list('owner'))[0].status).toBe('attached');
    expect(await dbA.getNotifications('owner')).toEqual([]);

    const b = services(dbB);
    await b.service.recover();
    await completed(b.service);
    expect(a.loop).toHaveBeenCalledOnce();
    expect(b.loop).not.toHaveBeenCalled();
    expect(await dbB.getNotifications('owner')).toHaveLength(1);
  });
  it('links a pre-run problem to its own occurrence and keeps a read warning after recovery', async () => {
    const a = services(dbA);
    const published = vi.fn();
    setBroadcastToUser(published);
    await a.service.queue(await job({ scopeJson: 'invalid' }), null);
    await a.service.recover();
    const [occurrence] = await a.service.list('owner');
    expect(occurrence).toMatchObject({ status: 'needs_attention', run_id: null });
    const [notice] = await dbA.getNotifications('owner');
    expect(notice).toMatchObject({ type: 'warning', title: '定时交办需要你处理', link: `app:scheduled-run:${occurrence.id}` });
    expect(await a.service.list('other', occurrence.id)).toEqual([]);
    await dbA.markNotificationRead(notice.id, 'owner');
    const b = services(dbB);
    await b.service.recover();
    expect(await dbB.getNotifications('owner', { includeRead: true })).toEqual([expect.objectContaining({ id: notice.id, read: 1 })]);
    expect(published).toHaveBeenCalledOnce();
    expect(b.loop).not.toHaveBeenCalled();
  });

  it('journals the scheduler tool scope, then restores the same workspace and tools after restart', async () => {
    const scheduler = new XScheduler(async () => { throw new Error('Expected durable dispatch'); }, {
      loadAll: async () => (await dbB.getAllScheduledJobs()).filter(row => row.enabled).map(row => ({
        id: row.id, userId: row.user_id, intent: row.intent, runAt: row.run_at, createdAt: row.created_at,
        scopeJson: row.scope_json,
      })),
      save: async value => { await job(value); },
      updateRunAt: async () => {},
      remove: async () => {},
    });
    setDefaultScheduler(scheduler);
    const executor = new ToolExecutor();
    const workspace = { agentId: 'editor', agentRunId: 'original-run', delegationDepth: 2 };
    const allowedToolNames = ['x.schedule_run', 'file.present'];
    const blockedToolNames = ['file.write'];
    const step = {
      id: 'schedule', taskId: 'parent', toolName: 'x.schedule_run', action: 'x.schedule_run',
      status: 'pending' as const, riskLevel: 'low' as const,
      toolInput: { intent: '提供现有成果 existing.md', at: Date.now(), allowedToolNames: ['file.write'], agentId: 'forged' },
    };
    const untrusted = await executor.execute(step, 'container', { userId: 'owner' });
    expect(untrusted.error).toContain('无法验证');
    expect(await dbA.getAllScheduledJobs()).toHaveLength(0);
    const receipt = await executor.execute(step, 'container', {
      userId: 'owner', scheduledToolNames: allowedToolNames, blockedToolNames, ...workspace,
    });
    expect(receipt.output).toMatchObject({ ok: true });
    await scheduler.loadJobs();
    const plan = scheduler.listJobs('owner')[0];
    expect(JSON.parse(plan.scopeJson!)).toEqual({ allowedToolNames, blockedToolNames, workspace });

    const dir = 'agents/editor/runs/original-run';
    await mkdir(path.join(sandbox.getRoot(), dir), { recursive: true });
    await writeFile(path.join(sandbox.getRoot(), dir, 'existing.md'), '成果');
    const a = services(dbA);
    await a.service.queue({ ...plan, scopeJson: undefined }, null);
    expect(await a.service.list('owner')).toHaveLength(0);
    await a.service.queue(plan, null);

    const b = services(dbB, vi.fn(async params => {
      await params.onToolEvent({ type: 'tool_start', id: 'present', toolName: 'file.present', input: { path: 'existing.md' } });
      await params.onToolEvent({ type: 'tool_complete', id: 'present', toolName: 'file.present', output: { ok: true, path: 'existing.md' }, duration: 1 });
      return { content: '已提供现有成果', stopReason: 'completed' };
    }));
    await b.service.recover();
    await completed(b.service);
    expect(b.loop).toHaveBeenCalledWith(expect.objectContaining({ allowedToolNames, blockedToolNames, ...workspace }));
    const run = await b.runs.get('owner', (await b.service.list('owner'))[0].run_id!);
    expect(run.artifacts.map(file => file.path)).toEqual([`${dir}/existing.md`]);
    expect(await sandbox.exists(`${dir}/文档/forbidden.md`)).toBe(false);
    expect(await sandbox.exists('文档/forbidden.md')).toBe(false);
  });
  it('sends a due file request to attention if the original run could not write files', async () => {
    const a = services(dbA);
    const plan = await job({
      intent: '写一段话并保存为 forbidden.md',
      scopeJson: JSON.stringify({
        allowedToolNames: ['x.schedule_run'], blockedToolNames: ['file.write'], workspace: {},
      }),
    });
    await a.service.queue(plan, null);
    await a.service.recover();
    await a.service.wait();
    const [occurrence] = await a.service.list('owner');
    expect(occurrence.status).toBe('needs_attention');
    expect((await a.runs.get('owner', occurrence.run_id!)).status).toBe('blocked');
    expect(a.loop).not.toHaveBeenCalled();
    expect(await sandbox.exists('文档/forbidden.md')).toBe(false);
  });

  it('flags a malformed persisted scope without opening a session or invoking a model', async () => {
    const a = services(dbA);
    const plan = await job({ scopeJson: '{"allowedToolNames":null,"blockedToolNames":[],"workspace":{}}' });
    await a.service.queue(plan, 200);
    await a.service.recover();
    expect((await a.service.list('owner'))[0]).toMatchObject({ status: 'needs_attention', execution_session_id: null, run_id: null });
    expect((await dbA.getAllScheduledJobs())[0].enabled).toBe(0);
    expect(a.loop).not.toHaveBeenCalled();
  });
  it('recovers after a crash between journaling and advancing the plan', async () => {
    const a = services(dbA); const plan = await job();
    const run = dbA.run.bind(dbA); let fail = true;
    vi.spyOn(dbA, 'run').mockImplementation(async (sql, args) => {
      if (sql.startsWith('UPDATE scheduled_jobs SET enabled=') && fail) { fail = false; throw new Error('simulated crash'); }
      return run(sql, args);
    });
    await expect(a.service.queue(plan, 200)).rejects.toThrow('simulated crash');
    const b = services(dbB); await b.service.queue(plan, 200); await b.service.recover(); await completed(b.service);
    expect((await dbA.getAllScheduledJobs())[0].next_run).toBe(200);
    expect(await dbA.query('SELECT * FROM scheduled_occurrences')).toHaveLength(1);
  });
  it('does not enqueue disabled plans or deliver a reminder into another user session', async () => {
    const a = services(dbA); const session = await dbA.createSession('other'); const plan = await job({ sessionId: session.id });
    await a.service.queue(plan, null); await a.service.recover();
    expect((await a.service.list('owner'))[0].status).toBe('needs_attention');
    expect(await dbA.query('SELECT * FROM chat_messages')).toHaveLength(0);
    await a.service.queue({ ...plan, runAt: 200 }, null);
    expect(await dbA.query('SELECT * FROM scheduled_occurrences')).toHaveLength(1); expect(a.loop).not.toHaveBeenCalled();
  });
  it('recovers a reminder receipt without adding duplicate messages or model calls', async () => {
    const published=vi.fn();setBroadcastToUser(published);
    const a = services(dbA); const session = await dbA.createSession('owner'); const plan = await job({ sessionId: session.id });
    await a.service.queue(plan, null); await a.service.recover();
    const notices=await dbA.getNotifications('owner',{includeRead:true});expect(notices).toHaveLength(1);expect(notices[0].link).toBe(`app:chat-session:${session.id}`);
    await dbA.markNotificationRead(notices[0].id,'owner');
    await dbA.run("UPDATE scheduled_occurrences SET status='queued'");
    const b = services(dbB); await b.service.recover();
    expect((await b.service.list('owner'))[0].status).toBe('reminded');
    expect(await dbA.query('SELECT * FROM chat_messages')).toHaveLength(1); expect(a.loop).not.toHaveBeenCalled(); expect(b.loop).not.toHaveBeenCalled();
    const recovered=await dbA.getNotifications('owner',{includeRead:true});expect(recovered).toHaveLength(1);expect(recovered[0].read).toBeTruthy();
    expect(published).toHaveBeenCalledTimes(1);expect(published).toHaveBeenCalledWith('owner',expect.objectContaining({type:'notification_created'}));setBroadcastToUser(()=>{});
  });
  it('delivers reminders without a model runtime or configured provider',async()=>{
    const session=await dbA.createSession('owner'),plan=await job({sessionId:session.id});
    const service=new ScheduledOccurrenceService({db:dbA,getRuns:()=>undefined,getSystemPrompt:async()=>{throw Error('no model');},getLLMConfig:async()=>{throw Error('no provider');}});
    await service.queue(plan,null);await service.recover();expect((await service.list('owner'))[0].status).toBe('reminded');expect(await dbA.getNotifications('owner')).toHaveLength(1);
  });
  it('does not disable future periods when a reminder occurrence is cancelled during delivery',async()=>{
    const a=services(dbA),session=await dbA.createSession('owner'),plan=await job({sessionId:session.id,cron:'* * * * *'});await a.service.queue(plan,200);const row=(await a.service.list('owner'))[0];
    const run=dbA.run.bind(dbA);let intercept=true;vi.spyOn(dbA,'run').mockImplementation(async(sql,params)=>{if(intercept&&sql.startsWith('INSERT OR IGNORE INTO chat_messages')){intercept=false;await a.service.cancel('owner',row.id);}return run(sql,params);});
    await a.service.recover();expect((await a.service.list('owner'))[0].status).toBe('cancelled');expect((await dbA.getAllScheduledJobs())[0].enabled).toBe(1);expect(await dbA.getNotifications('owner')).toHaveLength(0);
  });
  it('retries a failed reminder notification after its message was saved',async()=>{
    const a=services(dbA),session=await dbA.createSession('owner'),plan=await job({sessionId:session.id});await a.service.queue(plan,null);
    const run=dbA.run.bind(dbA);let fail=true;vi.spyOn(dbA,'run').mockImplementation(async(sql,params)=>{if(fail&&sql.startsWith('INSERT OR IGNORE INTO notifications')){fail=false;throw new Error('notice storage unavailable');}return run(sql,params);});
    await a.service.recover();expect((await a.service.list('owner'))[0].status).toBe('queued');expect(await dbA.getMessages(session.id)).toHaveLength(1);expect(await dbA.getNotifications('owner',{includeRead:true})).toHaveLength(0);
    const b=services(dbB);await b.service.recover();expect((await b.service.list('owner'))[0].status).toBe('reminded');expect(await dbA.getMessages(session.id)).toHaveLength(1);expect(await dbA.getNotifications('owner',{includeRead:true})).toHaveLength(1);expect(b.loop).not.toHaveBeenCalled();
  });
  it('recovers a saved handoff after a crash before attaching its run id', async () => {
    const a = services(dbA); const plan = await job(); await a.service.queue(plan, null);
    const row = (await a.service.list('owner'))[0]; const session = await dbA.createSession('owner');
    await dbA.run('UPDATE scheduled_occurrences SET execution_session_id=? WHERE id=?', [session.id, row.id]);
    const run = await a.runs.accept({ userId: 'owner', sessionId: session.id, requestId: row.id, messages: [{ role: 'user', content: plan.intent }],
      providerId: 'test', modelId: 'test', systemPrompt: 'test' });
    await dbA.run("UPDATE chat_run_ownership SET expires_at=0 WHERE scope_id LIKE 'session:%'");
    const b = services(dbB); await b.service.recover(); await b.service.wait();
    expect((await b.service.list('owner'))[0]).toMatchObject({ run_id: run.id, status: 'completed' });
    expect(b.loop).toHaveBeenCalledTimes(1); expect(a.loop).not.toHaveBeenCalled(); expect(await dbA.getAllTasks()).toHaveLength(1);
  });
  it('cancels queued work before accept and keeps history', async () => {
    const a = services(dbA); const plan = await job(); await a.service.queue(plan, 200);
    const row = (await a.service.list('owner'))[0];
    await expect(a.service.cancel('other', row.id)).rejects.toThrow('无权');
    await a.service.cancelJob(plan.id); await a.service.recover();
    expect((await a.service.list('owner'))[0].status).toBe('cancelled');
    expect((await dbA.getAllScheduledJobs())[0].enabled).toBe(0); expect(a.loop).not.toHaveBeenCalled();
  });
  it('deduplicates legacy manual/event callers across services without persisting credentials', async () => {
    const a = services(dbA); const b = services(dbB);
    const input = { userId: 'owner', intent: '帮我执行一次', systemPrompt: 'frozen prompt', source: 'run_now' as const,
      sourceId: 'same-request', llmConfig: { providerId: 'test', modelId: 'test', apiKey: 'never-save-this', baseUrl: 'https://private.invalid' }, metadata: { allowedToolNames: [] } };
    const result = await Promise.all([a.service.run(input), b.service.run(input)]);
    expect(result[0].runId).toBe(result[1].runId); expect(a.loop.mock.calls.length + b.loop.mock.calls.length).toBe(1);
    const tasks = await dbA.getAllTasks(); expect(tasks).toHaveLength(1);
    expect(tasks[0].metadata_json).not.toContain('never-save-this'); expect(tasks[0].metadata_json).not.toContain('private.invalid');
    const record = JSON.parse(tasks[0].metadata_json!).chatRun; expect(record.allowedToolNames).toEqual([]); expect(record.toolLoadingMode).toBe('all');
    const journal = await dbA.queryOne<{ job_json: string }>('SELECT job_json FROM scheduled_occurrences'); expect(journal?.job_json).not.toContain('never-save-this');
    await expect(a.service.run({ ...input, intent: 'another task' })).rejects.toThrow('不同内容');
    expect((await a.service.run({ ...input, systemPrompt: 'new current context' })).runId).toBe(result[0].runId);
  });
  it('records failed background work for attention and never retries the model automatically', async () => {
    const loop = vi.fn(async () => { throw new Error('network failure after side effect'); });
    const a = services(dbA, loop);
    const input = { userId: 'owner', intent: '执行', systemPrompt: '', source: 'event_driven' as const, actionFingerprint: 'event-one', llmConfig: { providerId: 'test', modelId: 'test' } };
    await expect(a.service.run(input)).rejects.toThrow(); await a.service.wait(); await a.service.recover();
    await expect(a.service.run(input)).rejects.toThrow(); expect(loop).toHaveBeenCalledTimes(1);
    expect((await a.service.list('owner'))[0].status).toBe('needs_attention');
  });
  it('keeps event identity stable during the retention window and permits a later authorized occurrence', async () => {
    const a = services(dbA); const input = { userId: 'owner', intent: '执行', systemPrompt: '', source: 'event_driven' as const, actionFingerprint: 'recurring-event', llmConfig: { providerId: 'test', modelId: 'test' } };
    const first = await a.service.run(input); expect((await a.service.run(input)).runId).toBe(first.runId);
    await dbA.run('UPDATE scheduled_occurrences SET created_at=?', [Date.now() - 8 * 24 * 60 * 60 * 1000]);
    const later = await a.service.run(input); expect(later.runId).not.toBe(first.runId); expect(a.loop).toHaveBeenCalledTimes(2);
  });
  it('serializes periodic occurrences and leaves a user-stopped run paused after owner loss', async () => {
    let entered!: () => void; const start = new Promise<void>(r => entered = r);
    let finish!: () => void; const gate = new Promise<void>(r => finish = r); releases.push(finish);
    const loop = vi.fn(async params => { entered(); await gate; await params.onCheckpoint([...params.messages, { role: 'assistant', content: 'late' }]); return { content: 'late', stopReason: 'completed' }; });
    const a = services(dbA, loop); const plan = await job({ cron: '* * * * *' });
    await a.service.queue(plan, 200); await a.service.queue({ ...plan, runAt: 200 }, 300); await a.service.recover(); await start;
    const rows = await a.service.list('owner'); const first = rows.find(r => r.scheduled_at === 100)!;
    expect(loop).toHaveBeenCalledTimes(1);
    await a.runs.stop('owner', first.run_id!);
    await dbA.run("UPDATE chat_run_ownership SET expires_at=0 WHERE scope_id LIKE 'session:%'");
    const b = services(dbB); await b.service.recover();
    expect((await b.runs.get('owner', first.run_id!)).status).toBe('paused'); expect(b.loop).not.toHaveBeenCalled();
    expect((await dbA.getAllScheduledJobs())[0].enabled).toBe(0);
    finish(); pending.push(a.runs.wait(first.run_id!)); await a.runs.wait(first.run_id!); await a.service.wait();
  });
});
