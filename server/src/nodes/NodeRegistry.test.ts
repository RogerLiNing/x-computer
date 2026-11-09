import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { NodeRegistry, normalizeLabels } from './NodeRegistry.js';

const specs = { hostname: 'hk-1', platform: 'linux', arch: 'x64', cpus: 2, memoryMb: 2048, agentVersion: '0.1.0' };

describe('NodeRegistry', () => {
  let sqlite: SqliteAppDatabase; let registry: NodeRegistry;
  beforeEach(async () => { sqlite = new SqliteAppDatabase(await mkdtemp(path.join(os.tmpdir(), 'nodes-'))); registry = new NodeRegistry(new SqliteDatabaseAdapter(sqlite)); });
  afterEach(() => sqlite.close());

  it('enrolls a node with a one-time token and authenticates it with the issued key', async () => {
    const { token } = await registry.createEnrollToken('roger', { name: '香港 02', labels: ['Overseas', 'browser', 'bad label!'] });
    const { node, nodeKey } = await registry.enroll(token, specs);
    expect(node).toMatchObject({ userId: 'roger', name: '香港 02', labels: ['overseas', 'browser'], specs });
    await expect(registry.enroll(token, specs)).rejects.toThrow(/无效/);
    expect((await registry.authenticate(node.id, nodeKey))?.id).toBe(node.id);
    expect(await registry.authenticate(node.id, 'wrong')).toBeUndefined();
    expect((await registry.list('roger')).map((item) => item.id)).toEqual([node.id]);
    expect(await registry.list('wife')).toEqual([]);
  });

  it('resolves by id, name or label, records heartbeats and removes only the owner\'s nodes', async () => {
    const a = await registry.enroll((await registry.createEnrollToken('roger', { name: 'gpu-box', labels: ['gpu'] })).token);
    await registry.enroll((await registry.createEnrollToken('roger', { name: 'crawler', labels: ['cn-mainland'] })).token);
    expect((await registry.resolve('roger', 'gpu'))?.name).toBe('gpu-box');
    expect((await registry.resolve('roger', 'crawler'))?.labels).toEqual(['cn-mainland']);
    expect(await registry.resolve('roger', 'nothing')).toBeUndefined();
    await registry.touch(a.node.id, { metrics: { load1: 0.5, memoryUsedMb: 100, memoryTotalMb: 2048, runningTasks: 1, uptimeSec: 10 } });
    const touched = await registry.get('roger', a.node.id);
    expect(touched?.metrics?.runningTasks).toBe(1);
    expect(touched?.lastSeenAt).toBeGreaterThan(0);
    expect(await registry.remove('wife', a.node.id)).toBe(false);
    expect(await registry.remove('roger', a.node.id)).toBe(true);
    expect(await registry.list('roger')).toHaveLength(1);
  });

  it('rejects bad names and expired tokens', async () => {
    await expect(registry.createEnrollToken('roger', { name: '../x' })).rejects.toThrow();
    expect(normalizeLabels(['GPU', 'gpu', 'x y'])).toEqual(['gpu']);
  });
});
