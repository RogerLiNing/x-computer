import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { NODE_WS_PATH, type ServerToNodeMessage } from '../../../shared/src/nodeProtocol.js';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { NodeGateway } from './NodeGateway.js';
import { NodeRegistry } from './NodeRegistry.js';
import { NodeTaskService } from './NodeTaskService.js';
import { createUpgradeRouter } from './upgradeRouter.js';

const specs = { hostname: 'n1', platform: 'linux', arch: 'x64', cpus: 1, memoryMb: 1024, agentVersion: 'test' };

function connect(port: number, nodeId: string, nodeKey: string): Promise<{ ws: WebSocket; next: () => Promise<ServerToNodeMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${NODE_WS_PATH}`, { headers: { 'x-node-id': nodeId, 'x-node-key': nodeKey } });
    const queue: ServerToNodeMessage[] = []; const waiters: Array<(message: ServerToNodeMessage) => void> = [];
    ws.on('message', (raw) => { const message = JSON.parse(raw.toString()) as ServerToNodeMessage; const waiter = waiters.shift(); if (waiter) waiter(message); else queue.push(message); });
    ws.on('open', () => resolve({ ws, next: () => new Promise((done) => { const queued = queue.shift(); if (queued) done(queued); else waiters.push(done); }) }));
    ws.on('error', reject);
  });
}

describe('NodeGateway', () => {
  let sqlite: SqliteAppDatabase; let registry: NodeRegistry; let gateway: NodeGateway; let tasks: NodeTaskService; let server: http.Server; let port: number;
  const callModel = vi.fn(async (request: { onChunk: (delta: string) => void; messages: Array<{ content: string }> }) => { request.onChunk('你'); request.onChunk('好'); return { content: `回答:${request.messages.at(-1)?.content}`, toolCalls: [] }; });
  const notify = vi.fn(async () => {});
  beforeEach(async () => {
    sqlite = new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(), 'node-gw-')));
    const db = new SqliteDatabaseAdapter(sqlite);
    registry = new NodeRegistry(db);
    let service: NodeTaskService;
    gateway = new NodeGateway({ registry, callModel: callModel as never, heartbeatIntervalMs: 200, events: {
      onProgress: (node, progress) => service.onProgress(node, progress), onResult: (node, result) => service.onResult(node, result), onQuestion: (node, question) => service.onQuestion(node, question),
      onOnline: (node) => service.flushQueued(node),
    } });
    service = new NodeTaskService({ db, registry, gateway, notify });
    tasks = service;
    server = http.createServer((_req, res) => res.end('ok'));
    createUpgradeRouter(server).register(NODE_WS_PATH, gateway.handleUpgrade);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
    callModel.mockClear(); notify.mockClear();
  });
  afterEach(async () => { gateway.stop(); await new Promise((resolve) => server.close(resolve)); sqlite.close(); });

  it('rejects unknown nodes and welcomes enrolled ones', async () => {
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${NODE_WS_PATH}`, { headers: { 'x-node-id': 'nope', 'x-node-key': 'nope' } });
      ws.on('close', (code) => resolve(code)); ws.on('error', reject);
    })).resolves.toBe(1008);
    const { node, nodeKey } = await registry.enroll((await registry.createEnrollToken('roger', { name: 'n1' })).token, specs);
    const client = await connect(port, node.id, nodeKey);
    expect(await client.next()).toMatchObject({ type: 'welcome', nodeId: node.id });
    expect(gateway.isOnline(node.id)).toBe(true);
    client.ws.send(JSON.stringify({ type: 'heartbeat', metrics: { load1: 1, memoryUsedMb: 1, memoryTotalMb: 2, runningTasks: 0, uptimeSec: 1 } }));
    await vi.waitFor(async () => expect((await registry.get('roger', node.id))?.metrics?.load1).toBe(1));
    client.ws.close();
    await vi.waitFor(() => expect(gateway.isOnline(node.id)).toBe(false));
  });

  it('proxies model requests with streamed chunks and relays task progress, questions and results', async () => {
    const { node, nodeKey } = await registry.enroll((await registry.createEnrollToken('roger', { name: 'n1' })).token, specs);
    const client = await connect(port, node.id, nodeKey);
    await client.next();
    const task = await tasks.create('roger', 'n1', '统计日志');
    expect(task.status).toBe('running');
    expect(await client.next()).toMatchObject({ type: 'task/assign', task: { taskId: task.id, goal: '统计日志' } });

    client.ws.send(JSON.stringify({ type: 'model/request', id: 'm1', taskId: task.id, messages: [{ role: 'user', content: '开始' }], tools: [] }));
    expect(await client.next()).toEqual({ type: 'model/chunk', id: 'm1', delta: '你' });
    expect(await client.next()).toEqual({ type: 'model/chunk', id: 'm1', delta: '好' });
    expect(await client.next()).toMatchObject({ type: 'model/done', id: 'm1', content: '回答:开始' });
    expect(callModel.mock.calls[0]![0]).toMatchObject({ userId: 'roger', nodeId: node.id, taskId: task.id });

    client.ws.send(JSON.stringify({ type: 'task/progress', progress: { taskId: task.id, kind: 'tool_start', at: 1, toolName: 'shell' } }));
    client.ws.send(JSON.stringify({ type: 'task/question', taskId: task.id, questionId: 'q1', question: '删除旧日志吗？' }));
    await vi.waitFor(async () => expect((await tasks.get('roger', task.id))?.status).toBe('waiting_user'));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), 'question');
    expect(await tasks.answer('roger', task.id, '可以')).toBe(true);
    expect(await client.next()).toMatchObject({ type: 'task/answer', taskId: task.id, questionId: 'q1', answer: '可以' });

    client.ws.send(JSON.stringify({ type: 'task/result', result: { taskId: task.id, ok: true, content: '共 120 行', steps: 2, modelCalls: 1 } }));
    await vi.waitFor(async () => expect((await tasks.get('roger', task.id))?.status).toBe('completed'));
    const done = await tasks.get('roger', task.id);
    expect(done?.result?.content).toBe('共 120 行');
    expect(done?.progress).toHaveLength(1);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ id: task.id, status: 'completed' }), 'completed');
    client.ws.close();
  });

  it('queues a task for an offline node and sends it when the node connects; streams exec output', async () => {
    const { node, nodeKey } = await registry.enroll((await registry.createEnrollToken('roger', { name: 'n1' })).token, specs);
    const queued = await tasks.create('roger', node.id, '离线时派发');
    expect(queued.status).toBe('queued');
    const client = await connect(port, node.id, nodeKey);
    await client.next();
    expect(await client.next()).toMatchObject({ type: 'task/assign', task: { taskId: queued.id } });
    await vi.waitFor(async () => expect((await tasks.get('roger', queued.id))?.status).toBe('running'));

    const chunks: string[] = [];
    const exit = gateway.exec(node.id, 'echo hi', { onOutput: (_stream, data) => chunks.push(data) });
    const run = await client.next() as Extract<ServerToNodeMessage, { type: 'exec/run' }>;
    expect(run).toMatchObject({ type: 'exec/run', command: 'echo hi' });
    client.ws.send(JSON.stringify({ type: 'exec/output', id: run.id, stream: 'stdout', data: 'hi\n' }));
    client.ws.send(JSON.stringify({ type: 'exec/exit', id: run.id, exitCode: 0 }));
    expect(await exit).toEqual({ exitCode: 0, timedOut: undefined });
    expect(chunks).toEqual(['hi\n']);
    expect(await tasks.cancel('roger', queued.id)).toBe(true);
    expect(await client.next()).toMatchObject({ type: 'task/cancel', taskId: queued.id });
    await expect(gateway.exec('missing', 'ls', { onOutput: () => {} })).rejects.toThrow(/不在线/);
    client.ws.close();
  });
});
