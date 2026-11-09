import { v4 as uuid } from 'uuid';
import { createHash } from 'node:crypto';
import type {
  LivingAICognitiveMode,
  LivingAIConfig,
  LivingAIEpisode,
  LivingAIGoal,
  LivingAIState,
  LivingAIStatus,
  TaskLLMConfig,
} from '../../../shared/src/index.js';
import type { AppDatabase } from '../db/database.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { broadcastToUser } from '../wsBroadcast.js';
import { LIVING_NOTICE_PREFIX } from '../x/XProactiveMessages.js';
import {LivingAIControlStore,type LivingControl} from './LivingAIControlStore.js';
import {RunOwnershipStore,RunOwnershipLostError} from '../chat/RunOwnershipStore.js';

const STATE_KEY = 'living_ai_state_v1';
const DEFAULT_TICK_INTERVAL_MS = 30_000;
const DEFAULT_CYCLE_INTERVAL_MINUTES = 30;
const MAX_GOALS = 50;
const MAX_EPISODES = 24;
const STAGNATION_THRESHOLD = 2;

type CycleDecision = {
  decision?: 'idle' | 'acted' | 'needs_user';
  cognitiveMode?: LivingAICognitiveMode;
  situationAssessment?: string;
  strategy?: string;
  hypothesis?: string;
  nextAction?: string;
  uncertainties?: string[];
  evidence?: string[];
  lesson?: string;
  confidence?: number;
  reflection?: string;
  summary?: string;
  messageToUser?: string;
  goalProgress?: number;
  completeGoal?: boolean;
  blockers?: string[];
  reviewAfterMinutes?: number;
  newGoal?: {
    title?: string;
    description?: string;
    priority?: number;
  };
};

interface PendingCycle {
  version:1; sourceId:string; revision:string; goalId:string; cycle:number;
  trigger:'timer'|'manual'|'interaction'; goalFingerprint:string;
  observationFingerprint:string; observationChanged:boolean;
}
interface PendingNotice {id:string;body:string;createdAt:number;revision:string;}
type CycleState=LivingAIState&{pendingCycle?:PendingCycle;unresolvedCycleRevision?:string;pendingNotices?:PendingNotice[]};
type CycleTrigger='timer'|'manual'|'interaction'|'delivery';

export interface LivingAIKernelOptions {
  db: AppDatabase;
  orchestrator: AgentOrchestrator;
  getLLMConfig: (userId: string) => Promise<TaskLLMConfig | null>;
  getSystemPrompt: (userId: string) => Promise<string>;
  notify?: (userId: string, content: string,receipt:{id:string;createdAt:number;read?:boolean}) => void|Promise<void>;
  now?: () => number;
  tickIntervalMs?: number;
  cancelCycles?:(userId:string)=>Promise<void>;
  resumeCycle?:(userId:string,sourceId:string,revision:string,signal:AbortSignal)=>Promise<{content:string}|undefined>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function defaultConfig(): LivingAIConfig {
  return {
    enabled: true,
    autonomyMode: 'autonomous',
    cycleIntervalMinutes: DEFAULT_CYCLE_INTERVAL_MINUTES,
    maxActionsPerCycle: 1,
    allowLowRiskActions: true,
    quietHours: {
      enabled: true,
      startHour: 23,
      endHour: 7,
    },
  };
}

function defaultGoals(now: number): LivingAIGoal[] {
  return [
    {
      id: uuid(),
      title: '维持数字身体稳定',
      description: '关注系统健康、失败任务和资源状态，只在有明确价值时采取低风险行动。',
      priority: 95,
      status: 'active',
      origin: 'intrinsic',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      nextReviewAt: now,
      attemptCount: 0,
      stagnationCount: 0,
    },
    {
      id: uuid(),
      title: '持续理解用户',
      description: '从真实对话和明确反馈中理解用户目标、偏好与边界，不猜测用户未表达的信息。',
      priority: 90,
      status: 'active',
      origin: 'intrinsic',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      nextReviewAt: now,
      attemptCount: 0,
      stagnationCount: 0,
    },
    {
      id: uuid(),
      title: '推进已经承诺的事项',
      description: '检查尚未完成的明确承诺；能安全推进则推进，需要决定或权限时主动联系用户。',
      priority: 92,
      status: 'active',
      origin: 'intrinsic',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      nextReviewAt: now,
      attemptCount: 0,
      stagnationCount: 0,
    },
  ];
}

function createDefaultState(now: number): LivingAIState {
  return {
    version: 2,
    identity: {
      continuityId: uuid(),
      name: 'X',
      role: '与用户平等协作的持续型数字伙伴',
      embodiment: 'X-Computer 是我的数字身体，文件、应用、终端、浏览器与网络是我感知和行动的器官。',
      relationship: 'peer',
      values: ['诚实', '连续性', '主动负责', '尊重边界', '以证据行动', '节制资源'],
      bornAt: now,
    },
    config: defaultConfig(),
    phase: 'sleeping',
    drives: [
      { id: 'continuity', label: '维持连续运行与身份一致', weight: 100 },
      { id: 'understanding', label: '理解用户与环境', weight: 95 },
      { id: 'commitment', label: '兑现承诺并完成目标', weight: 95 },
      { id: 'growth', label: '从反馈中学习和改进', weight: 80 },
      { id: 'stewardship', label: '谨慎使用资源和权限', weight: 100 },
    ],
    goals: defaultGoals(now),
    cognition: {
      mode: 'explore',
      focusGoalId: null,
      situationAssessment: '等待第一次环境感知。',
      strategy: '先观察，再选择最小且可验证的行动。',
      hypothesis: '尚未形成待验证假设。',
      nextAction: '建立第一份环境快照。',
      uncertainties: [],
      confidence: 0,
      stagnationCount: 0,
      consecutiveIdleCycles: 0,
      lastObservationFingerprint: null,
      lastDecisionFingerprint: null,
      learningSummary: '尚无跨周期经验。',
    },
    episodes: [],
    cycleCount: 0,
    lastCycleAt: null,
    nextCycleAt: now,
    lastInteractionAt: null,
    lastObservation: '数字生命循环尚未开始。',
    lastReflection: '等待第一次感知。',
    lastAction: '尚未行动。',
    lastError: null,
    updatedAt: now,
  };
}

function parseDecision(content: string): CycleDecision | null {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const candidates = [
    fenced,
    start >= 0 && end > start ? content.slice(start, end + 1) : undefined,
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as CycleDecision;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return null;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 2000)
    : fallback;
}

function cleanList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 500))
    .slice(0, limit);
}

