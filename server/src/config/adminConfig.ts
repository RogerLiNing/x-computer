/**
 * Admin 配置：从 .x-config.json 的 admin.emails 或环境变量 X_COMPUTER_ADMIN_EMAILS 读取管理员邮箱列表。
 */

import { loadDefaultConfig } from './defaultConfig.js';

const ADMIN_BANNED_KEY = 'admin_banned';

/** 获取管理员邮箱列表（小写，去重） */
export function getAdminEmails(): string[] {
  const env = process.env.X_COMPUTER_ADMIN_EMAILS?.trim();
  if (env) {
    return [...new Set(env.split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  }
  const config = loadDefaultConfig();
  const admin = config?.admin as { emails?: string[] } | undefined;
  const emails = Array.isArray(admin?.emails) ? admin.emails : [];
  return [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

export { ADMIN_BANNED_KEY };
