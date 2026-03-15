import { create } from 'zustand';
import { api } from '@/utils/api';
import { getUserIdOrNull } from '@/utils/userId';

const STORAGE_KEY = 'x-computer-system-logs';
const CLOUD_CONFIG_KEY = 'system_logs';

/** 日志级别：调试、信息、警告、错误 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/** 日志分类：系统级（API、运行时等）与应用级（各应用内产生） */
export type LogCategory = 'system' | 'application';

export type SystemLogEntry = {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  /** 具体来源，如 api、save_to_editor、chat、task 等 */
  source: string;
  message: string;
  detail?: string;
  url?: string;
  method?: string;
};

const MAX_ENTRIES = 200;

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];
const LOG_CATEGORIES: LogCategory[] = ['system', 'application'];

function isSystemLogEntry(x: unknown): x is SystemLogEntry {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.timestamp === 'number' &&
    LOG_LEVELS.includes(o.level as LogLevel) &&
    LOG_CATEGORIES.includes(o.category as LogCategory) &&
    typeof o.source === 'string' &&
    typeof o.message === 'string'
  );
}

function loadPersistedEntries(): SystemLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(isSystemLogEntry).slice(0, MAX_ENTRIES);
    return entries;
  } catch {
    return [];
  }
}

function persistEntries(entries: SystemLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore quota or disabled localStorage
  }
}

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: '调试',
  info: '信息',
  warning: '警告',
  error: '错误',
};

export const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  system: '系统',
  application: '应用',
};

export type AddLogOptions = {
  /** 为 true 时不触发云端 system_logs 同步，用于避免“写日志 → 同步失败 → 再写日志”的循环 */
  skipCloudSync?: boolean;
};

type SystemLogState = {
  entries: SystemLogEntry[];
  addLog: (entry: Omit<SystemLogEntry, 'id' | 'timestamp'>, options?: AddLogOptions) => void;
  clearLogs: () => void;
  /** 从云端配置覆盖本地（启动时拉取后调用） */
  replaceFromCloud: (entries: SystemLogEntry[]) => void;
};

let idCounter = 0;
function nextId(): string {
  return `log-${++idCounter}-${Date.now()}`;
}

export const useSystemLogStore = create<SystemLogState>((set) => ({
  entries: loadPersistedEntries(),

  addLog: (entry, options) =>
    set((state) => {
      const newEntry: SystemLogEntry = {
        ...entry,
        id: nextId(),
        timestamp: Date.now(),
      };
      const entries = [newEntry, ...state.entries].slice(0, MAX_ENTRIES);
      persistEntries(entries);
      if (getUserIdOrNull() && !options?.skipCloudSync) {
        api.setUserConfigKey(CLOUD_CONFIG_KEY, entries).catch(() => {});
      }
      return { entries };
    }),

  clearLogs: () => {
    persistEntries([]);
    set({ entries: [] });
    if (getUserIdOrNull()) api.setUserConfigKey(CLOUD_CONFIG_KEY, []).catch(() => {});
  },

  replaceFromCloud: (entries) => {
    const valid = Array.isArray(entries) ? entries.filter(isSystemLogEntry).slice(0, MAX_ENTRIES) : [];
    set({ entries: valid });
    persistEntries(valid);
  },
}));

export function getSystemLogStore(): {
  addLog: SystemLogState['addLog'];
  clearLogs: SystemLogState['clearLogs'];
  replaceFromCloud: SystemLogState['replaceFromCloud'];
  entries: SystemLogEntry[];
} {
  return useSystemLogStore.getState();
}
