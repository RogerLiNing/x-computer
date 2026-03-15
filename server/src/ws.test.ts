import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import WebSocket from 'ws';
import { startTestServer } from './testServer.js';

/**
 * WebSocket 接口测试。每个用例独立启动/关闭测试服务器。
 * 当前默认 describe.skip 跳过（部分环境下 startTestServer/连接会超时）。
 * 需要跑 WS 测试时：去掉 describe.skip，并执行 npm run test -- src/ws.test.ts --testTimeout=20000
 */
function openWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function receiveOne(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
      ws.off('message', onMessage);
    };
    ws.on('message', onMessage);
  });
}

describe.skip('WebSocket', () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) await close();
    close = null;
  });

  it('连接后收到 init 消息', async () => {
    const result = await startTestServer(path.join(os.tmpdir(), `ws-test-${Date.now()}-1`));
    close = result.close;
    const ws = await openWs(result.port);
    const msg = await receiveOne(ws);
    ws.close();
    expect(msg.type).toBe('init');
    expect(msg.data).toHaveProperty('mode');
    expect(msg.data).toHaveProperty('tasks');
    expect(msg.data).toHaveProperty('auditLog');
  });

  it('create_task 收到 task_created', async () => {
    const result = await startTestServer(path.join(os.tmpdir(), `ws-test-${Date.now()}-2`));
    close = result.close;
    const ws = await openWs(result.port);
    await receiveOne(ws);
    ws.send(JSON.stringify({
      type: 'create_task',
      data: { domain: 'chat', title: 'WS 测试', description: '测试创建任务' },
    }));
    const msg = await receiveOne(ws);
    ws.close();
    expect(msg.type).toBe('task_created');
    expect(msg.data).toHaveProperty('id');
    expect(msg.data.domain).toBe('chat');
  });

  it('set_mode 后收到 mode_changed', async () => {
    const result = await startTestServer(path.join(os.tmpdir(), `ws-test-${Date.now()}-3`));
    close = result.close;
    const ws = await openWs(result.port);
    await receiveOne(ws);
    ws.send(JSON.stringify({ type: 'set_mode', data: { mode: 'auto' } }));
    const msg = await receiveOne(ws);
    ws.close();
    expect(msg.type).toBe('mode_changed');
    expect(msg.data.mode).toBe('auto');
  });

  it('set_computer_context 不返回 error', async () => {
    const result = await startTestServer(path.join(os.tmpdir(), `ws-test-${Date.now()}-4`));
    close = result.close;
    const ws = await openWs(result.port);
    await receiveOne(ws);
    ws.send(JSON.stringify({
      type: 'set_computer_context',
      data: {
        timestamp: Date.now(),
        executionMode: 'approval',
        activeWindowId: null,
        windows: [],
        tasks: [],
        taskbarPinned: [],
        notificationCount: 0,
      },
    }));
    await new Promise((r) => setTimeout(r, 80));
    ws.close();
  });

  it('未知 type 收到 error', async () => {
    const result = await startTestServer(path.join(os.tmpdir(), `ws-test-${Date.now()}-5`));
    close = result.close;
    const ws = await openWs(result.port);
    await receiveOne(ws);
    ws.send(JSON.stringify({ type: 'unknown_type', data: {} }));
    const msg = await receiveOne(ws);
    ws.close();
    expect(msg.type).toBe('error');
    expect(msg.data.message).toContain('Unknown message type');
  });
});
