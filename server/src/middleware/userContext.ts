/** Server-verified sessions select the user. Header/query IDs are only consistency hints. */

import type { Request, Response, NextFunction } from 'express';
import { serviceTokenMatches } from '../auth/sessionAuth.js';

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
const AUTH_PUBLIC_PATHS = ['/api/auth/logout', '/api/auth/login', '/api/auth/register', '/api/auth/captcha', '/api/auth/settings', '/api/llm/config', '/api/health'];

export function userContextMiddleware(allowAnonymous = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const fullPath=(req.originalUrl || req.path).split('?')[0];
    try {
      if((req.method==='GET'||req.method==='POST')&&/^\/api\/apps\/preview\/[\w-]{1,128}\/[\w-]{43}\//.test(fullPath)){req.userId='anonymous';next();return;}
      if(req.method==='GET'&&/^\/api\/x-apps\/backend\/kv\/[^/]+$/.test(fullPath)&&typeof req.headers['x-app-read-token']==='string'){req.userId='anonymous';next();return;}
      if(req.headers.origin==='null'){res.status(403).json({error:'隔离预览不能访问账户接口'});return;}
      if(fullPath==='/api/workflow/execute-task') {
        if(!serviceTokenMatches(req.headers.authorization)) {res.status(401).json({error:'工作流回调未认证'});return;}
        const id=req.body?.userId;
        if(typeof id!=='string'||!/^[\w-]{1,128}$/.test(id)) {res.status(400).json({error:'无效工作流用户'});return;}
        req.userId=id;next();return;
      }
      const session=await req.app.locals.sessions.authenticate(req.headers.cookie);
      if(session) {
        const claimed=req.headers['x-user-id'] || req.query.userId;
        if(claimed && claimed!==session.userId) {res.status(403).json({error:'身份与登录会话不一致'});return;}
        req.userId=session.userId;next();return;
      }
      if(AUTH_PUBLIC_PATHS.includes(fullPath)||(req.method==='GET'&&fullPath==='/api/auth/oauth/status')||(req.method==='POST'&&['/api/auth/request-password-reset','/api/auth/reset-password'].includes(fullPath))) {req.userId='anonymous';next();return;}
      if(req.method==='GET' && /^\/api\/x-apps\/backend\/kv\//.test(fullPath) && typeof req.headers['x-app-read-token']==='string') {req.userId='anonymous';next();return;}
      if(allowAnonymous && !req.headers['x-user-id'] && !req.query.userId) {req.userId='anonymous';next();return;}
      res.status(401).json({error:'请先登录',code:'UNAUTHORIZED'});
    } catch {res.status(503).json({error:'登录验证暂不可用'});}
  };
}
