import { afterEach, expect, it, vi } from 'vitest';
import { getWhatsAppConnection, disconnectWhatsApp, setWhatsAppMessageHandler } from './whatsappService.js';
import { createBoardHandlers } from '../orchestrator/tools/board.js';
import { SendApprovalRequiredError, SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

const sdk = vi.hoisted(() => ({ home: '', sockets: [] as any[], saves: 0 }));
vi.mock('os', async importOriginal => {
  const real = await importOriginal<typeof import('os')>();
  const { mkdtempSync } = await import('node:fs'), path = await import('node:path');
  sdk.home = mkdtempSync(path.join(real.tmpdir(), 'whatsapp-identity-'));
  return { ...real, default: { ...real, homedir: () => sdk.home } };
});
vi.mock('../utils/systemProxy.js', () => ({ getSystemProxy: () => null }));
vi.mock('@whiskeysockets/baileys', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    default: () => {
      const socket = { user: { id: '10000000001:7@s.whatsapp.net', name: '合成账号 A' }, ev: new EventEmitter(), sendMessage: vi.fn(async () => ({ key: { id: 'local-receipt' } })), end: vi.fn() };
      sdk.sockets.push(socket); return socket;
    },
    useMultiFileAuthState: async () => ({ state: { creds: { registered: true }, keys: {} }, saveCreds: async () => { sdk.saves++; } }),
    Browsers: { macOS: () => ['MacOS', 'Desktop', 'fixture'] },
  };
});
const getConfig = () => JSON.stringify({ enabled: true, dmPolicy: 'open' });
const handler = createBoardHandlers({ resolveDB: () => null, resolveFS: async () => undefined }).sendWhatsAppHandler;
const input = { to: '10000000009', message: '合成验收正文', confirmed: true, sender: 'forged' };
const context = { userId: 'owner', runId: 'run', toolCallId: 'send', getConfig, assertSendActive: async () => {} };
afterEach(() => { disconnectWhatsApp('owner'); sdk.sockets.length = 0; sdk.saves = 0; setWhatsAppMessageHandler(() => {}); vi.clearAllMocks(); });
async function connected() {
  const connection = getWhatsAppConnection('owner', getConfig); await connection.connect('');
  const socket = sdk.sockets.at(-1); socket.ev.emit('connection.update', { connection: 'open' });
  return { connection, socket };
}
async function proposal(extra = {}) {
  try { await handler(input, { ...context, ...extra }); } catch (error) {
    expect(error).toBeInstanceOf(SendApprovalRequiredError); return (error as SendApprovalRequiredError).request;
  }
  throw new Error('Expected a pending human approval');
}
it('records the actual sender without exposing the connection binding or trusting model fields', async () => {
  const { connection, socket } = await connected(); const approval = await proposal();
  expect(approval.sender).toEqual({ accountId: '10000000001@s.whatsapp.net', label: '合成账号 A' });
  expect(JSON.stringify(approval)).not.toContain(connection.getSendIdentity()!.binding);
  expect(approval.input).toEqual({ to: input.to, message: input.message }); expect(socket.sendMessage).not.toHaveBeenCalled();
});
it('requires fresh confirmation after switching accounts with unchanged config', async () => {
  const { socket } = await connected(); const first = await proposal();
  socket.user = { id: '10000000002:9@s.whatsapp.net', name: '合成账号 B' };
  const next = await proposal({ approvedSendHash: first.hash });
  expect(next.hash).not.toBe(first.hash); expect(next.sender?.accountId).toBe('10000000002@s.whatsapp.net');
  expect(socket.sendMessage).not.toHaveBeenCalled();
  expect(await handler(input, { ...context, approvedSendHash: next.hash })).toMatchObject({ ok: true });
  expect(socket.sendMessage).toHaveBeenCalledOnce();
});
it('requires fresh confirmation for a new socket of the same account and ignores obsolete socket events', async () => {
  const { connection, socket } = await connected(); const first = await proposal();
  await connection.connect(''); sdk.sockets.at(-1).ev.emit('connection.update', { connection: 'open' });
  expect(socket.end).toHaveBeenCalledOnce();
  socket.ev.emit('connection.update', { connection: 'close' });
  const next = await proposal({ approvedSendHash: first.hash });
  expect(next.hash).not.toBe(first.hash); expect(connection.getStatus()).toBe('connected');
  expect(socket.sendMessage).not.toHaveBeenCalled(); expect(sdk.sockets.at(-1).sendMessage).not.toHaveBeenCalled();
});
it('blocks an account change during the final permission check before invoking the transport', async () => {
  const { socket } = await connected(); const approval = await proposal();
  await expect(handler(input, { ...context, approvedSendHash: approval.hash, assertSendActive: async () => {
    socket.user = { id: '10000000002@s.whatsapp.net', name: '合成账号 B' };
  } })).rejects.toBeInstanceOf(SendExecutionDeniedError);
  expect(socket.sendMessage).not.toHaveBeenCalled();
});
it('refuses disconnected sends without classifying them as uncertain transport delivery', async () => {
  const { connection, socket } = await connected(); const approval = await proposal(); connection.disconnect();
  await expect(handler(input, { ...context, approvedSendHash: approval.hash })).rejects.toBeInstanceOf(SendExecutionDeniedError);
  expect(socket.sendMessage).not.toHaveBeenCalled();
});
it('still marks a lost transport receipt as unknown and never retries it', async () => {
  const { socket } = await connected(); const approval = await proposal(); socket.sendMessage.mockRejectedValueOnce(new Error('lost receipt'));
  await expect(handler(input, { ...context, approvedSendHash: approval.hash })).rejects.toBeInstanceOf(UncertainToolOutcomeError);
  expect(socket.sendMessage).toHaveBeenCalledOnce();
});


it('ignores messages and credential updates from the replaced socket', async () => {
  const incoming = vi.fn(); setWhatsAppMessageHandler(incoming);
  const { connection, socket } = await connected();
  await connection.connect(''); const current = sdk.sockets.at(-1); current.ev.emit('connection.update', { connection: 'open' });
  const update = { type: 'notify', messages: [{ key: { remoteJid: '10000000009@s.whatsapp.net', id: 'fixture-event' }, message: { conversation: '合成消息' } }] };
  socket.ev.emit('creds.update', {}); socket.ev.emit('messages.upsert', update);
  current.ev.emit('creds.update', {}); current.ev.emit('messages.upsert', update);
  await vi.waitFor(() => expect(incoming).toHaveBeenCalledOnce()); expect(sdk.saves).toBe(1);
});
