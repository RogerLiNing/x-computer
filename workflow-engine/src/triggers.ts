/**
 * 工作流触发器：timer、event
 */

import type { WorkflowStore } from './store.js';
import type { WorkflowRunner } from './runner.js';

export interface TriggerSchedulerDeps {
  store: WorkflowStore;
  runner: WorkflowRunner;
}

interface TimerJob {
  id: string;
  definitionId: string;
  userId: string;
  cron: string;
  nextRun: number;
}

const cronCache = new Map<string, TimerJob[]>();
let cronInterval: ReturnType<typeof setInterval> | null = null;

/** 简单 cron 解析：仅支持 "min hour * * *" 和 "* * * *" 每小时整点 */
function nextCronRun(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return Date.now() + 60_000;
  const [minStr, hourStr] = parts;
  const now = new Date();
  let next = new Date(now);
  if (minStr === '*' && hourStr === '*') {
    next.setMinutes(next.getMinutes() + 1);
    next.setSeconds(0, 0);
    return next.getTime();
  }
  const min = minStr === '*' ? now.getMinutes() : parseInt(minStr, 10);
  const hour = hourStr === '*' ? now.getHours() : parseInt(hourStr, 10);
  next.setHours(hour, min, 0, 0);
  if (next.getTime() <= now.getTime()) next.setHours(next.getHours() + 1);
  return next.getTime();
}

export function startTimerScheduler(deps: TriggerSchedulerDeps): void {
  if (cronInterval) return;

  function tick(): void {
    const now = Date.now();
    for (const [key, jobs] of cronCache) {
      for (const j of jobs) {
        if (j.nextRun <= now) {
          setImmediate(() => {
            deps.runner.start(j.userId, j.definitionId).catch(() => {});
          });
          j.nextRun = nextCronRun(j.cron);
        }
      }
    }
  }

  cronInterval = setInterval(tick, 15_000);
}

export function stopTimerScheduler(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
  cronCache.clear();
}

export function registerTimerTrigger(definitionId: string, userId: string, cron: string): void {
  const key = `${userId}:${definitionId}`;
  const list = cronCache.get(key) ?? [];
  const existing = list.find((j) => j.definitionId === definitionId);
  if (existing) existing.cron = cron;
  else list.push({ id: `t-${Date.now()}`, definitionId, userId, cron, nextRun: nextCronRun(cron) });
  cronCache.set(key, list);
}

export function unregisterTimerTrigger(userId: string, definitionId: string): void {
  const key = `${userId}:${definitionId}`;
  const list = cronCache.get(key) ?? [];
  cronCache.set(
    key,
    list.filter((j) => j.definitionId !== definitionId),
  );
}

/** 事件触发：由主服务 HTTP 回调调用 */
export async function fireEventTrigger(
  deps: TriggerSchedulerDeps,
  userId: string,
  eventName: string,
): Promise<{ started: number }> {
  const defs = deps.store.listDefinitions(userId);
  let started = 0;
  for (const def of defs) {
    const triggers = def.triggers ?? [];
    const match = triggers.find((t) => t.type === 'event' && t.eventName === eventName);
    if (match) {
      await deps.runner.start(userId, def.id);
      started++;
    }
  }
  return { started };
}
