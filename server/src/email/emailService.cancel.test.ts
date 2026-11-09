import { expect, it, vi, afterEach } from 'vitest';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
import { withSmtpConnection } from './smtpConnection.js';
import dns from 'node:dns';
import { createBoardHandlers } from '../orchestrator/tools/board.js';
import { SendApprovalRequiredError } from '../tooling/sendApproval.js';
afterEach(() => vi.useRealTimers());
import { createSmtpFixture } from './smtpFixture.js';
import { sendEmail } from './emailService.js';
import { SendExecutionDeniedError } from '../tooling/sendApproval.js';

it('does not open SMTP when an approved send was stopped before dispatch', async () => {
  const smtp = await createSmtpFixture({ passwords: new Map([['sender@example.test', 'fixture']]) });
  try {
    const config = { host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.test', pass: 'fixture' };
    await expect(sendEmail(() => JSON.stringify(config), 'owner', { to: 'recipient@example.test', subject: '合成停止验收', body: '合成正文', signal: AbortSignal.abort() })).rejects.toBeInstanceOf(SendExecutionDeniedError);
    expect(smtp.connections).toBe(0); expect(smtp.messages).toHaveLength(0);
  } finally { await smtp.close(); }
});


it.each(['auth', 'receipt'] as const)('closes a live SMTP socket on stop during %s and never retries', async hold => {
  const settings = { passwords: new Map([['sender@example.test', 'fixture']]), hold }, smtp = await createSmtpFixture(settings);
  const controller = new AbortController();
  try {
    const config = { host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.test', pass: 'fixture' };
    const sending = sendEmail(() => JSON.stringify(config), 'owner', { to: 'recipient@example.test', subject: '合成停止验收', body: '合成正文', signal: controller.signal });
    const settled = sending.then(() => undefined, error => error);
    await vi.waitFor(() => expect(smtp.phases).toContain(hold === 'auth' ? 'auth' : 'queued'));
    controller.abort(); expect(await settled).toBeInstanceOf(UncertainToolOutcomeError);
    await vi.waitFor(() => expect(smtp.activeConnections).toBe(0)); expect(smtp.connections).toBe(1);
    expect(smtp.messages).toHaveLength(hold === 'auth' ? 0 : 1);
  } finally { controller.abort(); await smtp.close(); }
});
it('closes an incomplete TLS handshake as known not dispatched', async () => {
  const smtp = await createSmtpFixture({ passwords: new Map(), hold: 'greeting' }), controller = new AbortController();
  try {
    const config = { host: '127.0.0.1', port: smtp.port, secure: true, user: 'sender@example.test', pass: 'fixture' };
    const settled = sendEmail(() => JSON.stringify(config), 'owner', { to: 'recipient@example.test', subject: '合成停止验收', body: '合成正文', signal: controller.signal }).then(() => undefined, error => error);
    await vi.waitFor(() => expect(smtp.connections).toBe(1)); controller.abort();
    expect(await settled).toBeInstanceOf(SendExecutionDeniedError); await vi.waitFor(() => expect(smtp.activeConnections).toBe(0)); expect(smtp.messages).toHaveLength(0);
  } finally { controller.abort(); await smtp.close(); }
});
it('checks ownership again after connecting, before handing the mail to SMTP', async () => {
  const smtp = await createSmtpFixture({ passwords: new Map([['sender@example.test', 'fixture']]) }); let checks = 0;
  try {
    const config = { host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.test', pass: 'fixture' };
    await expect(sendEmail(() => JSON.stringify(config), 'owner', { to: 'recipient@example.test', subject: '合成验收', body: '合成正文', assertSendActive: async () => { checks++; if (checks === 2) throw new SendExecutionDeniedError('执行权已失效，尚未发送'); } })).rejects.toBeInstanceOf(SendExecutionDeniedError);
    expect(smtp.messages).toHaveLength(0); expect(smtp.auth).toHaveLength(0);
  } finally { await smtp.close(); }
});
it('enforces the network transaction deadline even when the send callback never returns', async () => {
  const smtp = await createSmtpFixture({ passwords: new Map() }); let began = false;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const settled = withSmtpConnection({ host: '127.0.0.1', port: smtp.port, secure: false }, {}, async () => { began = true; return new Promise<void>(() => {}); }).then(() => undefined, error => error);
    await vi.waitFor(() => expect(began).toBe(true)); vi.advanceTimersByTime(60000);
    expect(await settled).toBeInstanceOf(UncertainToolOutcomeError); await vi.waitFor(() => expect(smtp.activeConnections).toBe(0));
  } finally { vi.useRealTimers(); await smtp.close(); }
});


it('enforces the same deadline while DNS is pending, before mail dispatch', async () => {
  const lookup = vi.spyOn(dns, 'lookup').mockImplementation((..._args: any[]) => {});
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const send = vi.fn(async () => undefined);
    const settled = withSmtpConnection({ host: 'pending.example.test', port: 2525, secure: false }, {}, send).then(() => undefined, error => error);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled()); vi.advanceTimersByTime(60000);
    expect(await settled).toBeInstanceOf(SendExecutionDeniedError); expect(send).not.toHaveBeenCalled();
  } finally { lookup.mockRestore(); vi.useRealTimers(); }
});
it('rechecks the approved SMTP configuration after connecting and before authentication', async () => {
  const smtp = await createSmtpFixture({ passwords: new Map([['sender@example.test', 'fixture']]) });
  let config = { host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.test', pass: 'fixture' };
  const getConfig = () => JSON.stringify(config), input = { to: 'recipient@example.test', subject: '合成验收', body: '合成正文' };
  const handler = createBoardHandlers({ resolveDB: () => null, resolveFS: async () => undefined }).sendEmailHandler;
  const context = { userId: 'owner', runId: 'run', toolCallId: 'send', getConfig, assertSendActive: async () => {} };
  try {
    let hash = '';
    try { await handler(input, context); } catch (error) { expect(error).toBeInstanceOf(SendApprovalRequiredError); hash = (error as SendApprovalRequiredError).request.hash; }
    let checks = 0;
    await expect(handler(input, { ...context, approvedSendHash: hash, assertSendActive: async () => { checks++; if (checks === 3) { await vi.waitFor(() => expect(smtp.connections).toBe(1)); config = { ...config, pass: 'changed-fixture' }; } } })).rejects.toBeInstanceOf(SendExecutionDeniedError);
    expect(smtp.connections).toBe(1); expect(smtp.auth).toHaveLength(0); expect(smtp.messages).toHaveLength(0);
  } finally { await smtp.close(); }
});
