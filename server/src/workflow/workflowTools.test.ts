/**
 * 工作流工具集成测试（mock workflow-engine HTTP）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from '../orchestrator/ToolExecutor.js';

// Mock workflow client
vi.mock('./workflowClient.js', () => ({
  workflowDeploy: vi.fn().mockResolvedValue({ ok: true, definitionId: 'wf-001' }),
  workflowList: vi.fn().mockResolvedValue({
    definitions: [{ id: 'wf-001', name: 'Test', version: 1 }],
  }),
  workflowDelete: vi.fn().mockResolvedValue({ ok: true }),
  workflowStart: vi.fn().mockResolvedValue({ instanceId: 'inst-abc' }),
  workflowListInstances: vi.fn().mockResolvedValue({
    instances: [{ id: 'inst-abc', status: 'running' }],
  }),
  workflowGetInstance: vi.fn().mockResolvedValue({
    id: 'inst-abc',
    status: 'running',
    variables: {},
  }),
  workflowGetVariables: vi.fn().mockResolvedValue({ price: 100 }),
  workflowSetVariables: vi.fn().mockResolvedValue({ price: 200 }),
  workflowSignal: vi.fn().mockResolvedValue({ ok: true }),
}));

function step(toolName: string, toolInput: Record<string, unknown>) {
  return {
    id: 's1',
    taskId: 't1',
    action: 'run',
    toolName,
    toolInput,
    status: 'pending' as const,
    riskLevel: 'low' as const,
  };
}

describe('workflow tools', () => {
  let executor: ToolExecutor;
  const ctx = {
    userId: 'test-user-123',
    getConfig: () => undefined,
    setConfig: () => {},
  };

  beforeEach(() => {
    executor = new ToolExecutor();
    vi.clearAllMocks();
  });

  it('workflow.deploy 需要已登录', async () => {
    const call = await executor.execute(
      step('workflow.deploy', { definition: { id: 'w1', nodes: [], edges: [] } }),
      'container',
      { userId: 'anonymous' },
    );
    expect(call.error).toContain('需要已登录');
  });

  it('workflow.deploy 成功', async () => {
    const def = {
      id: 'wf-001',
      name: 'Test',
      version: 1,
      nodes: [{ id: 'start', type: 'start' }, { id: 't1', type: 'task' }],
      edges: [{ from: 'start', to: 't1' }],
    };
    const call = await executor.execute(
      step('workflow.deploy', { definition: def }),
      'container',
      ctx,
    );
    expect(call.error).toBeUndefined();
    expect((call.output as { ok?: boolean })?.ok).toBe(true);
  });

  it('workflow.list 成功', async () => {
    const call = await executor.execute(step('workflow.list', {}), 'container', ctx);
    expect(call.error).toBeUndefined();
    expect((call.output as { definitions?: unknown[] })?.definitions).toHaveLength(1);
  });

  it('workflow.start 成功', async () => {
    const call = await executor.execute(
      step('workflow.start', { definitionId: 'wf-001' }),
      'container',
      ctx,
    );
    expect(call.error).toBeUndefined();
    expect((call.output as { instanceId?: string })?.instanceId).toMatch(/^inst-/);
  });
});
