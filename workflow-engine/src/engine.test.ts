/**
 * 工作流执行引擎测试
 */

import { describe, it, expect } from 'vitest';
import { evalCondition, advance, getInitialNodeIds } from './engine.js';
import type { WorkflowDefinition } from './types.js';

describe('evalCondition', () => {
  it('空或 true 返回 true', () => {
    expect(evalCondition('', {})).toBe(true);
    expect(evalCondition('true', {})).toBe(true);
  });

  it('false 返回 false', () => {
    expect(evalCondition('false', {})).toBe(false);
  });

  it('>= 比较', () => {
    expect(evalCondition('price >= 1900', { price: 2000 })).toBe(true);
    expect(evalCondition('price >= 1900', { price: 1900 })).toBe(true);
    expect(evalCondition('price >= 1900', { price: 100 })).toBe(false);
  });

  it('< 比较', () => {
    expect(evalCondition('x < 10', { x: 5 })).toBe(true);
    expect(evalCondition('x < 10', { x: 10 })).toBe(false);
  });
});

describe('getInitialNodeIds', () => {
  it('从 start 出发取第一条边', () => {
    const def: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 't1', type: 'task', taskType: 'ai' },
      ],
      edges: [{ from: 'start', to: 't1' }],
    };
    expect(getInitialNodeIds(def)).toEqual(['t1']);
  });

  it('无 start 返回空', () => {
    const def: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      version: 1,
      nodes: [{ id: 't1', type: 'task' }],
      edges: [],
    };
    expect(getInitialNodeIds(def)).toEqual([]);
  });
});

describe('advance', () => {
  it('从 task 到 exclusive 到 end', () => {
    const def: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'fetch', type: 'task', taskType: 'script' },
        { id: 'gate', type: 'exclusive' },
        { id: 'notify', type: 'task', taskType: 'ai' },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { from: 'start', to: 'fetch' },
        { from: 'fetch', to: 'gate' },
        { from: 'gate', to: 'notify', condition: 'price >= 1900' },
        { from: 'gate', to: 'end', condition: 'true' },
        { from: 'notify', to: 'end' },
      ],
    };
    const vars1 = { price: 2000 };
    const r1 = advance(def, ['fetch'], vars1);
    expect(r1.nextNodeIds).toContain('notify');
    expect(r1.status).toBe('waiting');

    const r2 = advance(def, ['gate'], vars1);
    expect(r2.nextNodeIds).toContain('notify');
    expect(r2.status).toBe('waiting');

    const vars2 = { price: 100 };
    const r3 = advance(def, ['gate'], vars2);
    expect(r3.nextNodeIds).toEqual([]);
    expect(r3.status).toBe('completed');
  });

  it('到 end 返回 completed', () => {
    const def: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      version: 1,
      nodes: [
        { id: 't1', type: 'task' },
        { id: 'end', type: 'end' },
      ],
      edges: [{ from: 't1', to: 'end' }],
    };
    const r = advance(def, ['t1'], {});
    expect(r.nextNodeIds).toEqual([]);
    expect(r.status).toBe('completed');
  });

  it('parallel fork：沿所有出边推进到多个 task', () => {
    const def: WorkflowDefinition = {
      id: 'w2',
      name: 'Parallel',
      version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'fork', type: 'parallel' },
        { id: 't1', type: 'task', taskType: 'script' },
        { id: 't2', type: 'task', taskType: 'script' },
        { id: 'join', type: 'parallel' },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { from: 'start', to: 'fork' },
        { from: 'fork', to: 't1' },
        { from: 'fork', to: 't2' },
        { from: 't1', to: 'join' },
        { from: 't2', to: 'join' },
        { from: 'join', to: 'end' },
      ],
    };
    const r1 = advance(def, getInitialNodeIds(def), {});
    expect(r1.nextNodeIds).toHaveLength(2);
    expect(r1.nextNodeIds).toContain('t1');
    expect(r1.nextNodeIds).toContain('t2');
    expect(r1.status).toBe('waiting');

    const r2 = advance(def, ['t1', 't2'], { a: 1, b: 2 });
    expect(r2.nextNodeIds).toEqual([]);
    expect(r2.status).toBe('completed');
  });
});
