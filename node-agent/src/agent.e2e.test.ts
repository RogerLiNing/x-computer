import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NODE_WS_PATH } from '../../shared/src/nodeProtocol.js';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../../server/src/db/database.js';
import { NodeGateway } from '../../server/src/nodes/NodeGateway.js';
import { NodeRegistry } from '../../server/src/nodes/NodeRegistry.js';
import { NodeTaskService } from '../../server/src/nodes/NodeTaskService.js';
import { createUpgradeRouter } from '../../server/src/nodes/upgradeRouter.js';
import { NodeAgent } from './agent.js';

/** A fake brain: first call writes a file, second call finishes. */
const brain = vi.fn(async (request: { messages: Array<{ role: string; content: string }>; onChunk: (delta: string) => void }) => {
  const toolMessages = request.messages.filter((message) => message.role === 'tool');
  request.onChunk('思考中');
  if (toolMessages.length === 0) return { content: '', toolCalls: [{ id: 'w', name: 'file_write', arguments: { path: 'report.md', content: '# 报告\n一切正常' } }] };
  return { content: '', toolCalls: [{ id: 'f', name: 'finish', arguments: { summary: '报告已生成', files: ['report.md'] } }] };
});

describe('x-node end to end against the X gateway', () => {
  let sqlite: SqliteAppDatabase; let server: http.Server; let gateway: NodeGateway; let tasks: NodeTaskService; let registry: NodeRegistry; let port: number; let agent: NodeAgent | undefined;
  beforeEach(async () => {
    sqlite = new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(), 'x-node-e2e-db-')));
    const db = new SqliteDatabaseAdapter(sqlite);
    registry = new NodeRegistry(db);
    let service: NodeTaskService;
    gateway = new NodeGateway({ registry, callModel: brain as never, events: { onProgress: (n, p) => service.onProgress(n, p), onResult: (n, r) => service.onResult(n, r), onQuestion: (n, q) => service.onQuestion(n, q), onOnline: (n) => service.flushQueued(n) } });
    service = new NodeTaskService({ db, registry, gateway });
    tasks = service;
    server = http.createServer((_req, res) => res.end('ok'));
    createUpgradeRouter(server).register(NODE_WS_PATH, gateway.handleUpgrade);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
    brain.mockClear();
  });
  afterEach(async () => { agent?.stop(); gateway.stop(); await new Promise((resolve) => server.close(resolve)); sqlite.close(); });

  it('enrolls, connects, receives a task, borrows the brain, runs tools and reports the result', async () => {
    const { node, nodeKey } = await registry.enroll((await registry.createEnrollToken('roger', { name: 'e2e', labels: ['test'] })).token);
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'x-node-e2e-ws-'));
    agent = new NodeAgent({ serverUrl: `http://127.0.0.1:${port}`, nodeId: node.id, nodeKey, name: 'e2e', labels: ['test'], workspace }, () => {});
    await agent.start();
    await vi.waitFor(() => expect(gateway.isOnline(node.id)).toBe(true));
    await vi.waitFor(async () => expect((await registry.get('roger', node.id))?.specs?.hostname).toBeTruthy());

    const task = await tasks.create('roger', 'test', '生成一份巡检报告');
    await vi.waitFor(async () => expect((await tasks.get('roger', task.id))?.status).toBe('completed'), { timeout: 10_000 });
    const done = (await tasks.get('roger', task.id))!;
    expect(done.result).toMatchObject({ ok: true, content: '报告已生成', modelCalls: 2 });
    expect(done.result?.files?.[0]?.path).toMatch(/report\.md$/);
    expect(await readFile(path.join(workspace, done.result!.files![0]!.path), 'utf8')).toContain('一切正常');
    expect(done.progress.some((item) => item.kind === 'tool_start' && item.toolName === 'file_write')).toBe(true);
    expect(brain.mock.calls[0]![0]).toMatchObject({ userId: 'roger', nodeId: node.id, taskId: task.id });

    const chunks: string[] = [];
    const exit = await gateway.exec(node.id, 'echo from-node', { onOutput: (_s, data) => chunks.push(data) });
    expect(exit.exitCode).toBe(0);
    expect(chunks.join('')).toContain('from-node');
    const listed = await gateway.request<{ entries: Array<{ name: string }> }>(node.id, { type: 'fs/list', id: 'l1', path: 'tasks' });
    expect(listed.entries.length).toBeGreaterThan(0);
  });
});
