/**
 * Admin 鉴权中间件：校验当前用户是否为配置中的管理员。
 * 需在 userContext 之后使用（req.userId 已注入）。
 */

import type { Request, Response, NextFunction } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { getAdminEmails } from '../config/adminConfig.js';

export function createRequireAdmin(db: AsyncDatabase) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' });
      return;
    }
    const email = await db.getEmailByUserId(userId);
    const admins = getAdminEmails();
    if (!email || !admins.includes(email.toLowerCase())) {
      res.status(403).json({ error: '需要管理员权限', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}
