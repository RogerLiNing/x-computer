import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ChatRunSnapshot } from '@/utils/api';
import { setMiniAppsFromApi } from '@/appRegistry';
import { useChatRun } from './useChatRun';

const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as Array<() => void>, cleanups: new Map<number, () => void>() }));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }];
  },
  useRef(initial: unknown) { const index = hooks.cursor++; return hooks.slots[index] ??= { current: initial }; },
  useCallback(callback: unknown, deps: unknown[]) {
    const index = hooks.cursor++;
    if (!hooks.slots[index] || deps.some((dep, i) => dep !== hooks.slots[index].deps[i])) hooks.slots[index] = { callback, deps };
    return hooks.slots[index].callback;
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = hooks.cursor++;
    if (hooks.slots[index] && deps.every((dep, i) => dep === hooks.slots[index][i])) return;
    hooks.slots[index] = deps;
    hooks.effects.push(() => {
      hooks.cleanups.get(index)?.();
      const cleanup = effect();
      if (cleanup) hooks.cleanups.set(index, cleanup); else hooks.cleanups.delete(index);
    });
  },
}));
vi.mock('@/utils/api', () => ({ api: { listChatRuns: vi.fn(), getChatRun: vi.fn(), stopChatRun: vi.fn(), resumeChatRun: vi.fn(),getMiniApps:vi.fn() } }));
vi.mock('@/appRegistry',()=>({setMiniAppsFromApi:vi.fn()}));
vi.mock('@/utils/userId',()=>({getUserIdOrNull:()=> 'owner'}));

let sessionId: string | null;
const settled = vi.fn();
const snapshot = (status: ChatRunSnapshot['status'], id = 'run-1', session = 'session-1'): ChatRunSnapshot => ({ id, sessionId: session, status, content: '保存的输出', artifacts: [], toolCalls: [], canResume: status === 'paused', updatedAt: 1 });
const render = () => { hooks.cursor = 0; const result = useChatRun(sessionId, settled); hooks.effects.splice(0).forEach((effect) => effect()); return result; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups.clear();
  sessionId = 'session-1';
  vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [] });
});
afterEach(() => { hooks.cleanups.forEach((cleanup) => cleanup()); vi.useRealTimers(); });

