/**
 * 邮件发送与接收服务：
 * - SMTP：发送邮件，供 x.send_email 调用
 * - IMAP：收邮件，供 x.check_email 调用，实现邮件渠道双向通信（R042）
 */

import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import { isIP, type Socket } from 'node:net';
import { domainToASCII } from 'node:url';
import { withSmtpConnection, type SmtpOperation } from './smtpConnection.js';
import { SendExecutionDeniedError } from '../tooling/sendApproval.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
import type { Transporter } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { marked } from 'marked';
import { simpleParser } from 'mailparser';
import { loadDefaultConfig } from '../config/defaultConfig.js';

export interface EmailSmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  pass: string;
  /** 发件人显示名，如 "X Computer <user@qq.com>"；不填则用 user */
  from?: string;
}

function parseSmtpConfig(raw: string | undefined): EmailSmtpConfig | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    const c = o as Record<string, unknown>;
    const host = typeof c.host === 'string' ? c.host.trim() : '';
    const port = c.port == null || c.port === '' ? 465 : typeof c.port === 'number' || typeof c.port === 'string' ? Number(c.port) : NaN;
    const user = typeof c.user === 'string' ? c.user.trim() : '';
    const pass = typeof c.pass === 'string' ? c.pass : '';
    const from = typeof c.from === 'string' ? c.from.trim() : undefined;
    if (!host || !user || !pass || !Number.isSafeInteger(port) || port < 1 || port > 65535
      || /[\x00-\x20\x7f/@?#\\]/.test(host)
      || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(user + (from ?? ''))
      || (c.secure !== undefined && typeof c.secure !== 'boolean')) return null;
    return {
      host,
      port,
      secure: typeof c.secure === 'boolean' ? c.secure : port === 465,
      user,
      pass,
      from,
    };
  } catch {
    return null;
  }
}

function createSmtpTransporter(config: EmailSmtpConfig, connection: Socket): Transporter {
  // A transaction owns its transport; credentials and TLS settings never cross callers.
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connection, secured: !!config.secure, tls: { servername: isIP(config.host) ? undefined : domainToASCII(config.host), rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
  });
}

export function getEmailSendIdentity(raw: string | undefined) {
  const config = parseSmtpConfig(raw);
  if (!config) return null;
  return { accountId: config.user, label: `${config.from || config.user} · ${config.host}:${config.port}`,
    binding: createHash('sha256').update(JSON.stringify(config)).digest('hex') };
}

/** 解析 SMTP 配置（供管理工具复用） */
export function parseSmtpConfigExport(raw: string | undefined): EmailSmtpConfig | null {
  return parseSmtpConfig(raw);
}

export interface SendEmailOptions extends SmtpOperation {
  to: string;
  subject: string;
  body: string;
  /** 若为 false，body 作为纯文本发送；默认 true，将 body 从 Markdown 转成 HTML 发送富文本 */
  html?: boolean;
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
}

/** Submit once and retain recipient acceptance; success does not prove inbox delivery. */
async function deliverSmtp(config: EmailSmtpConfig, options: SendEmailOptions): Promise<SendEmailResult> {
  if (options.signal?.aborted) throw new SendExecutionDeniedError('交办已停止，邮件尚未发送');
  const to = options.to.trim(), subject = options.subject.trim(), body = options.body.trim();
  if (!to || !subject || !body) return { ok: false, error: '收件人、主题、正文均不能为空' };
  let transporter: Transporter | undefined;
  try {
    const html = options.html === false ? undefined : await marked.parse(body);
    const info = await withSmtpConnection(config, options, async socket => {
      transporter = createSmtpTransporter(config, socket);
      return transporter.sendMail({ from: config.from || config.user, to, subject, ...(html ? { html, text: body } : { text: body }) });
    });
    const addresses = (list: unknown): string[] => Array.isArray(list) ? list.flatMap(item => {
      const address = typeof item === 'string' ? item : item?.address;
      return typeof address === 'string' && address ? [address] : [];
    }) : [];
    const accepted = addresses(info.accepted), rejected = addresses(info.rejected);
    const messageId = typeof info.messageId === 'string' ? info.messageId : undefined;
    const ok = !!messageId && Array.isArray(info.accepted) && Array.isArray(info.rejected) && accepted.length > 0 && rejected.length === 0;
    return { ok, messageId, accepted, rejected,
      ...(!ok ? { error: 'SMTP 未确认全部收件人，可能已接受部分邮件，请核对后再决定是否重新发送' } : {}) };
  } catch (error) {
    if (error instanceof SendExecutionDeniedError || error instanceof UncertainToolOutcomeError) throw error;
    return { ok: false, error: 'SMTP 未返回完整发送回执，请核对邮件服务后再决定是否重新发送' };
  } finally {
    transporter?.close();
  }
}

export async function sendEmail(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const raw = await getConfig(userId, 'email_smtp_config');
  const config = parseSmtpConfig(raw);
  if (!config) return { ok: false, error: '未配置有效的邮件 SMTP，请在设置中配置' };
  return deliverSmtp(config, options);
}

// ── 系统邮件发送（用于验证码等系统通知）───────────────────────────────────

export interface SystemEmailOptions {
  to: string;
  subject: string;
  body: string;
  html?: boolean;
}
export interface SystemEmailResult extends SendEmailResult {}

/** One snapshot supplies both authentication and From; SMTP acceptance is not inbox delivery. */
export async function sendSystemEmail(options: SystemEmailOptions): Promise<SystemEmailResult> {
  const config = parseSmtpConfig(JSON.stringify(loadDefaultConfig().email?.smtp));
  if (!config) return { ok: false, error: '系统未配置有效的邮件 SMTP' };
  try { return await deliverSmtp(config, options); } catch { return { ok: false, error: '系统邮件未取得确定回执，请核对邮件服务' }; }
}

