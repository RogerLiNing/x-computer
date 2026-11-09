import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createXGroupRunRouter } from './xGroupRun.js';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { ChatRunService } from '../chat/ChatRunService.js';
import { ScheduledOccurrenceService } from '../scheduler/ScheduledOccurrenceService.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { resolveLLMCredentials } from '../llm/credentialResolver.js';
import { fire } from '../hooks/HookRegistry.js';
vi.mock('../llm/credentialResolver.js', () => ({ resolveLLMCredentials: vi.fn(async () => ({ providerId: 'mock', modelId: 'model', apiKey: 'server-only' })) }));
vi.mock('../hooks/HookRegistry.js', () => ({ fire: vi.fn() }));

describe('manual background handoff HTTP', () => {
  let sqlite: SqliteAppDatabase; let db: SqliteDatabaseAdapter; let server: Server; let base: string;
  let service: ScheduledOccurrenceService; let loop: ReturnType<typeof vi.fn>; let runs: ChatRunService;
  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'manual-handoff-')); sqlite = new SqliteAppDatabase(root); db = new SqliteDatabaseAdapter(sqlite);
    const sandbox = new SandboxFS(path.join(root, 'files')); await mkdir(sandbox.getRoot());
    loop = vi.fn(async params => { await params.onCheckpoint([...params.messages, { role: 'assistant', content: '完成' }]); return { content: '完成', stopReason: 'completed' }; });
    runs = new ChatRunService({ db, orchestrator: { runChatAgentLoop: loop } as never, getSandboxFS: async () => sandbox, getLLMConfig: async () => ({ providerId: 'mock', modelId: 'model' }) });
    service = new ScheduledOccurrenceService({ db, getRuns: () => runs, getSystemPrompt: async () => '', getLLMConfig: async () => ({ providerId: 'mock', modelId: 'model' }) });
    const orchestrator = { runIntentAsPersistedTask: service.run.bind(service),setGroupRunCancel:vi.fn() } as never;
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.userId = String(req.headers['x-test-user'] ?? 'owner'); next(); });
    app.use(createXGroupRunRouter(orchestrator, db, undefined, async () => '', undefined,()=>runs));
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; vi.mocked(fire).mockClear();
  });
  afterEach(async () => { await service.wait(); await new Promise<void>(r => server.close(() => r())); sqlite.close(); });
  const post = (body: object, user = 'owner') => fetch(base + '/x/run-now', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': user }, body: JSON.stringify(body) });
  it('deduplicates a repeated request, returns its durable identity and ignores client credentials', async () => {
    const input = { requestId: 'manual-one', intent: '执行交办', apiKey: 'attacker-key', baseUrl: 'http://localhost/private' };
    const [a, b] = await Promise.all([post(input), post(input)]); expect(a.status).toBe(200); expect(b.status).toBe(200);
    const first = await a.json(); const second = await b.json(); expect(first.runId).toBe(second.runId); expect(first.sessionId).toBeTruthy(); expect(loop).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await db.getAllTasks())).not.toContain('attacker-key');
    expect(vi.mocked(resolveLLMCredentials).mock.calls.at(-1)?.[3]).toBeUndefined(); expect(fire).not.toHaveBeenCalled(); expect(await db.getAllScheduledJobs()).toEqual([]);
  });
  it('does not present an execution failure as successful completion or replay it', async () => {
    loop.mockRejectedValue(new Error('model failed after an effect'));
    expect((await post({ requestId: 'failed-one', intent: '执行' })).status).toBe(500);
    expect((await post({ requestId: 'failed-one', intent: '执行' })).status).toBe(500);
    expect(loop).toHaveBeenCalledTimes(1); expect((await service.list('owner'))[0].status).toBe('needs_attention');
  });
  it('validates actor and request id before model access', async () => {
    expect((await post({ requestId: 'id', intent: '执行' }, 'anonymous')).status).toBe(401);
    expect((await post({ requestId: '', intent: '执行' })).status).toBe(400);
    expect((await post({ requestId: 'id', intent: {} })).status).toBe(400); expect(loop).not.toHaveBeenCalled();
  });
  it('merges read-only old history and durable groups, then cancels the actual saved run',async()=>{
    const old=[{id:'old',groupId:'group',groupName:'旧记录',goal:'old',results:[],createdAt:1}];await db.setConfig('owner','x_group_run_history',JSON.stringify(old));
    const session=await db.createSession('owner','群组记录');
    const run=await runs.accept({userId:'owner',sessionId:session.id,requestId:'group-row',providerId:'mock',modelId:'test',systemPrompt:'',messages:[{role:'user',content:'group goal'}],legacyWait:true,expert:{parentRunId:'parent',agentId:'coordinator',agentName:'群组',depth:1},coordination:{mode:'group',definitionId:'group',goal:'group goal',members:[]}});
    const read=async(user='owner')=>(await fetch(base+'/x/group-run-history?groupId=group',{headers:{'x-test-user':user}})).json();
    const history=await read();expect(history.runs.map((item:{id:string})=>item.id)).toEqual([run.id,'old']);expect((await read('other')).runs).toEqual([]);
    const cancelled=await fetch(base+'/x/cancel-group-run',{method:'POST',headers:{'x-test-user':'owner'}});expect(cancelled.status).toBe(200);expect((await cancelled.json()).stopped).toBe(1);
    expect((await runs.get('owner',run.id)).status).toBe('paused');expect(await db.getConfig('owner','x_group_run_history')).toBe(JSON.stringify(old));expect(loop).not.toHaveBeenCalled();
  });
});
