import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolExecutor } from './ToolExecutor.js';

describe('ToolExecutor http.request 真实化', () => {
  let executor: ToolExecutor;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = new ToolExecutor(undefined);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('任意公网 URL 可发起请求', async () => {
    const res = new Response('{"data":"ok"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    fetchMock.mockResolvedValueOnce(res);

    const step = {
      id: 'step-1',
      taskId: 'task-1',
      action: '请求外部 API',
      toolName: 'http.request',
      toolInput: { url: 'https://example.com/api', method: 'GET' },
      status: 'pending' as const,
      riskLevel: 'high' as const,
    };

    const call = await executor.execute(step, 'container');

    expect(call.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({ method: 'GET' }),
    );
    const output = call.output as { status: number; body: unknown };
    expect(output?.status).toBe(200);
    expect(output?.body).toEqual({ data: 'ok' });
  });

  it('允许 localhost 时发起请求并返回 status/body', async () => {
    const res = new Response('{"ok":true}', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    });
    fetchMock.mockResolvedValueOnce(res);

    const step = {
      id: 'step-1',
      taskId: 'task-1',
      action: '请求本地服务',
      toolName: 'http.request',
      toolInput: { url: 'http://127.0.0.1:4000/api/health', method: 'GET' },
      status: 'pending' as const,
      riskLevel: 'high' as const,
    };

    const call = await executor.execute(step, 'container');

    expect(call.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
    const output = call.output as { status: number; body: unknown };
    expect(output?.status).toBe(200);
    expect(output?.body).toEqual({ ok: true });
  });

  it('缺少 url 时抛出错误', async () => {
    const step = {
      id: 'step-1',
      taskId: 'task-1',
      action: '请求',
      toolName: 'http.request',
      toolInput: { method: 'GET' },
      status: 'pending' as const,
      riskLevel: 'high' as const,
    };

    const call = await executor.execute(step, 'container');

    expect(call.error).toBeDefined();
    expect(call.error).toContain('url 必填');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
