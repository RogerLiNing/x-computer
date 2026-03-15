/**
 * 邮件检查循环：定时拉取各用户收件箱，仅处理「当前用户发来的」新邮件，发出 email_received 信号。
 * 用户可配置 signal.add_trigger 监听 email_received，触发 X 处理并回复。
 */

import type { AppDatabase } from '../db/database.js';
import { fetchEmails } from './emailService.js';
import { fireSignal } from '../signals/signalService.js';
import { serverLogger } from '../observability/ServerLogger.js';

const EMAIL_IMAP_CONFIG_KEY = 'email_imap_config';
const EMAIL_FROM_FILTER_KEY = 'email_from_filter';
const EMAIL_PROCESSED_UIDS_KEY = 'email_processed_uids';

function parseFromFilter(raw: string | undefined): Set<string> {
  if (!raw || typeof raw !== 'string') return new Set();
  const s = raw.trim();
  if (!s) return new Set();
  try {
    const parsed = JSON.parse(s) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .filter((x): x is string => typeof x === 'string')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      );
    }
  } catch {
    /* 非 JSON，按逗号分隔 */
  }
  return new Set(s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}
const MAX_PROCESSED_UIDS = 500;

export interface EmailCheckLoopDeps {
  db: AppDatabase;
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>;
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>;
  runIntent: (userId: string, intent: string, meta?: { signal?: string }) => void;
  runAgent: (userId: string, agentId: string, goal: string) => Promise<void>;
}

async function loadProcessedUids(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
): Promise<Set<number>> {
  const raw = getConfig(userId, EMAIL_PROCESSED_UIDS_KEY);
  const value = raw instanceof Promise ? await raw : raw;
  if (!value) return new Set();
  try {
    const arr = JSON.parse(value) as unknown[];
    const nums = Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : [];
    return new Set(nums.slice(-MAX_PROCESSED_UIDS));
  } catch {
    return new Set();
  }
}

async function saveProcessedUids(
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>,
  userId: string,
  uids: number[],
): Promise<void> {
  const trimmed = uids.slice(-MAX_PROCESSED_UIDS);
  const result = setConfig(userId, EMAIL_PROCESSED_UIDS_KEY, JSON.stringify(trimmed));
  if (result instanceof Promise) await result;
}

/**
 * 执行一次邮件检查：遍历配置了 IMAP 的用户，拉取收件箱中新邮件，发出 email_received 信号。
 * 各用户使用各自的 IMAP 配置，收件箱即该用户的个人收件箱。
 */
export async function runEmailCheck(deps: EmailCheckLoopDeps): Promise<void> {
  const { db, getConfig, setConfig, runIntent, runAgent } = deps;
  const userIds = await db.getUserIdsWithConfigKey(EMAIL_IMAP_CONFIG_KEY);
  if (userIds.length === 0) return;

  for (const userId of userIds) {
    try {
      const result = await fetchEmails(getConfig, userId, {
        limit: 50,
        unseenOnly: false,
      });
      if (!result.ok) continue;

      const emails = result.emails ?? [];
      if (emails.length > 0) {
        await db.insertEmails(userId, emails.map((e) => ({
          uid: e.uid, messageId: e.messageId, from: e.from, to: e.to, subject: e.subject,
          date: e.date, text: e.text, unseen: e.unseen,
        })));
      }

      const processed = await loadProcessedUids(getConfig, userId);
      const fromFilterRaw = getConfig(userId, EMAIL_FROM_FILTER_KEY);
      const fromFilterValue = fromFilterRaw instanceof Promise ? await fromFilterRaw : fromFilterRaw;
      const fromFilter = parseFromFilter(typeof fromFilterValue === 'string' ? fromFilterValue : undefined);
      const newUids = emails.filter((e) => !processed.has(e.uid)).map((e) => e.uid);
      for (const uid of newUids) {
        const email = await db.getEmailByUid(userId, uid);
        if (email) {
          if (fromFilter.size > 0) {
            const fromNorm = email.from.trim().toLowerCase();
            if (!fromFilter.has(fromNorm)) continue;
          }
          const goal = `用户通过邮件发来消息，请处理并回复。

【发件人】${email.from}
【主题】${email.subject}
【正文】
${email.text || '(无正文)'}

请理解用户意图，处理请求，并用 x.send_email 回复到发件人 ${email.from}。`;
          void fireSignal(userId, 'email_received', { from: email.from, subject: email.subject, text: email.text, uid: email.uid, goal }, {
            getConfig,
            runIntent,
            runAgent,
          });
          serverLogger.info('email/check', `email_received 已发出`, `userId=${userId} from=${email.from} subject=${email.subject?.slice(0, 30)}`);
        }
      }
      if (newUids.length > 0) {
        await saveProcessedUids(setConfig, userId, [...processed, ...newUids]);
      }
    } catch (err) {
      serverLogger.warn('email/check', `用户 ${userId} 邮件检查失败`, err instanceof Error ? err.message : String(err));
    }
  }
}

const DEFAULT_INTERVAL_MS = 60_000; // 1 分钟

/**
 * 启动定时邮件检查。每 intervalMs 毫秒执行一次。
 */
export function startEmailCheckLoop(deps: EmailCheckLoopDeps, intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = () => {
    runEmailCheck(deps).catch((err) => {
      serverLogger.warn('email/check', '定时检查失败', err instanceof Error ? err.message : String(err));
    });
  };
  timer = setInterval(tick, intervalMs);
  tick();
  serverLogger.info('email/check', `邮件检查循环已启动`, `interval=${intervalMs}ms`);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
