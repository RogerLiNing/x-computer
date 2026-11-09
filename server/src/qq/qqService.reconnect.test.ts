import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectQQ, getQQConnection, QQ_CONNECT_TIMEOUT_MS } from './qqService.js';

/** 每次 new Bot().start() 依次取一个行为：'ok' 成功，'hang' 永不返回，其他字符串作为错误抛出。 */
const sdk = vi.hoisted(() => ({ behaviors: [] as string[], starts: 0 }));
vi.mock('qq-official-bot', () => ({
  ReceiverMode: { WEBSOCKET: 'websocket' },
  Bot: class {
    on = vi.fn();
    stop = vi.fn();
    getSelfInfo = vi.fn(async () => ({ id: 'bot', username: 'bot' }));
    start = vi.fn(() => {
      sdk.starts++;
      const behavior = sdk.behaviors.shift() ?? 'ok';
      if (behavior === 'ok') return Promise.resolve();
      if (behavior === 'hang') return new Promise<void>(() => {});
      return Promise.reject(new Error(behavior));
    });
  },
}));

const getConfig = () => undefined;
const USER = 'reconnect-fixture';

beforeEach(() => {
  vi.useFakeTimers();
  sdk.behaviors = [];
  sdk.starts = 0;
});
afterEach(() => {
  disconnectQQ(USER);
  vi.useRealTimers();
});

describe('QQ 断线重连', () => {
  it('连接卡住时按超时放弃，并在之后自动重试直到连上', async () => {
    sdk.behaviors = ['hang', 'ok'];
    const conn = getQQConnection(USER, getConfig);
    const first = conn.connect('app', 'secret');
    await vi.advanceTimersByTimeAsync(QQ_CONNECT_TIMEOUT_MS);
    expect((await first).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sdk.starts).toBe(2);
    expect(conn.getStatus()).toBe('connected');
  });

  it('连续失败很多次也不会永久放弃', async () => {
    sdk.behaviors = Array.from({ length: 15 }, () => 'network down');
    const conn = getQQConnection(USER, getConfig);
    await conn.connect('app', 'secret');
    await vi.advanceTimersByTimeAsync(15 * 5 * 60_000);
    expect(sdk.starts).toBe(16);
    expect(conn.getStatus()).toBe('connected');
  });

  it('密钥错误不自动重试，避免无意义地反复请求', async () => {
    sdk.behaviors = ['invalid appid or secret (100016)'];
    const conn = getQQConnection(USER, getConfig);
    expect((await conn.connect('app', 'wrong')).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sdk.starts).toBe(1);
  });

  it('主动断开后不再重连', async () => {
    sdk.behaviors = ['network down'];
    const conn = getQQConnection(USER, getConfig);
    await conn.connect('app', 'secret');
    conn.disconnect();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sdk.starts).toBe(1);
  });
});
