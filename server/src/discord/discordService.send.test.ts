import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { REST } from '@discordjs/rest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDiscordConnection, sendDiscordMessage } from './discordService.js';
import { sendWithReceipt } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

const sdk = vi.hoisted(() => ({ construct: vi.fn(), send: vi.fn() }));
vi.mock('discord.js', () => ({
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, DirectMessages: 3, MessageContent: 4 },
  Client: class {
    constructor(options: unknown) { sdk.construct(options); }
    on = vi.fn();
    login = vi.fn(async () => {});
    destroy = vi.fn();
    user = { id: 'fixture-bot', username: 'fixture' };
    channels = { fetch: async () => ({ send: sdk.send }) };
  },
}));

const getConfig = () => undefined;
afterEach(() => {
  getDiscordConnection('fixture', getConfig).disconnect();
  vi.resetAllMocks();
});

describe('Discord send transport', () => {
  it('makes one request with the configured REST client after an ambiguous server error', async () => {
    await getDiscordConnection('fixture', getConfig).connect('fixture-token');
    const options = sdk.construct.mock.calls[0][0].rest;
    let requests = 0;
    const server = http.createServer((request, response) => {
      request.resume();
      request.once('end', () => { requests++; response.writeHead(500); response.end('{}'); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const rest = new REST({ ...options, api: 'http://127.0.0.1:' + (server.address() as AddressInfo).port }).setToken('fixture-token');
      await expect(rest.post('/channels/fixture/messages', { body: { content: '正文' } })).rejects.toThrow();
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    sdk.send.mockRejectedValue(new Error('response lost'));
    await expect(sendWithReceipt(() => sendDiscordMessage(getConfig, 'fixture', 'channel', '正文')))
      .rejects.toBeInstanceOf(UncertainToolOutcomeError);
    expect(sdk.send).toHaveBeenCalledOnce();
  });
});
