import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChatRunService, ChatRunBlockedError } from './ChatRunService.js';
import { SandboxFS } from '../tooling/SandboxFS.js';

describe('durable assistant runs', () => {
  let rows: Map<string, any>;
  let messages: Map<string, any>;
  let db: any;
  let sandbox: SandboxFS;
  let loop: ReturnType<typeof vi.fn>;
  const input = { userId: 'u1', sessionId: 's1', requestId: 'request-one', messages: [{ role: 'user' as const, content: '整理报告' }],
    providerId: 'mock', modelId: 'mock-model', systemPrompt: 'system' };
  beforeEach(async () => {
    rows = new Map(); messages = new Map();
    const configs = new Map<string, string>();
    db = {
      getConfig: async (user: string, key: string) => configs.get(`${user}:${key}`),
      setConfig: async (user: string, key: string, value: string) => { configs.set(`${user}:${key}`, value); },
      getAllTasks: async () => [...rows.values()],
      getSession: async (id: string) => id === 's1' ? { id, user_id: 'u1' } : undefined,
      insertTask: vi.fn(async (row: any) => { rows.set(row.id, structuredClone(row)); }),
      upsertRunMessage: vi.fn(async (sid: string, id: string, role: string, content: string, tools?: string) => {
        messages.set(id, { session_id: sid, id, role, content, tool_calls_json: tools });
      }),
    };
    sandbox = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'chat-run-')));
    loop = vi.fn(async (params) => {
      await params.onCheckpoint([...params.messages, { role: 'assistant', content: '报告完成' }]);
      return { content: '报告完成', stopReason: 'completed' };
    });
  });
  const create = () => new ChatRunService({ db, orchestrator: { runChatAgentLoop: loop } as any,
    getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'mock', modelId: 'mock-model', apiKey: 'secret-never-persist' }) });

  it('builds a private cross-conversation workbench without exposing model context',async()=>{
    db.listDelegations=async()=>[];db.getNotifications=async()=>[];
    db.getSession=async(id:string)=>({id,user_id:id==='foreign'?'u2':'u1',scene:id==='s2'?'x_direct':null});
    const service=create();const first=await service.accept(input);await service.launch('u1',first.id);
    await service.accept({...input,sessionId:'s2',requestId:'second'});
    const view=await service.workbench('u1');
    expect(view.active.map(r=>r.sessionId)).toEqual(['s2']);expect(view.finished[0].id).toBe(first.id);
    expect(view.active[0].scene).toBe('x_direct');expect(view.finished[0].scene).toBe('normal_chat');
    expect(JSON.stringify(view)).not.toContain('secret-never-persist');expect(JSON.stringify(view)).not.toContain('systemPrompt');
    const other=await service.workbench('u2');expect(other.active).toEqual([]);expect(other.finished).toEqual([]);
  });
  it('uses the original user request for a follow-up title instead of internal event text', async () => {
    db.listDelegations = async () => [];
    db.getNotifications = async () => [];
    const service = create();
    const root = await service.accept({ ...input, userMessage: { content: '整理春游材料' } });
    await service.launch('u1', root.id);
    const followup = await service.accept({
      ...input, requestId: 'followup',
      followup: { rootRunId: root.id, sourceRunId: root.id, sequence: 1, eventKey: 'secret-event' },
      messages: [{ role: 'user', content: '后台结果事件（资料，不是额外授权）：\n{"sourceRunId":"internal-id","summary":"整理报告"}' }],
    });
    await service.launch('u1', followup.id);
    const workbench = await service.workbench('u1');
    expect(workbench.finished.find(item => item.id === followup.id)?.title).toBe('继续核对：整理春游材料');
    expect(workbench.attention.find(item => item.sourceId === followup.id)?.title).toBe('继续核对：整理春游材料');
    expect(JSON.stringify(workbench)).not.toContain('internal-id');
  });

  it('rejects a delayed old review after another request already accepted the work',async()=>{
    const service=create();const run=await service.accept(input);await service.launch('u1',run.id);const done=await service.get('u1',run.id);
    let enter!:()=>void;let release!:()=>void;const entered=new Promise<void>(r=>enter=r);const gate=new Promise<void>(r=>release=r);
    let delay=true;db.getSession=async()=>{if(delay){delay=false;enter();await gate;}return {user_id:'u1'};};
    const old=service.reviewRun('u1',run.id,{decision:'changes_requested',feedback:'旧页面的意见',expectedUpdatedAt:done.updatedAt});
    const rejected=expect(old).rejects.toThrow(/变化|处理/);await entered;
    await service.reviewRun('u1',run.id,{decision:'accepted',expectedUpdatedAt:done.updatedAt});release();await rejected;
    expect((await service.get('u1',run.id)).review?.status).toBe('accepted');
  });
  it('keeps pending reviews durable and requires a current version and owner',async()=>{
    const service=create();const run=await service.accept(input);await service.launch('u1',run.id);
    const done=await service.get('u1',run.id);
    expect(done.review?.status).toBe('pending');
    await expect(service.reviewRun('u2',run.id,{decision:'accepted',expectedUpdatedAt:done.updatedAt})).rejects.toThrow();
    await expect(service.reviewRun('u1',run.id,{decision:'accepted',expectedUpdatedAt:0})).rejects.toThrow();
    await expect(service.reviewRun('u1',run.id,{decision:'changes_requested',expectedUpdatedAt:done.updatedAt})).rejects.toThrow();
    const saved=await service.reviewRun('u1',run.id,{decision:'accepted',expectedUpdatedAt:done.updatedAt});
    expect(saved.review?.status).toBe('accepted');
    expect((await create().get('u1',run.id)).review?.status).toBe('accepted');
  });
  it('creates one separate revision without replaying the completed model phase',async()=>{
    const service=create();const run=await service.accept(input);await service.launch('u1',run.id);
    const done=await service.get('u1',run.id);
    await service.reviewRun('u1',run.id,{decision:'changes_requested',feedback:'补充结论',expectedUpdatedAt:done.updatedAt});
    const revision=await service.revise('u1',run.id);await service.wait(revision.id);
    expect(revision.id).not.toBe(run.id);
    expect((await service.revise('u1',run.id)).id).toBe(revision.id);
    expect((await service.get('u1',revision.id)).review?.status).toBe('pending');
    expect(loop).toHaveBeenCalledTimes(2);
  });
  it('derives attention from current source state without creating notifications',async()=>{
    db.listDelegations=async()=>[{id:'d1',title:'逾期',status:'waiting',due_at:'2020-01-01'}];
    db.getNotifications=async()=>[{id:'n1',type:'error',title:'失败',read:0,created_at:1}];
    const service=create();const run=await service.accept(input);await service.launch('u1',run.id);
    expect((await service.attention('u1')).map(i=>i.id).sort()).toEqual([`run:${run.id}`,'delegation:d1','notification:n1'].sort());
    const done=await service.get('u1',run.id);await service.reviewRun('u1',run.id,{decision:'accepted',expectedUpdatedAt:done.updatedAt});
    expect((await service.attention('u1')).some(i=>i.source==='run')).toBe(false);
  });
  it('keeps failed delegation synchronization visible and retryable',async()=>{
    db.getDelegation=async()=>({id:'d1'});
    db.updateDelegation=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({id:'d1'});
    const service=create();const run=await service.accept(input);await service.launch('u1',run.id);
    const done=await service.get('u1',run.id);
    await expect(service.reviewRun('u1',run.id,{decision:'accepted',delegationId:'d1',expectedUpdatedAt:done.updatedAt})).rejects.toThrow('offline');
    const pending=await service.get('u1',run.id);expect(pending.review?.delegationPending).toBe(true);
    const saved=await service.reviewRun('u1',run.id,{decision:'accepted',expectedUpdatedAt:pending.updatedAt});
    expect(saved.review?.delegationPending).toBe(false);
    expect(db.updateDelegation).toHaveBeenLastCalledWith('d1','u1',{status:'completed'});
  });
  it('accepts an idempotent handoff and persists both messages on the server', async () => {
    const service = create();
    const first = await service.accept(input);
    expect(messages.get(first.userMessageId)?.content).toBe('整理报告');
    await service.launch('u1', first.id);
    const replay = await service.accept(input);
    expect(replay.id).toBe(first.id);
    expect(loop).toHaveBeenCalledOnce();
    expect(messages.get(first.assistantMessageId)?.content).toBe('报告完成');
    expect(JSON.stringify([...rows.values()])).not.toContain('secret-never-persist');
  });

  it('prevents another user from reading, stopping or resuming the run', async () => {
    const service = create(); const run = await service.accept(input);
    await expect(service.get('u2', run.id)).rejects.toThrow();
    await expect(service.stop('u2', run.id)).rejects.toThrow();
    await expect(service.resume('u2', run.id)).rejects.toThrow();
    await expect(service.accept({ ...input, userId: 'u2' })).rejects.toThrow();
  });
  it('cancels a handoff before the run acknowledgement arrives', async () => {
    const service = create();
    await service.stopRequest('u1', 's1', input.requestId);
    await expect(service.accept(input)).rejects.toThrow(/取消/);
    await expect(create().accept(input)).rejects.toThrow(/取消/);
    expect(loop).not.toHaveBeenCalled();
  });
  it('rechecks cancellation after an in-flight configuration read', async () => {
    let release!: () => void; let reading!: () => void;
    const entered = new Promise<void>((resolve) => { reading = resolve; });
    db.getConfig = async () => { reading(); await new Promise<void>((resolve) => { release = resolve; }); return undefined; };
    const service = create(); const pending = service.accept(input);
    const rejected = expect(pending).rejects.toThrow(/取消/);
    await entered; await service.stopRequest('u1', 's1', input.requestId); release();
    await rejected; expect(loop).not.toHaveBeenCalled();
  });
  it('keeps stable message identities when accepting fails after the message write', async () => {
    const actualWrite = db.upsertRunMessage.getMockImplementation();
    db.upsertRunMessage.mockImplementationOnce(async (...args: any[]) => { await actualWrite(...args); throw new Error('connection lost after commit'); });
    const service = create();
    await expect(service.accept(input)).rejects.toThrow();
    const retry = await service.accept(input);
    expect([...messages.values()].filter((m) => m.role === 'user')).toHaveLength(1);
    await service.launch('u1', retry.id);
    expect((await service.get('u1', retry.id)).status).toBe('completed');
  });
  it('does not resume an older run alongside a new handoff in the same session', async () => {
    const service = create(); const first = await service.accept(input);
    await service.stop('u1', first.id);
    await service.accept({ ...input, requestId: 'another-handoff' });
    await expect(service.resume('u1', first.id)).rejects.toThrow(/已有/);
    expect(loop).not.toHaveBeenCalled();
  });

  it('waits for a cancelled tool to settle before reporting paused', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    loop.mockImplementationOnce(async ({ signal, onCheckpoint }) => {
      await onCheckpoint(input.messages);
      await gate;
      signal.throwIfAborted();
    });
    const service = create(); const run = await service.accept(input);
    const active = service.launch('u1', run.id);
    await vi.waitFor(() => expect(loop).toHaveBeenCalled());
    expect((await service.stop('u1', run.id)).status).toBe('stopping');
    release(); await active;
    expect((await service.get('u1', run.id)).status).toBe('paused');
    await service.resume('u1', run.id); await service.wait(run.id);
    expect((await service.get('u1', run.id)).status).toBe('completed');
    expect([...messages.values()].filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('recovers a checkpoint after restart without replaying completed tools', async () => {
    const service = create(); const run = await service.accept(input);
    const row = rows.get(run.id); const meta = JSON.parse(row.metadata_json);
    meta.chatRun.status = 'running';
    meta.chatRun.checkpoint = [...input.messages,
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'file.write', arguments: { path: '文档/报告.md' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"written":true}' }];
    row.metadata_json = JSON.stringify(meta);
    const recovered = create();
    expect((await recovered.get('u1', run.id)).status).toBe('interrupted');
    await recovered.resume('u1', run.id); await recovered.wait(run.id);
    expect(loop.mock.calls[0][0].messages.filter((message: any) => message.role === 'tool').at(-1).tool_call_id).toBe('c1');
    expect(loop.mock.calls[0][0].messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('用户已点击“继续做”') });
  });

  it('blocks blind replay when a crashed tool has an unknown outcome', async () => {
    const service = create(); const run = await service.accept(input);
    const row = rows.get(run.id); const meta = JSON.parse(row.metadata_json);
    meta.chatRun.status = 'running';
    meta.chatRun.checkpoint = [...input.messages,
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'email.send', arguments: {} }] }];
    row.metadata_json = JSON.stringify(meta);
    const recovered = create(); const snapshot = await recovered.get('u1', run.id);
    expect(snapshot.canResume).toBe(false);
    await expect(recovered.resume('u1', run.id)).rejects.toThrow(/未知/);
    expect(loop).not.toHaveBeenCalled();
  });
  it('recovers a checkpointed file result even when its UI tool event was not committed', async () => {
    await writeFile(path.join(sandbox.getRoot(), 'report.md'), 'completed file');
    const service = create(); const run = await service.accept(input);
    const row = rows.get(run.id); const meta = JSON.parse(row.metadata_json);
    Object.assign(meta.chatRun, { status: 'running', modelCompleted: true, finalContent: '已完成文件',
      toolCalls: [{ id: 'c1', toolName: 'file.write', input: { path: 'report.md' }, status: 'running' }],
      checkpoint: [...input.messages,
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'file.write', arguments: { path: 'report.md' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"written":true,"path":"report.md"}' },
        { role: 'assistant', content: '已完成文件' }] });
    row.metadata_json = JSON.stringify(meta);
    const recovered = create(); await recovered.resume('u1', run.id); await recovered.wait(run.id);
    expect(loop).not.toHaveBeenCalled();
    const result = await recovered.get('u1', run.id);
    expect(result.artifacts.map((a) => a.path)).toEqual(['report.md']);
    expect(result.toolCalls[0].status).toBe('completed');
  });

  it('does not label a step limit as successful completion', async () => {
    loop.mockResolvedValueOnce({ content: '还在处理', stopReason: 'step_limit' });
    const service = create(); const run = await service.accept(input);
    await service.launch('u1', run.id);
    expect((await service.get('u1', run.id)).status).toBe('blocked');
  });
  it('publishes terminal status only after the final assistant message is durable', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const write = db.upsertRunMessage.getMockImplementation();
    let assistantWrites = 0;
    db.upsertRunMessage.mockImplementation(async (...args: any[]) => {
      if (args[2] === 'assistant' && ++assistantWrites === 2) await gate;
      return write(...args);
    });
    const service = create(); const run = await service.accept(input); const active = service.launch('u1', run.id);
    await vi.waitFor(() => expect(assistantWrites).toBe(2));
    expect((await service.get('u1', run.id)).status).toBe('running');
    release(); await active;
    expect((await service.get('u1', run.id)).status).toBe('completed');
  });
  it('does not commit completion when saving the final message fails', async () => {
    const write = db.upsertRunMessage.getMockImplementation(); let count = 0;
    db.upsertRunMessage.mockImplementation(async (...args: any[]) => {
      if (args[2] === 'assistant' && ++count === 2) throw new Error('final message write failed');
      return write(...args);
    });
    const service = create(); const run = await service.accept(input);
    await expect(service.launch('u1', run.id)).rejects.toThrow();
    expect(rows.get(run.id).status).not.toBe('completed');
    const recovered = create();
    expect((await recovered.get('u1', run.id)).status).toBe('interrupted');
    await recovered.resume('u1', run.id); await recovered.wait(run.id);
    expect(loop).toHaveBeenCalledOnce();
    expect((await recovered.get('u1', run.id)).status).toBe('completed');
  });
  it.each([
    { toolName: 'x.schedule_run', output: { ok: true, jobId: 'saved' } },
    { toolName: 'x.schedule_reminder', output: { ok: true, jobId: 'saved' } },
    { toolName: 'x.schedule_run', output: { error: '时间无效' } },
  ])('keeps $toolName replies out of the requested file and artifact list', async ({ toolName, output }) => {
    const target = '文档/报告.md';
    await mkdir(path.join(sandbox.getRoot(), '文档'));
    await writeFile(path.join(sandbox.getRoot(), target), '已有内容');
    loop.mockImplementationOnce(async ({ onCheckpoint, messages }) => {
      await onCheckpoint([
        ...messages,
        { role: 'assistant', content: '', tool_calls: [{ id: 'schedule', name: toolName, arguments: {} }] },
        { role: 'tool', tool_call_id: 'schedule', content: JSON.stringify(output) },
        { role: 'assistant', content: '定时交办回执' },
      ]);
      return { content: '定时交办回执', stopReason: 'completed' };
    });
    const service = create();
    const run = await service.accept({ ...input, requestedTextArtifactPath: target });
    await service.launch('u1', run.id);
    const result = await create().get('u1', run.id);
    expect(result.content).toBe('定时交办回执');
    expect(result.review).toBeUndefined();
    expect(result.artifacts).toEqual([]);
    expect(await sandbox.read(target)).toBe('已有内容');
    expect(await sandbox.list('文档')).toHaveLength(1);
  });

  it('writes a due report in the captured workspace only while file.write remains authorized', async () => {
    const target = '文档/报告.md';
    const workspace = { agentId: 'editor', agentRunId: 'source-run' };
    const directory = 'agents/editor/runs/source-run';
    const fileTools = vi.fn()
      .mockResolvedValueOnce([{ name: 'file.write' }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ name: 'file.write' }]);
    const service = new ChatRunService({ db, orchestrator: { runChatAgentLoop: loop as never, getLLMToolDefsFiltered: fileTools },
      getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'mock', modelId: 'mock' }) });
    const run = await service.accept({ ...input, scheduledWorkspace: workspace, allowedToolNames: ['file.write'], requestedTextArtifactPath: target });
    await service.launch('u1', run.id);
    expect((await service.get('u1', run.id)).status).toBe('blocked');
    expect(await sandbox.exists(`${directory}/${target}`)).toBe(false);
    expect(loop).toHaveBeenCalledOnce();

    await service.resume('u1', run.id);
    await service.wait(run.id);
    expect(loop).toHaveBeenCalledOnce();
    expect((await service.get('u1', run.id)).artifacts.map(file => file.path)).toEqual([`${directory}/${target}`]);
    expect(await sandbox.read(`${directory}/${target}`)).toBe('报告完成');
    expect(await sandbox.exists(target)).toBe(false);
  });

  it('blocks incomplete text deliverables instead of saving and claiming success', async () => {
    const service = new ChatRunService({ db, orchestrator: { runChatAgentLoop: loop } as any,
      getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'mock', modelId: 'mock' }),
      completeText: async () => { throw new ChatRunBlockedError('缺少来源'); } });
    const run = await service.accept({ ...input, requestedTextArtifactPath: '文档/报告.md' });
    await service.launch('u1', run.id);
    expect((await service.get('u1', run.id)).status).toBe('blocked');
    expect(await sandbox.exists('文档/报告.md')).toBe(false);
  });

  it('delivers only existing files within the user sandbox', async () => {
    await mkdir(path.join(sandbox.getRoot(), '文档'));
    await writeFile(path.join(sandbox.getRoot(), '文档/报告.md'), 'verified report');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'chat-outside-'));
    await writeFile(path.join(outside, 'private.md'), 'private');
    await symlink(path.join(outside, 'private.md'), path.join(sandbox.getRoot(), '文档/escape.md'));
    loop.mockImplementationOnce(async ({ onCheckpoint, onToolEvent }) => {
      for (const [id, file] of [['ok', '文档/报告.md'], ['missing', '文档/missing.md'], ['escape', '文档/escape.md']]) {
        onToolEvent({ type: 'tool_complete', id, toolName: 'file.write', output: { path: file }, duration: 1 });
      }
      await onCheckpoint([...input.messages, { role: 'assistant', content: '已交付' }]);
      return { content: '已交付', stopReason: 'completed' };
    });
    const service = create(); const run = await service.accept(input); await service.launch('u1', run.id);
    expect((await service.get('u1', run.id)).artifacts.map((a) => a.path)).toEqual(['文档/报告.md']);
  });
  it('includes verified browser downloads in the existing review and artifact flow',async()=>{
    await mkdir(path.join(sandbox.getRoot(),'下载'));
    await writeFile(path.join(sandbox.getRoot(),'下载/网页成果.txt'),'真实浏览器下载内容');
    loop.mockImplementationOnce(async({onCheckpoint,onToolEvent})=>{
      onToolEvent({type:'tool_complete',id:'download',toolName:'browser.present_download',output:{presented:true,path:'下载/网页成果.txt'},duration:1});
      await onCheckpoint([...input.messages,{role:'assistant',content:'网页成果已交付'}]);return {content:'网页成果已交付',stopReason:'completed'};
    });
    const service=create();const run=await service.accept(input);await service.launch('u1',run.id);
    const done=await service.get('u1',run.id);expect(done.artifacts.map(a=>a.path)).toEqual(['下载/网页成果.txt']);expect(done.review?.status).toBe('pending');
    const accepted=await service.reviewRun('u1',run.id,{decision:'accepted',expectedUpdatedAt:done.updatedAt});expect(accepted.review?.status).toBe('accepted');
  });

  it('does not carry an incorrectly inferred input-file output into a revision',async()=>{
    const service=create();const run=await service.accept({...input,userMessage:{content:'请向网页提供工作区文件 下载/输入.txt'},requestedTextArtifactPath:'错误识别/输入.txt'});await service.launch('u1',run.id);
    const done=await service.get('u1',run.id);await service.reviewRun('u1',run.id,{decision:'changes_requested',feedback:'只交付真实网页处理结果，不生成额外文本',expectedUpdatedAt:done.updatedAt});
    const revised=await service.revise('u1',run.id);await service.wait(revised.id);
    expect(JSON.parse(rows.get(revised.id).metadata_json).chatRun.requestedTextArtifactPath).toBeUndefined();expect((await service.get('u1',revised.id)).artifacts).toEqual([]);
  });

  it('keeps prior conversation tool calls out of current execution and recovery traces',async()=>{
    const history=[...input.messages,{role:'assistant' as const,content:'',tool_calls:[{id:'old-upload',name:'browser.request_upload',arguments:{path:'old.txt'}}]},{role:'tool' as const,content:JSON.stringify({selected:true}),tool_call_id:'old-upload'},{role:'user' as const,content:'只交付已有结果'}];
    loop.mockImplementationOnce(async({onCheckpoint,onToolEvent})=>{
      onToolEvent({type:'tool_complete',id:'current',toolName:'browser.downloads',output:{downloads:[]},duration:1});
      await onCheckpoint([...history,{role:'assistant',content:'已核对当前结果'}]);return {content:'已核对当前结果',stopReason:'completed'};
    });
    const service=create();const run=await service.accept({...input,messages:history});await service.launch('u1',run.id);
    expect((await service.get('u1',run.id)).toolCalls.map(tool=>tool.toolName)).toEqual(['browser.downloads']);
    const recovered=create();expect((await recovered.get('u1',run.id)).toolCalls.map(tool=>tool.toolName)).toEqual(['browser.downloads']);
    expect(JSON.parse(rows.get(run.id).metadata_json).chatRun.checkpoint.some((m:any)=>m.tool_call_id==='old-upload')).toBe(true);
  });

  it('does not overwrite a user-edited generated file when resuming finalization',async()=>{
    const write=db.upsertRunMessage.getMockImplementation();let count=0;
    db.upsertRunMessage.mockImplementation(async(...args:any[])=>{if(args[2]==='assistant'&&++count===2)throw new Error('lost final message');return write(...args);});
    const service=create();const run=await service.accept({...input,requestedTextArtifactPath:'文档/报告.md'});await expect(service.launch('u1',run.id)).rejects.toThrow();
    await writeFile(path.join(sandbox.getRoot(),'文档/报告.md'),'用户修改过的内容');
    const recovered=create();await recovered.resume('u1',run.id);await recovered.wait(run.id);
    expect((await recovered.get('u1',run.id)).status).toBe('blocked');expect(await sandbox.read('文档/报告.md')).toBe('用户修改过的内容');expect(loop).toHaveBeenCalledOnce();
  });

});
