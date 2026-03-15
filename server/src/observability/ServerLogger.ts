/**
 * Server-side in-memory logger for X-Computer.
 * Stores recent log entries in a ring buffer and prints to console.
 * Entries can be retrieved via GET /api/logs by the frontend.
 */

export type ServerLogLevel = 'debug' | 'info' | 'warning' | 'error';
export type ServerLogCategory = 'system' | 'application';

export interface ServerLogEntry {
  id: string;
  timestamp: number;
  level: ServerLogLevel;
  category: ServerLogCategory;
  source: string;
  message: string;
  detail?: string;
}

const MAX_ENTRIES = 500;

let idCounter = 0;

class ServerLoggerImpl {
  private entries: ServerLogEntry[] = [];

  private add(level: ServerLogLevel, category: ServerLogCategory, source: string, message: string, detail?: string) {
    const entry: ServerLogEntry = {
      id: `srv-${++idCounter}-${Date.now()}`,
      timestamp: Date.now(),
      level,
      category,
      source,
      message,
      detail,
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES;
    }

    // Also print to server console for terminal visibility (东八区)
    const d = new Date(entry.timestamp);
    const ts = d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }) +
      '.' + String(d.getUTCMilliseconds()).padStart(3, '0');
    const tag = `[${level.toUpperCase()}][${category}/${source}]`;
    const line = `${ts} ${tag} ${message}`;
    switch (level) {
      case 'error':
        console.error(line, detail ? `\n${detail}` : '');
        break;
      case 'warning':
        console.warn(line, detail ? `\n${detail}` : '');
        break;
      case 'debug':
        console.debug(line, detail ? `\n${detail}` : '');
        break;
      default:
        console.log(line, detail ? `\n${detail}` : '');
    }
  }

  debug(source: string, message: string, detail?: string) {
    this.add('debug', 'system', source, message, detail);
  }

  info(source: string, message: string, detail?: string) {
    this.add('info', 'system', source, message, detail);
  }

  warn(source: string, message: string, detail?: string) {
    this.add('warning', 'system', source, message, detail);
  }

  error(source: string, message: string, detail?: string) {
    this.add('error', 'system', source, message, detail);
  }

  appInfo(source: string, message: string, detail?: string) {
    this.add('info', 'application', source, message, detail);
  }

  appWarn(source: string, message: string, detail?: string) {
    this.add('warning', 'application', source, message, detail);
  }

  appError(source: string, message: string, detail?: string) {
    this.add('error', 'application', source, message, detail);
  }

  getAll(): ServerLogEntry[] {
    return [...this.entries];
  }

  getRecent(limit = 200): ServerLogEntry[] {
    return this.entries.slice(0, limit);
  }

  clear() {
    this.entries = [];
  }

  get count(): number {
    return this.entries.length;
  }
}

/** Singleton server logger */
export const serverLogger = new ServerLoggerImpl();
