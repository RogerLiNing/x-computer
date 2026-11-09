import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{mkdir,readFile,writeFile}from'node:fs/promises';import path from'node:path';import http from'node:http';
import{SqliteAppDatabase,SqliteDatabaseAdapter}from'../server/dist/server/src/db/database.js';
const root='/tmp/x-computer-browser-isolated-20261030',user='acceptance-20261030';
assert.equal(JSON.parse(await readFile('/tmp/x-computer-browser-config-20261030.json','utf8')).database?.type,'sqlite');
let hits=0;const sink=http.createServer((req,res)=>{if(req.url==='/count'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({hits}));return;}hits++;res.end('synthetic navigation probe');});
await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));const trap=`http://127.0.0.1:${sink.address().port}/probe`;
const sqlite=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(sqlite);const nonce=randomUUID().slice(0,8);const id=`preview-audit-${nonce}`;const other=`preview-other-${nonce}`;
try{
 assert.ok(await db.getUser(user));const dir=path.join(root,'users',user,'workspace/apps',id);await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'index.html'),'<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="style.css"></head><body><h1>隔离预览验收</h1><p>存档次数：<output id="count"></output></p><button id="inc">增加一次</button><button id="check">检查隔离</button><button id="backend">验证应用数据</button><button id="nav">测试导航限制</button><pre id="result">等待检查</pre><script src="app.js"></script></body></html>');
 await writeFile(path.join(dir,'style.css'),'body{font:18px system-ui;padding:24px;background:#edf7f3;color:#173f34}button{font-size:18px;margin:6px;padding:12px;border-radius:10px}pre{white-space:pre-wrap}');
 const code=`let count=Number(localStorage.getItem('count')||0);document.getElementById('count').textContent=count;document.getElementById('inc').onclick=()=>{localStorage.setItem('count',String(++count));document.getElementById('count').textContent=count;};document.getElementById('check').onclick=async()=>{let parentBlocked=false,accountBlocked=false,otherBlocked=false;try{top.document.body.dataset.previewEscape='bad'}catch{parentBlocked=true}try{const r=await fetch('/api/users/me/config');accountBlocked=!r.ok}catch{accountBlocked=true}try{const r=await fetch('/api/x-apps/backend/kv/${other}?key=secret');otherBlocked=!r.ok}catch{otherBlocked=true}document.getElementById('result').textContent=JSON.stringify({parentBlocked,accountBlocked,otherBlocked},null,2);};document.getElementById('backend').onclick=async()=>{await fetch('/api/x-apps/backend/kv/${id}?key=check',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:{saved:'应用自己的数据'}})});const data=await(await fetch('/api/x-apps/backend/kv/${id}?key=check')).json();document.getElementById('result').textContent=data.saved;};document.getElementById('nav').onclick=()=>{location.href=${JSON.stringify(trap)};};`;
 await writeFile(path.join(dir,'app.js'),code);await db.appBackendKvSet(user,other,'secret','"synthetic-other-app"');
 const raw=await db.getConfig(user,'x_mini_apps');const apps=raw?JSON.parse(raw):[];assert.ok(Array.isArray(apps));apps.push({id,name:'隔离预览验收',path:`apps/${id}`});await db.setConfig(user,'x_mini_apps',JSON.stringify(apps));
 const session=await db.createSession(user,'交互内容隔离验收','normal_chat');
 await db.addMessage(session.id,'user','请显示可点击的计数器。');
 await db.addMessage(session.id,'assistant','```jsx\nexport default function Message(){const [n,setN]=React.useState(0);return <section><h2>交互内容隔离验收</h2><button onClick={()=>setN(n+1)}>React 计数 {n}</button></section>}\n```');
 const report={appId:id,otherAppId:other,sessionId:session.id,trapCount:`http://127.0.0.1:${sink.address().port}/count`,synthetic:true};
 const out='/Users/rogerlee/.codex/outputs/x-computer-app-isolation-20261031';await mkdir(out,{recursive:true});await writeFile(path.join(out,'fixture.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');
}finally{sqlite.close();}
process.on('SIGINT',()=>sink.close(()=>process.exit(0)));process.on('SIGTERM',()=>sink.close(()=>process.exit(0)));
