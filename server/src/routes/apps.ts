import { Router } from 'express';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { MiniAppLogStore } from '../miniAppLogStore.js';
import { PreviewService } from '../apps/PreviewService.js';
import { injectAppBootstrap } from '../apps/appBootstrap.js';
import { renderReact } from '../apps/renderReact.js';
import { appRuntime } from '../apps/appRuntime.js';
import { previewCapsule } from '../../../shared/src/previewCapsule.js';
import { AppVersionStore } from '../apps/AppVersionStore.js';

export function createAppsRouter(
  orchestrator: AgentOrchestrator,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
  miniAppLogStore?: MiniAppLogStore,
): Router {
  const router = Router();
  const previews=db&&userSandboxManager?new PreviewService(db,userSandboxManager):undefined;
  const versions=db&&userSandboxManager?new AppVersionStore(db):undefined;
  router.get('/apps/:appId/versions',async(req,res)=>{
    if(!versions)return res.status(503).json({error:'版本服务不可用'});
    try{res.json({versions:await versions.list(req.userId,req.params.appId)});}
    catch{res.status(400).json({error:'无法读取应用版本'});}
  });
  router.post('/apps/:appId/versions/:versionId/restore',async(req,res)=>{
    if(!versions||!db||!userSandboxManager)return res.status(503).json({error:'版本服务不可用'});
    try{
      const {sandboxFS}=await userSandboxManager.getForUser(req.userId);
      const restored=await versions.restore(req.userId,req.params.appId,req.params.versionId,sandboxFS);
      await versions.register(req.userId,restored);
      res.json({app:restored});
    }catch{res.status(400).json({error:'恢复未完成；当前应用和存档未被覆盖，请重试'});}
  });
  const legacyPolicy="sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'";
  router.post('/apps/preview',async(req,res)=>{
    if(!previews)return res.status(503).json({error:'预览服务不可用'});
    try{
      const session=await req.app.locals.sessions.authenticate(req.headers.cookie);
      if(!session||session.userId!==req.userId)return res.status(401).json({error:'需要登录'});
      const origin=req.headers.origin??`${req.protocol}://${req.get('host')}`;
      const {appId,content,mode}=req.body??{};
      if(appId!==undefined&&(typeof appId!=='string'||content!==undefined))return res.status(400).json({error:'应用预览参数无效'});
      if(content!==undefined&&(typeof content!=='string'||Buffer.byteLength(content)>512*1024||!['html','react'].includes(mode)))return res.status(400).json({error:'内容预览参数无效'});
      const html=content===undefined?undefined:mode==='react'?await renderReact(content):(content.match(/^```(?:html)?\s*\n([\s\S]*?)```\s*$/)?.[1]??content);
      res.json(await previews.mint(req.userId,session,origin,{appId,html}));
    }catch{res.status(400).json({error:'预览尚未创建，请检查应用或内容'});}
  });
  router.post('/apps/preview/:owner/:token/__runtime',async(req,res)=>{
    if(!previews||!db)return res.status(503).json({error:'预览服务不可用'});
    try{
      const preview=await previews.resolve(req.params.owner,req.params.token);
      if(!preview.app_id)return res.status(403).json({error:'内容预览不能访问应用数据'});
      res.json(await appRuntime(db,previews,miniAppLogStore,preview.user_id,preview.app_id,String(req.body?.op??''),req.body?.args,preview.token_hash));
    }catch{res.status(403).json({error:'应用请求未完成或超出授权范围'});}
  });
  router.get(/^\/apps\/preview\/([\w-]+)\/([\w-]+)\/(.+)$/,async(req,res)=>{
    if(!previews)return res.status(503).end();
    try{
      const match=req.path.match(/^\/apps\/preview\/([\w-]+)\/([\w-]+)\/(.+)$/)!;
      const [,owner,token,encoded]=match;const asset=decodeURIComponent(encoded);
      const preview=await previews.resolve(owner,token);
      const prefix=`${preview.origin}/api/apps/preview/${owner}/${token}/`;
      if(req.headers['sec-fetch-dest']==='document'&&asset!=='__viewer')return res.redirect(prefix+'__viewer');
      res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*',
        'Content-Security-Policy':`sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${prefix}; style-src 'unsafe-inline' ${prefix}; img-src data: blob: ${prefix}; font-src data: ${prefix}; media-src data: blob: ${prefix}; connect-src ${prefix}; frame-src 'none'; base-uri 'none'; form-action 'none'`});
      if(asset==='__viewer'){
        res.set('Content-Security-Policy',`sandbox allow-scripts; default-src 'none'; frame-src ${prefix}; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`);
        return res.type('text/html').send(previewCapsule(prefix+'index.html',preview.origin));
      }
      if(asset==='__runtime')return res.status(405).end();
      const ext=asset.split('.').pop()?.toLowerCase();
      const mime:Record<string,string>={html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',js:'application/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff2:'font/woff2',mp3:'audio/mpeg',wav:'audio/wav'};
      res.type(mime[ext??'']??'application/octet-stream');
      const body=preview.app_id?await previews.readAppAsset(owner,preview.app_id,asset):asset==='index.html'?Buffer.from(preview.html??''):null;
      if(body===null)return res.status(404).end();
      if(ext==='html'||ext==='htm')res.send(injectAppBootstrap(body.toString('utf8'),preview.app_id,preview.app_id?await previews.storage(owner,preview.app_id):{},preview.token_hash,preview.app_id?await versions?.sourceAppId(owner,preview.app_id):undefined));
      else res.send(body);
    }catch{res.status(403).json({error:'预览已失效或资源不可访问'});}
  });

  router.use('/apps/sandbox',(req,res,next)=>{res.set({'Content-Security-Policy':legacyPolicy,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});next();});

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

  /** 只返回仍可打开的应用；读取列表不删除登记，避免覆盖并发交付的新应用。 */
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

    if (userIdFromPath !== req.userId) {res.status(403).json({error:'无权访问此工作区'});return;}
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
