import { afterEach, expect, it, vi } from 'vitest';
import { sendEmail, sendSystemEmail, parseSmtpConfigExport } from './emailService.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';
const smtp = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), close: vi.fn() }));
vi.mock('./smtpConnection.js', () => ({ withSmtpConnection: async (_config: unknown, _operation: unknown, send: (socket: unknown) => Promise<unknown>) => send({}) }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.create } }));
vi.mock('../config/defaultConfig.js', () => ({ loadDefaultConfig: vi.fn() }));
const config = { host: 'smtp.example.test', port: 587, user: 'sender@example.test', pass: 'fixture-pass-a', secure: false, from: '合成发件人 <alias@example.test>' };
const options = { to: 'recipient@example.test', subject: '合成验收', body: '合成正文' };
const setup = () => { smtp.send.mockResolvedValue({ messageId: 'local-id', accepted: [options.to], rejected: [] }); smtp.create.mockReturnValue({ sendMail: smtp.send, close: smtp.close }); };
afterEach(() => vi.resetAllMocks());
it('does not reuse another user’s credentials or stale TLS settings', async () => {
  setup(); await sendEmail(() => JSON.stringify(config), 'alice', options);
  const changed = { ...config, pass: 'fixture-pass-b', secure: true };
  await sendEmail(() => JSON.stringify(changed), 'bob', options);
  expect(smtp.create).toHaveBeenCalledTimes(2);
  expect(smtp.create.mock.calls[0][0]).toMatchObject({ secure: false, auth: { user: config.user, pass: config.pass } });
  expect(smtp.create.mock.calls[1][0]).toMatchObject({ secure: true, auth: { user: config.user, pass: changed.pass } });
  expect(smtp.close).toHaveBeenCalledTimes(2);
});
it('uses a single current configuration snapshot for system authentication and From', async () => {
  setup(); vi.mocked(loadDefaultConfig).mockReturnValue({ email: { smtp: config } } as never); await sendSystemEmail(options);
  const changed = { ...config, user: 'system-b@example.test', pass: 'fixture-system-b', from: 'System B <system-b@example.test>' };
  vi.mocked(loadDefaultConfig).mockReturnValue({ email: { smtp: changed } } as never); await sendSystemEmail(options);
  expect(smtp.create).toHaveBeenCalledTimes(2); expect(smtp.create.mock.calls[1][0].auth.user).toBe(changed.user);
  expect(smtp.send.mock.calls[1][0].from).toBe(changed.from); expect(smtp.close).toHaveBeenCalledTimes(2);
});
it('does not report partial recipient acceptance as complete success', async () => {
  setup(); smtp.send.mockResolvedValueOnce({ messageId: 'partial', accepted: ['one@example.test'], rejected: ['two@example.test'] });
  const result = await sendEmail(() => JSON.stringify(config), 'owner', { ...options, to: 'one@example.test,two@example.test' });
  expect(result.ok).toBe(false); expect(result).toMatchObject({ accepted: ['one@example.test'], rejected: ['two@example.test'] });
  expect(smtp.send).toHaveBeenCalledOnce(); expect(smtp.close).toHaveBeenCalledOnce();
});
it('does not infer acceptance from a message ID without recipient receipts', async () => {
  setup(); smtp.send.mockResolvedValueOnce({ messageId: 'no-receipt' });
  expect((await sendEmail(() => JSON.stringify(config), 'owner', options)).ok).toBe(false); expect(smtp.send).toHaveBeenCalledOnce();
});
it('closes its own transport after a lost receipt without retrying', async () => {
  setup(); smtp.send.mockRejectedValueOnce(new Error('response lost'));
  expect((await sendEmail(() => JSON.stringify(config), 'owner', options)).ok).toBe(false);
  expect(smtp.send).toHaveBeenCalledOnce(); expect(smtp.close).toHaveBeenCalledOnce();
});
it('validates ports and previewed identity fields without exposing secrets', () => {
  for (const change of [{ port: 0 }, { port: 1.5 }, { port: 65536 }, { port: true }, { host: 'user:password@smtp.example.test' }, { user: 'sender\r\nforged' }, { from: 'Alias\r\nBcc: other@example.test' }]) expect(parseSmtpConfigExport(JSON.stringify({ ...config, ...change }))).toBeNull();
});

it('keeps explicit TLS settings and applies the standard port defaults only when omitted', () => {
  expect(parseSmtpConfigExport(JSON.stringify({ ...config, port: 465, secure: undefined }))?.secure).toBe(true);
  expect(parseSmtpConfigExport(JSON.stringify({ ...config, port: 587, secure: undefined }))?.secure).toBe(false);
  expect(parseSmtpConfigExport(JSON.stringify({ ...config, port: undefined, secure: undefined }))?.port).toBe(465);
  expect(parseSmtpConfigExport(JSON.stringify({ ...config, secure: 'false' }))).toBeNull();
});
it('does not expose authentication details from a transport error', async () => {
  setup(); smtp.send.mockRejectedValueOnce(new Error('private SMTP error ' + config.pass));
  const result = await sendEmail(() => JSON.stringify(config), 'owner', options);
  expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(config.pass);
});
