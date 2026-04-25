/**
 * NotificationService — central place for creating in-app notifications.
 * Import and call notify() from any part of the backend to push a notification
 * to a user's notification center.
 */
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'task' | 'webhook' | 'system';

export interface NotifyOptions {
  userId: string;
  type?: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Unix timestamp in ms; defaults to 30 days from now */
  expiresAt?: number;
}

let _db: AsyncDatabase | undefined;

export function initNotificationService(db: AsyncDatabase): void {
  _db = db;
}

async function notify(opts: NotifyOptions): Promise<void> {
  if (!_db) {
    serverLogger.warn('notification-service', 'NotificationService not initialized, skipping');
    return;
  }
  try {
    const expiresAt = opts.expiresAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000;
    await _db.createNotification({
      userId: opts.userId,
      type: opts.type ?? 'info',
      title: opts.title,
      body: opts.body ?? null,
      link: opts.link ?? null,
      expiresAt,
    });
  } catch (err) {
    serverLogger.error('notification-service', 'Failed to create notification', String(err));
  }
}

export const NotificationService = { notify };
