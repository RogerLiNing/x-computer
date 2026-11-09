import { describe, expect, it, vi } from 'vitest';
import { ToolExecutor } from './ToolExecutor.js';
import { ToolPipeline } from './pipeline/ToolPipeline.js';
import { createDefaultToolPipeline } from './pipeline/index.js';
import { AuditLogger } from '../observability/AuditLogger.js';

const definition = { name: 'demo.echo', description: 'echo', domain: ['agent'] as never, riskLevel: 'low' as const, parameters: [], requiredPermissions: [] };
const step = { id: 'step-1', taskId: 'task', action: definition.name, toolName: definition.name, toolInput: { text: 'hi' }, status: 'pending' as const, riskLevel: 'low' as const };

describe('ToolExecutor runs every call through the pipeline', () => {
  it('writes an audit action row carrying the initiator before the handler and a result row after', async () => {
    const audit = new AuditLogger();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executor = new ToolExecutor();
    executor.setPipeline(createDefaultToolPipeline({ audit }));
    executor.registerDynamicTool(definition, async (input) => ({ echoed: input.text }));
    const call = await executor.execute(step, 'container', { userId: 'alice', runId: 'run-1', toolCallId: 'tc-1', initiator: { kind: 'scheduled', userId: 'alice', jobId: 'job-9' } });
    logSpy.mockRestore();
    expect(call.output).toEqual({ echoed: 'hi' });
    const rows = audit.getAll().filter((entry) => entry.action === 'demo.echo');
    expect(rows.map((entry) => entry.type)).toEqual(['action', 'result']);
    expect(rows[0].metadata).toMatchObject({ initiator: { kind: 'scheduled', jobId: 'job-9' }, toolCallId: 'tc-1', runId: 'run-1' });
    expect(rows[0].taskId).toBe('run-1');
  });

  it('turns a policy denial into a tool error instead of running the handler', async () => {
    const executor = new ToolExecutor();
    const handler = vi.fn(async () => 'ran');
    executor.registerDynamicTool(definition, handler);
    const call = await executor.execute(step, 'container', { userId: 'alice', blockedToolNames: ['demo.echo'] });
    expect(handler).not.toHaveBeenCalled();
    expect(call.error).toContain('demo.echo');
    expect(call.completedAt).toBeDefined();
  });

  it('applies a custom pipeline and still propagates approval-style errors untouched', async () => {
    const executor = new ToolExecutor();
    const seen: string[] = [];
    executor.setPipeline(new ToolPipeline({ wrappers: [async (invocation, next) => { seen.push(invocation.toolName); return next(); }] }));
    executor.registerDynamicTool(definition, async () => { const error = new Error('stop'); error.name = 'AbortError'; throw error; });
    await expect(executor.execute(step, 'container', { userId: 'alice' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual(['demo.echo']);
  });
});