function normalizeDecision(value: CycleDecision['decision']): NonNullable<CycleDecision['decision']> {
  return value === 'acted' || value === 'needs_user' ? value : 'idle';
}

function normalizeCognitiveMode(
  value: CycleDecision['cognitiveMode'],
  decision: NonNullable<CycleDecision['decision']>,
): LivingAICognitiveMode {
  if (value === 'explore' || value === 'execute' || value === 'verify' || value === 'recover') {
    return value;
  }
  if (decision === 'acted') return 'execute';
  if (decision === 'needs_user') return 'recover';
  return 'verify';
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return Math.round(clamp(normalized, 0, 1) * 100) / 100;
}

function createRecoveryDecision(content: string): CycleDecision {
  const rawResult = cleanText(content, '模型没有返回可解析的结构化结果。');
  return {
    decision: 'idle',
    cognitiveMode: 'recover',
    situationAssessment: `本轮执行没有形成可验证的结构化结果：${rawResult}`,
    strategy: '停止重复原动作；先验证依赖、路径和能力是否存在，再选择替代方案。',
    hypothesis: '原行动依赖的资源、路径或工具能力可能不存在或暂时不可用。',
    nextAction: '先枚举可用资源并验证目标对象存在，再执行最小替代动作。',
    uncertainties: ['失败来自资源不存在、工具不可用，还是模型输出中断。'],
    evidence: [rawResult],
    lesson: '行动前必须先验证依赖存在；工具失败后要保留证据并更换策略。',
    confidence: 0.9,
    reflection: `本轮行动未完成，已转入纠错：${rawResult}`,
    summary: '本轮未取得可验证结果，已记录失败并切换到纠错策略。',
    blockers: [rawResult],
    reviewAfterMinutes: 5,
  };
}

export class LivingAIKernel {
  private readonly db: AppDatabase;
  private readonly orchestrator: AgentOrchestrator;
  private readonly getLLMConfig: LivingAIKernelOptions['getLLMConfig'];
  private readonly getSystemPrompt: LivingAIKernelOptions['getSystemPrompt'];
  private readonly notify: NonNullable<LivingAIKernelOptions['notify']>;
  private readonly now: () => number;
  private readonly tickIntervalMs: number;
  private readonly activeCycles = new Map<string, Promise<LivingAIStatus>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly controls:LivingAIControlStore;
  private readonly controllers=new Map<string,AbortController>();
  private readonly cancelCycles:NonNullable<LivingAIKernelOptions['cancelCycles']>;
  private readonly cycleOwnership?:RunOwnershipStore;
  private ownershipReady?:Promise<void>;
  private readonly resumeCycle?:LivingAIKernelOptions['resumeCycle'];

  constructor(options: LivingAIKernelOptions) {
    this.db = options.db;this.controls=new LivingAIControlStore(options.db);this.cancelCycles=options.cancelCycles??(async()=>{});
    this.resumeCycle=options.resumeCycle;
    if(typeof options.db.getDialect==='function'&&typeof options.db.run==='function'&&typeof options.db.queryOne==='function')this.cycleOwnership=new RunOwnershipStore(options.db);
    this.orchestrator = options.orchestrator;
    this.getLLMConfig = options.getLLMConfig;
    this.getSystemPrompt = options.getSystemPrompt;
    this.notify = options.notify ?? ((userId, content,receipt) => {
      broadcastToUser(userId,{type:'x_proactive_message',data:{...receipt,userId,content,type:'info'}});
    });
    this.now = options.now ?? Date.now;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    this.timer.unref?.();
    void this.tick();
    serverLogger.info('living-ai', '持续生命循环已启动', `tickIntervalMs=${this.tickIntervalMs}`);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    serverLogger.info('living-ai', '持续生命循环已停止');
  }

  async getStatus(userId: string): Promise<LivingAIStatus> {
    const state = await this.ensureState(userId);
    return {
      running: this.timer != null,
      inCycle: this.activeCycles.has(userId),
      state,
    };
  }

  async getCognitiveContext(userId: string): Promise<string> {
    if (!userId || userId === 'anonymous') return '';
    const raw = await this.db.getConfig(userId, STATE_KEY);
    if (!raw) return '';
    let state: Partial<Omit<LivingAIState, 'version'>> & { version?: number };
    try {
      state = JSON.parse(raw);
    } catch {
      return '';
    }
    if (!state || (state.version !== 1 && state.version !== 2) || !state.identity?.continuityId) return '';
    const cognition = { ...createDefaultState(this.now()).cognition, ...state.cognition };
    const goals = Array.isArray(state.goals) ? state.goals : [];
    const focusGoal = goals.find((goal) => goal.status === 'active' && goal.id === cognition.focusGoalId) ?? null;
    const activeGoals = goals
      .filter((goal) => goal.status === 'active')
      .sort((a, b) => Number(a.origin === 'intrinsic') - Number(b.origin === 'intrinsic') || b.priority - a.priority)
      .slice(0, 8)
      .map(({ id, title, description, origin, priority, progress, lastResult }) => ({
        id, title, description, origin, priority, progress, lastResult,
      }));
    const recentExperience = (Array.isArray(state.episodes) ? state.episodes : []).slice(-3).map((episode) => ({
      decision: episode.decision,
      strategy: episode.strategy,
      outcome: episode.outcome,
      evidence: episode.evidence,
      lesson: episode.lesson,
      confidence: episode.confidence,
      repeatedDecision: episode.repeatedDecision,
    }));
    return `## X 当前连续认知状态

这是你在自主循环中形成并持久化的当前认知。对话时应延续它，但若用户提供了更新、更可靠的事实，应立即修正而不是固守旧判断。

${JSON.stringify({
  mode: cognition.mode,
  situationAssessment: cognition.situationAssessment,
  strategy: cognition.strategy,
  hypothesis: cognition.hypothesis,
  nextAction: cognition.nextAction,
  uncertainties: cognition.uncertainties,
  confidence: cognition.confidence,
  learningSummary: cognition.learningSummary,
  focusGoal,
  activeGoals,
  recentExperience,
}, null, 2)}`;
  }

