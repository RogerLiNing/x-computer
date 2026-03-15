/**
 * 用户上下文中间件：从请求中解析 userId，注入到 req 对象。
 *
 * 规则：
 * 1. 优先从 Header `X-User-Id` 取
 * 2. 回退到 query `userId`
 * 3. 若均无则返回 401（可配为自动分配临时 ID）
 *
 * 多用户隔离的基础：后续 FS/Shell/Memory/Task 等路由通过 req.userId 选择对应沙箱。
 */

import type { Request, Response, NextFunction } from 'express';

// ── 扩展 Express Request ──────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 当前请求关联的用户 ID（由 userContext 中间件注入） */
      userId: string;
    }
  }
}

/** 无需 X-User-Id 即可访问的路径（登录/注册/验证码等） */
const AUTH_PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/captcha', '/api/auth/settings', '/api/workflow/execute-task'];

/** 路径式小程序资源：/api/apps/sandbox/:userId/apps/...，userId 在 URL 中，iframe 加载无法带 Header */
const SANDBOX_PATH_PREFIX = '/api/apps/sandbox/';

/** GET 小程序后端 KV 且带 X-App-Read-Token 时放行（由路由内解析 Token 得到 userId） */
const isAppBackendKvGetWithToken = (method: string, path: string, headers: Request['headers']) =>
  method === 'GET' &&
  /^\/api\/x-apps\/backend\/kv\/[^/]+$/.test(path) &&
  typeof headers['x-app-read-token'] === 'string' &&
  (headers['x-app-read-token'] as string).trim() !== '';

export function userContextMiddleware(allowAnonymous = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const fullPath = (req.originalUrl || req.baseUrl + req.path || '').split('?')[0];
    const isAuthPublic = AUTH_PUBLIC_PATHS.some((p) => fullPath === p || fullPath.startsWith(p + '?'));

    const xUserId = req.headers['x-user-id'];
    const hasUserId = typeof xUserId === 'string' ? xUserId.trim() !== '' : false;
    if (!hasUserId && isAppBackendKvGetWithToken(req.method, fullPath, req.headers)) {
      req.userId = 'anonymous';
      return next();
    }

    let userId =
      (typeof req.headers['x-user-id'] === 'string' && req.headers['x-user-id'].trim()) ||
      (typeof req.query?.userId === 'string' && req.query.userId.trim()) ||
      '';

    // 路径式小程序：iframe 加载无法带 X-User-Id，从 URL 提取 userId
    if (!userId && fullPath.startsWith(SANDBOX_PATH_PREFIX)) {
      const rest = fullPath.slice(SANDBOX_PATH_PREFIX.length);
      const firstSlash = rest.indexOf('/');
      const pathUserId = firstSlash >= 0 ? rest.slice(0, firstSlash) : rest;
      if (pathUserId && /^[\w-]{1,128}$/.test(decodeURIComponent(pathUserId))) {
        userId = decodeURIComponent(pathUserId);
      }
    }

    if (!userId) {
      if (allowAnonymous) {
        req.userId = 'anonymous';
        return next();
      }
      if (isAuthPublic) {
        req.userId = 'anonymous';
        return next();
      }
      res.status(401).json({ error: '请先登录 (Missing X-User-Id header)', code: 'UNAUTHORIZED' });
      return;
    }

    // 简单校验：userId 格式合法（UUID、字母数字、连字符、下划线，长度 1-128）
    if (!/^[\w-]{1,128}$/.test(userId)) {
      res.status(400).json({ error: 'Invalid userId format' });
      return;
    }

    req.userId = userId;
    next();
  };
}
