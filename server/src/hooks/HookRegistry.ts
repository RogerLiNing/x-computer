/**
 * 事件式钩子注册表。不阻塞主流程，handler 内抛错会被捕获并打日志。
 * 对齐 OpenClaw hooks：task_complete、memory_captured 等。
 */

import type { HookEventName, HookHandler } from './types.js';

const handlers = new Map<HookEventName, HookHandler[]>();

export function registerHook<E extends HookEventName>(event: E, handler: HookHandler<E>): void {
  const list = handlers.get(event) ?? [];
  list.push(handler as HookHandler);
  handlers.set(event, list);
}

export function unregisterHook(event: HookEventName, handler: HookHandler): void {
  const list = handlers.get(event) ?? [];
  const idx = list.indexOf(handler);
  if (idx >= 0) list.splice(idx, 1);
}

/**
 * 触发事件：异步执行所有已注册的 handler，不阻塞；单个 handler 抛错不影响其他。
 */
export function fire<E extends HookEventName>(event: E, payload: import('./types.js').HookPayloadMap[E]): void {
  const list = handlers.get(event) ?? [];
  if (list.length === 0) return;
  Promise.allSettled(
    list.map((h) => Promise.resolve(h(payload))),
  ).then((results) => {
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[Hooks] ${event} handler #${i} failed:`, r.reason);
      }
    });
  });
}

/** 仅用于测试：清空所有 handler */
export function clearAllHooks(): void {
  handlers.clear();
}
