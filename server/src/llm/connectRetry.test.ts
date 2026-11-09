import { describe, expect, it, vi } from 'vitest';
import { fetchWithConnectRetry, isConnectFailure } from './connectRetry.js';

function connectError(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

const noWait = async () => {};

describe('模型请求连接失败重试', () => {
  it('只把「没连上」的错误当作可重试', () => {
    expect(isConnectFailure(connectError('UND_ERR_CONNECT_TIMEOUT'))).toBe(true);
    expect(isConnectFailure(connectError('ECONNREFUSED'))).toBe(true);
    expect(isConnectFailure(connectError('EAI_AGAIN'))).toBe(true);
    expect(isConnectFailure(connectError('ECONNRESET'))).toBe(false);
    expect(isConnectFailure(new Error('boom'))).toBe(false);
    expect(isConnectFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false);
  });

  it('连接超时后重试，成功就返回结果', async () => {
    const ok = new Response('ok');
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(connectError('UND_ERR_CONNECT_TIMEOUT'))
      .mockResolvedValueOnce(ok);
    const res = await fetchWithConnectRetry('https://api.example.com', { method: 'POST' }, { fetchImpl, wait: noWait });
    expect(res).toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('一直连不上时最多试 3 次，抛出最后的错误', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(connectError('UND_ERR_CONNECT_TIMEOUT'));
    await expect(fetchWithConnectRetry('https://api.example.com', {}, { fetchImpl, wait: noWait })).rejects.toThrow('fetch failed');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('请求已经发出后的错误、HTTP 错误都不重试', async () => {
    const reset = vi.fn().mockRejectedValue(connectError('ECONNRESET'));
    await expect(fetchWithConnectRetry('https://api.example.com', {}, { fetchImpl: reset, wait: noWait })).rejects.toThrow();
    expect(reset).toHaveBeenCalledTimes(1);

    const http500 = vi.fn().mockResolvedValue(new Response('x', { status: 500 }));
    expect((await fetchWithConnectRetry('https://api.example.com', {}, { fetchImpl: http500, wait: noWait })).status).toBe(500);
    expect(http500).toHaveBeenCalledTimes(1);
  });

  it('用户取消后不再重试', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw connectError('UND_ERR_CONNECT_TIMEOUT');
    });
    await expect(fetchWithConnectRetry('https://api.example.com', { signal: controller.signal }, { fetchImpl, wait: noWait })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
