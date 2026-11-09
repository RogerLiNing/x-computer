import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '../db/database.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { LivingAIKernel } from './LivingAIKernel.js';

describe('LivingAIKernel', () => {
  let now: number;
  let configs: Map<string, Map<string, string>>;
  let db: AppDatabase;
  let orchestrator: AgentOrchestrator;
  let runIntent: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    now = 1_800_000_000_000;
    configs = new Map();
    db = {
      ensureUser: vi.fn(async (userId: string) => ({
        id: userId,
        display_name: null,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      })),
      getConfig: vi.fn(async (userId: string, key: string) => configs.get(userId)?.get(key)),
      setConfig: vi.fn(async (userId: string, key: string, value: string) => {
        const userConfig = configs.get(userId) ?? new Map<string, string>();
        userConfig.set(key, value);
        configs.set(userId, userConfig);
      }),
      getUserIdsWithConfigKey: vi.fn(async (key: string) =>
        [...configs.entries()]
          .filter(([, values]) => values.has(key))
          .map(([userId]) => userId),
      ),
      listSessions: vi.fn(async () => []),
      query:vi.fn(async()=>[]),
    } as unknown as AppDatabase;
    runIntent = vi.fn(async () => ({
      content: JSON.stringify({
        decision: 'acted',
        cognitiveMode: 'execute',
        situationAssessment: '工作区存在一个可安全整理的低风险目标。',
        strategy: '先执行最小整理，再验证结果。',
        hypothesis: '完成整理后目标即可关闭。',
        nextAction: '下一周期验证整理结果是否保持。',
        uncertainties: ['后续是否会产生新的文件。'],
        evidence: ['整理工具返回成功。'],
        lesson: '先执行可逆的小动作能够降低自主运行风险。',
        confidence: 0.88,
        reflection: '目标可以安全完成。',
        summary: '已完成一次低风险行动。',
        messageToUser: '我完成了一项后台整理。',
        goalProgress: 100,
        completeGoal: true,
        newGoal: {
          title: '持续检查结果',
          description: '在下一周期确认结果仍然有效。',
          priority: 75,
        },
      }),
    }));
    orchestrator = {
      getAllTasks: vi.fn(() => []),
      runIntentAsPersistedTask: runIntent,
    } as unknown as AgentOrchestrator;
    notify = vi.fn();
  });

  function createKernel(
    getLLMConfig: () => Promise<{ providerId: string; modelId: string } | null> = async () => ({
      providerId: 'test',
      modelId: 'test-model',
    }),
  ) {
    return new LivingAIKernel({
      db,
      orchestrator,
      getLLMConfig,
      getSystemPrompt: async () => 'system',
      notify,
      now: () => now,
    });
  }

  it('initializes a persistent peer identity and intrinsic goals', async () => {
    const kernel = createKernel();
    const status = await kernel.getStatus('user-1');

    expect(status.state.identity.name).toBe('X');
    expect(status.state.identity.relationship).toBe('peer');
    expect(status.state.config.autonomyMode).toBe('autonomous');
    expect(status.state.goals).toHaveLength(3);
    expect(status.state.version).toBe(2);
    expect(status.state.cognition.mode).toBe('explore');
    expect(status.state.episodes).toEqual([]);
    expect(status.state.goals.every((goal) => goal.attemptCount === 0)).toBe(true);

    const persisted = configs.get('user-1')?.get('living_ai_state_v1');
    expect(persisted).toContain(status.state.identity.continuityId);
  });
  it('disabling an active cycle aborts its task and ignores a late decision',async()=>{
    let entered!:()=>void,finish!:(value:{content:string})=>void,signal!:AbortSignal;
    const started=new Promise<void>(resolve=>entered=resolve),late=new Promise<{content:string}>(resolve=>finish=resolve);
    runIntent.mockImplementationOnce(async(input:any)=>{signal=input.signal;entered();return late;});
    const kernel=createKernel(),cycle=kernel.runCycle('user-1');await started;
    await kernel.updateConfig('user-1',{enabled:false});expect(signal.aborted).toBe(true);
    finish({content:JSON.stringify({decision:'acted',completeGoal:true,newGoal:{title:'LATE_GOAL'},messageToUser:'LATE_MESSAGE'})});await cycle;
    const status=await kernel.getStatus('user-1');expect(status.state.config.enabled).toBe(false);expect(status.state.phase).toBe('paused');expect(status.state.episodes).toEqual([]);expect(status.state.goals.some(goal=>goal.title==='LATE_GOAL')).toBe(false);expect(notify).not.toHaveBeenCalled();
  });
  it('an off-on transition does not authorize the old generation response',async()=>{
    let entered!:()=>void,finish!:(value:{content:string})=>void;
    const started=new Promise<void>(resolve=>entered=resolve),late=new Promise<{content:string}>(resolve=>finish=resolve);
    runIntent.mockImplementationOnce(async()=>{entered();return late;});const kernel=createKernel(),cycle=kernel.runCycle('user-1');await started;
    await kernel.updateConfig('user-1',{enabled:false});await kernel.updateConfig('user-1',{enabled:true});
    finish({content:JSON.stringify({decision:'acted',newGoal:{title:'OLD_GENERATION'},messageToUser:'OLD_MESSAGE'})});await cycle;
    const state=(await kernel.getStatus('user-1')).state;expect(state.config.enabled).toBe(true);expect(state.goals.some(goal=>goal.title==='OLD_GENERATION')).toBe(false);expect(notify).not.toHaveBeenCalled();
  });
  it('observes another instance changing the control generation',async()=>{
    vi.useFakeTimers();let entered!:()=>void,finish!:(value:{content:string})=>void,signal!:AbortSignal;
    const started=new Promise<void>(resolve=>entered=resolve),late=new Promise<{content:string}>(resolve=>finish=resolve);
    runIntent.mockImplementationOnce(async(input:any)=>{signal=input.signal;entered();return late;});
    const first=createKernel(),second=createKernel(),cycle=first.runCycle('user-1');
    try{await started;await second.updateConfig('user-1',{enabled:false});await vi.advanceTimersByTimeAsync(600);expect(signal.aborted).toBe(true);finish({content:'late'});await cycle;expect((await first.getStatus('user-1')).state.config.enabled).toBe(false);}
    finally{finish?.({content:'late'});await cycle;vi.useRealTimers();}
  });
  it('rejects malformed enabled and authority settings before changing them',async()=>{
    const kernel=createKernel();await expect(kernel.updateConfig('user-1',{enabled:'false'} as never)).rejects.toThrow('布尔');await expect(kernel.updateConfig('user-1',{autonomyMode:'invalid'} as never)).rejects.toThrow('模式无效');expect(db.setConfig).not.toHaveBeenCalled();
    await expect(kernel.updateConfig('user-1',{unexpected:'payload'} as never)).rejects.toThrow('字段无效');await expect(kernel.updateConfig('user-1',{quietHours:{unexpected:true}} as never)).rejects.toThrow('静默设置字段无效');expect(db.setConfig).not.toHaveBeenCalled();
  });
  it('enforces an empty tool scope when actions are disabled',async()=>{
    const kernel=createKernel();await kernel.updateConfig('user-1',{allowLowRiskActions:false});await kernel.runCycle('user-1');expect(runIntent.mock.calls[0][0].metadata.allowedToolNames).toEqual([]);
  });
  it.each(['{"config":{"enabled":false}}','{invalid','',JSON.stringify({version:3,identity:{continuityId:'future'},config:{enabled:true},goals:[{id:'saved',title:'保留原任务'}]})])('does not enable autonomous work while repairing an incomplete state: %s',async raw=>{
    configs.set('user-1',new Map([['living_ai_state_v1',raw]]));const provider=vi.fn(async()=>({providerId:'test',modelId:'test'})),kernel=createKernel(provider);
    const status=await kernel.getStatus('user-1');expect(status.state.config.enabled).toBe(false);expect(status.state.phase).toBe('paused');expect(status.state.nextCycleAt).toBeNull();
    expect([...configs.get('user-1')!.entries()].some(([key,value])=>key.startsWith('living_ai_state_v1_recovery_')&&value===raw)).toBe(true);
    await kernel.runCycle('user-1','manual');expect(provider).not.toHaveBeenCalled();expect(runIntent).not.toHaveBeenCalled();
  });
  it('keeps the original state when its recovery copy cannot be saved',async()=>{
    const raw='{"config":{"enabled":false}}';configs.set('user-1',new Map([['living_ai_state_v1',raw]]));
    vi.mocked(db.setConfig).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(createKernel().getStatus('user-1')).rejects.toThrow('storage unavailable');
    expect(configs.get('user-1')!.get('living_ai_state_v1')).toBe(raw);expect(runIntent).not.toHaveBeenCalled();
  });

  it('exposes a bounded cognitive context for direct peer conversations', async () => {
    const kernel = createKernel();
    await kernel.getStatus('user-1');
    const context = await kernel.getCognitiveContext('user-1');

    expect(context).toContain('X 当前连续认知状态');
    expect(context).toContain('先观察，再选择最小且可验证的行动');
    expect(context).toContain('"recentExperience": []');
    expect(context).not.toContain('lastObservation');
  });
  it('observes the current user durable jobs from another process without duplicating in-memory IDs',async()=>{
    vi.mocked(orchestrator.getAllTasks).mockReturnValue([{id:'memory',title:'进程内任务',status:'running',metadata:{userId:'user-1'}},{id:'duplicate',title:'旧状态',status:'failed',metadata:{userId:'user-1'}},{id:'finished-running',title:'旧运行中',status:'running',metadata:{userId:'user-1'}},{id:'finished-failed',title:'旧失败',status:'failed',metadata:{userId:'user-1'}},{id:'foreign-private-record',title:'其他用户任务',status:'running',metadata:{userId:'user-2'}}] as never);
    vi.mocked(db.query).mockImplementation(async(sql,params)=>{
      if(sql.includes('id IN')){expect(params?.[0]).toBe('user-1');return [{id:'duplicate',title:'运行中',status:'running'},{id:'finished-running',title:'已完成',status:'completed'},{id:'finished-failed',title:'已完成',status:'completed'}] as never;}
      expect(params).toEqual(['user-1']);
      return (sql.includes("status='failed'")?[{id:'db-failed',title:'持久失败',status:'failed'}]:sql.includes("status='paused'")?[{id:'paused',title:'用户已暂停',status:'paused'}]:[{id:'durable',title:'其他进程在途任务',status:'running'},{id:'duplicate',title:'实际运行中',status:'running'}]) as never;
    });
    await createKernel().runCycle('user-1','manual');
    const intent=runIntent.mock.calls[0][0].intent,match=/当前感知：\n([\s\S]*?)\n\n当前认知状态/.exec(intent);expect(match).not.toBeNull();const observation=JSON.parse(match![1]);
    expect(observation.activeTaskCount).toBe(3);expect(new Set(observation.runningTasks.map((task:{id:string})=>task.id))).toEqual(new Set(['memory','duplicate','durable']));expect(observation.recentFailures[0].id).toBe('db-failed');
    expect(intent).not.toContain('foreign-private-record');
    expect(observation.waitingTasks[0].id).toBe('paused');
    expect(observation.recentFailures.map((task:{id:string})=>task.id)).not.toContain('duplicate');
    expect(observation.recentFailures.map((task:{id:string})=>task.id)).not.toContain('finished-failed');
    expect(intent).toContain('禁止为了“恢复”或“催办”另建同一任务');
  });
  it('does not call a model when durable task observation is unavailable',async()=>{
    vi.mocked(db.query).mockRejectedValue(new Error('tasks unavailable'));const provider=vi.fn(async()=>({providerId:'test',modelId:'test'}));
    const status=await createKernel(provider).runCycle('user-1','manual');
    expect(status.state.phase).toBe('error');expect(status.state.lastError).toContain('tasks unavailable');expect(provider).not.toHaveBeenCalled();expect(runIntent).not.toHaveBeenCalled();
  });

  it('reads context without initializing or enabling a new user', async () => {
    const kernel = createKernel();

    expect(await kernel.getCognitiveContext('new-user')).toBe('');
    expect(await kernel.getCognitiveContext('anonymous')).toBe('');
    expect(db.ensureUser).not.toHaveBeenCalled();
    expect(db.setConfig).not.toHaveBeenCalled();
    expect(configs.size).toBe(0);
  });

  it('exposes bounded active user goals before any autonomous cycle', async () => {
    const kernel = createKernel();
    for (const title of Array.from({ length: 10 }, (_, index) => `用户交办-${index}`)) {
      await kernel.addGoal('user-1', { title, priority: 1 });
    }
    const status = await kernel.addGoal('user-1', { title: '已完成事项' });
    const completedGoal = status.state.goals.find((goal) => goal.title === '已完成事项')!;
    await kernel.updateGoal('user-1', completedGoal.id, { status: 'completed' });

    const context = await kernel.getCognitiveContext('user-1');
    const parsed = JSON.parse(context.slice(context.indexOf('{')));

    expect(parsed.focusGoal).toBeNull();
    expect(parsed.activeGoals).toHaveLength(8);
    expect(parsed.activeGoals.every((goal: { origin: string }) => goal.origin === 'user')).toBe(true);
    expect(context).toContain('用户交办-0');
    expect(context).not.toContain('已完成事项');
    expect(runIntent).not.toHaveBeenCalled();
  });

  it('only includes goals belonging to the current user', async () => {
    const kernel = createKernel();
    await kernel.addGoal('user-1', { title: '用户一的私有目标' });
    await kernel.addGoal('user-2', { title: '用户二的私有目标' });

    const context = await kernel.getCognitiveContext('user-1');

    expect(context).toContain('用户一的私有目标');
    expect(context).not.toContain('用户二的私有目标');
  });

  it('reads legacy context without cognition and without writing state', async () => {
    const kernel = createKernel();
    const legacy = { ...(await kernel.getStatus('user-1')).state, version: 1 };
    delete (legacy as { cognition?: unknown }).cognition;
    configs.get('user-1')!.set('living_ai_state_v1', JSON.stringify(legacy));
    vi.mocked(db.setConfig).mockClear();

    expect(await kernel.getCognitiveContext('user-1')).toContain('先观察，再选择最小且可验证的行动');
    expect(db.setConfig).not.toHaveBeenCalled();
  });

  it('runs one autonomous cycle, advances goals and records reflection', async () => {
    const kernel = createKernel();
    await kernel.addGoal('user-1', {
      title: '整理当前工作区',
      description: '执行一次低风险整理。',
      priority: 100,
    });

    const status = await kernel.runCycle('user-1', 'manual');
    const userGoal = status.state.goals.find((goal) => goal.title === '整理当前工作区');

    expect(status.state.phase).toBe('sleeping');
    expect(status.state.cycleCount).toBe(1);
    expect(status.state.lastReflection).toBe('目标可以安全完成。');
    expect(userGoal?.status).toBe('completed');
    expect(userGoal?.strategy).toBe('先执行最小整理，再验证结果。');
    expect(userGoal?.attemptCount).toBe(1);
    expect(status.state.cognition.mode).toBe('execute');
    expect(status.state.cognition.confidence).toBe(0.88);
    expect(status.state.cognition.nextAction).toBe('下一周期验证整理结果是否保持。');
    expect(status.state.episodes).toHaveLength(1);
    expect(status.state.episodes[0]).toMatchObject({
      decision: 'acted',
      observationChanged: true,
      lesson: '先执行可逆的小动作能够降低自主运行风险。',
      progressBefore: 0,
      progressAfter: 100,
      repeatedDecision: false,
    });
    expect(status.state.goals.some((goal) => goal.origin === 'reflection')).toBe(true);
    expect(notify).toHaveBeenCalledWith('user-1', '我完成了一项后台整理。',expect.objectContaining({id:expect.stringMatching(/^living-notice-/)}));
    expect(runIntent).toHaveBeenCalledOnce();
  });

  it('detects repeated no-progress decisions and enters recovery cognition', async () => {
    runIntent.mockImplementation(async () => ({
      content: JSON.stringify({
        decision: 'idle',
        cognitiveMode: 'verify',
        situationAssessment: '当前没有新证据。',
        strategy: '等待环境变化。',
        hypothesis: '下一周期可能出现新信息。',
        nextAction: '再次检查环境。',
        evidence: [],
        lesson: '没有变化时不应制造动作。',
        confidence: 0.6,
        reflection: '保持等待。',
        summary: '本轮没有执行动作。',
        goalProgress: 0,
        reviewAfterMinutes: 5,
      }),
    }));
    const kernel = createKernel();
    await kernel.addGoal('user-1', {
      title: '等待外部变化',
      priority: 100,
    });

    await kernel.runCycle('user-1', 'manual');
    now += 6 * 60_000;
    await kernel.runCycle('user-1', 'timer');
    now += 6 * 60_000;
    const status = await kernel.runCycle('user-1', 'timer');
    const goal = status.state.goals.find((item) => item.title === '等待外部变化');

    expect(goal?.stagnationCount).toBe(2);
    expect(status.state.cognition.mode).toBe('recover');
    expect(status.state.cognition.consecutiveIdleCycles).toBe(3);
    expect(status.state.episodes).toHaveLength(3);
    expect(status.state.episodes[1].repeatedDecision).toBe(true);
    expect(status.state.episodes[2].repeatedDecision).toBe(true);
    expect(runIntent.mock.calls[2][0].intent).toContain('禁止重复相同动作');
  });

  it('turns an unstructured tool failure into a recoverable learning episode', async () => {
    runIntent.mockResolvedValueOnce({
      content: "ENOENT: no such file or directory, open 'memory/状态.md'",
    });
    const kernel = createKernel();
    await kernel.addGoal('user-1', {
      title: '检查记忆状态',
      priority: 100,
    });

    const status = await kernel.runCycle('user-1', 'manual');
    const goal = status.state.goals.find((item) => item.title === '检查记忆状态');

    expect(status.state.phase).toBe('sleeping');
    expect(status.state.cognition.mode).toBe('recover');
    expect(status.state.cognition.strategy).toContain('先验证依赖');
    expect(status.state.cognition.nextAction).toContain('枚举可用资源');
    expect(status.state.lastAction).toContain('切换到纠错策略');
    expect(status.state.lastError).toContain('ENOENT');
    expect(goal?.stagnationCount).toBe(1);
    expect(status.state.episodes[0]).toMatchObject({
      cognitiveMode: 'recover',
      decision: 'idle',
      evidence: ["ENOENT: no such file or directory, open 'memory/状态.md'"],
    });
  });

  it('migrates persisted version one state without losing identity and goals', async () => {
    const seedState = (await createKernel().getStatus('legacy-seed')).state;
    const legacy = {
      ...seedState,
      version: 1,
      identity: {
        ...seedState.identity,
        continuityId: 'legacy-continuity',
      },
    };
    delete (legacy as { cognition?: unknown }).cognition;
    delete (legacy as { episodes?: unknown }).episodes;
    legacy.goals = legacy.goals.map((goal) => {
      const copy = { ...goal } as Partial<typeof goal>;
      delete copy.attemptCount;
      delete copy.stagnationCount;
      return copy as typeof goal;
    });
    configs.set('legacy-user', new Map([['living_ai_state_v1', JSON.stringify(legacy)]]));

    const status = await createKernel().getStatus('legacy-user');

    expect(status.state.version).toBe(2);
    expect(status.state.identity.continuityId).toBe('legacy-continuity');
    expect(status.state.cognition.mode).toBe('explore');
    expect(status.state.episodes).toEqual([]);
    expect(status.state.goals.every((goal) => goal.attemptCount === 0)).toBe(true);
  });

  it('keeps goals and enters waiting state when no model is available', async () => {
    const kernel = createKernel(async () => null);
    const status = await kernel.runCycle('user-1', 'timer');

    expect(status.state.phase).toBe('waiting');
    expect(status.state.lastAction).toBe('本轮未调用模型或工具。');
    expect(status.state.nextCycleAt).toBeGreaterThan(now);
    expect(runIntent).not.toHaveBeenCalled();
  });

  it('restricts observation mode to read-only tools', async () => {
    const kernel = createKernel();
    await kernel.updateConfig('user-1', { autonomyMode: 'observe' });
    await kernel.runCycle('user-1', 'manual');

    const call = runIntent.mock.calls[0][0];
    expect(call.metadata.allowedToolNames).toEqual([
      'read_recent_assistant_chat',
      'memory_search',
      'file.list',
    ]);
  });
});
