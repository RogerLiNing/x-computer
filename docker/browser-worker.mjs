import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rename, stat, copyFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import {createBrowserPolicy,startBrowserProxy,createCloudflareResolver} from './browser-network.mjs';
const allowedOrigins = JSON.parse(process.env.X_BROWSER_ALLOWED_ORIGINS || '[]');
const dnsMode=process.env.X_BROWSER_DNS_MODE || 'system';
if(!['system','cloudflare'].includes(dnsMode))throw new Error('浏览器DNS模式无效');
const networkPolicy=createBrowserPolicy(allowedOrigins,dnsMode==='cloudflare'?createCloudflareResolver():undefined);
const outboundProxy=await startBrowserProxy(networkPolicy);
async function allowed(url){try{await networkPolicy.resolve(url);return true;}catch(error){throw new Error(error.name==='TimeoutError'?'域名解析超时，请稍后重试或检查浏览器DNS配置':error.message);}}
const directory = '/workspace/.x-browser';
await mkdir(directory, { recursive: true, mode: 0o700 });
const exportsDirectory = `${directory}/exports`;
await mkdir(exportsDirectory,{recursive:true,mode:0o700});
const manifestPath=`${exportsDirectory}/manifest.json`;
let downloads=[];
try{downloads=JSON.parse(await readFile(manifestPath,'utf8'));if(!Array.isArray(downloads)||downloads.length>100)throw new Error('下载记录损坏');}
catch(error){if(error.code!=='ENOENT')throw error;}
let pendingDownloads=0;
let downloadError;
let downloadWrites=Promise.resolve();
function captureDownload(download){
  if(pendingDownloads>=2){void download.cancel();downloadError='同时下载过多，请稍后重试';return;}
  pendingDownloads++;
  const timer=setTimeout(()=>void download.cancel(),15000);
  const finished=(async()=>{
    const source=await download.path();
    if(!source)throw new Error('下载未完成');
    const info=await stat(source);
    if(info.size>10*1024*1024)throw new Error('单个下载文件不能超过10MB');
    const bytes=await readFile(source);
    const id=randomUUID();
    const name=basename(download.suggestedFilename().replaceAll('\\','/')).replace(/[\x00-\x1f]/g,'').slice(0,120)||'下载文件';
    const entry={id,name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),createdAt:Date.now()};
    const write=downloadWrites.then(async()=>{
      if(downloads.length>=100||downloads.reduce((sum,file)=>sum+file.size,0)+entry.size>20*1024*1024)throw new Error('浏览器下载空间已满，请先保存需要的成果');
      await copyFile(source,`${exportsDirectory}/${id}`,constants.COPYFILE_EXCL);
      const next=[...downloads,entry];const temporary=`${manifestPath}.tmp`;
      await writeFile(temporary,JSON.stringify(next),{mode:0o600});await rename(temporary,manifestPath);downloads=next;downloadError=undefined;
    });
    downloadWrites=write.catch(()=>{});await write;
  })();
  void finished.catch(()=>{downloadError='下载未保存：文件过大、空间不足或下载中断，请重新检查。';}).finally(()=>{clearTimeout(timer);pendingDownloads--;});
}
const controlPath = `${directory}/control.json`;
let uploadRequests=[];
try{
 const saved=JSON.parse(await readFile(controlPath,'utf8'));
 if(saved.uploadRequests!==undefined&&!Array.isArray(saved.uploadRequests))throw new Error('上传记录损坏');
 uploadRequests=(saved.uploadRequests??[]).slice(-20).map(request=>({...request,status:request.status==='pending'?'expired':request.status==='consumed'?'unknown':request.status}));
}catch(error){if(error.code!=='ENOENT')throw error;}

