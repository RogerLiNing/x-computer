import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';import os from 'node:os';import http from 'node:http';
import express from 'express';import nodemailer from 'nodemailer';
import {createServer} from 'vite';import react from '@vitejs/plugin-react';import tailwindcss from 'tailwindcss';import tailwindConfig from '../frontend/tailwind.config.js';
import {SqliteAppDatabase,SqliteDatabaseAdapter} from '../server/dist/server/src/db/database.js';
import {SessionAuth} from '../server/dist/server/src/auth/sessionAuth.js';
import {hashPassword} from '../server/dist/server/src/auth/password.js';
import {createAuthRouter} from '../server/dist/server/src/routes/auth.js';
import {createAuthEnhancedRoutes} from '../server/dist/server/src/routes/authEnhanced.js';
import {createUserRouter} from '../server/dist/server/src/routes/user.js';
import {userContextMiddleware} from '../server/dist/server/src/middleware/userContext.js';
import {clearDefaultConfigCache} from '../server/dist/server/src/config/defaultConfig.js';

const repository=fileURLToPath(new URL('../',import.meta.url)),root=await mkdtemp(path.join(os.tmpdir(),'x-reset-browser-')),out=await mkdtemp(path.join(os.tmpdir(),'x-reset-evidence-'));
const configPath=path.join(root,'config.private.json'),config={database:{type:'sqlite'},auth:{allowRegister:false,allowAnonymous:false},email:{smtp:{host:'fixture.invalid',user:'fixture',pass:'fixture-only'}}};
await writeFile(configPath,JSON.stringify(config),{mode:0o600});process.env.X_COMPUTER_CONFIG_PATH=configPath;process.env.DATABASE_TYPE='sqlite';process.env.NODE_ENV='test';clearDefaultConfigCache();
// Deliberate in-memory mail transport: no DNS, SMTP connection or external message is sent.
const mailbox=[],originalTransport=nodemailer.createTransport;
nodemailer.createTransport=()=>({sendMail:async options=>{mailbox.push({subject:options.subject,text:options.text});return{messageId:'local-fixture'};}});
const native=new SqliteAppDatabase(root),db=new SqliteDatabaseAdapter(native),sessions=new SessionAuth(db),uid='password-reset-browser',email='reset-browser@example.test',newPassword='New-Local-Fixture-Password';
await db.ensureUser(uid);await db.createAuthAccount(email,await hashPassword('Old-Local-Fixture-Password'),uid);const oldCookie=await sessions.createCookie(uid);
const app=express();app.locals.sessions=sessions;app.use(express.json());app.use(userContextMiddleware(false));app.use('/api/auth',createAuthRouter(db,undefined));app.use('/api/auth',createAuthEnhancedRoutes(db,undefined,sessions));app.use('/api/users',createUserRouter(db));
const backend=http.createServer(app);let vite,browser,resetSecret='';
try{
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));const backendOrigin=`http://127.0.0.1:${backend.address().port}`;
 await mkdir(path.join(root,'fixture'));
 await writeFile(path.join(root,'fixture/main.tsx'),`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import i18n from '${repository}frontend/src/i18n';import{LoginScreen}from'${repository}frontend/src/components/auth/LoginScreen';import '${repository}frontend/src/styles/global.css';await i18n.changeLanguage('zh-CN');function Fixture(){const[done,setDone]=useState(false);return done?<p role="status">测试账号已登录</p>:<LoginScreen onLoggedIn={()=>setDone(true)}/>;}createRoot(document.getElementById('root')).render(<Fixture/>);`,{mode:0o600});
 vite=await createServer({configFile:false,root:path.join(repository,'frontend'),plugins:[react(),{name:'owned-reset-fixture',configureServer(server){server.middlewares.use('/__reset',async(_req,res)=>{const html=await server.transformIndexHtml('/__reset','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@fs'+path.join(root,'fixture/main.tsx')+'"></script></html>');res.setHeader('Content-Type','text/html');res.end(html);});}}],css:{postcss:{plugins:[tailwindcss({...tailwindConfig,content:[path.join(repository,'frontend/src/**/*.{ts,tsx}'),path.join(root,'fixture/main.tsx')]})]}},resolve:{alias:{'@':path.join(repository,'frontend/src'),'@shared':path.join(repository,'shared/src')},dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:0,fs:{allow:[repository,root]},proxy:{'/api':{target:backendOrigin,changeOrigin:true}}}});
 await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
 const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');browser=await chromium.launch({headless:true,...(process.env.FIRST_USE_CHROME_PATH?{executablePath:process.env.FIRST_USE_CHROME_PATH}:{}),args:['--disable-background-networking']});
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'}),page=await context.newPage();context.setDefaultTimeout(5000);await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin+'/__reset');
 await page.getByRole('button',{name:'忘记密码？',exact:true}).click();await page.getByPlaceholder('邮箱',{exact:true}).fill(email);
 const requested=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/request-password-reset');await page.getByRole('button',{name:'发送验证码',exact:true}).click();const requestedResponse=await requested;assert.equal(requestedResponse.status(),200);const requestBody=await requestedResponse.json();
 const resetToken=mailbox.find(message=>message.subject.includes('重置码'))?.text.split('\n\n')[1];assert.ok(/^[\w-]{32}$/.test(resetToken));resetSecret=resetToken;assert.equal(requestBody.code,undefined);assert.ok(!JSON.stringify(requestBody).includes(resetToken));
 await page.getByPlaceholder('粘贴邮件中的完整重置码',{exact:true}).fill(resetToken);assert.equal(await page.getByPlaceholder('粘贴邮件中的完整重置码',{exact:true}).inputValue(),resetToken);
 await page.getByPlaceholder('新密码（至少 8 个字符）',{exact:true}).fill(newPassword);await page.getByPlaceholder('确认新密码',{exact:true}).fill(newPassword);
 const resetResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/reset-password');await page.getByRole('button',{name:'重置密码',exact:true}).click();const resetReply=await resetResponse;assert.equal(resetReply.status(),200);assert.equal(resetReply.headers()['set-cookie'],undefined);assert.equal((await context.request.get(origin+'/api/users/me')).status(),401);
 const stale=await fetch(backendOrigin+'/api/users/me',{headers:{Cookie:oldCookie}});assert.equal(stale.status,401);
 await page.locator('form').waitFor();await page.locator('form input[type=email]').fill(email);await page.locator('form input[type=password]').fill(newPassword);
 const question=await page.locator('form').getByText(/\d+\s+\+\s+\d+\s+=\s+\?/).innerText(),parts=question.match(/(\d+)\s+\+\s+(\d+)/);await page.getByPlaceholder('?',{exact:true}).fill(String(Number(parts[1])+Number(parts[2])));
 await page.locator('form').getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('status').filter({hasText:'测试账号已登录'}).waitFor();assert.equal((await context.request.get(origin+'/api/users/me')).status(),200);await page.screenshot({path:path.join(out,'reset-and-login.png')});
 await writeFile(configPath,JSON.stringify({database:{type:'sqlite'},auth:{allowRegister:false,allowAnonymous:false}}));clearDefaultConfigCache();
 const unavailable=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'}),disabled=await unavailable.newPage();unavailable.setDefaultTimeout(5000);await disabled.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const settingsReply=disabled.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/settings');await disabled.goto(origin+'/__reset');assert.equal((await(await settingsReply).json()).passwordResetAvailable,false);await disabled.getByRole('button',{name:'忘记密码？',exact:true}).click();await disabled.getByRole('status').filter({hasText:'暂时无法通过邮件找回'}).waitFor();assert.equal(await disabled.getByRole('button',{name:'发送验证码',exact:true}).isDisabled(),true);await disabled.screenshot({path:path.join(out,'mail-unavailable.png')});
 await writeFile(path.join(out,'evidence.json'),JSON.stringify({success:true,root,realLoginComponent:true,realAuthHttpRoutes:true,database:'isolated SQLite',mailTransport:'deliberately captured in memory',externalMailSent:false,tokenLength:resetToken.length,tokenNotReturnedInHttp:true,alphanumericTokenPreserved:true,passwordResetThroughUi:true,normalLoginAfterReset:true,oldCookieRejected:true,mailUnavailableStateVerified:true,modelCalled:false,originalMysqlAccessed:false,memoryManagementChanged:false},null,2),{mode:0o600});console.log(JSON.stringify({success:true,evidence:path.join(out,'evidence.json')}));
}catch(error){let detail=String(error.stack??error).replaceAll(newPassword,'[REDACTED_SECRET]').replaceAll(oldCookie,'[REDACTED_SECRET]');if(resetSecret)detail=detail.replaceAll(resetSecret,'[REDACTED_SECRET]');await writeFile(path.join(out,'failure.json'),JSON.stringify({success:false,error:detail}),{mode:0o600});console.error(JSON.stringify({success:false,errorName:error.name,evidence:path.join(out,'failure.json')}));process.exitCode=1;}
finally{await browser?.close();await vite?.close();await new Promise(resolve=>backend.close(resolve));nodemailer.createTransport=originalTransport;native.close();}
