/**
 * 工作流存储测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { WorkflowStore } from './store.js';
import type { WorkflowDefinition } from './types.js';

describe('WorkflowStore', () => {
  let store: WorkflowStore;
  const dbPath = path.join(os.tmpdir(), `wf-test-${Date.now()}.sqlite`);

  beforeEach(() => {
    store = new WorkflowStore(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  const def: WorkflowDefinition = {
    id: 'wf-001',
    name: '测试流程',
    version: 1,
    nodes: [{ id: 'start', type: 'start' }, { id: 't1', type: 'task', taskType: 'ai' }],
    edges: [{ from: 'start', to: 't1' }],
  };

  it('deploy 和 getDefinition', () => {
    store.deploy('u1', def);
    const got = store.getDefinition('u1', 'wf-001');
    expect(got).not.toBeNull();
    expect(got?.id).toBe('wf-001');
    expect(got?.nodes).toHaveLength(2);
  });

  it('按 userId 隔离', () => {
    store.deploy('u1', def);
    expect(store.getDefinition('u2', 'wf-001')).toBeNull();
  });

  it('listDefinitions', () => {
    store.deploy('u1', def);
    const list = store.listDefinitions('u1');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('测试流程');
  });

  it('createInstance 和 getInstance', () => {
    store.deploy('u1', def);
    const id = store.createInstance('wf-001', 'u1');
    expect(id).toMatch(/^inst-/);
    const inst = store.getInstance('u1', id);
    expect(inst).not.toBeNull();
    expect(inst?.status).toBe('running');
    expect(inst?.definitionId).toBe('wf-001');
  });

  it('updateInstance', () => {
    store.deploy('u1', def);
    const id = store.createInstance('wf-001', 'u1');
    store.updateInstance('u1', id, { status: 'completed', variables: { x: 1 } });
    const inst = store.getInstance('u1', id);
    expect(inst?.status).toBe('completed');
    expect(inst?.variables).toEqual({ x: 1 });
  });

  it('deleteDefinition', () => {
    store.deploy('u1', def);
    const ok = store.deleteDefinition('u1', 'wf-001');
    expect(ok).toBe(true);
    expect(store.getDefinition('u1', 'wf-001')).toBeNull();
  });
});