// Restarting never silently gives the model control of a person's page.
let holder = 'human';
let revision = 0;
const run = randomUUID();
let context;
let page;
const maxTabs = 8;
const tabs = new Map();
const pageIds = new WeakMap();
let tabError;
let framed;
let controlWrites = Promise.resolve();
let targets = [];
let observed;
let queue = Promise.resolve();
function persist() {
  const content = JSON.stringify({ holder, run, revision, uploadRequests });
  const write = controlWrites.then(async () => {
    const temporary = `${controlPath}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, controlPath);
  });
  controlWrites = write.catch(() => {});
  return write;
}
await persist();
async function ready() {
  if (context) {
    if (!page) await context.newPage();
    return;
  }
  context = await chromium.launchPersistentContext(`${directory}/profile`, {
    headless: true, executablePath: process.env.X_BROWSER_EXECUTABLE || undefined, viewport: { width: 1100, height: 700 }, acceptDownloads: true, downloadsPath: '/tmp/x-browser-downloads', serviceWorkers: 'block',
    proxy: {server:outboundProxy.url},
    args: ['--disable-dev-shm-usage','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  context.setDefaultTimeout(5000);
  await context.route('**/*', async route => {
    try { if (['blob:','data:'].includes(new URL(route.request().url()).protocol) || networkPolicy.permits(route.request().url())) { await route.continue(); return; } } catch {}
    await route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  context.on('page', popup => trackPage(popup));
  for (const existing of context.pages()) trackPage(existing, false);
  if (!page) await context.newPage();
}
function trackPage(tab, select = true) {
  if (pageIds.has(tab)) return;
  if (tabs.size >= maxTabs) {
    tabError = '最多同时打开8个标签页，请先关闭用完的页面';
    void tab.close().catch(() => {});
    return;
  }
  const id = randomUUID();
  const entry = { id, page: tab, title: '' };
  pageIds.set(tab, id);
  tabs.set(id, entry);
  if (!page || select) page = tab;
  const recordChange = () => { changed(); void persist().catch(() => { tabError = '页面状态暂未保存，请重新查看'; }); };
  tab.on('download', captureDownload);
  tab.on('framenavigated', frame => { if (frame === tab.mainFrame()) recordChange(); });
  tab.on('domcontentloaded', () => {
    void tab.title().then(title => { if (tabs.has(id)) entry.title = title.slice(0, 120); }).catch(() => {});
  });
  tab.on('close', () => {
    tabs.delete(id);
    if (page === tab) page = tabs.values().next().value?.page;
    recordChange();
  });
  recordChange();
}
const state = () => ({ holder, run, revision, started: !!page, url: page?.url(), activeTabId: pageIds.get(page),
  tabs: [...tabs.values()].map(tab => ({ id: tab.id, title: tab.title, url: tab.page.url(), active: tab.page === page })),
  maxTabs, tabError, frame: framed, allowedOrigins, downloads, pendingDownloads, downloadError, uploadRequests });
function changed() { revision++; framed = undefined; observed = undefined; targets = [];for(const request of uploadRequests)if(request.status==='pending')request.status='expired'; }
function text(value, limit) {
  if (typeof value !== 'string' || value.length > limit) throw new Error('文字参数无效');
  return value;
}
async function fileTargetInfo(element){
 return element.evaluate(el=>({connected:el.isConnected,tag:el.tagName,type:el.type,id:el.id,name:el.name,label:(el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.name||'文件选择框').trim().slice(0,200),accept:el.accept,multiple:el.multiple,formAction:el.form?.action??null}));
}
async function dispatch(input) {
  if (!input || !['human','agent'].includes(input.actor)) throw new Error('控制身份无效');
  const { actor, action } = input;
  let expired=false;
  for(const request of uploadRequests)if(request.status==='pending'&&request.expiresAt<=Date.now()){request.status='expired';expired=true;}
  if(expired)await persist();
  if (action === 'state') return state();
  if (action === 'start') { if (actor !== 'human') throw new Error('请先由用户打开助手电脑'); await ready(); return state(); }
  if (!page) throw new Error('请先打开助手电脑');
  if (action === 'take' || action === 'release') {
    if (actor !== 'human') throw new Error('只有用户可以交接控制权');
    holder = action === 'take' ? 'human' : 'agent'; changed(); await persist(); return state();
  }
  if (action === 'frame') {
    if (actor !== 'human') throw new Error('画面只提供给已登录用户');
    const source = page, version = revision;
    const image = (await source.screenshot({ type: 'jpeg', quality: 65 })).toString('base64');
    if (source !== page || version !== revision) throw new Error('画面已变化，请重新刷新');
    framed = `${run}:${version}:${pageIds.get(source)}`;
    return { ...state(), image };
  }
  if(action==='upload_reject'||action==='upload_cancel'){
    if(action==='upload_reject'&&actor!=='human')throw new Error('只有用户可以决定上传');
    const request=uploadRequests.find(item=>item.id===input.id);
    if(!request||request.status!=='pending')throw new Error('上传请求已处理');
    request.status=action==='upload_reject'?'rejected':'cancelled';await persist();return state();
  }
  if(action==='upload_approve'){
    if(actor!=='human')throw new Error('只有用户可以批准上传');
    const request=uploadRequests.find(item=>item.id===input.id);
    if(!request||request.status!=='pending')throw new Error('上传请求已处理');
    if(request.run!==run||request.snapshot!==observed||request.url!==page.url()||request.tabId!==pageIds.get(page)){
      request.status='expired';await persist();throw new Error('页面已变化，请重新申请上传');
    }
    const element=targets[request.target];
    if(!element||!await element.evaluate(el=>el.isConnected&&el.tagName==='INPUT'&&el.type==='file')){request.status='expired';await persist();throw new Error('文件选择框已变化，请重新申请');}
    if(JSON.stringify(await fileTargetInfo(element))!==JSON.stringify(request.targetInfo)){request.status='expired';await persist();throw new Error('文件选择框资料已变化，请重新申请');}
    const handle=await open(`${directory}/imports/${request.id}`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    let bytes;
    try{const info=await handle.stat();if(!info.isFile()||info.size!==request.file.size||info.size>5*1024*1024)throw new Error('文件大小校验失败');bytes=await handle.readFile();}finally{await handle.close();}
    if(createHash('sha256').update(bytes).digest('hex')!==request.file.sha256)throw new Error('文件内容校验失败');
    request.status='consumed';await persist();
    try{await element.setInputFiles({name:request.file.name,mimeType:request.file.mimeType,buffer:bytes});request.status='completed';}
    catch{request.status='unknown';throw new Error('向网页提供文件的结果未知，请查看页面，未自动重试');}
    finally{changed();await persist();}
    return state();
  }
  if (holder !== actor) throw new Error(holder === 'human' ? '用户正在操作，请等待交还' : '请先点“我来操作”');
  if(action==='upload_request'){
    if(page.url()!=='about:blank'&&!networkPolicy.permits(page.url()))throw new Error('当前网页未获允许，不能提供文件');
    if(actor!=='agent'||!observed||input.snapshot!==observed)throw new Error('请先重新读取页面');
    if(!Number.isInteger(input.target)||input.target<0||input.target>=Math.min(targets.length,100))throw new Error('文件选择框无效');
    if(!await targets[input.target].evaluate(el=>el.isConnected&&el.tagName==='INPUT'&&el.type==='file'))throw new Error('目标不是文件选择框');
    const file=input.file;
    if(!file||typeof file.path!=='string'||typeof file.name!=='string'||!Number.isSafeInteger(file.size)||file.size<0||file.size>5*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))throw new Error('上传文件资料无效');
    const prior=uploadRequests.find(item=>item.status==='pending');
    if(prior){if(prior.snapshot===observed&&prior.file.path===file.path&&prior.file.sha256===file.sha256)return {requestId:prior.id,pending:true};throw new Error('请先处理已有上传请求');}
    const request={id:randomUUID(),status:'pending',run,snapshot:observed,target:input.target,targetInfo:await fileTargetInfo(targets[input.target]),url:page.url(),tabId:pageIds.get(page),file,createdAt:Date.now(),expiresAt:Date.now()+5*60*1000};
    uploadRequests=[...uploadRequests.slice(-19),request];await persist();return {requestId:request.id,pending:true};
  }
  if (action === 'snapshot') {
    const source = page, version = revision;
    const nextTargets = await source.$$('button,a,input,textarea,select');
    const elements = await Promise.all(nextTargets.slice(0,100).map(async (element,index) => ({
      index, tag: await element.evaluate(el=>el.tagName), type:await element.getAttribute('type'), id:await element.getAttribute('id'), name:await element.getAttribute('name'),
      label: await element.evaluate(el=>(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0,120)),
    })));
    const content = (await source.locator('body').innerText()).slice(0, 8000);
    if (source !== page || version !== revision) throw new Error('页面已变化，请重新读取页面');
    targets = nextTargets;
    observed = `${run}:${version}:${randomUUID()}`;
    return { ...state(), snapshot: observed, text: content, elements };
  }
  if (actor === 'agent' && (!observed || input.snapshot !== observed)) throw new Error('页面已变化，请先重新读取页面');
  if (actor === 'human' && ['click','type','key','scroll'].includes(action) && (!framed || input.frame !== framed)) {
    throw new Error('画面已变化，请先刷新后再操作');
  }
  try {
    if (action === 'new_tab') {
      if (tabs.size >= maxTabs) throw new Error('最多同时打开8个标签页，请先关闭用完的页面');
      const url = input.url === undefined ? undefined : text(input.url, 2048);
      if (url && !await allowed(url)) throw new Error('此网站未获管理员允许，或指向内网地址');
      const created = await context.newPage();
      trackPage(created);
      page = created;
      tabError = undefined;
      if (url) await created.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    } else if (action === 'switch_tab' || action === 'close_tab') {
      const tab = typeof input.tab === 'string' ? tabs.get(input.tab) : undefined;
      if (!tab || tab.page.isClosed()) throw new Error('标签页不存在，请重新查看页面');
      if (action === 'switch_tab') {
        await tab.page.bringToFront();
        page = tab.page;
      } else {
        await tab.page.close({ runBeforeUnload: false });
        if (!page) await context.newPage();
      }
      tabError = undefined;
    } else if (action === 'demo' && actor === 'human') {
      await page.setContent('<html lang="zh"><meta charset="utf-8"><title>助手电脑练习页</title><body style="font:24px sans-serif;padding:40px"><h1>助手电脑练习页</h1><label>写一句话 <input aria-label="写一句话"></label><button onclick="document.querySelector(\'p\').textContent=document.querySelector(\'input\').value">展示文字</button><p>在这里练习人工接管与助手继续操作。</p><button onclick="const a=document.createElement(\'a\');a.href=window.URL.createObjectURL(new window.Blob([document.querySelector(\'p\').textContent],{type:\'text/plain;charset=utf-8\'}));a.download=\'浏览器成果.txt\';a.click()">下载成果</button><a href="about:blank" target="_blank">打开新页面</a><hr><label>选择文件 <input type="file" aria-label="选择文件" onchange="if(this.files[0])this.files[0].text().then(value=>document.querySelector(\'p\').textContent=\'网页读取：\'+value)"></label></body></html>');
    } else if (action === 'navigate') {
      const url=text(input.url,2048);
      if (!await allowed(url)) throw new Error('此网站未获管理员允许，或指向内网地址');
      try{
        const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:10000});
        if(response&&response.status()>=400)throw new Error(`网站返回 HTTP ${response.status()}，请稍后重试`);
      }catch(error){
        if(error.message.includes('ERR_NETWORK_CHANGED'))throw new Error('网络发生变化，页面连接已中断。请先查看画面，再重试打开网站。');
        if(error.name==='TimeoutError')throw new Error('网站加载超时。请先查看画面，再重试打开网站。');
        throw error;
      }
    } else if (action === 'click') {
      if (actor === 'agent') {
        if (!Number.isInteger(input.target) || input.target < 0 || input.target >= Math.min(targets.length,100)) throw new Error('目标无效');
        await targets[input.target].click();
      } else {
        if (![input.x,input.y].every(Number.isFinite) || input.x < 0 || input.x > 1100 || input.y < 0 || input.y > 700) throw new Error('坐标无效');
        await page.mouse.click(input.x,input.y);
      }
    } else if (action === 'type') {
      const value = text(input.text,4000);
      if (actor === 'agent') {
        if (!Number.isInteger(input.target) || input.target < 0 || input.target >= Math.min(targets.length,100)) throw new Error('目标无效');
        await targets[input.target].fill(value);
      } else await page.keyboard.insertText(value);
    } else if (action === 'key') {
      if (!['Enter','Tab','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(input.key)) throw new Error('按键无效');
      await page.keyboard.press(input.key);
    } else if (action === 'scroll') {
      if (!Number.isFinite(input.delta) || Math.abs(input.delta) > 1000) throw new Error('滚动距离无效');
      await page.mouse.wheel(0,input.delta);
    } else throw new Error('操作无效');
  } finally { changed(); await persist(); }
  return state();
}
createServer(async (req,res) => {
  res.setHeader('Content-Type','application/json');
  if(req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {res.writeHead(403);res.end('{}');return;}
  let body='';
  for await (const chunk of req) {body+=chunk;if(body.length>16000){res.writeHead(413);res.end('{}');return;}}
  let input;try{input=JSON.parse(body);}catch{res.writeHead(400);res.end('{}');return;}
  // Transfers and actions share one queue: a successful takeover means earlier actions have settled.
  const result = queue.then(()=>dispatch(input));queue=result.catch(()=>{});
  try{res.end(JSON.stringify({ok:true,value:await result}));}
  catch(error){res.end(JSON.stringify({ok:false,error:error.message}));}
}).listen(7788,'127.0.0.1');
