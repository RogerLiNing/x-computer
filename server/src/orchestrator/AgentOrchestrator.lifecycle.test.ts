import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator } from './AgentOrchestrator.js';
import { AuditLogger } from '../observability/AuditLogger.js';
import { ToolExecutor } from './ToolExecutor.js';
import { callLLMWithTools } from '../chat/chatService.js';
import type { ChatMessage } from '../chat/chatService.js';
import type { AsyncDatabase } from '../db/database.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

vi.mock('../chat/chatService.js', () => ({
  callLLMWithTools: vi.fn(), callLLMWithToolsStream: vi.fn(), callLLM: vi.fn(), callLLMGenerateImage: vi.fn(),
}));

const config = { providerId: 'test', modelId: 'model', apiType: 'openai' as const };
const tool = { name: 'test.action', description: 'test', parameters: { type: 'object' } };
const requested = { content: '处理', toolCalls: [{ id: 'call-1', name: tool.name, arguments: {} }] };
const input = [{ role: 'user' as const, content: '完成交办' }];

function createOrchestrator() {
  const orchestrator = new AgentOrchestrator(new AuditLogger());
  vi.spyOn(orchestrator, 'getLLMToolDefsFiltered').mockResolvedValue([tool]);
  const executor = Reflect.get(orchestrator, 'executor') as ToolExecutor;
  const execute = vi.spyOn(executor, 'execute').mockResolvedValue({
    id: 'result-1', toolName: tool.name, input: {}, output: { path: 'result.txt' }, startedAt: 1, completedAt: 2, runtimeType: 'container',
  });
  return { orchestrator, execute };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('Agent execution lifecycle', () => {
  it('ends a durable handoff after the complete dispatch batch without another model round',async()=>{
    const {orchestrator,execute}=createOrchestrator();
    vi.mocked(orchestrator.getLLMToolDefsFiltered).mockResolvedValue([{...tool,name:'x.dispatch_agent'}]);
    execute.mockResolvedValue({id:'receipt',toolName:'x.dispatch_agent',input:{},output:{ok:true,runId:'child',agentName:'专家'},startedAt:1,completedAt:2,runtimeType:'container'});
    vi.mocked(callLLMWithTools).mockResolvedValue({content:'安排专家',toolCalls:[{id:'dispatch',name:'x.dispatch_agent',arguments:{}}]});
    let saved:ChatMessage[]=[];
    const result=await orchestrator.runChatAgentLoop({messages:input,llmConfig:config,systemPrompt:'',returnAfterExpertDispatch:true,onCheckpoint:async messages=>{saved=messages;}});
    expect(callLLMWithTools).toHaveBeenCalledTimes(1);expect(result.stopReason).toBe('completed');expect(result.content).toContain('接单回执');
    expect(saved.filter(message=>message.role==='tool')).toHaveLength(1);expect(saved.at(-1)?.content).toBe(result.content);
  });
  it('passes the complete parent authorization scope to delegation even with on-demand discovery',async()=>{
    const {orchestrator,execute}=createOrchestrator();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(requested).mockResolvedValueOnce({content:'done',toolCalls:[]});
    await orchestrator.runChatAgentLoop({messages:input,llmConfig:config,systemPrompt:'',toolLoadingMode:'on_demand',initialLoadedToolNames:[tool.name],allowedToolNames:[tool.name,'file.read'],blockedToolNames:['file.write'],delegationDepth:1});
    expect(execute).toHaveBeenCalledWith(expect.anything(),'container',expect.objectContaining({allowedToolNames:[tool.name,'file.read'],blockedToolNames:['file.write'],delegationDepth:1}));
    const context=execute.mock.calls[0][2]!;
    context.clearGroupRunCancel!('user');orchestrator.setGroupRunCancel('user',true);
    expect(context.isGroupRunCancelRequested!('user')).toBe(true);
    expect(context.onGroupRunProgress).toBeTypeOf('function');
  });
  it.each([
    {parent:['file.read'],child:['file.read','file.write'],expected:['file.read']},
    {parent:[],child:['file.write'],expected:[]},
    {parent:['file.read'],child:[],expected:['file.read']},
    {parent:undefined,child:['file.read'],expected:['file.read']},
    {parent:undefined,child:[],expected:undefined},
  ])('intersects expert permissions with the parent scope: $parent / $child',async({parent,child,expected})=>{
    const {orchestrator}=createOrchestrator();orchestrator.setGetLLMConfigForAgent(async()=>config);
    const loop=vi.spyOn(orchestrator,'runChatAgentLoop').mockResolvedValue({content:'done',stopReason:'completed'});
    await orchestrator.runCustomAgentLoop({agentDef:{id:'expert',name:'专家',systemPrompt:'work',toolNames:child,createdAt:1,updatedAt:1},goal:'complete',userId:'user',allowedToolNames:parent,blockedToolNames:['file.delete'],delegationDepth:1});
    expect(loop).toHaveBeenCalledWith(expect.objectContaining({allowedToolNames:expected,blockedToolNames:['file.delete'],delegationDepth:2,agentId:'expert'}));
  });
  it('stops recursive delegation before resolving credentials or starting another expert',async()=>{
    const {orchestrator}=createOrchestrator(),resolve=vi.fn(async()=>config);orchestrator.setGetLLMConfigForAgent(resolve);
    const loop=vi.spyOn(orchestrator,'runChatAgentLoop');
    await expect(orchestrator.runCustomAgentLoop({agentDef:{id:'expert',name:'专家',systemPrompt:'work',toolNames:[],createdAt:1,updatedAt:1},goal:'work',userId:'user',delegationDepth:3})).rejects.toThrow('层级');
    expect(resolve).not.toHaveBeenCalled();expect(loop).not.toHaveBeenCalled();
  });
  it('keeps an uncertain extension call pending and never asks the model to replay it', async () => {
    const { orchestrator, execute } = createOrchestrator();
    execute.mockRejectedValue(new UncertainToolOutcomeError('result unknown'));
    vi.mocked(callLLMWithTools).mockResolvedValue(requested);
    let history:ChatMessage[]=[];
    await expect(orchestrator.runChatAgentLoop({ messages:input,llmConfig:config,systemPrompt:'',onCheckpoint:async messages=>{history=messages;} })).rejects.toBeInstanceOf(UncertainToolOutcomeError);
    expect(execute).toHaveBeenCalledTimes(1);expect(callLLMWithTools).toHaveBeenCalledTimes(1);
    expect(history.at(-1)?.tool_calls?.[0].id).toBe('call-1');expect(history.some(message=>message.role==='tool')).toBe(false);
  });
  it('treats an empty allowlist as no tools, and respects restrictions during on-demand loading', async () => {
    for (const mode of ['all', 'on_demand'] as const) {
      const { orchestrator, execute } = createOrchestrator();
      vi.mocked(callLLMWithTools).mockResolvedValueOnce(requested).mockResolvedValueOnce({ content: '完成', toolCalls: [] });
      await orchestrator.runChatAgentLoop({ messages: input, llmConfig: config, systemPrompt: '', allowedToolNames: [], toolLoadingMode: mode });
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it('carries the original write permission into scheduled work without exposing writes during the receipt turn', async () => {
    const { orchestrator, execute } = createOrchestrator();
    const schedule = { ...tool, name: 'x.schedule_run' };
    vi.mocked(orchestrator.getLLMToolDefsFiltered).mockResolvedValue([schedule, { ...tool, name: 'file.write' }]);
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({ content: '', toolCalls: [{ id: 'schedule', name: schedule.name, arguments: {} }] })
      .mockResolvedValueOnce({ content: '已保存计划', toolCalls: [] });
    await orchestrator.runChatAgentLoop({ messages: input, llmConfig: config, systemPrompt: '',
      automaticTextDelivery: true, blockedToolNames: ['shell.run'] });
    expect(vi.mocked(callLLMWithTools).mock.calls[0]?.[1]?.map(item => item.name)).toEqual(['x.schedule_run']);
    expect(execute).toHaveBeenCalledWith(expect.anything(), 'container', expect.objectContaining({
      scheduledToolNames: ['x.schedule_run', 'file.write'],
      scheduledBlockedToolNames: ['shell.run'],
      blockedToolNames: ['shell.run', 'file.write'],
    }));
  });
  it('does not offer or execute blocked tools in all-tools mode', async () => {
    const { orchestrator, execute } = createOrchestrator();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(requested).mockResolvedValueOnce({ content: '完成', toolCalls: [] });
    await orchestrator.runChatAgentLoop({ messages: input, llmConfig: config, systemPrompt: '', blockedToolNames: [tool.name], toolLoadingMode: 'all' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('routes legacy intents to the shared durable runner and refuses an unconfigured fallback', async () => {
    const { orchestrator } = createOrchestrator();
    const value = { intent: '执行', userId: 'owner', llmConfig: config, systemPrompt: '', source: 'run_now' as const };
    await expect(orchestrator.runIntentAsPersistedTask(value)).rejects.toThrow('尚未就绪');
    const runner = vi.fn(async () => ({ content: 'durable receipt' })); orchestrator.setBackgroundIntentRunner(runner);
    expect(await orchestrator.runIntentAsPersistedTask(value)).toEqual({ content: 'durable receipt' }); expect(runner).toHaveBeenCalledWith(value);
  });
  it('keeps tool call identifiers unique across textual-call model rounds', async () => {
    const { orchestrator } = createOrchestrator();
    const repeated = { content: '', toolCalls: [{ id: 'text_call_0', name: tool.name, arguments: {} }] };
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(repeated).mockResolvedValueOnce(repeated)
      .mockResolvedValueOnce({ content: '完成', toolCalls: [] });
    let checkpoint: ChatMessage[] = [];
    await orchestrator.runChatAgentLoop({ messages: input, llmConfig: config, systemPrompt: '',
      onCheckpoint: async (messages) => { checkpoint = structuredClone(messages); } });
    const calls = checkpoint.flatMap((message) => message.tool_calls ?? []);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.id)).size).toBe(2);
    expect(checkpoint.filter((message) => message.role === 'tool').map((message) => message.tool_call_id))
      .toEqual(calls.map((call) => call.id));
  });
  it('awaits durable call checkpoints before dispatch and saves results before final completion', async () => {
    const { orchestrator, execute } = createOrchestrator();
    const checkpoints: ChatMessage[][] = [];
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(requested).mockResolvedValueOnce({ content: '已交付', toolCalls: [] });
    execute.mockImplementationOnce(async () => {
      expect(checkpoints.at(-1)?.at(-1)?.tool_calls?.[0]?.id).toBe('call-1');
      return { id: 'result', toolName: tool.name, input: {}, output: 'saved', startedAt: 1, completedAt: 2, runtimeType: 'container' };
    });
    const result = await orchestrator.runChatAgentLoop({
      messages: input, llmConfig: config, systemPrompt: 'system',
      onCheckpoint: async (messages) => { checkpoints.push(structuredClone(messages)); },
    });
    expect(result.stopReason).toBe('completed');
    expect(checkpoints.some((history) => history.at(-1)?.tool_call_id === 'call-1')).toBe(true);
    expect(checkpoints.at(-1)?.at(-1)).toMatchObject({ role: 'assistant', content: '已交付' });
    expect(vi.mocked(callLLMWithTools).mock.calls[0]?.[0].apiType).toBe('openai');
  });

  it('does not execute model-proposed tools or notify after cancellation', async () => {
    const { orchestrator, execute } = createOrchestrator();
    const controller = new AbortController();
    const onToolEvent = vi.fn();
    vi.mocked(callLLMWithTools).mockImplementationOnce(async (request) => {
      expect(request.signal).toBe(controller.signal);
      controller.abort();
      return requested;
    });
    await expect(orchestrator.runChatAgentLoop({
      messages: input, llmConfig: config, systemPrompt: '', signal: controller.signal, onToolEvent,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).not.toHaveBeenCalled();
    expect(onToolEvent).not.toHaveBeenCalled();
  });

  it('settles a returned tool result before honoring stop and skips subsequent tools', async () => {
    const { orchestrator, execute } = createOrchestrator();
    const controller = new AbortController();
    const checkpoints: ChatMessage[][] = [];
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({ ...requested, toolCalls: [...requested.toolCalls, { ...requested.toolCalls[0], id: 'call-2' }] });
    execute.mockImplementationOnce(async (_step, _runtime, context) => {
      expect(context?.signal).toBe(controller.signal);
      controller.abort();
      return { id: 'result', toolName: tool.name, input: {}, output: 'done', startedAt: 1, completedAt: 2, runtimeType: 'container' };
    });
    await expect(orchestrator.runChatAgentLoop({
      messages: input, llmConfig: config, systemPrompt: '', signal: controller.signal,
      onCheckpoint: async (messages) => { checkpoints.push(structuredClone(messages)); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(checkpoints.at(-1)?.find((message) => message.tool_call_id === 'call-1')).toMatchObject({ content: '"done"' });
    expect(checkpoints.at(-1)?.find((message) => message.tool_call_id === 'call-2')?.content).toContain('cancelledBeforeDispatch');
  });

  it('never dispatches a tool when its preceding checkpoint fails', async () => {
    const { orchestrator, execute } = createOrchestrator();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(requested);
    await expect(orchestrator.runChatAgentLoop({
      messages: input, llmConfig: config, systemPrompt: '',
      onCheckpoint: async (history) => { if (history.at(-1)?.tool_calls) throw new Error('storage failed'); },
    })).rejects.toThrow('storage failed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports budget exhaustion without claiming completion', async () => {
    const { orchestrator } = createOrchestrator();
    vi.mocked(callLLMWithTools).mockResolvedValue(requested);
    const result = await orchestrator.runChatAgentLoop({ messages: input, llmConfig: config, systemPrompt: '', maxSteps: 1 });
    expect(result.stopReason).toBe('step_limit');
  });

  it('waits for the model to settle before pausing and resumes without replaying completed tools', async () => {
    const { orchestrator, execute } = createOrchestrator();
    let finish!: (value: { content: string; toolCalls: [] }) => void;
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(requested).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const task = await orchestrator.createAndRun({ domain: 'agent', title: 'test', description: 'finish', llmConfig: config }, 'user');
    task.metadata = { ...task.metadata, allowedToolNames: [tool.name] };
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(orchestrator.pauseTask(task.id)).toBe(true);
    expect(task.status).toBe('running');
    finish({ content: 'late', toolCalls: [] });
    await vi.waitFor(() => expect(task.status).toBe('paused'));
    expect(task.steps).toHaveLength(1);
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({ content: 'finished', toolCalls: [] });
    expect(await orchestrator.resumeTask(task.id)).toBe(true);
    await vi.waitFor(() => expect(task.status).toBe('completed'));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callLLMWithTools).mock.calls.at(-1)?.[0].messages.some((message) => message.tool_call_id === 'call-1')).toBe(true);
  });

  it('reconciles interrupted legacy tasks while leaving chat runs to their owning service', async () => {
    const insertTask = vi.fn();
    const rows = [
      { id: 'legacy', domain: 'agent', title: 'legacy', status: 'running', steps_json: '[]', metadata_json: '{"userId":"user"}', created_at: 1, updated_at: 1 },
      { id: 'chat-run', domain: 'chat', title: 'chat', status: 'running', steps_json: '[]', metadata_json: '{"userId":"user","chatRun":{"version":1}}', created_at: 1, updated_at: 1 },
    ];
    const db = { getAllTasks: async () => rows, insertTask } as unknown as AsyncDatabase;
    const orchestrator = new AgentOrchestrator(new AuditLogger(), undefined, undefined, db);
    await orchestrator.init();
    expect(orchestrator.getTask('legacy')?.status).toBe('paused');
    expect(orchestrator.getTask('chat-run')).toBeUndefined();
    expect(insertTask).toHaveBeenCalledTimes(1);
    expect(insertTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'legacy', status: 'paused' }));
  });
  it('keeps legacy task credentials out of records and resolves fresh credentials on resume', async () => {
    const saved: unknown[] = [];
    const db = { insertTask: async (row: unknown) => { saved.push(structuredClone(row)); }, updateTaskExecution: async () => {}, getConfig: async () => undefined } as unknown as AsyncDatabase;
    const orchestrator = new AgentOrchestrator(new AuditLogger(), undefined, undefined, db);
    const resolver = vi.fn(async () => ({ ...config, apiKey: 'fresh-server-key', baseUrl: 'https://model.invalid/v1' }));
    orchestrator.setGetLLMConfigForAgent(resolver);
    let release!: () => void;
    vi.spyOn(orchestrator, 'runChatAgentLoop').mockImplementationOnce(async params => {
      expect(params.llmConfig.apiKey).toBe('fresh-server-key');
      await new Promise<void>(resolve => { release = resolve; }); params.signal?.throwIfAborted();
      return { content: 'first', stopReason: 'completed' };
    }).mockImplementationOnce(async params => {
      expect(params.llmConfig.apiKey).toBe('rotated-server-key'); return { content: 'done', stopReason: 'completed' };
    });
    const task = await orchestrator.createAndRun({ domain: 'agent', title: 'credentials', description: 'execute', llmConfig: { ...config, apiKey: 'incoming-key', baseUrl: 'https://incoming.invalid' } }, 'owner');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(JSON.stringify(task)).not.toContain('incoming-key'); expect(JSON.stringify(saved)).not.toContain('fresh-server-key');
    orchestrator.pauseTask(task.id); release(); await vi.waitFor(() => expect(task.status).toBe('paused'));
    resolver.mockResolvedValue({ ...config, apiKey: 'rotated-server-key', baseUrl: 'https://model.invalid/v1' });
    await orchestrator.resumeTask(task.id); await vi.waitFor(() => expect(task.status).toBe('completed'));
    expect(resolver).toHaveBeenCalledTimes(2);
    for (const secret of ['incoming-key','fresh-server-key','rotated-server-key','incoming.invalid']) expect(JSON.stringify(saved)).not.toContain(secret);
  });

  it('does not report a delegated agent as successful when its step budget is exhausted', async () => {
    const { orchestrator } = createOrchestrator();
    orchestrator.setGetLLMConfigForAgent(async () => config);
    vi.spyOn(orchestrator, 'runChatAgentLoop').mockResolvedValue({ content: 'still working', stopReason: 'step_limit' });
    await expect(orchestrator.runCustomAgentLoop({
      agentDef: { id: 'agent', name: 'Agent', systemPrompt: '', toolNames: [], createdAt: 1, updatedAt: 1 },
      goal: 'finish', userId: 'user',
    })).rejects.toThrow('尚未完成');
  });
});
