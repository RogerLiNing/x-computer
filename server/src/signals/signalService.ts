/**
 * 信号触发服务：当 signal.emit 或内置事件发生时，查找用户配置的触发器并执行。
 * R037：信号/条件触发。
 * 支持已处理事件去重：相同 fingerprint 在保留期内不再触发。
 */

import * as crypto from 'node:crypto';
import { serverLogger } from '../observability/ServerLogger.js';

export interface SignalTrigger {
  id: string;
  signal: string;
  agentId?: string;
  intent?: string;
  cooldownMs?: number;
}

const X_SIGNAL_TRIGGERS_KEY = 'x_signal_triggers';

/** 冷却记录：triggerId -> lastFireTime */
const cooldownUntil = new Map<string, number>();

/** 内置默认触发器：用户未配置时自动使用，实现开箱即用的 WhatsApp/邮件回复 */
const DEFAULT_TRIGGERS: Record<string, Omit<SignalTrigger, 'id'> & { id: string }> = {
  whatsapp_message_received: {
    id: '__default_whatsapp__',
    signal: 'whatsapp_message_received',
    intent: '处理用户通过 WhatsApp 发来的消息并回复',
  },
  email_received: {
    id: '__default_email__',
    signal: 'email_received',
    intent: '处理用户发来的邮件并回复',
  },
  telegram_message_received: {
    id: '__default_telegram__',
    signal: 'telegram_message_received',
    intent: '处理用户通过 Telegram 发来的消息并回复',
  },
  discord_message_received: {
    id: '__default_discord__',
    signal: 'discord_message_received',
    intent: '处理用户通过 Discord 发来的消息并回复',
  },
  slack_message_received: {
    id: '__default_slack__',
    signal: 'slack_message_received',
    intent: '处理用户通过 Slack 发来的消息并回复',
  },
  qq_message_received: {
    id: '__default_qq__',
    signal: 'qq_message_received',
    intent: '处理用户通过 QQ 发来的消息并回复',
  },
};

export async function loadTriggers(
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>,
  userId: string,
): Promise<SignalTrigger[]> {
  const raw = getConfig(userId, X_SIGNAL_TRIGGERS_KEY);
  const value = raw instanceof Promise ? await raw : raw;
  if (!value) return [];
  try {
    const arr = JSON.parse(value) as unknown[];
    return Array.isArray(arr)
      ? arr.filter((x): x is SignalTrigger => {
          if (!x || typeof x !== 'object') return false;
          const t = x as Record<string, unknown>;
          return typeof t.id === 'string' && typeof t.signal === 'string';
        })
      : [];
  } catch {
    return [];
  }
}

export function saveTriggers(
  setConfig: (userId: string, key: string, value: string) => void | Promise<void>,
  userId: string,
  list: SignalTrigger[],
): void | Promise<void> {
  const result = setConfig(userId, X_SIGNAL_TRIGGERS_KEY, JSON.stringify(list));
  return result instanceof Promise ? result : undefined;
}

export interface SignalFireDeps {
  getConfig: (userId: string, key: string) => string | undefined | Promise<string | undefined>;
  runIntent: (userId: string, intent: string, meta?: { signal?: string; actionFingerprint?: string }) => void;
  runAgent: (userId: string, agentId: string, goal: string, meta?: { triggerId?: string; actionFingerprint?: string }) => Promise<void>;
  /** 检查该 fingerprint 是否在保留期内已处理，是则跳过 */
  checkHandled?: (userId: string, fingerprint: string) => boolean | Promise<boolean>;
  /** 任务完成后调用，用于记录已处理（由 api 层在 task_complete 时调用） */
  recordHandled?: (userId: string, fingerprint: string) => void | Promise<void>;
}

/** 从 (userId, signal, triggerId, payload) 生成 fingerprint，用于去重 */
export function computeActionFingerprint(
  userId: string,
  signal: string,
  triggerId: string,
  payload: Record<string, unknown> | undefined,
): string {
  const canonical: Record<string, unknown> = { userId, signal, triggerId };
  if (payload) {
    if (payload.uid != null) canonical.uid = payload.uid;
    if (payload.messageId != null) canonical.messageId = payload.messageId;
    if (payload.taskId != null) canonical.taskId = payload.taskId;
    if (Object.keys(canonical).length <= 3 && payload.goal && typeof payload.goal === 'string') {
      canonical.goalHash = crypto.createHash('sha256').update(payload.goal.slice(0, 2000)).digest('hex').slice(0, 32);
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * 发出信号并执行匹配的触发器。
 * 与 cooldown 冲突的触发器会跳过。
 */
export async function fireSignal(
  userId: string,
  signal: string,
  payload: Record<string, unknown> | undefined,
  deps: SignalFireDeps,
): Promise<{ fired: number; skipped: number }> {
  if (!userId || userId === 'anonymous') return { fired: 0, skipped: 0 };
  let triggers = (await loadTriggers(deps.getConfig, userId)).filter((t) => t.signal === signal);
  const defaultT = DEFAULT_TRIGGERS[signal];
  if (triggers.length === 0 && defaultT) {
    triggers = [defaultT as SignalTrigger];
  }
  if (triggers.length === 0) return { fired: 0, skipped: 0 };

  let fired = 0;
  let skipped = 0;
  const now = Date.now();

  for (const t of triggers) {
    const key = `${userId}:${t.id}`;
    const until = cooldownUntil.get(key) ?? 0;
    if (until > now) {
      skipped++;
      continue;
    }
    if (t.cooldownMs && t.cooldownMs > 0) {
      cooldownUntil.set(key, now + t.cooldownMs);
    }

    const fingerprint = computeActionFingerprint(userId, signal, t.id, payload);
    const handled = deps.checkHandled?.(userId, fingerprint);
    if (handled instanceof Promise ? await handled : handled) {
      skipped++;
      continue;
    }

    const goalFromPayload = payload && typeof payload.goal === 'string' ? payload.goal : undefined;

    if (t.agentId) {
      const goal = goalFromPayload ?? `信号 ${signal} 触发，请根据上下文处理。`;
      setImmediate(async () => {
        try {
          await deps.runAgent(userId, t.agentId!, goal, { triggerId: t.id, actionFingerprint: fingerprint });
        } catch (err) {
          serverLogger.warn('signals', `trigger ${t.id} runAgent 失败`, err instanceof Error ? err.message : String(err));
        }
      });
      fired++;
    } else if (t.intent) {
      const message = goalFromPayload ?? t.intent;
      deps.runIntent(userId, message, { signal, actionFingerprint: fingerprint });
      fired++;
    } else {
      skipped++;
    }
  }

  if (fired > 0) {
    serverLogger.info('signals', `signal ${signal} fired ${fired} trigger(s)`, `userId=${userId}`);
  }
  return { fired, skipped };
}
