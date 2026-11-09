import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@x-computer/shared';
import { ToolPipeline, type ToolInvocation } from './ToolPipeline.js';
import { createPermissionPolicy } from './policies/permissionPolicy.js';
import { createScopePolicy } from './policies/scopePolicy.js';
import { createTimeoutWrapper } from './wrappers/timeout.js';
import { resolveInitiator } from './initiator.js';

const definition: ToolDefinition = {
  name: 'demo.echo', description: 'echo', domain: ['chat'], riskLevel: 'low', parameters: [], requiredPermissions: [],
};

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return { id: 'call-1', toolName: 'demo.echo', input: { text: 'hi' }, definition, context: { userId: 'alice', runId: 'run-1' }, ...overrides };
}

describe('ToolPipeline', () => {
  it('records an audit row before the handler runs and a result row after it', async () => {
    const audit = vi.fn();
    const order: string[] = [];
    const pipeline = new ToolPipeline({ audit: (entry) => { audit(entry); order.push(entry.type); } });
    const result = await pipeline.run(invocation(), async () => { order.push('handler'); return { ok: true }; });
    expect(result).toEqual({ ok: true });
    expect(order).toEqual(['action', 'handler', 'result']);
    const action = audit.mock.calls[0][0];
    expect(action.action).toBe('demo.echo');
    expect(action.metadata).toMatchObject({ initiator: { kind: 'user', userId: 'alice' }, runId: 'run-1' });
  });

  it('denies when a pre-execute policy refuses, without running the handler', async () => {
    const audit = vi.fn();
    const handler = vi.fn(async () => 'never');
    const pipeline = new ToolPipeline({ audit, policies: [async () => ({ action: 'deny', code: 'blocked', reason: '本轮未授权此工具' })] });
    await expect(pipeline.run(invocation(), handler)).rejects.toMatchObject({ name: 'ToolDeniedError', code: 'blocked' });
    expect(handler).not.toHaveBeenCalled();
    expect(audit.mock.calls.map((call) => call[0].type)).toEqual(['approval']);
    expect(audit.mock.calls[0][0].result).toContain('denied');
  });

  it('runs policies in order and stops at the first denial', async () => {
    const seen: string[] = [];
    const pipeline = new ToolPipeline({ policies: [
      async () => { seen.push('first'); return undefined; },
      async () => { seen.push('second'); return { action: 'deny', code: 'x', reason: 'x' }; },
      async () => { seen.push('third'); return undefined; },
    ] });
    await expect(pipeline.run(invocation(), async () => 1)).rejects.toThrow();
    expect(seen).toEqual(['first', 'second']);
  });

  it('wraps execution with around-wrappers in registration order', async () => {
    const trace: string[] = [];
    const pipeline = new ToolPipeline({ wrappers: [
      async (_inv, next) => { trace.push('a:in'); const out = await next(); trace.push('a:out'); return out; },
      async (_inv, next) => { trace.push('b:in'); const out = await next(); trace.push('b:out'); return out; },
    ] });
    await pipeline.run(invocation(), async () => { trace.push('body'); return 1; });
    expect(trace).toEqual(['a:in', 'b:in', 'body', 'b:out', 'a:out']);
  });

  it('lets post-execute hooks rewrite the result and records an error row for a thrown handler', async () => {
    const audit = vi.fn();
    const pipeline = new ToolPipeline({ audit, postHooks: [async (_inv, result) => ({ ...(result as object), tagged: true })] });
    expect(await pipeline.run(invocation(), async () => ({ ok: true }))).toEqual({ ok: true, tagged: true });
    await expect(pipeline.run(invocation(), async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(audit.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error', result: expect.stringContaining('boom') });
  });

  it('never lets a failing audit sink break tool execution', async () => {
    const pipeline = new ToolPipeline({ audit: () => { throw new Error('db down'); } });
    expect(await pipeline.run(invocation(), async () => 'fine')).toBe('fine');
  });
});

describe('built-in policies', () => {
  it('scope policy denies blocked tools and tools outside an explicit allow list', async () => {
    const policy = createScopePolicy();
    expect(await policy(invocation({ context: { blockedToolNames: ['demo.echo'] } }))).toMatchObject({ action: 'deny', code: 'blocked' });
    expect(await policy(invocation({ context: { allowedToolNames: ['other'] } }))).toMatchObject({ action: 'deny', code: 'not_allowed' });
    expect(await policy(invocation({ context: { allowedToolNames: ['demo.echo'] } }))).toBeUndefined();
    expect(await policy(invocation({ context: {} }))).toBeUndefined();
  });

  it('permission policy gates package tools that declare permissions when the context lists grants', async () => {
    const policy = createPermissionPolicy();
    const needsNetwork = { ...definition, name: 'pkg.demo.echo', requiredPermissions: ['network'] };
    const pkg = (context: Record<string, unknown>) => invocation({ toolName: 'pkg.demo.echo', definition: needsNetwork, context });
    expect(await policy(invocation({ toolName: 'file.write', definition: { ...definition, requiredPermissions: ['fs.write'] }, context: { grantedPermissions: [] } }))).toBeUndefined();
    expect(await policy(pkg({}))).toBeUndefined();
    expect(await policy(pkg({ grantedPermissions: ['kv'] }))).toMatchObject({ action: 'deny', code: 'permission' });
    expect(await policy(pkg({ grantedPermissions: ['network'] }))).toBeUndefined();
    expect(await policy(invocation({ toolName: 'pkg.demo.echo', definition: undefined, context: { grantedPermissions: [] } }))).toBeUndefined();
  });
});

describe('timeout wrapper', () => {
  it('fails a call that exceeds its deadline and passes fast calls through', async () => {
    const wrapper = createTimeoutWrapper({ defaultMs: 20 });
    expect(await wrapper(invocation(), async () => 'fast')).toBe('fast');
    await expect(wrapper(invocation(), () => new Promise((resolve) => setTimeout(() => resolve('slow'), 200)))).rejects.toMatchObject({ name: 'ToolTimeoutError' });
  });

  it('honours a per-tool override and skips tools marked as long running', async () => {
    const wrapper = createTimeoutWrapper({ defaultMs: 20, perTool: { 'demo.echo': 500 }, exempt: ['sleep'] });
    expect(await wrapper(invocation(), () => new Promise((resolve) => setTimeout(() => resolve('ok'), 50)))).toBe('ok');
    expect(await wrapper(invocation({ toolName: 'sleep' }), () => new Promise((resolve) => setTimeout(() => resolve('ok'), 50)))).toBe('ok');
  });
});

describe('resolveInitiator', () => {
  it('prefers an explicit initiator, then infers from the execution context', () => {
    expect(resolveInitiator({ initiator: { kind: 'scheduled', userId: 'a', jobId: 'j' } })).toEqual({ kind: 'scheduled', userId: 'a', jobId: 'j' });
    expect(resolveInitiator({ userId: 'a', agentId: 'bot' })).toEqual({ kind: 'agent', userId: 'a', agentId: 'bot' });
    expect(resolveInitiator({ userId: 'a', taskMetadata: { sourceMessage: { channel: 'qq' } } })).toEqual({ kind: 'channel', userId: 'a', channel: 'qq' });
    expect(resolveInitiator({ userId: 'a' })).toEqual({ kind: 'user', userId: 'a' });
    expect(resolveInitiator(undefined)).toEqual({ kind: 'system' });
  });
});
