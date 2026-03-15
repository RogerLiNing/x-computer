/**
 * 用户身份管理：仅在登录/注册后存在 userId，无匿名用户。
 * 所有 API 请求通过 X-User-Id Header 携带此 ID。
 */

const USER_ID_KEY = 'x-computer-user-id';

/** 获取当前用户 ID（若未登录则返回 null，不自动创建） */
export function getUserIdOrNull(): string | null {
  return localStorage.getItem(USER_ID_KEY);
}

/**
 * 获取当前用户 ID，未登录时抛出。
 * 仅在已进入桌面（登录后）的上下文中调用。
 */
export function getUserId(): string {
  const id = getUserIdOrNull();
  if (!id) throw new Error('Not logged in');
  return id;
}

/** 手动设置用户 ID（登录/注册成功后调用） */
export function setUserId(userId: string): void {
  localStorage.setItem(USER_ID_KEY, userId);
}
