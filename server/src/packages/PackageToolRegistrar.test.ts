import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppDatabase, SqliteDatabaseAdapter } from '../db/database.js';
import { ToolExecutor } from '../orchestrator/ToolExecutor.js';
import { PackageRegistry } from './PackageRegistry.js';
import { PackageToolRegistrar } from './PackageToolRegistrar.js';

const todoPackage = {
  format: 1, id: 'todo', name: '待办', version: '1.0.0', kinds: ['tools'], permissions: ['kv', 'network:api.example.com'],
  tools: [
    { name: 'todo.save', description: '保存', parameters: [{ name: 'key', type: 'string', description: 'k', required: true }, { name: 'value', type: 'string', description: 'v', required: false }], impl: { type: 'kv' } },
    { name: 'todo.sync', description: '同步', parameters: [], impl: { type: 'http', url: 'https://api.example.com/sync', method: 'POST' } },
  ],
};

describe('PackageToolRegistrar', () => {
  let sqlite: SqliteAppDatabase; let db: SqliteDatabaseAdapter; let registry: PackageRegistry; let executor: ToolExecutor; let registrar: PackageToolRegistrar;
  const fetchImpl = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response('{"synced":true}', { status: 200 }));
  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pkg-tools-'));
    sqlite = new SqliteAppDatabase(root); db = new SqliteDatabaseAdapter(sqlite);
    registry = new PackageRegistry(db);
    executor = new ToolExecutor(undefined, undefined, undefined, undefined, undefined, undefined, db);
    registrar = new PackageToolRegistrar(registry, executor, { db, fetchImpl: fetchImpl as unknown as typeof fetch, runTool: async () => ({ ran: true }) });
    fetchImpl.mockClear();
  });
  afterEach(() => sqlite.close());

  const step = (toolName: string, toolInput: Record<string, unknown>) => ({ id: 's', taskId: 't', action: toolName, toolName, toolInput, status: 'pending' as const, riskLevel: 'low' as const });

  it('registers enabled package tools per user with implied permissions and runs them through the executor', async () => {
    await registry.install('alice', todoPackage, { source: 'installed', path: 'apps/todo' });
    await registrar.ensureLoaded('alice');
    const names = executor.listTools('alice').map((tool) => tool.name);
    expect(names).toContain('pkg.todo.save');
    expect(executor.getToolDefinition('pkg.todo.sync', 'alice')?.requiredPermissions).toEqual(['network:api.example.com']);
    expect(executor.listTools('bob').map((tool) => tool.name)).not.toContain('pkg.todo.save');

    const granted = await registrar.grantedPermissions('alice');
    const saved = await executor.execute(step('pkg.todo.save', { key: 'a', value: '1' }), 'container', { userId: 'alice', grantedPermissions: granted });
    expect(saved.output).toEqual({ ok: true, key: 'a' });
    const read = await executor.execute(step('pkg.todo.save', { key: 'a' }), 'container', { userId: 'alice', grantedPermissions: granted });
    expect(read.output).toEqual({ key: 'a', value: '1' });
    expect(await db.appBackendKvGet('alice', 'todo', 'a')).toBe('1');

    const synced = await executor.execute(step('pkg.todo.sync', { since: 1 }), 'container', { userId: 'alice', grantedPermissions: granted });
    expect(synced.output).toMatchObject({ status: 200, body: '{"synced":true}' });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.example.com/sync');
  });

  it('denies a package tool whose permission was not granted and drops tools when the package is disabled', async () => {
    await registry.install('alice', todoPackage, { source: 'installed', path: 'apps/todo' });
    await registrar.ensureLoaded('alice');
    const denied = await executor.execute(step('pkg.todo.sync', {}), 'container', { userId: 'alice', grantedPermissions: ['kv'] });
    expect(denied.error).toContain('network:api.example.com');
    expect(fetchImpl).not.toHaveBeenCalled();

    await registry.setEnabled('alice', 'todo', false);
    await registrar.ensureLoaded('alice');
    expect(executor.listTools('alice').map((tool) => tool.name)).not.toContain('pkg.todo.save');
    expect(await registrar.grantedPermissions('alice')).toEqual([]);
  });

  it('does not touch the executor when nothing changed', async () => {
    const spy = vi.spyOn(executor, 'clearDynamicToolsByScope');
    await registrar.ensureLoaded('alice');
    await registrar.ensureLoaded('alice');
    expect(spy).toHaveBeenCalledTimes(1);
    await registrar.ensureLoaded('anonymous');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
