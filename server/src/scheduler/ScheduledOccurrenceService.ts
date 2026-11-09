import { CHANNEL_PROGRESS_TEXT, scheduleProgressNotice } from './progressNotice.js';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppDatabase } from '../db/database.js';
import { ChatRunService, type ChatRunSnapshot, type RunWorkspace } from '../chat/ChatRunService.js';
import { RunOwnershipStore } from '../chat/RunOwnershipStore.js';
import { resolveRequestedTextArtifactPath, buildTextArtifactDeliveryInstruction } from '../chat/xDirectToolPolicy.js';
import type { TaskLLMConfig } from '../../../shared/src/index.js';
import type { ScheduledJob } from './XScheduler.js';
import type { BackgroundIntentInput } from '../orchestrator/AgentOrchestrator.js';
import {LivingAIControlStore} from '../living-ai/LivingAIControlStore.js';
import {broadcastToUser} from '../wsBroadcast.js';
import { SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { backgroundAutostartEnabled } from '../config/backgroundRuntime.js';
import { channelRunPolicy } from './channelRunPolicy.js';

export interface ChannelReplyAddress {
  channel: 'qq' | 'telegram' | 'discord' | 'slack' | 'whatsapp';
  target: string;
  targetType?: 'private' | 'group' | 'guild';
  thread?: string;
  configDigest: string;
  accountId?: string;
  sourceScope?: string;
  legacyUnbound?: boolean;
}

interface BackgroundJob extends ScheduledJob {
  livingAI?:boolean;livingAIRevision?:string;
  providerId?: string; modelId?: string; systemPrompt?: string;
  allowedToolNames?: string[]; actionFingerprint?: string;
  source?: string;
  channelReply?: ChannelReplyAddress;
  channelReplyVersion?: number;
  sourceInboxId?: string;
  channelHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface ScheduledScope {
  allowedToolNames: string[];
  blockedToolNames: string[];
  workspace: RunWorkspace;
}

function parseScheduledScope(raw: string): ScheduledScope {
  const scope = JSON.parse(raw) as Partial<ScheduledScope> | null;
  const workspace = scope?.workspace;
  const names = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(name => typeof name === 'string' && name.length > 0);
  if (!scope || !names(scope.allowedToolNames) || !names(scope.blockedToolNames)
    || !workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    throw new Error('Invalid scheduled scope');
  }
  const { agentId, agentRunId, delegationDepth } = workspace;
  if ((agentId !== undefined && (typeof agentId !== 'string' || !/^[\w-]{1,128}$/.test(agentId)))
    || (agentRunId !== undefined && (!agentId || typeof agentRunId !== 'string' || !/^[\w-]{1,64}$/.test(agentRunId)))
    || (delegationDepth !== undefined && (!Number.isSafeInteger(delegationDepth) || delegationDepth < 0))) {
    throw new Error('Invalid scheduled workspace');
  }
  return { allowedToolNames: scope.allowedToolNames, blockedToolNames: scope.blockedToolNames,
    workspace: { agentId, agentRunId, delegationDepth } };
}

interface Occurrence {
  id: string; user_id: string; job_id: string; scheduled_at: number; job_json: string;
  status: string; execution_session_id: string | null; run_id: string | null;
  cancelled: number; error: string | null;
  created_at: number;
}
interface Options {
  db: AppDatabase;
  getRuns: () => ChatRunService | undefined;
  getSystemPrompt: (userId: string) => Promise<string>;
  getLLMConfig: (userId: string, overrides?: { providerId?: string; modelId?: string }) => Promise<TaskLLMConfig | null | undefined>;
  ensureUserMcp?: (userId: string) => Promise<unknown>;
  onCompleted?: (job: BackgroundJob) => Promise<void>;
  sendChannelReply?: (userId: string, address: ChannelReplyAddress, text: string, assertActive?: () => Promise<void>) => Promise<boolean>;
  validateChannelReply?: (userId: string, address: ChannelReplyAddress) => Promise<void>;
}
const publicStatus = (status: string) => ({ channel_queued: 'queued', channel_attached: 'attached', channel_waiting: 'needs_attention' } as Record<string,string>)[status] ?? status;
const statusFor = (job: BackgroundJob, status: 'queued' | 'attached' | 'needs_attention') => job.channelReply ? ({ queued: 'channel_queued', attached: 'channel_attached', needs_attention: 'channel_waiting' })[status] : status;
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const isLivingJob=(job:BackgroundJob)=>job.livingAI===true||job.name==='X 自主生命循环'&&job.intent.startsWith('这是 X 的一次持续生命循环，不是用户的新指令。');

/** A saved occurrence precedes advancing its plan; ChatRun owns all model execution. */
export class ScheduledOccurrenceService {
  private ready: Promise<void>;
  private locks: RunOwnershipStore;
  private sqlite: boolean;
  private recovering = false;
  private timer?: ReturnType<typeof setInterval>;
  private active = new Map<string, Promise<void>>();
  private busyJobs = new Set<string>();
  private readonly progressNoticed = new Set<string>();
  constructor(private options: Options) {
    this.sqlite = options.db.getDialect() === 'sqlite';
    this.locks = new RunOwnershipStore(options.db);
    this.ready = this.init();
    void this.ready.catch(error => console.error('[scheduler] initialization failed', error));
  }
  private async init() {
    await this.locks.init();
    await this.options.db.run(`CREATE TABLE IF NOT EXISTS scheduled_occurrences (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, job_id VARCHAR(128) NOT NULL,
      scheduled_at BIGINT NOT NULL, job_json TEXT NOT NULL, status VARCHAR(32) NOT NULL,
      execution_session_id VARCHAR(64), run_id VARCHAR(64), cancelled INTEGER NOT NULL DEFAULT 0,
      error TEXT, created_at BIGINT NOT NULL)${this.sqlite ? '' : ' ENGINE=InnoDB'}`);
    await this.options.db.run(`CREATE TABLE IF NOT EXISTS channel_reply_receipts (
      id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(128) NOT NULL, owner_token VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL, started_at BIGINT NOT NULL)${this.sqlite ? '' : ' ENGINE=InnoDB'}`);
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.recover().catch(error => console.error('[background] recovery failed', error)); }, 15000);
    this.timer.unref();
    void this.recover().catch(error => console.error('[background] recovery failed', error));
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  /** Legacy intent callers share this journal instead of creating a second task runtime. */
  async run(input: BackgroundIntentInput): Promise<{ content: string; runId: string; sessionId: string }> {
    if(!input.signal)return this.runTracked(input);
    input.signal.throwIfAborted();
    const request={...input,sourceId:input.sourceId||randomUUID()},cancel=()=>{void this.cancelInput(request).catch(()=>console.warn('[background] cancellation pending',request.userId));};
    input.signal.addEventListener('abort',cancel,{once:true});
    try{return await this.runTracked(request);}
    finally{input.signal.removeEventListener('abort',cancel);if(input.signal.aborted)await this.cancelInput(request);}
  }
  private async cancelInput(input:BackgroundIntentInput){
    await this.ready;const key=digest(JSON.stringify([input.userId,input.source||'event_driven',input.actionFingerprint||input.sourceId]));
    const rows=await this.options.db.query<Occurrence>("SELECT * FROM scheduled_occurrences WHERE user_id=? AND job_id=? AND status IN ('queued','attached','needs_attention','cancelled')",[input.userId,`handoff:${key}`]);
    for(const row of rows)await this.cancel(input.userId,row.id);
  }
  async cancelLivingCycles(userId:string){
    await this.ready;const rows=await this.options.db.query<Occurrence>("SELECT * FROM scheduled_occurrences WHERE user_id=? AND status IN ('queued','attached','needs_attention','channel_queued','channel_attached','channel_waiting')",[userId]);
    for(const row of rows)if(isLivingJob(JSON.parse(row.job_json)))await this.cancel(userId,row.id);
  }
  async resumeLivingCycle(userId:string,sourceId:string,revision:string,signal:AbortSignal){
    await this.ready;signal.throwIfAborted();
    const key=digest(JSON.stringify([userId,'event_driven',sourceId]));
    const row=await this.options.db.queryOne<Occurrence>('SELECT * FROM scheduled_occurrences WHERE id=? AND user_id=?',[key,userId]);
    if(!row)return undefined;
    const job=JSON.parse(row.job_json) as BackgroundJob;
    if(job.livingAI!==true||job.livingAIRevision!==revision||job.source!=='event_driven')throw new Error('原自主交办与检查点不一致');
    if(!await new LivingAIControlStore(this.options.db).permits(userId,revision))throw new DOMException('自主运行设置已变化','AbortError');
    const cancel=()=>{void this.cancel(userId,key).catch(()=>console.warn('[background] cancellation pending',userId));};
    signal.addEventListener('abort',cancel,{once:true});
    try{return await this.waitForOccurrence(key,userId,signal);}
    finally{signal.removeEventListener('abort',cancel);if(signal.aborted)await this.cancel(userId,key);}
  }
  private async runTracked(input:BackgroundIntentInput):Promise<{content:string;runId:string;sessionId:string}>{
    await this.ready;
    input.signal?.throwIfAborted();
    if (!input.userId || input.userId === 'anonymous' || !input.intent?.trim()) throw new Error('缺少有效用户或交办内容');
    const request = input.actionFingerprint || input.sourceId || randomUUID();
    const base = digest(JSON.stringify([input.userId, input.source || 'event_driven', request]));
    let key = base;
    const now = Date.now();
    const allowed = input.metadata?.allowedToolNames;
    if (allowed !== undefined && (!Array.isArray(allowed) || !allowed.every(name => typeof name === 'string'))) throw new Error('工具权限范围无效');
    const job: BackgroundJob = { id: `handoff:${base}`, userId: input.userId, intent: input.intent, runAt: now, createdAt: now,
      livingAI:input.metadata?.livingAI===true,livingAIRevision:typeof input.metadata?.livingAIRevision==='string'?input.metadata.livingAIRevision:undefined,
      name: input.title, source: input.source || 'event_driven', providerId: input.llmConfig.providerId, modelId: input.llmConfig.modelId,
      systemPrompt: input.systemPrompt, allowedToolNames: allowed as string[] | undefined, actionFingerprint: input.actionFingerprint };
    const lock = `schedule:${digest(job.id)}`;
    while (this.busyJobs.has(lock)){input.signal?.throwIfAborted();await delay(100,undefined,{signal:input.signal});}
    this.busyJobs.add(lock);
    try {
    while (!await this.locks.acquire(input.userId, lock, lock, 'record')){input.signal?.throwIfAborted();await delay(100,undefined,{signal:input.signal});}
    if (input.actionFingerprint) {
      const previous = await this.options.db.queryOne<Occurrence & { created_at: number }>('SELECT * FROM scheduled_occurrences WHERE job_id=? ORDER BY created_at DESC,id DESC LIMIT 1', [job.id]);
      if (previous) key = previous.status === 'completed' && previous.created_at <= now - 7 * 24 * 60 * 60 * 1000 && !await this.options.db.hasHandledEvent(input.userId, input.actionFingerprint) ? digest(`${previous.id}:next`) : previous.id;
    }
    input.signal?.throwIfAborted();
    await this.options.db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO scheduled_occurrences
      (id,user_id,job_id,scheduled_at,job_json,status,created_at) VALUES (?,?,?,?,?,'queued',?)`,
    [key, input.userId, job.id, now, JSON.stringify(job), now]);
    } finally { try { await this.locks.release(lock, 'record'); } finally { this.busyJobs.delete(lock); } }
    return this.waitForOccurrence(key,input.userId,input.signal,job);
  }
  private async waitForOccurrence(key:string,userId:string,signal?:AbortSignal,expected?:BackgroundJob):Promise<{content:string;runId:string;sessionId:string}>{
    for (;;) {
      signal?.throwIfAborted();
      const row = await this.options.db.queryOne<Occurrence>('SELECT * FROM scheduled_occurrences WHERE id=? AND user_id=?', [key, userId]);
      if (!row) throw new Error('交办尚未保存');
      const saved = JSON.parse(row.job_json) as BackgroundJob;
      if (expected&&(saved.intent !== expected.intent || saved.providerId !== expected.providerId || saved.modelId !== expected.modelId ||
          JSON.stringify(saved.allowedToolNames) !== JSON.stringify(expected.allowedToolNames))) throw new Error('交办编号已用于不同内容或权限');
      if (row.cancelled) {await this.cancel(userId,row.id);if(signal)throw new DOMException('此次交办已取消','AbortError');throw new Error('此次交办已取消');}
      if (row.run_id) {
        const runs = this.options.getRuns();
        if (!runs) throw new Error('任务服务尚未就绪');
        const run = await runs.get(userId, row.run_id);
        if (run.status === 'completed') { await this.settle(userId, row.id, run.id); return { content: run.content, runId: run.id, sessionId: run.sessionId }; }
        if (!['running', 'stopping', 'interrupted'].includes(run.status) || (run.status === 'interrupted' && !run.canResume)) throw new Error(run.error || '执行需要你处理，请打开原对话');
        if (['running', 'stopping'].includes(run.status)) { await delay(500); continue; }
      }
      if (row.status === 'needs_attention') throw new Error(row.error || '执行需要你处理，请打开原对话');
      await this.prepare(row);
      await delay(100);
    }
  }
  async enqueueChannel(userId: string, messageId: string, text: string, address: ChannelReplyAddress, sourceInboxId?: string): Promise<void> {
    await this.ready;
    if (!userId || userId === 'anonymous' || !messageId || !address.target || !text.trim()) throw new Error('渠道交办信息不完整');
    const identity = [userId, address.channel, address.target, address.targetType, address.thread, messageId];
    const legacyId = digest(JSON.stringify(identity));
    const sourceScope = address.accountId || address.sourceScope;
    const id = digest(JSON.stringify([...identity, ...(sourceScope ? [sourceScope] : [])]));
    const legacy = id !== legacyId ? await this.options.db.queryOne<{job_json:string}>('SELECT job_json FROM scheduled_occurrences WHERE id=? AND user_id=?', [legacyId,userId]) : undefined;
    if (legacy && !(JSON.parse(legacy.job_json) as BackgroundJob).channelReply?.accountId) address = {...address,legacyUnbound:true};
    const jobId = `channel:${digest(JSON.stringify([userId,address.channel,address.target,address.targetType,address.thread,address.accountId,address.sourceScope,address.configDigest]))}`;
    const now = Date.now();
    const job: BackgroundJob = {
      id: jobId, userId, intent: text, name: `渠道消息 [${address.channel}] · ${address.accountId || '来源账号待核对'}`.slice(0,200),
      runAt: now, createdAt: now, allowedToolNames: [], channelReply: address, channelReplyVersion: 2, sourceInboxId,
    };
    const db = this.options.db;
    await db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO channel_reply_receipts (id,user_id,owner_token,status,started_at) VALUES (?,?,'','not_sent',?)`, [id,userId,now]);
    await db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO scheduled_occurrences
      (id,user_id,job_id,scheduled_at,job_json,status,created_at) VALUES (?,?,?,?,?,'channel_queued',?)`,
    [id, userId, jobId, now, JSON.stringify(job), now]);
    const saved = await db.queryOne<{job_id: string; job_json: string}>('SELECT job_id,job_json FROM scheduled_occurrences WHERE id=? AND user_id=?', [id, userId]);
    if (saved?.job_id !== jobId || (JSON.parse(saved.job_json) as BackgroundJob).intent !== text) throw new Error('渠道交办编号与内容不一致');
    if(backgroundAutostartEnabled())void this.recover().catch(() => console.warn('[scheduler] channel recovery pending'));
  }

  private async channelHistory(row: Occurrence, runs: ChatRunService) {
    const previous = await this.options.db.query<Occurrence>(`SELECT * FROM scheduled_occurrences
      WHERE user_id=? AND job_id=? AND status='completed' AND run_id IS NOT NULL
      AND (scheduled_at<? OR (scheduled_at=? AND id<?)) ORDER BY scheduled_at DESC,id DESC LIMIT 12`,
    [row.user_id, row.job_id, row.scheduled_at, row.scheduled_at, row.id]);
    const history: Array<{role: 'user' | 'assistant'; content: string}> = [];
    for (const item of previous.reverse()) {
      const receipt = await this.options.db.queryOne<{status: string}>('SELECT status FROM channel_reply_receipts WHERE id=? AND user_id=?', [item.id, row.user_id]);
      if (receipt?.status !== 'sent') continue;
      const run = await runs.get(row.user_id, item.run_id!);
      if (run.status !== 'completed') continue;
      history.push({ role: 'user', content: (JSON.parse(item.job_json) as BackgroundJob).intent.slice(0, 4000) },
        { role: 'assistant', content: run.content.slice(0, 4000) });
    }
    return history;
  }

  private async deliverChannelReply(row: Occurrence, address: ChannelReplyAddress, text: string): Promise<'sent' | 'pending' | 'unknown' | 'not_sent'> {
    if (!text.trim()) return 'unknown';
    const db = this.options.db;
    if (!address.accountId || address.legacyUnbound) {
      const prior = await db.queryOne<{status:string}>('SELECT status FROM channel_reply_receipts WHERE id=? AND user_id=?',[row.id,row.user_id]);
      return prior && ['sending','sent','unknown'].includes(prior.status) ? 'unknown' : 'not_sent';
    }
    const token = randomUUID();
    await db.run(`UPDATE channel_reply_receipts SET owner_token=?,status='sending',started_at=? WHERE id=? AND user_id=? AND status='not_sent'
      AND EXISTS (SELECT 1 FROM scheduled_occurrences o WHERE o.id=? AND o.user_id=? AND o.cancelled=0 AND o.status IN ('attached','needs_attention','channel_attached','channel_waiting'))`,[token,Date.now(),row.id,row.user_id,row.id,row.user_id]);
    // The claim precedes the external send. Losing the receipt must never replay the send.
    await db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO channel_reply_receipts
      (id,user_id,owner_token,status,started_at)
      SELECT id,user_id,?,'sending',? FROM scheduled_occurrences
      WHERE id=? AND user_id=? AND cancelled=0 AND status IN ('attached','needs_attention','channel_attached','channel_waiting')`,
    [token, Date.now(), row.id, row.user_id]);
    const saved = await db.queryOne<{owner_token: string; status: string; started_at: number}>(
      'SELECT owner_token,status,started_at FROM channel_reply_receipts WHERE id=? AND user_id=?', [row.id, row.user_id],
    );
    if (!saved) return 'pending';
    if (saved.owner_token !== token) {
      if (saved.status === 'sent') return 'sent';
      return saved.status === 'sending' && Date.now() - Number(saved.started_at) < 60000 ? 'pending' : 'unknown';
    }
    let sent = false, denied = false;
    try {
      sent = await this.options.sendChannelReply?.(row.user_id,address,text,async()=>{
        const active = await db.queryOne<{id:string}>(`SELECT o.id FROM scheduled_occurrences o JOIN channel_reply_receipts r ON r.id=o.id AND r.user_id=o.user_id WHERE o.id=? AND o.user_id=? AND o.cancelled=0 AND r.owner_token=? AND r.status='sending'`,[row.id,row.user_id,token]);
        if (!active) throw new SendExecutionDeniedError('交办已停止或执行权已变化，自动回复尚未发送');
      }) === true;
    } catch (error) { denied = error instanceof SendExecutionDeniedError; }
    const status = sent ? 'sent' : denied ? 'not_sent' : 'unknown';
    await db.run('UPDATE channel_reply_receipts SET status=? WHERE id=? AND user_id=? AND owner_token=?',
      [status, row.id, row.user_id, token]);
    return status;
  }

  async queue(job: ScheduledJob, nextAt: number | null): Promise<void> {
    await this.ready;
    const db = this.options.db;
    const id = digest(JSON.stringify([job.id, job.runAt]));
    await db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO scheduled_occurrences
      (id,user_id,job_id,scheduled_at,job_json,status,created_at)
      SELECT ?,?,?,?,?,?,? FROM scheduled_jobs WHERE id=? AND user_id=? AND enabled=1 AND COALESCE(next_run,run_at)=?
      AND (scope_json=? OR (scope_json IS NULL AND ? IS NULL))`,
    [id, job.userId, job.id, job.runAt, JSON.stringify(job), 'queued', Date.now(), job.id, job.userId, job.runAt, job.scopeJson ?? null, job.scopeJson ?? null]);
    // Repeating this after a crash is safe even if the occurrence was already delivered.
    await db.run(`UPDATE scheduled_jobs SET enabled=?,run_at=?,next_run=? WHERE id=? AND user_id=?
      AND enabled=1 AND COALESCE(next_run,run_at)=?
      AND EXISTS(SELECT 1 FROM scheduled_occurrences WHERE id=?)`,
    [nextAt == null ? 0 : 1, nextAt ?? job.runAt, nextAt, job.id, job.userId, job.runAt, id]);
  }
  async list(userId: string, focusId?: string) {
    await this.ready;
    const rows = await this.options.db.query<Occurrence & {reply_status:string|null}>(
      'SELECT o.*,r.status AS reply_status FROM scheduled_occurrences o LEFT JOIN channel_reply_receipts r ON r.id=o.id AND r.user_id=o.user_id WHERE o.user_id=? ORDER BY CASE WHEN o.id=? THEN 0 ELSE 1 END, o.scheduled_at DESC LIMIT 100',
      [userId, focusId ?? null],
    );
    return rows.map(({job_json,reply_status,...row})=>{
      const job=JSON.parse(job_json) as BackgroundJob;
      // A completed model run does not prove the external reply was accepted.
      const replyStatus=job.channelReply ? row.status==='completed'&&reply_status!=='sent' ? 'unknown'
        : ['not_sent','sending','sent','unknown'].includes(reply_status??'') ? reply_status : undefined : undefined;
      return {...row,status:publicStatus(row.status),name:job.name||job.intent.slice(0,80),replyStatus};
    });
  }
  /** The newest occurrence of each job the user owns, as the scheduler shows it. */
  async lastOutcomes(userId: string): Promise<Record<string, { status: string; error: string | null; at: number }>> {
    await this.ready;
    const rows = await this.options.db.query<Pick<Occurrence, 'job_id' | 'status' | 'error' | 'scheduled_at'>>(
      'SELECT job_id,status,error,scheduled_at FROM scheduled_occurrences WHERE user_id=? AND cancelled=0 ORDER BY scheduled_at DESC,id DESC LIMIT 500', [userId]);
    const outcomes: Record<string, { status: string; error: string | null; at: number }> = {};
    for (const row of rows) if (!outcomes[row.job_id]) outcomes[row.job_id] = { status: publicStatus(row.status), error: row.error, at: Number(row.scheduled_at) };
    return outcomes;
  }
  async cancelJob(jobId: string): Promise<void> {
    await this.ready;
    // Disable first so no other dispatcher can enqueue a new occurrence during cancellation.
    await this.options.db.run('UPDATE scheduled_jobs SET enabled=0 WHERE id=?', [jobId]);
    const rows = await this.options.db.query<Occurrence>("SELECT * FROM scheduled_occurrences WHERE job_id=? AND status IN ('queued','attached','needs_attention','channel_queued','channel_attached','channel_waiting')", [jobId]);
    for (const row of rows) await this.cancel(row.user_id, row.id);
  }
  async cancel(userId: string, id: string): Promise<void> {
    await this.ready;
    await this.options.db.run("UPDATE scheduled_occurrences SET cancelled=1,status='cancelled' WHERE id=? AND user_id=? AND status IN ('queued','attached','needs_attention','channel_queued','channel_attached','channel_waiting')", [id, userId]);
    const row = await this.options.db.queryOne<Occurrence>('SELECT * FROM scheduled_occurrences WHERE id=? AND user_id=?', [id, userId]);
    if (!row) throw new Error('执行记录不存在或无权访问');
    if (row.cancelled && row.execution_session_id) {
      const runs = this.options.getRuns();
      if (!runs) throw new Error('任务服务暂不可用，请稍后重试停止');
      await runs.stopRequest(userId, row.execution_session_id, row.id);
    }
    if(row.cancelled)this.refreshOutcomeNotice(userId,await this.resolveAttentionNotice(userId,row.id),'notification_updated');
  }
  async recover(): Promise<void> {
    await this.ready;
    if (this.recovering) return;
    this.recovering = true;
    try {
      await this.options.getRuns()?.deliverPendingQuestions?.();
      await this.options.getRuns()?.deliverExpertReturns?.();
      await this.options.getRuns()?.continueExpertReturns?.();
      const rows = await this.options.db.query<Occurrence>(`SELECT o.* FROM scheduled_occurrences o
        WHERE o.status IN ('queued','attached','needs_attention','channel_queued','channel_attached','channel_waiting') AND (o.status NOT IN ('needs_attention','channel_waiting') OR o.run_id IS NOT NULL OR EXISTS (SELECT 1 FROM channel_reply_receipts r WHERE r.id=o.id AND r.user_id=o.user_id AND r.status='not_sent'))
        AND (o.status<>'channel_waiting' OR (JSON_EXTRACT(o.job_json,'$.channelReplyVersion')=2
          AND JSON_EXTRACT(o.job_json,'$.channelReply.accountId') IS NOT NULL
          AND COALESCE(JSON_EXTRACT(o.job_json,'$.channelReply.legacyUnbound'),0)=0
          AND (o.run_id IS NULL OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=o.run_id AND t.user_id=o.user_id AND t.status IN ('running','completed')))))
        AND NOT EXISTS(SELECT 1 FROM scheduled_occurrences earlier WHERE earlier.job_id=o.job_id
          AND (earlier.status IN ('queued','attached','channel_queued','channel_attached') OR (earlier.status IN ('needs_attention','channel_waiting') AND o.job_id NOT LIKE 'channel:%'))
          AND (earlier.scheduled_at<o.scheduled_at OR (earlier.scheduled_at=o.scheduled_at AND earlier.id<o.id)))
        ORDER BY CASE WHEN o.status IN ('needs_attention','channel_waiting') THEN 1 ELSE 0 END, COALESCE((SELECT r.started_at FROM channel_reply_receipts r WHERE r.id=o.id),o.scheduled_at),o.id LIMIT 100`);
      for (const row of rows) {
        try { await this.prepare(row); }
        catch (error) { console.error('[scheduler] occurrence recovery failed', row.id, error); }
      }
    } finally { this.recovering = false; }
  }
  private async prepare(original: Occurrence): Promise<void> {
    const db = this.options.db;
    const runs = this.options.getRuns();
    const lock = `schedule:${digest(original.job_id)}`;
    if (this.busyJobs.has(lock)) return;
    this.busyJobs.add(lock);
    let run: ChatRunSnapshot | undefined;
    try {
      if (!await this.locks.acquire(original.user_id, lock, lock, 'record')) return;
      const first = original.job_id.startsWith('channel:')
        ? await db.queryOne<Occurrence>('SELECT * FROM scheduled_occurrences WHERE id=? AND user_id=?', [original.id, original.user_id])
        : await db.queryOne<Occurrence>(`SELECT * FROM scheduled_occurrences WHERE job_id=?
        AND status IN ('queued','attached','needs_attention','channel_queued','channel_attached','channel_waiting') ORDER BY scheduled_at,id LIMIT 1`, [original.job_id]);
      if (!first || first.id !== original.id || first.cancelled || !['queued', 'attached', 'needs_attention'].includes(publicStatus(first.status))) return;
      const row = {...first,status:publicStatus(first.status)};
      const job = JSON.parse(row.job_json) as BackgroundJob;
      if (job.channelReply && job.channelReplyVersion !== 2) job.channelReply = {...job.channelReply,legacyUnbound:true};
      if (row.status === 'needs_attention') {
        if (row.run_id&&runs) { await this.settle(row.user_id, row.id, row.run_id); return; }
        const retry = job.channelReply && await db.queryOne<{status:string}>('SELECT status FROM channel_reply_receipts WHERE id=? AND user_id=? AND status=?',[row.id,row.user_id,'not_sent']);
        if (!retry) return;
      }
      if (job.channelReply && !row.run_id) {
        try {
          if (!this.options.validateChannelReply) throw new SendExecutionDeniedError('渠道身份核对服务不可用，消息尚未处理');
          await this.options.validateChannelReply(row.user_id,job.channelReply);
        } catch (error) {
          if (!(error instanceof SendExecutionDeniedError)) throw error;
          await db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO channel_reply_receipts (id,user_id,owner_token,status,started_at) VALUES (?,?,'','not_sent',?)`,[row.id,row.user_id,Date.now()]);
          await db.run('UPDATE channel_reply_receipts SET started_at=? WHERE id=? AND user_id=? AND status=?',[Date.now(),row.id,row.user_id,'not_sent']);
          await this.needsAttention(row,error.message); return;
        }
      }
      if(isLivingJob(job)&&!await new LivingAIControlStore(db).permits(row.user_id,job.livingAIRevision)){await this.cancel(row.user_id,row.id);return;}
      if (job.sessionId) { await this.deliverReminder(row, job); return; }
      if(!runs)return;
      let scope: ScheduledScope | undefined;
      if (!row.run_id && job.scopeJson != null) {
        try { scope = parseScheduledScope(job.scopeJson); }
        catch { await this.needsAttention(row, '定时任务的权限记录无效，请重新交办。'); return; }
      }
      if (!row.execution_session_id) {
        const session = await db.createSession(row.user_id, job.name || job.intent.slice(0, 40), 'normal_chat');
        await db.run('UPDATE scheduled_occurrences SET execution_session_id=? WHERE id=? AND execution_session_id IS NULL AND cancelled=0', [session.id, row.id]);
      }
      const current = await db.queryOne<Occurrence>('SELECT * FROM scheduled_occurrences WHERE id=?', [row.id]);
      if (!current?.execution_session_id || current.cancelled) return;
      if (current.run_id) run = await runs.get(row.user_id, current.run_id);
      else {
        const config = await this.options.getLLMConfig(row.user_id, job.providerId && job.modelId ? { providerId: job.providerId, modelId: job.modelId } : undefined);
        if (!config?.providerId || !config.modelId) { await this.needsAttention(row, '尚未配置可用模型，请配置后重新交办。'); return; }
        if (!job.channelReply) await this.options.ensureUserMcp?.(row.user_id);
        const channelPolicy = job.channelReply ? channelRunPolicy(job.channelReply) : undefined;
        let systemPrompt = channelPolicy
          ? channelPolicy.systemPrompt
          : job.systemPrompt ?? await this.options.getSystemPrompt(row.user_id);
        if (job.channelReply && !job.channelHistory) {
          job.channelHistory = await this.channelHistory(row, runs);
          await db.run('UPDATE scheduled_occurrences SET job_json=? WHERE id=? AND user_id=? AND cancelled=0',
            [JSON.stringify(job), row.id, row.user_id]);
        }
        const requestedTextArtifactPath = job.channelReply ? undefined : resolveRequestedTextArtifactPath(job.intent);
        if (scope) systemPrompt += '\n\n这是已到期的交办。现在按原授权完成任务，不要重新创建本计划。';
        if (requestedTextArtifactPath) systemPrompt += `\n\n${buildTextArtifactDeliveryInstruction(requestedTextArtifactPath)}`;
        const allowedToolNames = scope?.allowedToolNames ?? channelPolicy?.allowedToolNames ?? job.allowedToolNames;
        run = await runs.accept({ userId: row.user_id, sessionId: current.execution_session_id, requestId: row.id,
          messages: [...(job.channelHistory ?? []), { role: 'user', content: job.intent }], userMessage: { content: job.intent },
          channelReplyOnly: job.channelReply ? true : undefined,
          providerId: config.providerId, modelId: config.modelId, systemPrompt, requestedTextArtifactPath,
          toolLoadingMode: allowedToolNames === undefined || scope?.allowedToolNames.includes('capability.load') ? 'on_demand' : 'all',
          initialLoadedToolNames: ['file.present'],
          allowedToolNames, blockedToolNames: scope?.blockedToolNames, scheduledWorkspace: job.channelReply ? {} : scope?.workspace });
        await db.run("UPDATE scheduled_occurrences SET run_id=?,status=? WHERE id=? AND cancelled=0", [run.id, statusFor(job,'attached'), row.id]);
      }
      const latest = await db.queryOne<Occurrence>('SELECT * FROM scheduled_occurrences WHERE id=?', [row.id]);
      if (latest?.cancelled) { await runs.stopRequest(row.user_id, current.execution_session_id, row.id); return; }
      if (run.status === 'interrupted' && run.canResume) {
        await runs.resume(row.user_id, run.id, { automatic: true });
        this.track(row, run.id, runs.wait(run.id));
      } else if (['running', 'stopping'].includes(run.status)) {
        this.track(row, run.id, runs.launch(row.user_id, run.id));
      } else await this.settle(row.user_id, row.id, run.id);
    } finally { try { await this.locks.release(lock, 'record'); } finally { this.busyJobs.delete(lock); } }
  }
  private track(row: Occurrence, runId: string, execution: Promise<unknown>) {
    this.noticeSlowChannelReply(row, execution);
    const work = execution.then(() => this.settle(row.user_id, row.id, runId))
      .catch(error => console.error('[scheduler] run failed', row.id, error))
      .finally(() => { if (this.active.get(row.id) === work) this.active.delete(row.id); });
    this.active.set(row.id, work);
  }
  async wait(): Promise<void> { await Promise.all(this.active.values()); }
  /** A channel conversation stays silent while the model works; after a while the person hears that work is under way. */
  private noticeSlowChannelReply(row: Occurrence, execution: Promise<unknown>) {
    if (!this.options.sendChannelReply || this.progressNoticed.has(row.id)) return;
    let job: BackgroundJob;
    try { job = JSON.parse(row.job_json) as BackgroundJob; } catch { return; }
    if (!job.channelReply) return;
    this.progressNoticed.add(row.id);
    const address = job.channelReplyVersion === 2 ? job.channelReply : { ...job.channelReply, legacyUnbound: true };
    void scheduleProgressNotice(execution, { send: () => this.options.sendChannelReply!(row.user_id, address, CHANNEL_PROGRESS_TEXT) });
  }
  private async saveOutcomeNotice(row: Occurrence, outcome: 'completed' | 'needs_attention' | 'channel_reply_unknown', detail?: string): Promise<string | undefined> {
    const job = JSON.parse(row.job_json) as BackgroundJob;
    if (row.job_id.startsWith('handoff:') || job.sessionId) return;
    const db = this.options.db;
    const id = `scheduled-outcome-${digest(`${row.id}:${outcome}`)}`;
    const latest = await db.queryOne<{job_json:string}>('SELECT job_json FROM scheduled_occurrences WHERE id=? AND user_id=?',[row.id,row.user_id]);
    if (latest && JSON.parse(latest.job_json)['outcomeNotice_' + outcome]) return;
    const completed = outcome === 'completed';
    const title = outcome === 'channel_reply_unknown' ? '渠道回复未确认'
      : job.channelReply ? '渠道消息需要你处理'
      : completed ? '定时交办做好了' : '定时交办需要你处理';
    const body = [(job.name || job.intent).slice(0, 140),outcome==='channel_reply_unknown'?'还不知道对方有没有收到。先到原来的聊天里看看，暂时别再发一次。':detail?.slice(0,1000)].filter(Boolean).join('\n');
    const originalLink = row.run_id && row.execution_session_id
      ? `app:chat-session:${row.execution_session_id}`
      : `app:scheduled-run:${row.id}`;
    const link = job.channelReply ? `app:scheduled-run:${row.id}` : originalLink;
    const existing = await db.queryOne<{user_id: string; link: string}>('SELECT user_id,link FROM notifications WHERE id=?', [id]);
    if (existing) {
      if (existing.user_id !== row.user_id || (existing.link !== link && existing.link !== originalLink)) throw new Error('定时结果通知编号或链接冲突');
      await db.run('UPDATE scheduled_occurrences SET job_json=JSON_SET(job_json,?,1) WHERE id=? AND user_id=?',[`$.outcomeNotice_${outcome}`,row.id,row.user_id]);
      return;
    }
    await db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO notifications
      (id,user_id,type,title,body,link,\`read\`,created_at)
      SELECT ?,user_id,?,?,?,?,0,? FROM scheduled_occurrences
      WHERE id=? AND user_id=? AND cancelled=0 AND status IN ('queued','attached','needs_attention','channel_queued','channel_attached','channel_waiting')`,
    [id, completed ? 'success' : 'warning', title, body, link, Date.now(), row.id, row.user_id]);
    const saved = await db.queryOne<{user_id: string; link: string}>('SELECT user_id,link FROM notifications WHERE id=?', [id]);
    if (saved && (saved.user_id !== row.user_id || saved.link !== link)) throw new Error('定时结果通知编号或链接冲突');
    if (saved) await db.run('UPDATE scheduled_occurrences SET job_json=JSON_SET(job_json,?,1) WHERE id=? AND user_id=?',[`$.outcomeNotice_${outcome}`,row.id,row.user_id]);
    return saved ? id : undefined;
  }
  private refreshOutcomeNotice(userId: string, id: string | undefined, type = 'notification_created') {
    if (!id) return;
    try { broadcastToUser(userId, { type, data: { id } }); }
    catch { console.warn('[scheduler] outcome notification refresh unavailable'); }
  }
  private async resolveAttentionNotice(userId:string,occurrenceId:string):Promise<string|undefined>{
    const id=`scheduled-outcome-${digest(`${occurrenceId}:needs_attention`)}`;
    const pending=await this.options.db.queryOne<{read:number}>('SELECT `read` FROM notifications WHERE id=? AND user_id=?',[id,userId]);
    if(!pending||pending.read)return;
    await this.options.db.markNotificationRead(id,userId);
    return id;
  }
  private async needsAttention(row: Occurrence, error: string, questionPending = false) {
    const db = this.options.db;
    const noticeId = publicStatus(row.status) === 'needs_attention' || questionPending ? undefined : await this.saveOutcomeNotice(row, 'needs_attention',error);
    await db.run("UPDATE scheduled_occurrences SET status=?,error=? WHERE id=? AND user_id=? AND cancelled=0 AND status IN ('queued','attached','needs_attention','channel_queued','channel_attached','channel_waiting')", [statusFor(JSON.parse(row.job_json),'needs_attention'),error, row.id, row.user_id]);
    await db.run("UPDATE scheduled_jobs SET enabled=0 WHERE user_id=? AND id IN (SELECT job_id FROM scheduled_occurrences WHERE id=? AND cancelled=0 AND status IN ('needs_attention','channel_waiting'))", [row.user_id, row.id]);
    this.refreshOutcomeNotice(row.user_id, noticeId);
  }
  private async settle(userId: string, id: string, runId: string) {
    const run = await this.options.getRuns()!.get(userId, runId);
    const db = this.options.db;
    const row = await db.queryOne<Occurrence>('SELECT * FROM scheduled_occurrences WHERE id=? AND user_id=? AND run_id=?', [id, userId, runId]);
    if (!row || row.cancelled || row.status === 'completed') return;
    if (run.status === 'completed') {
      const job = JSON.parse(row.job_json) as BackgroundJob;
      let noticeId: string | undefined;
      let resolvedNoticeId: string | undefined;
      if (job.channelReply) {
        const address = job.channelReplyVersion === 2 ? job.channelReply : {...job.channelReply,legacyUnbound:true};
        const delivery = await this.deliverChannelReply(row, address, run.content);
        if (delivery === 'pending') return;
        if (delivery === 'not_sent') { await this.needsAttention(row,!job.channelReply.accountId || job.channelReply.legacyUnbound ? '历史消息的来源账号不明，未自动回复，请人工核对。' : '自动回复尚未发送，请恢复原渠道账号和配置后重试。'); return; }
        if (delivery === 'unknown') noticeId = await this.saveOutcomeNotice(row, 'channel_reply_unknown');
        if (delivery === 'sent' || delivery === 'unknown') {
          resolvedNoticeId=await this.resolveAttentionNotice(userId,row.id);
        }
      } else {
        await this.options.onCompleted?.(job);
        noticeId = await this.saveOutcomeNotice(row, 'completed');
      }
      await db.run("UPDATE scheduled_occurrences SET status='completed',error=NULL WHERE id=? AND user_id=? AND cancelled=0", [id, userId]);
      this.refreshOutcomeNotice(userId, noticeId);
      this.refreshOutcomeNotice(userId, resolvedNoticeId,'notification_updated');
    } else if (!['running', 'stopping'].includes(run.status)) {
      await this.needsAttention(row, run.error || '执行已停止，请到原对话查看并决定是否继续。', run.userQuestion?.status === 'pending');
    } else {
      await db.run("UPDATE scheduled_occurrences SET status=?,error=NULL WHERE id=? AND user_id=? AND cancelled=0 AND status IN ('attached','needs_attention','channel_attached','channel_waiting')", [statusFor(JSON.parse(row.job_json),'attached'),id, userId]);
    }
  }
  private async deliverReminder(row: Occurrence, job: ScheduledJob) {
    const db = this.options.db;
    const session = await db.getSession(job.sessionId!);
    if (session?.user_id !== row.user_id) { await this.needsAttention(row, '提醒会话不存在或无权访问。'); return; }
    const messageId = digest(`reminder:${row.id}`);
    await db.run(`${this.sqlite ? 'INSERT OR IGNORE' : 'INSERT IGNORE'} INTO chat_messages (id,session_id,role,content,created_at)
      SELECT ?,?,'assistant',?,? FROM scheduled_occurrences WHERE id=? AND cancelled=0 AND status='queued'`,
    [messageId, job.sessionId!, `⏰ **提醒**\n\n${job.intent}`, this.sqlite ? new Date().toISOString() : new Date().toISOString().slice(0, 19).replace('T', ' '), row.id]);
    const message=await db.queryOne<{session_id:string;content:string}>('SELECT session_id,content FROM chat_messages WHERE id=?',[messageId]);
    if(!message||message.session_id!==job.sessionId||message.content!==`⏰ **提醒**\n\n${job.intent}`){await this.needsAttention(row,'提醒消息编号或内容冲突，已保留现有数据。');return;}
    const noticeId=`scheduled-reminder-${digest(row.id)}`,body=job.intent.slice(0,2000),link=`app:chat-session:${job.sessionId}`;
    await db.run(`${this.sqlite?'INSERT OR IGNORE':'INSERT IGNORE'} INTO notifications(id,user_id,type,title,body,link,\`read\`,created_at)
      SELECT ?,user_id,'info','到时间啦',?,?,0,created_at FROM scheduled_occurrences WHERE id=? AND user_id=? AND cancelled=0 AND status='queued'`,[noticeId,body,link,row.id,row.user_id]);
    const notice=await db.queryOne<{user_id:string;body:string;link:string;read:number}>('SELECT user_id,body,link,`read` FROM notifications WHERE id=?',[noticeId]);
    if(!notice)return;
    if(notice.user_id!==row.user_id||notice.body!==body||notice.link!==link){await this.needsAttention(row,'提醒通知编号冲突，已保留现有数据。');return;}
    await db.run("UPDATE scheduled_occurrences SET status='reminded' WHERE id=? AND cancelled=0 AND status='queued' AND EXISTS(SELECT 1 FROM chat_messages WHERE id=? AND session_id=?)", [row.id, messageId, job.sessionId!]);
    const delivered=await db.queryOne<{status:string;cancelled:number}>('SELECT status,cancelled FROM scheduled_occurrences WHERE id=?',[row.id]);
    if(delivered?.status==='reminded'&&!delivered.cancelled&&!notice.read){try{broadcastToUser(row.user_id,{type:'notification_created',data:{id:noticeId,sessionId:job.sessionId,...(Buffer.byteLength(message.content)<=16000?{message:{id:messageId,content:message.content,timestamp:Number(row.created_at)}}:{})}});}catch{console.warn('[scheduler] reminder realtime refresh unavailable');}}
  }
}