// ── IMAP 收信（R042 邮件渠道双向通信）─────────────────────────────────────────

export interface EmailImapConfig {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  pass: string;
}

function parseImapConfig(raw: string | undefined): EmailImapConfig | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    const c = o as Record<string, unknown>;
    const host = typeof c.host === 'string' ? c.host.trim() : '';
    const port = typeof c.port === 'number' ? c.port : Number(c.port);
    const user = typeof c.user === 'string' ? c.user.trim() : '';
    const pass = typeof c.pass === 'string' ? c.pass : '';
    if (!host || !user || !pass) return null;
    return {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 993,
      secure: c.secure !== false,
      user,
      pass,
    };
  } catch {
    return null;
  }
}

export interface FetchedEmail {
  uid: number;
  messageId?: string;
  from: string;
  to?: string;
  subject: string;
  date?: string;
  text?: string;
  /** 是否未读 */
  unseen?: boolean;
}

export interface FetchEmailsResult {
  ok: boolean;
  error?: string;
  emails?: FetchedEmail[];
}

/** 规范化邮箱用于比对（小写、trim） */
function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

/**
 * 从 IMAP 收件箱拉取邮件（默认最近 N 封，可选仅未读、可选按发件人过滤）。
 * fromFilter：仅保留发件人等于此邮箱的邮件（忽略大小写），用于「只拉当前用户发来的」。
 */
export async function fetchEmails(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
  options: { limit?: number; unseenOnly?: boolean; fromFilter?: string } = {},
): Promise<FetchEmailsResult> {
  const raw = getConfig(userId, 'email_imap_config');
  const rawValue = raw instanceof Promise ? await raw : raw;
  const config = parseImapConfig(rawValue);
  if (!config) {
    return {
      ok: false,
      error: '未配置 IMAP，请在 设置 → 通知/邮件 中配置收信（QQ 邮箱：imap.qq.com, 993）',
    };
  }
  const limit = Math.min(Math.max(1, options.limit ?? 10), 50);
  const unseenOnly = options.unseenOnly ?? false;
  const fromFilter = options.fromFilter ? normalizeEmail(options.fromFilter) : '';

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure ?? config.port === 993,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  // 监听错误事件，防止未捕获的错误导致进程崩溃
  client.on('error', (err) => {
    console.error('[email] ImapFlow error event:', err.message);
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox;
      const total = mailbox && typeof mailbox === 'object' && 'exists' in mailbox ? (mailbox as { exists: number }).exists : 0;
      if (!total) return { ok: true, emails: [] };

      let uids: number[];
      if (unseenOnly) {
        const searchRes = await client.search({ seen: false }, { uid: true });
        uids = Array.isArray(searchRes) ? searchRes : [];
        if (uids.length === 0) return { ok: true, emails: [] };
        uids = uids.slice(-limit); // 取最近 limit 封未读
      } else {
        // 序列 start:* 表示从 start 到最新（部分服务器如 QQ 对 *:N 格式报 Sequence set is invalid）
        const start = Math.max(1, total - limit + 1);
        const range = `${start}:*`;
        uids = [];
        for await (const m of client.fetch(range, { uid: true })) {
          uids.push(m.uid);
        }
      }

      const emails: FetchedEmail[] = [];
      const fetchOpts = {
        envelope: true,
        uid: true,
        flags: true,
        source: { maxLength: 256 * 1024 },
      };

      const list = await client.fetchAll(uids, fetchOpts, { uid: true });
      for (const msg of list) {
        const env = msg.envelope ?? {};
        const fromAddr = (env as { from?: { address?: string }[] }).from?.[0];
        const from = fromAddr
          ? (typeof fromAddr === 'object' && fromAddr && 'address' in fromAddr
              ? (fromAddr as { address?: string }).address
              : String(fromAddr))
          : '';
        const toAddrs = (env as { to?: unknown[] }).to ?? [];
        const to = toAddrs
          .map((a) => (typeof a === 'object' && a && 'address' in a ? (a as { address?: string }).address : String(a)))
          .filter(Boolean)
          .join(', ');
        let text = '';
        const raw = (msg as { source?: Buffer }).source;
        if (raw && Buffer.isBuffer(raw)) {
          try {
            const parsed = await simpleParser(raw);
            text = (parsed.text ?? parsed.html ?? '').toString().trim().slice(0, 3000);
          } catch {
            /* 解析失败则留空 */
          }
        }
        const envTyped = env as { messageId?: string; subject?: string; date?: Date };
        const fromNorm = normalizeEmail(from || '');
        if (fromFilter && fromNorm !== fromFilter) continue;
        emails.push({
          uid: msg.uid,
          messageId: envTyped.messageId,
          from: from || 'unknown',
          to: to || undefined,
          subject: envTyped.subject?.slice(0, 500) ?? '',
          date: envTyped.date instanceof Date ? envTyped.date.toISOString() : undefined,
          text: text || undefined,
          unseen: msg.flags?.has('\\Seen') === false,
        });
      }
      return { ok: true, emails };
    } finally {
      lock.release();
    }
  } catch (err) {
    const e = err as Error & { responseText?: string; code?: string };
    const msg =
      (typeof e.responseText === 'string' && e.responseText.trim())
        ? e.responseText.trim()
        : (err instanceof Error ? err.message : String(err));
    console.error('[email] fetchEmails failed:', msg, e.code ?? '', err instanceof Error ? err.stack : '');
    return { ok: false, error: `收信失败: ${msg}` };
  } finally {
    try {
      await client.logout();
    } catch {
      /* 忽略 */
    }
  }
}

export { parseImapConfig };
