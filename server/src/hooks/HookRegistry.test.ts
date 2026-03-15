import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerHook, fire, clearAllHooks } from './HookRegistry.js';

describe('HookRegistry', () => {
  afterEach(() => {
    clearAllHooks();
  });

  it('calls registered task_complete handler with payload', async () => {
    const fn = vi.fn<() => void>();
    registerHook('task_complete', fn);
    fire('task_complete', { taskId: 't1', data: { success: true } });
    await new Promise((r) => setTimeout(r, 10));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ taskId: 't1', data: { success: true } });
  });

  it('calls registered memory_captured handler with payload', async () => {
    const fn = vi.fn<() => void>();
    registerHook('memory_captured', fn);
    fire('memory_captured', {
      workspaceId: 'w1',
      type: 'fact',
      content: '用户叫李宁宁',
      filePath: 'memory/2026-02-11.md',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({
      workspaceId: 'w1',
      type: 'fact',
      content: '用户叫李宁宁',
      filePath: 'memory/2026-02-11.md',
    });
  });

  it('calls multiple handlers for same event', async () => {
    const a = vi.fn();
    const b = vi.fn();
    registerHook('task_complete', a);
    registerHook('task_complete', b);
    fire('task_complete', { taskId: 't2', data: {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('does not throw when no handlers registered', () => {
    expect(() => fire('task_complete', { taskId: 't3', data: null })).not.toThrow();
  });

  it('handler rejection does not block other handlers', async () => {
    const ok = vi.fn();
    const fail = vi.fn(() => Promise.reject(new Error('hook failed')));
    registerHook('task_complete', fail);
    registerHook('task_complete', ok);
    fire('task_complete', { taskId: 't4', data: {} });
    await new Promise((r) => setTimeout(r, 50));
    expect(ok).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