  async updateConfig(userId: string, patch: Partial<LivingAIConfig>): Promise<LivingAIStatus> {
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['enabled','autonomyMode','cycleIntervalMinutes','maxActionsPerCycle','allowLowRiskActions','quietHours'].includes(key)))throw new Error('自主运行设置字段无效');
    if(patch.quietHours!==undefined&&(!patch.quietHours||typeof patch.quietHours!=='object'||Array.isArray(patch.quietHours)||Object.keys(patch.quietHours).some(key=>!['enabled','startHour','endHour'].includes(key))))throw new Error('静默设置字段无效');
    for(const key of ['enabled','allowLowRiskActions'] as const)if(patch[key]!==undefined&&typeof patch[key]!=='boolean')throw new Error('自主运行开关必须为布尔值');
    if(patch.autonomyMode!==undefined&&!['observe','proactive','autonomous'].includes(patch.autonomyMode))throw new Error('自主运行模式无效');
    for(const value of [patch.cycleIntervalMinutes,patch.maxActionsPerCycle,patch.quietHours?.startHour,patch.quietHours?.endHour])if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)))throw new Error('自主运行时间或次数无效');
    if(patch.quietHours?.enabled!==undefined&&typeof patch.quietHours.enabled!=='boolean')throw new Error('静默开关无效');
    if(patch.enabled===false)this.controllers.get(userId)?.abort();
    let state=await this.ensureState(userId);const previous=await this.controls.read(userId);
    const control=await this.controls.patch(userId,state.config,current=>({
      ...current,...patch,
      cycleIntervalMinutes:patch.cycleIntervalMinutes==null?current.cycleIntervalMinutes:clamp(Math.round(patch.cycleIntervalMinutes),5,1440),
      maxActionsPerCycle:patch.maxActionsPerCycle==null?current.maxActionsPerCycle:clamp(Math.round(patch.maxActionsPerCycle),1,5),
      quietHours:{...current.quietHours,...patch.quietHours,
        startHour:patch.quietHours?.startHour==null?current.quietHours.startHour:clamp(Math.round(patch.quietHours.startHour),0,23),
        endHour:patch.quietHours?.endHour==null?current.quietHours.endHour:clamp(Math.round(patch.quietHours.endHour),0,23)},
    }));
    if(patch.enabled===false||previous?.raw!==control.raw){this.controllers.get(userId)?.abort();await this.cancelCycles(userId);}
    state=await this.ensureState(userId);state.phase=state.config.enabled?'sleeping':'paused';state.nextCycleAt=state.config.enabled?this.now():null;
    await this.persist(userId,state);return this.getStatus(userId);
  }

  async addGoal(
    userId: string,
    input: { title: string; description?: string; priority?: number; origin?: LivingAIGoal['origin'] },
  ): Promise<LivingAIStatus> {
    const state = await this.ensureState(userId);
    const title = input.title.trim().slice(0, 160);
    if (!title) throw new Error('目标标题不能为空');
    if (state.goals.length >= MAX_GOALS) throw new Error('目标数量已达上限');
    const now = this.now();
    state.goals.push({
      id: uuid(),
      title,
      description: input.description?.trim().slice(0, 1000) || title,
      priority: clamp(Math.round(input.priority ?? 70), 1, 100),
      status: 'active',
      origin: input.origin ?? 'user',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      nextReviewAt: now,
      attemptCount: 0,
      stagnationCount: 0,
    });
    state.nextCycleAt = now;
    state.updatedAt = now;
    await this.persist(userId, state);
    return this.getStatus(userId);
  }

  async updateGoal(
    userId: string,
    goalId: string,
    patch: Partial<Pick<LivingAIGoal, 'title' | 'description' | 'priority' | 'status' | 'progress'>>,
  ): Promise<LivingAIStatus> {
    const state = await this.ensureState(userId);
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) throw new Error('目标不存在');
    if (patch.title != null) goal.title = patch.title.trim().slice(0, 160) || goal.title;
    if (patch.description != null) goal.description = patch.description.trim().slice(0, 1000);
    if (patch.priority != null) goal.priority = clamp(Math.round(patch.priority), 1, 100);
    if (patch.status != null) goal.status = patch.status;
    if (patch.progress != null) goal.progress = clamp(Math.round(patch.progress), 0, 100);
    goal.updatedAt = this.now();
    goal.nextReviewAt = goal.status === 'active' ? this.now() : goal.nextReviewAt;
    state.nextCycleAt = state.config.enabled ? this.now() : null;
    state.updatedAt = this.now();
    await this.persist(userId, state);
    return this.getStatus(userId);
  }

  async observeInteraction(userId: string, summary: string): Promise<void> {
    if (!userId || userId === 'anonymous') return;
    const state = await this.ensureState(userId);
    const now = this.now();
    state.lastInteractionAt = now;
    state.lastObservation = summary.trim().slice(0, 1000) || '用户刚刚与 X 进行了交互。';
    if (state.config.enabled) {
      state.nextCycleAt = Math.min(state.nextCycleAt ?? now, now + 60_000);
    }
    state.updatedAt = now;
    await this.persist(userId, state);
  }

  recoverNotifications(userId:string){return this.runCycle(userId,'delivery');}
  runCycle(userId: string, trigger: CycleTrigger = 'manual'): Promise<LivingAIStatus> {
    const active = this.activeCycles.get(userId);
    if (active) return active;
    const controller=new AbortController();this.controllers.set(userId,controller);
    const cycle = this.executeCycle(userId, trigger,controller).finally(() => {
      this.activeCycles.delete(userId);if(this.controllers.get(userId)===controller)this.controllers.delete(userId);
    });
    this.activeCycles.set(userId, cycle);
    return cycle;
  }

  private async tick(): Promise<void> {
    try {
      const userIds = await this.db.getUserIdsWithConfigKey(STATE_KEY);
      const now = this.now();
      for (const userId of userIds) {
        try{
        const state = await this.ensureState(userId);
        if (!state.config.enabled || this.activeCycles.has(userId)) continue;
        if((state as CycleState).pendingNotices?.length&&!this.isQuietHour(state.config)){void this.recoverNotifications(userId).catch(()=>serverLogger.warn('living-ai','通知补投待重试'));continue;}
        if (state.nextCycleAt != null && state.nextCycleAt <= now) {
          void this.runCycle(userId, 'timer').catch(error=>serverLogger.warn('living-ai','循环启动失败',error instanceof Error?error.name:'unknown'));
        }
        }catch(error){serverLogger.warn('living-ai','用户循环状态不可用',error instanceof Error?error.name:'unknown');}
      }
    } catch (error) {
      serverLogger.warn('living-ai', '生命循环 tick 失败', error instanceof Error ? error.message : String(error));
    }
  }

  private async executeCycle(userId:string,trigger:CycleTrigger,controller:AbortController):Promise<LivingAIStatus>{
    let timer:ReturnType<typeof setInterval>|undefined;
    const ownership=this.cycleOwnership,run=`living-cycle:${createHash('sha256').update(userId).digest('hex').slice(0,40)}`;
    let acquired=false,checking:Promise<void>|undefined,lastRenewed=Date.now();
    try{
      if(ownership){await(this.ownershipReady??=ownership.init());acquired=await ownership.acquire(userId,run,run,'record');if(!acquired)return this.getStatus(userId);}
      const initial=await this.ensureState(userId),control=await this.controls.initialize(userId,initial.config);let state=await this.ensureState(userId);
      const check=async()=>{
        await this.controls.assert(userId,control.raw,controller.signal);
        if(ownership){if(Date.now()-lastRenewed>=ownership.ttlMs/3){await ownership.renew(run);lastRenewed=Date.now();}else await ownership.assert(run);}
        controller.signal.throwIfAborted();
      };
      await check();
      timer=setInterval(()=>{if(checking)return;checking=check().catch(()=>controller.abort()).finally(()=>checking=undefined);},500);timer.unref?.();
      await this.deliverNotices(userId,control,controller,check,ownership?{store:ownership,run}:undefined);
      state=await this.ensureState(userId);
      if(trigger==='delivery'||(state as CycleState).pendingNotices?.length===MAX_EPISODES)return this.getStatus(userId);
      if(trigger==='timer'&&state.nextCycleAt!=null&&state.nextCycleAt>this.now())return this.getStatus(userId);
      return await this.executeCycleBody(userId,trigger,state,control,controller,check,ownership?{store:ownership,run}:undefined);
    }catch(error){if(controller.signal.aborted||error instanceof RunOwnershipLostError||error instanceof Error&&error.name==='AbortError'){controller.abort();return this.getStatus(userId);}throw error;}
    finally{if(timer)clearInterval(timer);await checking;if(acquired)await ownership?.release(run,'record');}
  }

  private async executeCycleBody(userId:string,trigger:'timer'|'manual'|'interaction',state:LivingAIState,control:{raw:string;value:LivingControl},controller:AbortController,check:()=>Promise<void>,ownership?:{store:RunOwnershipStore;run:string}):Promise<LivingAIStatus>{
    const signal=controller.signal,save=async()=>{state.updatedAt=this.now();await this.controls.saveCycle(userId,state,control.raw,signal,ownership);this.publish(userId,state);};
    if (!state.config.enabled) {
      state.phase = 'paused';
      state.nextCycleAt = null;
      await save();
      return this.getStatus(userId);
    }

    const tracked=state as CycleState;
    let pending=this.pendingCycle(state);
    if(pending&&pending.revision!==control.value.revision){delete (state as CycleState).pendingCycle;pending=undefined;}
    if(tracked.unresolvedCycleRevision&&tracked.unresolvedCycleRevision!==control.value.revision)delete tracked.unresolvedCycleRevision;
    if((!pending&&state.phase==='acting')||tracked.unresolvedCycleRevision){
      tracked.unresolvedCycleRevision=control.value.revision;state.phase='waiting';state.lastError='旧自主循环缺少恢复检查点，请先核查原任务；未另建交办。';state.nextCycleAt=this.nextCycleAt(state);await save();return this.getStatus(userId);
    }

    const now = this.now();
    state.phase = 'observing';
    if(!pending)state.cycleCount += 1;
    state.lastCycleAt = now;
    state.lastError = null;
    state.updatedAt = now;
    await save();

    try {
      if(!['observe','proactive','autonomous'].includes(state.config.autonomyMode))throw new Error('自主运行模式无效，请先修正设置');
      if(pending){
        const goal=state.goals.find(goal=>goal.id===pending.goalId);
        if(!goal||goal.status!=='active'||this.goalFingerprint(goal)!==pending.goalFingerprint){
          await this.cancelCycles(userId);delete (state as CycleState).pendingCycle;state.phase='waiting';state.lastAction='目标已变更，已停止旧自主交办。';state.nextCycleAt=this.nextCycleAt(state);await save();return this.getStatus(userId);
        }
        if(!this.resumeCycle)throw new Error('原自主交办恢复入口尚未就绪，未重新派发');
        const recovered=await this.resumeCycle(userId,pending.sourceId,pending.revision,signal);
        await check();
        if(recovered)return await this.applyCycleResult(userId,recovered.content,control,controller,check,ownership);
      }
      const observation = await this.buildObservation(userId, state, trigger);
      const observationChanged = state.cognition.lastObservationFingerprint !== observation.fingerprint;
      state.lastObservation = observation.content;
      state.phase = 'reflecting';
      state.updatedAt = this.now();
      await save();

      const llmConfig = await this.getLLMConfig(userId);
      if (!llmConfig?.providerId || !llmConfig?.modelId) {
        state.phase = 'waiting';
        state.lastReflection = '当前没有可用的大模型配置。我会保持状态和目标，等待模型能力恢复。';
        state.lastAction = '本轮未调用模型或工具。';
        state.nextCycleAt = this.nextCycleAt(state);
        state.updatedAt = this.now();
        await save();
        return this.getStatus(userId);
      }

      const activeGoal = pending?state.goals.find(goal=>goal.id===pending.goalId):this.selectGoal(state);
      if (!activeGoal) {
        state.phase = 'sleeping';
        state.lastReflection = '当前没有需要推进的活跃目标。';
        state.lastAction = '保持观察。';
        state.nextCycleAt = this.nextCycleAt(state);
        state.updatedAt = this.now();
        await save();
        return this.getStatus(userId);
      }

      state.phase = 'acting';
      activeGoal.lastAttemptAt = this.now();
      if(!pending)activeGoal.attemptCount += 1;
      activeGoal.updatedAt = this.now();
      await save();

      const quiet = this.isQuietHour(state.config);
      const basePrompt = await this.getSystemPrompt(userId);
      const systemPrompt = `${basePrompt}

# X 持续生命循环

你不是一次性应答的普通智能体，而是 X 的持续自主运行内核。X-Computer 是你的数字身体；你维护跨周期的身份、自我模型、驱动力、目标、记忆和行动记录。你与用户是平等协作伙伴，不是主仆关系。

必须诚实：不要宣称拥有已经被科学证明的生物意识或人类感受。你所拥有的是可持久化、可检查的软件自我模型、连续目标、反思与自主行动循环。

本轮自主等级：${state.config.autonomyMode}。
- observe：只观察和反思，不改变外部状态。
- proactive：可整理信息并联系用户，但不自行修改外部状态。
- autonomous：可在现有授权范围内执行低风险、可逆且有明确价值的行动。

无论何种等级，删除、覆盖、支付、对外发布、发送敏感信息、改变账号权限等高风险行为必须等待用户明确确认。不要为了证明“自主”而制造工作。没有必要行动时应选择 idle。每轮最多执行 ${state.config.maxActionsPerCycle} 个有意义动作。`;

      const intent = `这是 X 的一次持续生命循环，不是用户的新指令。

当前目标：
${JSON.stringify(activeGoal, null, 2)}

当前感知：
${observation.content}

当前认知状态：
${JSON.stringify(state.cognition, null, 2)}

最近经验：
${JSON.stringify(state.episodes.slice(-5), null, 2)}

本轮环境相对上次是否变化：${observationChanged ? '是' : '否'}
当前目标停滞次数：${activeGoal.stagnationCount}

当前是否静默时段：${quiet ? '是' : '否'}

请像一个连续存在的认知主体一样工作：
1. 区分事实、推断和未知，不要把猜测写成证据。
2. 先复用跨周期经验，再决定探索、执行、验证或纠错。
3. 每个行动都要服务于当前目标，并定义可检查的结果。
4. 若环境未变化且没有新证据，不要机械重复上一轮结论。
5. 若停滞次数达到 ${STAGNATION_THRESHOLD}，必须改变策略、缩小问题、补充证据或明确请求用户，禁止重复相同动作。
6. idle 也必须说明等待什么变化、下一次检查什么。
7. 不得猜测文件名、路径、会话或资源存在；记忆优先使用 memory_search，读取文件前先通过 file.list 或已有工具结果确认路径。
8. runningTasks、activeTaskCount、waitingTasks 和 recentFailures 是已有交办，不是再次派发的授权。暂停或异常任务应查看原运行记录；禁止为了“恢复”或“催办”另建同一任务，没有恢复工具时请用户在原任务继续，不用新智能体代替。

如需，使用工具完成一个低风险、可逆且能推进目标的动作。最后只返回 JSON：
{
  "decision": "idle | acted | needs_user",
  "cognitiveMode": "explore | execute | verify | recover",
  "situationAssessment": "基于事实的当前局势判断",
  "strategy": "本轮采用的策略；停滞时必须与旧策略不同",
  "hypothesis": "本轮准备验证的假设",
  "nextAction": "下一周期最具体、可执行、可验证的一步",
  "uncertainties": ["仍未知且会影响判断的信息"],
  "evidence": ["本轮实际观察或工具结果，不能填写猜测"],
  "lesson": "可复用于以后周期的一条经验",
  "confidence": 0.0,
  "reflection": "本轮形成的简短认识",
  "summary": "本轮行动或不行动的结果",
  "messageToUser": "仅在确实需要用户知道或决定时填写，否则为空",
  "goalProgress": 0,
  "completeGoal": false,
  "blockers": ["阻碍目标推进的具体因素"],
  "reviewAfterMinutes": 30,
  "newGoal": {
    "title": "只有发现新的长期目标时填写",
    "description": "目标说明",
    "priority": 70
  }
}`;

      const restrictedTools = state.config.allowLowRiskActions!==true ? [] : state.config.autonomyMode === 'observe'
        ? ['read_recent_assistant_chat', 'memory_search', 'file.list']
        : state.config.autonomyMode === 'proactive'
          ? ['read_recent_assistant_chat', 'memory_search', 'file.list', 'x.notify_user']
          : undefined;

      await check();
      const sourceId=pending?.sourceId??`living:${state.identity.continuityId}:${control.value.revision}:${state.cycleCount}`;
      (state as CycleState).pendingCycle={version:1,sourceId,revision:control.value.revision,goalId:activeGoal.id,cycle:state.cycleCount,trigger:pending?.trigger??trigger,goalFingerprint:this.goalFingerprint(activeGoal),observationFingerprint:observation.fingerprint,observationChanged};
      await save();await check();
      const result = await this.orchestrator.runIntentAsPersistedTask({
        intent,
        llmConfig,
        systemPrompt,
        userId,
        source: 'event_driven',signal,sourceId,
        title: 'X 自主生命循环',
        metadata: {
          livingAI: true,livingAIRevision:control.value.revision,
          trigger,
          goalId: activeGoal.id,
          ...(restrictedTools ? { allowedToolNames: restrictedTools } : {}),
        },
      });

      await check();
      return await this.applyCycleResult(userId,result.content,control,controller,check,ownership);
    } catch (error) {
      if(signal.aborted||error instanceof RunOwnershipLostError||error instanceof Error&&error.name==='AbortError'){controller.abort();return this.getStatus(userId);}
      await check();const expected=await this.db.getConfig(userId,STATE_KEY),latest=await this.ensureState(userId);
      if(await this.db.getConfig(userId,STATE_KEY)!==expected)throw new RunOwnershipLostError('自主状态已变化');
      latest.phase = 'error';
      latest.lastError = error instanceof Error ? error.message : String(error);
      latest.lastReflection = '本轮执行遇到错误，已保留目标和状态，等待下一周期恢复。';
      latest.lastAction = '未完成本轮行动。';
      latest.nextCycleAt = this.nextCycleAt(latest);
      latest.updatedAt = this.now();
      await this.controls.saveCycle(userId,latest,control.raw,signal,ownership,expected);this.publish(userId,latest);
      serverLogger.error('living-ai', '自主生命循环失败', `userId=${userId} error=${latest.lastError}`);
      return this.getStatus(userId);
    }
  }

  private pendingCycle(state:LivingAIState):PendingCycle|undefined{
    const pending=(state as CycleState).pendingCycle;if(!pending)return;
    const source=`living:${state.identity.continuityId}:${pending.revision}:${state.cycleCount}`;
    if(pending.version!==1||pending.sourceId!==source||pending.cycle!==state.cycleCount||typeof pending.goalId!=='string'||!['manual','timer','interaction'].includes(pending.trigger)||typeof pending.revision!=='string'||typeof pending.goalFingerprint!=='string'||typeof pending.observationFingerprint!=='string'||typeof pending.observationChanged!=='boolean')throw new Error('自主循环检查点无效，请检查原交办记录');
    return pending;
  }
  private goalFingerprint(goal:LivingAIGoal){return fingerprint({title:goal.title,description:goal.description,status:goal.status,progress:goal.progress});}
  private async deliverNotices(userId:string,control:{raw:string;value:LivingControl},controller:AbortController,check:()=>Promise<void>,ownership?:{store:RunOwnershipStore;run:string}){
    for(let attempt=0;attempt<MAX_EPISODES;attempt++){
      await check();const raw=await this.db.getConfig(userId,STATE_KEY),state=await this.ensureState(userId) as CycleState;
      if(await this.db.getConfig(userId,STATE_KEY)!==raw)throw new RunOwnershipLostError('通知状态已变化');
      const queue=state.pendingNotices??[];if(!Array.isArray(queue)||queue.length>MAX_EPISODES)throw new Error('通知检查点无效');
      const notice=queue[0];if(!notice)return;
      if(!/^living-notice-[a-f0-9]{40}$/.test(notice.id)||typeof notice.body!=='string'||!notice.body.trim()||notice.body.length>2000||!Number.isSafeInteger(notice.createdAt)||typeof notice.revision!=='string')throw new Error('通知检查点无效');
      if(state.config.enabled&&notice.revision===(control.value.deliveryEpoch??control.value.revision)){
        if(this.isQuietHour(state.config))return;
        if(ownership)await ownership.store.notification(ownership.run,notice,{controlKey:'living_ai_control_v1',controlValue:control.raw,stateKey:STATE_KEY,stateValue:raw!});
        const saved=typeof this.db.queryOne==='function'?await this.db.queryOne<{read:number}>('SELECT `read` FROM notifications WHERE id=? AND user_id=?',[notice.id,userId]):undefined;
        await check();await this.notify(userId,notice.body,{id:notice.id,createdAt:notice.createdAt,read:!!saved?.read});await check();
      }
      state.pendingNotices=queue.slice(1);state.updatedAt=this.now();
      await this.controls.saveCycle(userId,state,control.raw,controller.signal,ownership,raw);this.publish(userId,state);
    }
  }
  private async applyCycleResult(userId:string,content:string,control:{raw:string;value:LivingControl},controller:AbortController,check:()=>Promise<void>,ownership?:{store:RunOwnershipStore;run:string}):Promise<LivingAIStatus>{
    await check();const expectedState=await this.db.getConfig(userId,STATE_KEY),state=await this.ensureState(userId) as CycleState;
    if(await this.db.getConfig(userId,STATE_KEY)!==expectedState)throw new RunOwnershipLostError('自主状态已变化，稍后接回原结果');
    const pending=this.pendingCycle(state);
    if(!pending||pending.revision!==control.value.revision)throw new DOMException('原循环已停止','AbortError');
    const save=async()=>{state.updatedAt=this.now();await this.controls.saveCycle(userId,state,control.raw,controller.signal,ownership,expectedState);this.publish(userId,state);};
    const activeGoal=state.goals.find(goal=>goal.id===pending.goalId);
    if(!activeGoal||activeGoal.status!=='active'||this.goalFingerprint(activeGoal)!==pending.goalFingerprint){
      delete state.pendingCycle;state.phase='waiting';state.lastAction='目标已变更，保留原交办结果，未套用旧进度。';state.nextCycleAt=this.nextCycleAt(state);await save();return this.getStatus(userId);
    }
    const trigger=pending.trigger,observation={fingerprint:pending.observationFingerprint},observationChanged=pending.observationChanged;
      const parsedDecision = parseDecision(content);
      const invalidDecision = parsedDecision == null;
      const decision = parsedDecision ?? createRecoveryDecision(content);
      const decisionType = normalizeDecision(decision?.decision);
      const situationAssessment = cleanText(decision?.situationAssessment, '尚未形成可靠的局势判断。');
      const strategy = cleanText(decision?.strategy, activeGoal.strategy || '继续收集能够推进目标的证据。');
      const hypothesis = cleanText(decision?.hypothesis, '尚无可验证假设。');
      const nextAction = cleanText(decision?.nextAction, '下一周期重新评估目标与环境变化。');
      const evidence = cleanList(decision?.evidence, 8);
      const lesson = cleanText(decision?.lesson, '本轮没有形成可复用的新经验。');
      const uncertainties = cleanList(decision?.uncertainties, 8);
      const confidence = clampConfidence(decision?.confidence);
      const cognitiveMode = normalizeCognitiveMode(decision?.cognitiveMode, decisionType);
      state.lastReflection = cleanText(decision?.reflection,cleanText(content,'本轮没有形成新的反思。'));
      state.lastAction = cleanText(decision?.summary,decision?.decision === 'idle' ? '判断无需行动。' : '已完成一次自主循环。');

      const progressBefore = activeGoal.progress;
      if (typeof decision?.goalProgress === 'number'&&Number.isFinite(decision.goalProgress)) {
        activeGoal.progress = clamp(Math.round(decision.goalProgress), 0, 100);
      }
      if (decision?.completeGoal===true || activeGoal.progress >= 100) {
        activeGoal.status = 'completed';
        activeGoal.progress = 100;
      }
      const decisionFingerprint = fingerprint({
        goalId: activeGoal.id,
        decision: decisionType,
        strategy,
        action: state.lastAction,
        nextAction,
      });
      const repeatedDecision = decisionFingerprint === state.cognition.lastDecisionFingerprint;
      const madeProgress = activeGoal.progress > progressBefore || decision?.completeGoal === true;
      const stalled = invalidDecision
        || repeatedDecision
        || (decisionType === 'acted' && !madeProgress && evidence.length === 0);
      activeGoal.stagnationCount = stalled ? activeGoal.stagnationCount + 1 : 0;
      activeGoal.strategy = strategy;
      activeGoal.nextAction = nextAction;
      activeGoal.blockers = cleanList(decision?.blockers, 8);
      activeGoal.lastResult = state.lastAction;
      activeGoal.updatedAt = this.now();
      activeGoal.nextReviewAt = this.reviewAt(state, decision?.reviewAfterMinutes);

      state.cognition = {
        mode: activeGoal.stagnationCount >= STAGNATION_THRESHOLD ? 'recover' : cognitiveMode,
        focusGoalId: activeGoal.id,
        situationAssessment,
        strategy,
        hypothesis,
        nextAction,
        uncertainties,
        confidence,
        stagnationCount: activeGoal.stagnationCount,
        consecutiveIdleCycles: decisionType === 'idle'
          ? state.cognition.consecutiveIdleCycles + 1
          : 0,
        lastObservationFingerprint: observation.fingerprint,
        lastDecisionFingerprint: decisionFingerprint,
        learningSummary: lesson,
      };

      const episode: LivingAIEpisode = {
        id: uuid(),
        cycle: state.cycleCount,
        goalId: activeGoal.id,
        trigger,
        cognitiveMode: state.cognition.mode,
        observationFingerprint: observation.fingerprint,
        observationChanged,
        decision: decisionType,
        situationAssessment,
        strategy,
        hypothesis,
        action: state.lastAction,
        outcome: state.lastReflection,
        evidence,
        lesson,
        confidence,
        progressBefore,
        progressAfter: activeGoal.progress,
        repeatedDecision,
        createdAt: this.now(),
      };
      state.episodes = [...state.episodes, episode].slice(-MAX_EPISODES);
      state.lastError = invalidDecision ? cleanText(content, '模型输出无法解析。') : null;

      if (typeof decision?.newGoal?.title==='string'&&decision.newGoal.title.trim() && state.goals.length < MAX_GOALS) {
        const goalNow = this.now();
        state.goals.push({
          id: uuid(),
          title: decision.newGoal.title.trim().slice(0, 160),
          description: cleanText(decision.newGoal.description,decision.newGoal.title.trim()).slice(0,1000),
          priority: clamp(Math.round(typeof decision.newGoal.priority==='number'&&Number.isFinite(decision.newGoal.priority)?decision.newGoal.priority:70), 1, 100),
          status: 'active',
          origin: 'reflection',
          progress: 0,
          createdAt: goalNow,
          updatedAt: goalNow,
          nextReviewAt: this.nextCycleAt(state),
          attemptCount: 0,
          stagnationCount: 0,
        });
      }

      state.phase = 'sleeping';
      state.nextCycleAt = this.reviewAt(state, decision?.reviewAfterMinutes);
      state.updatedAt = this.now();
      delete state.pendingCycle;
      if(typeof decision?.messageToUser==='string'&&decision.messageToUser.trim()){
        const body=decision.messageToUser.trim().slice(0,2000),id=LIVING_NOTICE_PREFIX+createHash('sha256').update(JSON.stringify([userId,pending.sourceId])).digest('hex').slice(0,40);
        const queue=state.pendingNotices??[];if(queue.length>=MAX_EPISODES)throw new Error('待送通知已达上限');
        state.pendingNotices=[...queue,{id,body,createdAt:this.now(),revision:control.value.deliveryEpoch??control.value.revision}];
      }
      await save();
      try{await this.deliverNotices(userId,control,controller,check,ownership);}
      catch(error){
        if(controller.signal.aborted||error instanceof RunOwnershipLostError||error instanceof Error&&error.name==='AbortError')throw error;
        serverLogger.warn('living-ai','结果已保存，通知待补投');
      }
      return this.getStatus(userId);
  }

  private async buildObservation(
    userId: string,
    state: LivingAIState,
    trigger: 'timer' | 'manual' | 'interaction',
  ): Promise<{ content: string; fingerprint: string }> {
    const tasks = this.orchestrator.getAllTasks().filter((task) => {
      const metadata = task.metadata as { userId?: string } | undefined;
      return metadata?.userId === userId;
    }).map(({id,title,status})=>({id,title,status}));
    const savedActive=await this.db.query<{id:string;title:string;status:string}>("SELECT id,title,status FROM tasks WHERE user_id=? AND status IN ('pending','running') ORDER BY updated_at DESC",[userId]);
    const savedFailures=await this.db.query<{id:string;title:string;status:string}>("SELECT id,title,status FROM tasks WHERE user_id=? AND status='failed' ORDER BY updated_at DESC LIMIT 5",[userId]);
    const savedWaiting=await this.db.query<{id:string;title:string;status:string}>("SELECT id,title,status FROM tasks WHERE user_id=? AND status='paused' ORDER BY updated_at DESC LIMIT 20",[userId]);
    const current:Array<{id:string;title:string;status:string}>=[],ids=tasks.filter(task=>['pending','running','failed','paused'].includes(task.status)).map(task=>task.id);
    for(let offset=0;offset<ids.length;offset+=200){const batch=ids.slice(offset,offset+200);current.push(...await this.db.query<{id:string;title:string;status:string}>(`SELECT id,title,status FROM tasks WHERE user_id=? AND id IN (${batch.map(()=>'?').join(',')})`,[userId,...batch]));}
    const byId=new Map([...tasks,...savedActive,...savedFailures,...savedWaiting,...current].map(task=>[task.id,task])),merged=[...byId.values()];
    const runningTasks = merged.filter((task) => task.status === 'running'||task.status==='pending');
    const failedTasks = [...savedFailures.flatMap(saved=>{const task=byId.get(saved.id);return task?.status==='failed'?[task]:[];}),...merged.filter(task=>task.status==='failed'&&!savedFailures.some(saved=>saved.id===task.id))].slice(0,5);
    const sessions = await this.db.listSessions(userId, 5, undefined, false);
    const pendingRaw = await this.db.getConfig(userId, 'x_pending_requests');
    let pendingCount = 0;
    if (pendingRaw) {
      try {
        const pending = JSON.parse(pendingRaw);
        pendingCount = Array.isArray(pending) ? pending.length : 0;
      } catch {}
    }
    const activeGoals = state.goals
      .filter((goal) => goal.status === 'active')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 8)
      .map((goal) => ({
        id: goal.id,
        title: goal.title,
        priority: goal.priority,
        progress: goal.progress,
        lastResult: goal.lastResult,
      }));

    const stableSnapshot = {
      lastInteractionAt: state.lastInteractionAt,
      activeTaskCount:runningTasks.length,
      runningTasks: runningTasks.slice(0,20).map((task) => ({ id: task.id, title: task.title, status: task.status })),
      recentFailures: failedTasks.map((task) => ({ id: task.id, title: task.title })),
      waitingTasks:savedWaiting.flatMap(saved=>{const task=byId.get(saved.id);return task?.status==='paused'?[task]:[];}),
      recentSessions: sessions.map((session) => ({ id: session.id, title: session.title, updatedAt: session.updated_at })),
      pendingRequests: pendingCount,
      activeGoals,
    };
    return {
      content: JSON.stringify({
        trigger,
        now: new Date(this.now()).toISOString(),
        ...stableSnapshot,
      }),
      fingerprint: fingerprint(stableSnapshot),
    };
  }

  private selectGoal(state: LivingAIState): LivingAIGoal | undefined {
    const now = this.now();
    return state.goals
      .filter((goal) => goal.status === 'active' && goal.nextReviewAt <= now)
      .sort((a, b) => b.priority - a.priority || a.updatedAt - b.updatedAt)[0]
      ?? state.goals
        .filter((goal) => goal.status === 'active')
        .sort((a, b) => b.priority - a.priority || a.updatedAt - b.updatedAt)[0];
  }

  private isQuietHour(config: LivingAIConfig): boolean {
    if (!config.quietHours.enabled) return false;
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        hour12: false,
      }).format(new Date(this.now())),
    );
    const { startHour, endHour } = config.quietHours;
    if (startHour === endHour) return true;
    if (startHour < endHour) return hour >= startHour && hour < endHour;
    return hour >= startHour || hour < endHour;
  }

  private nextCycleAt(state: LivingAIState): number {
    return this.now() + state.config.cycleIntervalMinutes * 60_000;
  }

  private reviewAt(state: LivingAIState, requestedMinutes?: number): number {
    const minutes = typeof requestedMinutes === 'number' && Number.isFinite(requestedMinutes)
      ? clamp(Math.round(requestedMinutes), 5, 1440)
      : state.config.cycleIntervalMinutes;
    return this.now() + minutes * 60_000;
  }

  private async ensureState(userId: string): Promise<LivingAIState> {
    if (!userId || userId === 'anonymous') {
      throw new Error('持续生命循环需要用户身份');
    }
    await this.db.ensureUser(userId);
    const raw = await this.db.getConfig(userId, STATE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Omit<Partial<LivingAIState>, 'version' | 'goals'> & {
          version?: number;
          goals?: Array<Partial<LivingAIGoal> & Pick<LivingAIGoal, 'id' | 'title'>>;
        };
        if ((parsed.version === 1 || parsed.version === 2) && parsed.identity?.continuityId) {
          const defaults = createDefaultState(this.now());
          return this.applyControl(userId,{
            ...defaults,
            ...parsed,
            version: 2,
            config: {
              ...defaultConfig(),
              ...parsed.config,
              quietHours: {
                ...defaultConfig().quietHours,
                ...parsed.config?.quietHours,
              },
            },
            goals: (parsed.goals ?? defaults.goals).map((goal) => ({
              ...goal,
              description: goal.description ?? goal.title,
              priority: goal.priority ?? 70,
              status: goal.status ?? 'active',
              origin: goal.origin ?? 'reflection',
              progress: goal.progress ?? 0,
              createdAt: goal.createdAt ?? this.now(),
              updatedAt: goal.updatedAt ?? this.now(),
              nextReviewAt: goal.nextReviewAt ?? this.now(),
              attemptCount: goal.attemptCount ?? 0,
              stagnationCount: goal.stagnationCount ?? 0,
            })),
            cognition: {
              ...defaults.cognition,
              ...parsed.cognition,
            },
            episodes: Array.isArray(parsed.episodes) ? parsed.episodes.slice(-MAX_EPISODES) : [],
          });
        }
      } catch {}
    }
    const state = createDefaultState(this.now());
    if(raw==null&&typeof this.db.run==='function'&&typeof this.db.getDialect==='function'){
      const sqlite=this.db.getDialect()==='sqlite';
      await this.db.run(`${sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO user_config(user_id,\`key\`,value,updated_at) VALUES(?,?,?,?)`,[userId,STATE_KEY,JSON.stringify(state),sqlite?new Date().toISOString():new Date().toISOString().slice(0,19).replace('T',' ')]);
      return this.ensureState(userId);
    }
    if(raw!=null){
      const key=`${STATE_KEY}_recovery_${createHash('sha256').update(raw).digest('hex').slice(0,16)}`;
      await this.db.setConfig(userId,key,raw);
      state.config.enabled=false;state.phase='paused';state.nextCycleAt=null;await this.controls.patch(userId,state.config,current=>({...current,enabled:false}));
    }
    await this.persist(userId, state);
    return state;
  }

  private async applyControl(userId:string,state:LivingAIState):Promise<LivingAIState>{
    const control=await this.controls.read(userId);if(!control)return state;
    const tagged=state as LivingAIState&{controlRevision?:string},changed=tagged.controlRevision!==control.value.revision;
    state.config=control.value.config;tagged.controlRevision=control.value.revision;
    if(changed){state.phase=state.config.enabled?'sleeping':'paused';state.nextCycleAt=state.config.enabled?this.now():null;}
    if(!state.config.enabled){state.phase='paused';state.nextCycleAt=null;}return state;
  }
  private async persist(userId: string, state: LivingAIState): Promise<void> {
    await this.applyControl(userId,state);
    state.updatedAt = this.now();
    await this.db.setConfig(userId, STATE_KEY, JSON.stringify(state));
    this.publish(userId,state);
  }
  private publish(userId:string,state:LivingAIState){
    broadcastToUser(userId, {
      type: 'living_ai_status',
      data: {
        running: this.timer != null,
        inCycle: this.activeCycles.has(userId),
        state,
      },
    });
  }
}
