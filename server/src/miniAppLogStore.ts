/**
 * 小程序运行时日志：按用户与应用存储，供 X 通过 x.get_app_logs 或 GET /api/apps/sandbox-logs 查看。
 * 用于排查「某个应用有问题」时的控制台错误、未捕获异常等。
 */

export interface MiniAppLogEntry {
  time: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  detail?: string;
}

const MAX_ENTRIES_PER_APP = 200;

export class MiniAppLogStore {
  /** userId -> appId -> entries (newest last) */
  private byUser = new Map<string, Map<string, MiniAppLogEntry[]>>();

  append(userId: string, appId: string, entry: Omit<MiniAppLogEntry, 'time'>): void {
    if (!userId || !appId || userId === 'anonymous') return;
    let userMap = this.byUser.get(userId);
    if (!userMap) {
      userMap = new Map();
      this.byUser.set(userId, userMap);
    }
    let list = userMap.get(appId);
    if (!list) {
      list = [];
      userMap.set(appId, list);
    }
    list.push({
      ...entry,
      time: new Date().toISOString(),
    });
    if (list.length > MAX_ENTRIES_PER_APP) {
      list.splice(0, list.length - MAX_ENTRIES_PER_APP);
    }
  }

  getLogs(userId: string, appId: string, limit = 50): MiniAppLogEntry[] {
    const userMap = this.byUser.get(userId);
    if (!userMap) return [];
    const list = userMap.get(appId);
    if (!list) return [];
    const start = Math.max(0, list.length - limit);
    return list.slice(start);
  }
}
