import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebClient } from '@slack/web-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSlackConnection, sendSlackMessage } from './slackService.js';
import { sendWithReceipt } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

const sdk = vi.hoisted(() => ({ construct: vi.fn(), post: vi.fn(), stop: vi.fn() }));
vi.mock('@slack/bolt', () => ({
  App: class {
    constructor(options: unknown) { sdk.construct(options); }
    message = vi.fn();
    start = vi.fn(async () => {});
    stop = sdk.stop;
    client = { auth: { test: async () => ({ user_id: 'fixture-bot', user: 'fixture' }) }, chat: { postMessage: sdk.post } };
  },
}));

const getConfig = () => undefined;
afterEach(() => {
  getSlackConnection('fixture', getConfig).disconnect();
  vi.resetAllMocks();
});

describe('Slack send transport', () => {
  it('disables SDK retries and preserves an uncertain thread reply', async () => {
    await getSlackConnection('fixture', getConfig).connect('fixture-bot-token', 'fixture-app-token');
    expect(sdk.construct).toHaveBeenCalledWith(expect.objectContaining({
      clientOptions: { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true },
    }));
    sdk.post.mockRejectedValue(new Error('connection lost after acceptance'));
    await expect(sendWithReceipt(() => sendSlackMessage(getConfig, 'fixture', 'channel', '正文', 'thread')))
      .rejects.toBeInstanceOf(UncertainToolOutcomeError);
    expect(sdk.post).toHaveBeenCalledOnce();
    expect(sdk.post).toHaveBeenCalledWith({ channel: 'channel', text: '正文', thread_ts: 'thread' });
  });
  it.each(['lost', 'rate-limited'] as const)('makes one HTTP attempt when the reply is %s', async failure => {
    await getSlackConnection('fixture', getConfig).connect('fixture-bot-token', 'fixture-app-token');
    const options = sdk.construct.mock.calls[0][0].clientOptions;
    let requests = 0;
    const server = http.createServer((request, response) => {
      request.resume();
      request.once('end', () => {
        requests++;
        if (failure === 'lost') response.destroy();
        else { response.writeHead(429, { 'retry-after': '1', 'content-type': 'application/json' }); response.end('{"ok":false,"error":"ratelimited"}'); }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = new WebClient('fixture-token', {
        ...options, timeout: 1000, slackApiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
      });
      await expect(client.chat.postMessage({ channel: 'channel', text: '正文' })).rejects.toThrow();
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

});
