import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { MiniAppLogStore } from '../miniAppLogStore.js';

export function createAppsRouter(
  orchestrator: AgentOrchestrator,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
  miniAppLogStore?: MiniAppLogStore,
): Router {
  const router = Router();

  /** 生成注入到小程序 HTML 的脚本：上报 window.onerror 与 console.error 到后端，供 x.get_app_logs 查看 */
  function buildMiniAppLoggerScript(appId: string, userId: string): string {
    const a = appId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const u = userId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return (
      '<script>(function(){var appId="' +
      a +
      '",userId="' +
      u +
      '",api="/api";function send(lvl,msg,det){try{fetch(api+"/apps/sandbox-logs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({appId:appId,userId:userId,level:lvl,message:msg,detail:det||null})}).catch(function(){})}catch(e){}}window.onerror=function(m,s,l,c,e){send("error",m||"Unknown",e&&e.stack?e.stack:null);return false};if(typeof console!=="undefined"&&console.error){var o=console.error;console.error=function(){o.apply(console,arguments);var t=Array.prototype.slice.call(arguments);send("error",t.join(" "),null)}}})();<\/script>'
    );
  }

  /** X 制作的小程序列表（按用户隔离）。仅返回沙箱内仍存在应用目录的项，删除目录后桌面图标会同步消失；并写回清理后的 x_mini_apps。 */
  router.get('/apps', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') return res.json({ apps: [] });
      if (!db) return res.json({ apps: [] });
      const raw = await db.getConfig(userId, 'x_mini_apps');
      if (!raw) return res.json({ apps: [] });
      let apps: { id: string; name: string; path: string }[];
      try {
        const arr = JSON.parse(raw) as unknown[];
        apps = Array.isArray(arr)
          ? arr.filter((x): x is { id: string; name: string; path: string } => {
              if (!x || typeof x !== 'object') return false;
              const a = x as Record<string, unknown>;
              return typeof a.id === 'string' && typeof a.name === 'string' && typeof a.path === 'string';
            })
          : [];
      } catch {
        return res.json({ apps: [] });
      }
      if (apps.length === 0) return res.json({ apps: [] });
      if (!userSandboxManager) return res.json({ apps });
      try {
        const { sandboxFS } = await userSandboxManager.getForUser(userId);
        const existing: typeof apps = [];
        for (const app of apps) {
          const indexPath = app.path.replace(/\/?$/, '') + '/index.html';
          try {
            await sandboxFS.read(indexPath);
            existing.push(app);
          } catch (err: any) {
            const code = (err as NodeJS.ErrnoException)?.code ?? '';
            if (code !== 'ENOENT' && !err?.message?.includes('not found')) throw err;
          }
        }
        if (existing.length !== apps.length) {
          await db.setConfig(userId, 'x_mini_apps', JSON.stringify(existing));
        }
        return res.json({ apps: existing });
      } catch (err: any) {
        res.status(500).json({ error: err.message ?? '获取应用列表失败' });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取应用列表失败' });
    }
  });

  /** 小程序运行时上报日志（iframe 内注入的脚本会 POST 控制台错误等），供 x.get_app_logs 与 GET sandbox-logs 查看 */
  router.post('/apps/sandbox-logs', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return;
    }
    if (!miniAppLogStore) {
      res.status(503).json({ error: '日志服务不可用' });
      return;
    }
    const { appId, level, message, detail } = req.body || {};
    const bodyUserId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (bodyUserId && bodyUserId !== userId) {
      res.status(403).json({ error: '用户不匹配' });
      return;
    }
    const aid = String(appId ?? '').trim();
    const msg = String(message ?? '').trim();
    if (!aid || !msg) {
      res.status(400).json({ error: 'appId 与 message 必填' });
      return;
    }
    const lvl = level === 'warn' || level === 'info' ? level : 'error';
    miniAppLogStore.append(userId, aid, { level: lvl, message: msg, detail: detail != null ? String(detail) : undefined });
    res.json({ ok: true });
  });

  /** 获取指定小程序的最近运行时日志（供前端或调试用；X 请用工具 x.get_app_logs） */
  router.get('/apps/sandbox-logs', (req, res) => {
    const userId = (req as { userId?: string }).userId;
    if (!userId || userId === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return;
    }
    if (!miniAppLogStore) return res.json({ logs: [] });
    const appId = String(req.query.appId ?? '').trim();
    if (!appId) {
      res.status(400).json({ error: 'appId 必填' });
      return;
    }
    const limit = Math.min(Math.max(0, Number(req.query.limit) || 30), 100);
    res.json({ logs: miniAppLogStore.getLogs(userId, appId, limit) });
  });

  /** 提供小程序静态资源（沙箱 apps/ 目录下文件，按用户隔离）。
   * 路径式（推荐）：/api/apps/sandbox/:userId/apps/calc/index.html
   * 这样 iframe 内相对引用 style.css、app.js 会请求同一路径下的文件，URL 中已带 userId，子资源可正确鉴权。
   * 对 .html 响应注入运行时错误上报脚本，便于 X 通过 x.get_app_logs 查看问题。 */
  router.get(/^\/apps\/sandbox\/([^/]+)\/(.+)$/, async (req, res) => {
    const pathForMatch = (req as { path?: string }).path ?? '';
    const match = pathForMatch.match(/^\/apps\/sandbox\/([^/]+)\/(.+)$/);
    const userIdFromPath = match ? decodeURIComponent(match[1]) : '';
    let pathParam = match ? match[2].replace(/^\/+/, '') : '';
    if (!pathParam.startsWith('apps/')) {
      res.status(400).json({ error: 'path 须以 apps/ 开头' });
      return;
    }
    // 兼容错误引用：若路径为 apps/<id>/apps/<id>/...（重复一段），规范为 apps/<id>/...
    const dupMatch = pathParam.match(/^apps\/([^/]+)\/apps\/\1\/(.*)$/);
    if (dupMatch) pathParam = `apps/${dupMatch[1]}/${dupMatch[2]}`;

    if (!userIdFromPath || userIdFromPath === 'anonymous') {
      res.status(401).json({ error: '需要登录' });
      return;
    }
    if (!userSandboxManager) {
      res.status(503).json({ error: '用户沙箱不可用' });
      return;
    }
    try {
      const { sandboxFS } = await userSandboxManager.getForUser(userIdFromPath);
      const ext = pathParam.replace(/^.*\./, '').toLowerCase();
      const binaryExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'wav', 'mp3', 'ogg', 'm4a']);
      const mime: Record<string, string> = {
        html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript',
        json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', webp: 'image/webp', bmp: 'image/bmp',
        wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4',
      };
      res.set('Content-Type', mime[ext] || 'text/plain');

      if (binaryExts.has(ext)) {
        const buffer = await sandboxFS.readBinary(pathParam);
        res.send(buffer);
        return;
      }
      let content = await sandboxFS.read(pathParam);
      if ((ext === 'html' || ext === 'htm') && content.includes('</body>')) {
        const appIdMatch = pathParam.match(/^apps\/([^/]+)\//);
        const appId = appIdMatch ? appIdMatch[1] : '';
        const script = buildMiniAppLoggerScript(appId, userIdFromPath);
        content = content.replace('</body>', script + '</body>');
      }
      res.send(content);
    } catch (err: any) {
      if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }
      res.status(500).json({ error: err.message ?? '读取失败' });
    }
  });

  router.get('/apps/sandbox', async (req, res) => {
    try {
      const pathParam = (req.query.path as string)?.trim();
      if (!pathParam || !pathParam.startsWith('apps/')) {
        res.status(400).json({ error: 'path 必填且须以 apps/ 开头' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        res.status(401).json({ error: '需要登录' });
        return;
      }
      if (!userSandboxManager) {
        res.status(503).json({ error: '用户沙箱不可用' });
        return;
      }
      const { sandboxFS } = await userSandboxManager.getForUser(userId);
      const ext = pathParam.replace(/^.*\./, '').toLowerCase();
      const binaryExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp']);
      const mime: Record<string, string> = {
        html: 'text/html',
        htm: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        webp: 'image/webp',
        bmp: 'image/bmp',
      };
      res.set('Content-Type', mime[ext] || 'text/plain');
      if (binaryExts.has(ext)) {
        const buffer = await sandboxFS.readBinary(pathParam);
        res.send(buffer);
      } else {
        const content = await sandboxFS.read(pathParam);
        res.send(content);
      }
    } catch (err: any) {
      if (err.message?.includes('ENOENT') || err.message?.includes('not found')) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }
      res.status(500).json({ error: err.message ?? '读取失败' });
    }
  });

  return router;
}
