/**
 * 退出登录时清空所有本地缓存、Cookie 等。
 * 用于保护隐私，确保下次进入系统为全新状态。
 */

/** 已知的 localStorage 键（包括各模块使用的） */
const KNOWN_KEYS = [
  'x-computer-user-id',
  'x-computer-llm-config',
  'x-computer-llm-secrets',
  'x-computer-llm-imported-models',
  'x-computer-last-chat-session-id',
  'x-computer-installed-apps',
  'x-computer-desktop-icon-layout',
  'x-computer-system-logs',
  'audio_api_config',
];

/** 清空 localStorage 中所有 x-computer 相关及已知配置键 */
function clearLocalStorage(): void {
  try {
    for (const key of KNOWN_KEYS) {
      localStorage.removeItem(key);
    }
    // 兜底：删除所有以 x-computer 开头的键
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('x-computer') || k === 'audio_api_config')) {
        keys.push(k);
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore quota / disabled
  }
}

/** 清空当前域名下的 Cookie */
function clearCookies(): void {
  try {
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const eq = part.indexOf('=');
      const name = eq >= 0 ? part.slice(0, eq).trim() : part.trim();
      if (name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
      }
    }
  } catch {
    // ignore
  }
}

/** 清空 Cache API 缓存 */
async function clearCaches(): Promise<void> {
  try {
    if ('caches' in window && typeof caches.keys === 'function') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }
}

/**
 * 清空所有本地缓存、Cookie、Cache API。
 * 退出登录时调用，随后应执行页面刷新（刷新后 getUserId 会生成新匿名 ID）。
 */
export async function clearAllLocalData(): Promise<void> {
  clearLocalStorage();
  clearCookies();
  await clearCaches();
}
