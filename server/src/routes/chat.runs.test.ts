import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { MemoryService } from '../memory/MemoryService.js';
import { callLLM } from '../chat/chatService.js';
import { resolveLLMCredentials } from '../llm/credentialResolver.js';
import { resetRateLimitState } from '../middleware/chatRateLimit.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import { createChatRouter } from './chat.js';

vi.mock('../chat/chatService.js', () => ({
  callLLM: vi.fn().mockResolvedValue('仍然没有要求的章节'),
  callLLMStream: vi.fn(), callLLMWithTools: vi.fn(), callLLMGenerateImage: vi.fn(),
}));
vi.mock('../llm/credentialResolver.js', () => ({
  resolveLLMCredentials: vi.fn().mockResolvedValue({ providerId: 'mock', modelId: 'mock-model', apiKey: 'not-a-real-key' }),
}));

type LoopParams = Parameters<AgentOrchestrator['runChatAgentLoop']>[0];
type LoopResult = Awaited<ReturnType<AgentOrchestrator['runChatAgentLoop']>>;

describe('assistant handoff HTTP lifecycle', () => {
  let sqlite: SqliteAppDatabase;
  let db: SqliteDatabaseAdapter;
  let sandbox: SandboxFS;
  let server: Server;
  let base: string;
  let sessionId: string;
  let loop: ReturnType<typeof vi.fn<(params: LoopParams) => Promise<LoopResult>>>;
  const releaseGates: Array<() => void> = [];
  const payload = (requestId: string, content = '请整理资料') => ({
    requestId, sessionId, providerId: 'mock', modelId: 'mock-model', scene: 'normal_chat',
    messages: [{ role: 'user', content }],
  });
  const api = (url: string, body?: object, userId = 'owner') => fetch(base + url, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const snapshot = async (runId: string) => (await api(`/chat/runs/${runId}`)).json();
  const terminal = async (runId: string, status: string) => {
    let settled: Record<string, any> = {};
    await vi.waitFor(async () => { settled = await snapshot(runId); expect(settled.status).toBe(status); }, { timeout: 5000, interval: 250 });
    return settled;
  };
  const eventData = (text: string, event: string): Record<string, any> => {
    const block = text.split(/\n\n+/).find((part) => part.startsWith(`event: ${event}\n`));
    if (!block) throw new Error(`Missing SSE event ${event}: ${text}`);
    return JSON.parse(block.slice(block.indexOf('data: ') + 'data: '.length));
  };
  const openRun = async (requestId: string) => {
    const response = await api('/chat/agent/stream', payload(requestId));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) {
      const result = await reader.read();
      if (result.done) throw new Error('SSE ended before accepting the handoff');
      text += decoder.decode(result.value, { stream: true });
    }
    return { reader, accepted: eventData(text, 'run_started') };
  };
  function gate() {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    releaseGates.push(release);
    return { pending, release };
  }

  beforeEach(async () => {
    releaseGates.length = 0;
    vi.mocked(callLLM).mockResolvedValue('仍然没有要求的章节');
    vi.mocked(resolveLLMCredentials).mockResolvedValue({ providerId: 'mock', modelId: 'mock-model', apiKey: 'not-a-real-key' });
    vi.spyOn(MemoryService.prototype, 'readLearnedPrompt').mockResolvedValue('');
    vi.spyOn(MemoryService.prototype, 'ensureEvolvedCorePromptExists').mockResolvedValue();
    vi.spyOn(MemoryService.prototype, 'readEvolvedCorePrompt').mockResolvedValue('');
    const root = await mkdtemp(path.join(os.tmpdir(), 'assistant-http-'));
    sqlite = new SqliteAppDatabase(path.join(root, 'db'));
    db = new SqliteDatabaseAdapter(sqlite);
    await db.exec(await readFile(new URL('../../migrations/017_add_calendar_events.sql', import.meta.url), 'utf8'));
    sandbox = new SandboxFS(path.join(root, 'workspace'));
    await mkdir(path.join(sandbox.getRoot(), '文档'), { recursive: true });
    sessionId = sqlite.createSession('owner', '闭环集成测试', 'normal_chat').id;
    loop = vi.fn(async ({ messages, onCheckpoint }) => {
      await onCheckpoint?.([...messages, { role: 'assistant', content: '资料已经整理' }]);
      return { content: '资料已经整理', stopReason: 'completed' };
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.userId = req.header('X-User-Id') ?? 'owner'; next(); });
    const orchestrator = { getTools: () => [], runChatAgentLoop: loop } as unknown as AgentOrchestrator;
    app.use(createChatRouter(orchestrator, sandbox, (_req, _res, next) => next(), undefined, db));
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    releaseGates.forEach((release) => release());
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    sqlite?.close();
    vi.restoreAllMocks();
  });

  it('accepts once, persists server-owned messages, and returns the same run on retry', async () => {
    const first = await api('/chat/agent/stream', payload('same-handoff'));
    const firstText = await first.text();
    expect(first.status).toBe(200);
    const accepted = eventData(firstText, 'run_started');
    const done = eventData(firstText, 'done');
    expect(done.status).toBe('completed');
    expect(done.serverPersisted).toBe(true);
    resetRateLimitState(); // The handoff idempotency check is independent of the model-send rate policy.
    const retry = await api('/chat/agent/stream', payload('same-handoff'));
    expect(eventData(await retry.text(), 'run_started').runId).toBe(accepted.runId);
    expect(loop).toHaveBeenCalledOnce();
    const messages = await db.getMessages(sessionId);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].id).toBe(done.assistantMessageId);
    expect(messages[1].content).toBe('资料已经整理');
    expect(JSON.stringify(await db.getAllTasks())).not.toContain('not-a-real-key');
  });
  it.each(['/chat/agent','/chat/agent/stream'])('preloads the requested Office creator for %s handoffs',async endpoint=>{
    const response=await api(endpoint,payload('office-preload','请把故事做成 Word 文档，保存到 故事.docx'));
    expect(response.status).toBe(200);await response.text();
    await vi.waitFor(()=>expect(loop).toHaveBeenCalled());
    expect(loop.mock.calls[0][0].initialLoadedToolNames).toContain('office.create_docx');
  });
  it.each(['/chat/agent','/chat/agent/stream'])('registers an authenticated legacy %s request that omits conversation IDs',async endpoint=>{
    const {sessionId:_session,requestId:_request,...body}=payload('auto');
    const first=await api(endpoint,body);expect(first.status).toBe(200);
    const data=endpoint.endsWith('/stream')?eventData(await first.text(),'run_started'):await first.json();
    expect(data.serverPersisted).toBe(true);expect(data.sessionId).toBeTruthy();expect(data.requestId).toBeTruthy();
    const owner=await db.getSession(data.sessionId);expect(owner?.user_id).toBe('owner');
    expect((await db.getMessages(data.sessionId)).map(message=>message.role)).toEqual(['user','assistant']);
    resetRateLimitState();const retry=await api(endpoint,{...body,sessionId:data.sessionId,requestId:data.requestId});
    const repeated=endpoint.endsWith('/stream')?eventData(await retry.text(),'run_started'):await retry.json();
    expect(repeated.runId).toBe(data.runId);expect(loop).toHaveBeenCalledTimes(1);
  });

  it('keeps working after the SSE reader disconnects and exposes a verified real file', async () => {
    const work = gate();
    loop.mockImplementationOnce(async ({ messages, onCheckpoint, onToolEvent }) => {
      await onCheckpoint?.(messages);
      await work.pending;
      await onToolEvent?.({ type: 'tool_start', id: 'file-1', toolName: 'file.write', input: { path: '文档/交付.md' } });
      await sandbox.writeOverwrite('文档/交付.md', '真实文件内容');
      await onToolEvent?.({ type: 'tool_complete', id: 'file-1', toolName: 'file.write', output: { written: true, path: '文档/交付.md' }, duration: 1 });
      await onCheckpoint?.([...messages, { role: 'assistant', content: '成果已准备好' }]);
      return { content: '成果已准备好', stopReason: 'completed' };
    });
    const { reader, accepted } = await openRun('disconnect-handoff');
    await reader.cancel();
    expect((await snapshot(accepted.runId)).status).toBe('running');
    work.release();
    const result = await terminal(accepted.runId, 'completed');
    expect(result.artifacts).toEqual([{ path: '文档/交付.md', name: '交付.md', size: Buffer.byteLength('真实文件内容') }]);
    expect(await sandbox.read('文档/交付.md')).toBe('真实文件内容');
    const listed = await (await api(`/chat/runs?sessionId=${sessionId}`)).json();
    expect(listed.runs[0].id).toBe(accepted.runId);
    expect((await db.getMessages(sessionId))[1].content).toBe('成果已准备好');
  });

  it('stops through a separate request, waits for settlement and resumes the saved checkpoint', async () => {
    const work = gate();
    loop.mockImplementationOnce(async ({ messages, onCheckpoint, signal }) => {
      await onCheckpoint?.(messages);
      await work.pending;
      signal!.throwIfAborted();
      return { content: '不应到达', stopReason: 'completed' };
    });
    const { reader, accepted } = await openRun('stop-handoff');
    const stop = await api(`/chat/runs/${accepted.runId}/stop`, {});
    expect(stop.status).toBe(200);
    expect((await stop.json()).status).toBe('stopping');
    work.release();
    expect((await terminal(accepted.runId, 'paused')).canResume).toBe(true);
    await reader.cancel();
    const resume = await api(`/chat/runs/${accepted.runId}/resume`, {});
    expect(resume.status).toBe(202);
    await terminal(accepted.runId, 'completed');
    expect(loop).toHaveBeenCalledTimes(2);
    expect(loop.mock.calls[1][0].messages.some((m) => m.role === 'user' && m.content === '请整理资料')).toBe(true);
    expect((await db.getMessages(sessionId)).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('rejects a different user for list, read, stop, resume and handoff', async () => {
    const completed = await api('/chat/agent/stream', payload('owned-handoff'));
    const run = eventData(await completed.text(), 'done');
    expect((await api(`/chat/runs?sessionId=${sessionId}`, undefined, 'stranger')).status).toBe(404);
    expect((await api(`/chat/runs/${run.id}`, undefined, 'stranger')).status).toBe(404);
    expect((await api(`/chat/runs/${run.id}/stop`, {}, 'stranger')).status).toBe(404);
    expect((await api(`/chat/runs/${run.id}/resume`, {}, 'stranger')).status).toBe(409);
    expect((await api('/chat/agent/stream', payload('stranger-handoff'), 'stranger')).status).toBe(400);
    expect(loop).toHaveBeenCalledOnce();
  });

  it('delivers only the body when the model repeats it around file and length commentary', async () => {
    const body = '先浇水，再播种。覆土保湿，等种子发芽。';
    const draft = body + '\n\n**字数**：二十字。\n**文件**：`播种.md`（正文如下）\n\n---\n\n' + body;
    loop.mockImplementationOnce(async ({ messages, onCheckpoint }) => {
      await onCheckpoint?.([...messages, { role: 'assistant', content: draft }]);
      return { content: draft, stopReason: 'completed' };
    });
    const response = await api('/chat/agent/stream', payload('clean-file', '请写一段不超过四十字的播种说明，保存为 播种.md'));
    const done = eventData(await response.text(), 'done');
    expect(done.status).toBe('completed');
    expect(await sandbox.read('文档/播种.md')).toBe(body);
    expect(done.content).toBe(body);
    expect(vi.mocked(callLLM).mock.calls.some(([params]) =>
      params.messages.some(message => message.role === 'system' && /完整性编辑器|按原始要求重写/.test(message.content)),
    )).toBe(false);
  });

  it.each([true, false])('replaces over-limit drafts only when one correction passes: %s', async corrected => {
    const long = '请先浇水，再选择合适的种子，播种后覆盖薄土并持续保持湿润。'.repeat(3);
    loop.mockImplementationOnce(async ({ messages, onCheckpoint }) => {
      await onCheckpoint?.([...messages, { role: 'assistant', content: long }]);
      return { content: long, stopReason: 'completed' };
    });
    const body = '先浇水，再播种。';
    vi.mocked(callLLM).mockResolvedValueOnce(corrected ? body : long);
    const response = await api('/chat/agent/stream', payload('over-limit', '写一段播种说明，正文不超过40字，保存为 播种.md'));
    const done = eventData(await response.text(), 'done');
    const corrections = vi.mocked(callLLM).mock.calls.filter(([params]) =>
      params.messages.some(message => message.role === 'system' && message.content.includes('按原始要求重写')),
    );
    expect(corrections).toHaveLength(1);
    if (corrected) {
      expect(done.status).toBe('completed');
      expect(await sandbox.read('文档/播种.md')).toBe(body);
    } else {
      expect(done.status).toBe('blocked');
      expect(done.error).toContain('正文最多 40 字');
      expect(done.artifacts).toEqual([]);
      expect(await sandbox.exists('文档/播种.md')).toBe(false);
    }
  });

  it('keeps an existing file untouched when no body was generated', async () => {
    await sandbox.writeOverwrite('文档/播种.md', '已有正文');
    loop.mockResolvedValueOnce({ content: '', stopReason: 'completed' });
    vi.mocked(callLLM).mockResolvedValueOnce(' ');
    const response = await api('/chat/agent/stream', payload('no-new-content', '生成一份报告并保存为 播种.md'));
    const done = eventData(await response.text(), 'done');
    expect(done.status).toBe('blocked');
    expect(done.error).toContain('完整正文');
    expect(done.artifacts).toEqual([]);
    expect(await sandbox.read('文档/播种.md')).toBe('已有正文');
  });

  it('retains text-completeness checks and does not publish an incomplete file', async () => {
    loop.mockImplementationOnce(async ({ messages, onCheckpoint }) => {
      await onCheckpoint?.([...messages, { role: 'assistant', content: '只有执行摘要' }]);
      return { content: '只有执行摘要', stopReason: 'completed' };
    });
    const response = await api('/chat/agent/stream', payload('incomplete-report', '请写研究报告，包含执行摘要、关键发现、争议与局限，保存到 "文档/研究报告.md"'));
    const done = eventData(await response.text(), 'done');
    expect(done.status).toBe('blocked');
    expect(done.error).toContain('交付校验未通过');
    expect(done.artifacts).toEqual([]);
    expect(await sandbox.exists('文档/研究报告.md')).toBe(false);
    expect(callLLM).toHaveBeenCalledOnce();
  });

  it('allows repeated status polling without consuming the model-send rate limit', async () => {
    const response = await api('/chat/agent/stream', payload('poll-handoff'));
    const run = eventData(await response.text(), 'done');
    expect((await api(`/chat/runs/${run.id}`)).status).toBe(200);
    expect((await api(`/chat/runs/${run.id}`)).status).toBe(200);
  });

  it('persists an early stop request and refuses the later handoff', async () => {
    const cancelled = await api('/chat/runs/stop-request', { sessionId, requestId: 'cancel-before-ack' });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).status).toBe('paused');
    const handoff = await api('/chat/agent/stream', payload('cancel-before-ack'));
    expect(handoff.status).toBe(400);
    expect((await handoff.json()).error).toContain('取消');
    expect(loop).not.toHaveBeenCalled();
  });
});
