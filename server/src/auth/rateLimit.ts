/**
 * 登录失败限流：同一邮箱多次失败后锁定一段时间，防止暴力破解。
 */

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

interface Entry {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

const store = new Map<string, Entry>();

function key(email: string): string {
  return email.toLowerCase().trim();
}

export function recordFailure(email: string): void {
  const k = key(email);
  const now = Date.now();
  const existing = store.get(k);
  if (!existing) {
    store.set(k, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  if (existing.lockedUntil > now) return; // 已锁定，不增加计数
  existing.count += 1;
  existing.firstAt = existing.firstAt || now;
  if (existing.count >= MAX_FAILURES) {
    existing.lockedUntil = now + LOCK_MINUTES * 60 * 1000;
  }
  store.set(k, existing);
}

export function clearFailures(email: string): void {
  store.delete(key(email));
}

/** 若已锁定返回剩余秒数，否则返回 0 */
export function getLockedRemainingSeconds(email: string): number {
  const k = key(email);
  const e = store.get(k);
  if (!e || e.lockedUntil <= Date.now()) return 0;
  return Math.ceil((e.lockedUntil - Date.now()) / 1000);
}

/** 是否被锁定 */
export function isLocked(email: string): boolean {
  return getLockedRemainingSeconds(email) > 0;
}