describe('服务端交办恢复', () => {
  it('等待命令确认期间持续取状态，并同步另一设备的拒绝决定',async()=>{
    const approval={id:'consent',toolCallId:'call',command:'test',workdir:'.',timeout:5000,workspace:'/test',executionMode:'host' as const,hash:'hash',expiresAt:Date.now()+60000,status:'pending' as const};
    const pending={...snapshot('blocked'),shellApproval:approval,canResume:false};vi.mocked(api.listChatRuns).mockResolvedValue({runs:[pending]});vi.mocked(api.getChatRun).mockResolvedValue(pending);
    render();await flush();render();await vi.advanceTimersByTimeAsync(1000);await flush();render();
    vi.mocked(api.getChatRun).mockResolvedValue({...snapshot('paused'),updatedAt:10,shellApproval:{...approval,status:'rejected'}});await vi.advanceTimersByTimeAsync(5000);await flush();
    expect(render().run?.shellApproval?.status).toBe('rejected');expect(render().run?.canResume).toBe(true);
  });
  it('选中任务的停止回执也作废迟到轮询，并继续跟踪实际暂停结果',async()=>{
    const running=snapshot('running');vi.mocked(api.listChatRuns).mockResolvedValue({runs:[running]});render();await flush();render();
    let resolve!:(next:ChatRunSnapshot)=>void;vi.mocked(api.getChatRun).mockReturnValueOnce(new Promise(done=>resolve=done));await vi.advanceTimersByTimeAsync(1000);
    render().follow({...running,status:'stopping'});render();resolve({...running,updatedAt:50});await flush();expect(render().run?.status).toBe('stopping');
    vi.mocked(api.getChatRun).mockResolvedValue({...snapshot('paused'),updatedAt:100});await vi.advanceTimersByTimeAsync(1000);await flush();expect(render().run?.status).toBe('paused');
  });
  it('修改回执立即启用运行控制，即使后续列表刷新断网也保留',async()=>{
    vi.mocked(api.listChatRuns).mockResolvedValue({runs:[snapshot('completed')]});render();await flush();render();
    const revision=snapshot('running','revision');render().follow(revision);render();
    vi.mocked(api.listChatRuns).mockRejectedValue(new Error('offline'));await render().refresh();
    expect(render().run?.id).toBe('revision');expect(render().isRunning).toBe(true);
    render().follow(snapshot('running','other','different-session'));expect(render().run?.id).toBe('revision');
  });
  it('验收刷新后保留新决定，并立即跟踪正在执行的修改版',async()=>{
    const original={...snapshot('completed'),review:{status:'pending' as const}};
    vi.mocked(api.listChatRuns).mockResolvedValue({runs:[original]});render();await flush();render();
    const returned={...original,updatedAt:2,review:{status:'changes_requested' as const,feedback:'改短一些'}};
    vi.mocked(api.listChatRuns).mockResolvedValue({runs:[returned]});await render().refresh();
    expect(render().run?.review?.status).toBe('changes_requested');
    const revision={...snapshot('running','revision'),updatedAt:3};
    vi.mocked(api.listChatRuns).mockResolvedValue({runs:[revision,returned]});await render().refresh();
    expect(render().run?.id).toBe('revision');expect(render().isRunning).toBe(true);
  });
  it('停止确认后忽略旧轮询的运行态，并继续获取真正的暂停结果',async()=>{
    const running=snapshot('running');vi.mocked(api.listChatRuns).mockResolvedValue({runs:[running]});render();await flush();render();
    let resolve!:(value:ChatRunSnapshot)=>void;vi.mocked(api.getChatRun).mockReturnValueOnce(new Promise(done=>resolve=done));
    await vi.advanceTimersByTimeAsync(1000);vi.mocked(api.stopChatRun).mockResolvedValue({...running,status:'stopping'});await render().stop();render();
    resolve({...running,updatedAt:50,waitingForModel:true});await flush();expect(render().run?.status).toBe('stopping');
    vi.mocked(api.getChatRun).mockResolvedValue({...snapshot('paused'),updatedAt:100});await vi.advanceTimersByTimeAsync(1000);await flush();expect(render().run?.status).toBe('paused');
  });
  it('仅会话消息变化也刷新内容，不改变成果验收版本',async()=>{
    const run={...snapshot('completed'),conversationUpdatedAt:10};vi.mocked(api.listChatRuns).mockResolvedValue({runs:[run]});
    render();await flush();render().accept({...run,conversationUpdatedAt:20});
    expect(settled).toHaveBeenLastCalledWith(expect.objectContaining({updatedAt:run.updatedAt,conversationUpdatedAt:20}));
  });
  it('后台启动助手跟进后切换到真实运行，保留停止入口',async()=>{
    const root={...snapshot('completed'),expertRuns:[{id:'expert',agentName:'专家',status:'completed' as const}]};
    vi.mocked(api.listChatRuns).mockResolvedValue({runs:[root]});render();await flush();render();
    const followup={...snapshot('running','followup-1'),followup:{rootRunId:'run-1',sourceRunId:'expert',sequence:1,eventKey:'event'}};
    vi.mocked(api.getChatRun).mockResolvedValueOnce({...root,followupRunId:'followup-1'}).mockResolvedValueOnce(followup);
    await vi.advanceTimersByTimeAsync(1000);await flush();render();
    expect(render().run?.id).toBe('followup-1');expect(render().isRunning).toBe(true);
  });
  it('初稿完成后仍能收到专家修改版，并刷新原对话消息',async()=>{
    const draft={...snapshot('completed'),expertRuns:[{id:'draft',agentName:'专家',status:'completed' as const}]};
    vi.mocked(api.listChatRuns).mockResolvedValue({runs:[draft]});
    render();await flush();render();
    vi.mocked(api.getChatRun).mockResolvedValue({...draft,updatedAt:20,expertRuns:[{id:'revision',agentName:'专家',status:'completed'}]});
    await vi.advanceTimersByTimeAsync(1000);await flush();render();
    expect(render().run?.expertRuns?.[0].id).toBe('revision');
    expect(settled).toHaveBeenLastCalledWith(expect.objectContaining({updatedAt:20}));
    expect(render().isRunning).toBe(false);
  });
  it('同步已交付的应用到桌面，不需要用户刷新页面',async()=>{
    const run={...snapshot('completed'),toolCalls:[{id:'app',toolName:'x.create_app',status:'completed' as const}]};
    vi.mocked(api.listChatRuns).mockResolvedValue({runs:[run]});vi.mocked(api.getMiniApps).mockResolvedValue({apps:[{id:'created',name:'新应用',path:'apps/created'}]});
    render();await flush();await flush();render();
    expect(setMiniAppsFromApi).toHaveBeenCalledWith([{id:'created',name:'新应用',path:'apps/created'}]);
    expect(api.getMiniApps).toHaveBeenCalledTimes(1);
  });
  it('重新打开会话后恢复已保存的交办及终态消息', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('completed')] });
    render(); await flush();
    expect(render().run?.status).toBe('completed');
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1' }));
  });

  it('切换会话后忽略旧会话迟到的恢复结果', async () => {
    let resolve!: (value: { runs: ChatRunSnapshot[] }) => void;
    vi.mocked(api.listChatRuns).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(); sessionId = 'session-2'; render(); await flush();
    resolve({ runs: [snapshot('completed')] }); await flush();
    expect(render().run).toBeNull();
    expect(settled).not.toHaveBeenCalled();
  });

  it('切换到较早更新的另一会话时仍恢复它的交办', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValueOnce({ runs: [{ ...snapshot('completed'), updatedAt: 20 }] });
    render(); await flush(); render();
    sessionId = 'session-2';
    vi.mocked(api.listChatRuns).mockResolvedValueOnce({ runs: [snapshot('paused', 'run-2', 'session-2')] });
    render(); await flush();
    expect(render().run?.id).toBe('run-2');
  });

  it('新交办开始后拒绝同会话旧交办迟到的终态', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('completed')] });
    render(); await flush();
    const oldAccept = render().accept;
    render().track({ runId: 'run-2', sessionId: 'session-1', status: 'running', serverPersisted: true });
    oldAccept({ ...snapshot('completed'), updatedAt: 99 });
    expect(render().run?.id).toBe('run-2');
    expect(render().isRunning).toBe(true);
  });

  it('同一交办的旧状态不得把已完成回退为运行中', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('completed')] });
    render(); await flush();
    render().accept(snapshot('running'));
    expect(render().run?.status).toBe('completed');
  });

  it('刷新请求晚于新交办返回时保持新交办跟踪', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('completed')] });
    render(); await flush();
    let resolve!: (value: { runs: ChatRunSnapshot[] }) => void;
    vi.mocked(api.listChatRuns).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = render().refresh();
    render().track({ runId: 'run-2', sessionId: 'session-1', status: 'running', serverPersisted: true });
    resolve({ runs: [snapshot('completed')] }); await pending;
    expect(render().run?.id).toBe('run-2');
  });

  it('停止调用服务端并等待其真实终态', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('running')] });
    vi.mocked(api.stopChatRun).mockResolvedValue(snapshot('stopping'));
    render(); await flush(); await render().stop();
    expect(api.stopChatRun).toHaveBeenCalledWith('run-1');
    expect(render().run?.status).toBe('stopping');
    expect(settled).not.toHaveBeenCalled();
  });

  it('恢复同一交办后轮询到完成，而不是创建新交办', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('paused')] });
    vi.mocked(api.resumeChatRun).mockResolvedValue(snapshot('running'));
    vi.mocked(api.getChatRun).mockResolvedValue({ ...snapshot('completed'), updatedAt: 2 });
    render(); await flush(); await render().resume(); render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.resumeChatRun).toHaveBeenCalledWith('run-1');
    expect(render().run?.status).toBe('completed');
  });

  it('窗口卸载只结束跟踪，不停止后台执行', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('running')] });
    render(); await flush(); render();
    hooks.cleanups.forEach((cleanup) => cleanup());
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.stopChatRun).not.toHaveBeenCalled();
    expect(api.getChatRun).not.toHaveBeenCalled();
  });

  it('轮询断网保留运行状态，恢复网络后继续取结果', async () => {
    vi.mocked(api.listChatRuns).mockResolvedValue({ runs: [snapshot('running')] });
    vi.mocked(api.getChatRun).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(snapshot('completed'));
    render(); await flush(); render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(render().isRunning).toBe(true);
    expect(render().error).toContain('重新获取');
    await vi.advanceTimersByTimeAsync(2000);
    expect(render().run?.status).toBe('completed');
  });
});
