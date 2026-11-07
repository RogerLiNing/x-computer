import { afterEach, describe, expect, it, vi } from 'vitest';
import { disconnectQQ, getQQConnection, sendQQMessage } from './qqService.js';
import { sendWithReceipt } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

const sdk = vi.hoisted(() => ({
  private: vi.fn(), group: vi.fn(), guild: vi.fn(),
}));
vi.mock('qq-official-bot', () => ({
  ReceiverMode: { WEBSOCKET: 'websocket' },
  Bot: class {
    on = vi.fn();
    start = vi.fn(async () => {});
    stop = vi.fn();
    getSelfInfo = vi.fn(async () => ({ id: 'fixture-bot', username: 'fixture' }));
    sendPrivateMessage = sdk.private;
    sendGroupMessage = sdk.group;
    sendGuildMessage = sdk.guild;
  },
}));

const getConfig = () => undefined;
afterEach(() => {
  disconnectQQ('fixture');
  vi.resetAllMocks();
});

describe('QQ send transport', () => {
  it.each(['private', 'group', 'guild'] as const)('does not repeat an uncertain %s message', async type => {
    const connection = getQQConnection('fixture', getConfig);
    await connection.connect('fixture-app', 'fixture-secret');
    sdk[type].mockRejectedValue(new Error('provider accepted, response connection closed'));
    await expect(sendWithReceipt(() => sendQQMessage(getConfig, 'fixture', { type, id: 'recipient' }, '完整正文')))
      .rejects.toBeInstanceOf(UncertainToolOutcomeError);
    expect(sdk[type]).toHaveBeenCalledOnce();
    expect(sdk[type]).toHaveBeenCalledWith('recipient', '完整正文');
    expect(Object.values(sdk).reduce((count, mock) => count + mock.mock.calls.length, 0)).toBe(1);
  });

  it('sends a successful reply once and refuses to dispatch while disconnected', async () => {
    const connection = getQQConnection('fixture', getConfig);
    expect((await connection.sendMessage({ type: 'private', id: 'recipient' }, '正文')).ok).toBe(false);
    expect(sdk.private).not.toHaveBeenCalled();
    await connection.connect('fixture-app', 'fixture-secret');
    sdk.private.mockResolvedValue({ id: 'provider-receipt' });
    expect(await connection.sendMessage({ type: 'private', id: 'recipient' }, '正文')).toEqual({ ok: true });
    expect(sdk.private).toHaveBeenCalledOnce();
  });
});
