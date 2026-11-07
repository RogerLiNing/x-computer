import { expect, it, vi } from 'vitest';
import { simpleParser } from 'mailparser';
import { createSmtpFixture } from './smtpFixture.js';
import { sendEmail, sendSystemEmail } from './emailService.js';
import { createBoardHandlers } from '../orchestrator/tools/board.js';
import { SendApprovalRequiredError, sendWithReceipt } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
const message = { to: 'recipient@example.test', subject: '合成 SMTP 验收', body: '真实 SMTP 协议、合成测试内容。' };
it('authenticates with a rotated password on a fresh connection and preserves the actual From/body', async () => {
  const passwords = new Map([['sender@example.test', 'fixture-a']]), smtp = await createSmtpFixture({ passwords });
  try {
    let config = { host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.test', pass: 'fixture-a', from: '合成账号 <alias@example.test>' };
    const get = () => JSON.stringify(config);
    expect((await sendEmail(get, 'alice', message)).ok).toBe(true);
    passwords.set(config.user, 'fixture-b'); config = { ...config, pass: 'fixture-b' };
    expect((await sendEmail(get, 'bob', message)).ok).toBe(true);
    expect(smtp.connections).toBe(2); expect(smtp.auth.map(item => item.pass)).toEqual(['fixture-a', 'fixture-b']); expect(smtp.messages).toHaveLength(2);
    const parsed = await simpleParser(smtp.messages[1].raw);
    expect(parsed.from?.value[0].address).toBe('alias@example.test'); expect(parsed.subject).toBe(message.subject); expect(parsed.text).toContain(message.body);
  } finally { await smtp.close(); }
});
it('waits for confirmation, re-confirms From changes, and sends only the reviewed snapshot', async () => {
  const smtp = await createSmtpFixture({ passwords: new Map([['sender@example.test', 'fixture-a']]) });
  try {
    let config = { host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.test', pass: 'fixture-a', from: 'Alias A <alias-a@example.test>' };
    const getConfig = () => JSON.stringify(config), handler = createBoardHandlers({ resolveDB: () => null, resolveFS: async () => undefined }).sendEmailHandler;
    const context = { userId: 'owner', runId: 'run', toolCallId: 'send', getConfig, assertSendActive: async () => {} };
    const proposal = async (approvedSendHash?: string) => {
      try { await handler(message, { ...context, approvedSendHash }); } catch (error) { expect(error).toBeInstanceOf(SendApprovalRequiredError); return (error as SendApprovalRequiredError).request; }
      throw new Error('Expected approval');
    };
    const first = await proposal(); expect(first.sender?.label).toContain('alias-a@example.test'); expect(JSON.stringify(first)).not.toContain(config.pass); expect(smtp.connections).toBe(0);
    config = { ...config, from: 'Alias B <alias-b@example.test>' };
    const next = await proposal(first.hash); expect(next.hash).not.toBe(first.hash); expect(smtp.messages).toHaveLength(0);
    expect(await handler(message, { ...context, approvedSendHash: next.hash })).toMatchObject({ ok: true });
    expect(smtp.messages).toHaveLength(1); expect(smtp.messages[0].from).toBe('alias-b@example.test');
  } finally { await smtp.close(); }
});
it.each(['partial', 'lost'] as const)('does not retry or report complete success after a %s receipt', async mode => {
  const smtp = await createSmtpFixture({ passwords: new Map([['sender@example.test', 'fixture']]), rejected: new Set(['rejected@example.test']), dropReply: mode === 'lost' });
  try {
    const config = { host: '127.0.0.1', port: smtp.port, secure: false, user: 'sender@example.test', pass: 'fixture' };
    await expect(sendWithReceipt(() => sendEmail(() => JSON.stringify(config), 'owner', { ...message, to: mode === 'partial' ? message.to + ',rejected@example.test' : message.to }))).rejects.toBeInstanceOf(UncertainToolOutcomeError);
    expect(smtp.messages).toHaveLength(1); expect(smtp.messages[0].recipients).toEqual([message.to]);
  } finally { await smtp.close(); }
});


it('submits system email using one current SMTP snapshot for authentication and From', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
  const { clearDefaultConfigCache } = await import('../config/defaultConfig.js');
  const smtp = await createSmtpFixture({ passwords: new Map([['system-a@example.test', 'fixture-a'], ['system-b@example.test', 'fixture-b']]) });
  const root = await mkdtemp(path.join(os.tmpdir(), 'system-smtp-'));
  try {
    for (const suffix of ['a', 'b']) {
      const file = path.join(root, suffix + '.private.json');
      await writeFile(file, JSON.stringify({ email: { smtp: { host: '127.0.0.1', port: smtp.port, secure: false, user: `system-${suffix}@example.test`, pass: `fixture-${suffix}`, from: `system-alias-${suffix}@example.test` } } }), { mode: 0o600, flag: 'wx' });
      vi.stubEnv('X_COMPUTER_CONFIG_PATH', file); clearDefaultConfigCache();
      expect((await sendSystemEmail(message)).ok).toBe(true);
    }
    expect(smtp.auth.map(item => item.user)).toEqual(['system-a@example.test', 'system-b@example.test']);
    expect(smtp.messages.map(item => item.from)).toEqual(['system-alias-a@example.test', 'system-alias-b@example.test']);
  } finally { vi.unstubAllEnvs(); clearDefaultConfigCache(); await smtp.close(); }
});
