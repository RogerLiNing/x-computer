import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../frontend/tailwind.config.js';

// Component acceptance only: no account, model, database or external website is used.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=await mkdtemp(path.join(os.tmpdir(),'x-first-use-ui-'));
const out=await mkdtemp(path.join(os.tmpdir(),'x-first-use-evidence-'));await mkdir(path.join(fixture,'public'));
await writeFile(path.join(fixture,'main.tsx'),`
import React,{useRef,useState} from 'react';import{createRoot}from'react-dom/client';
import i18n from '${root}frontend/src/i18n';
import{OnboardingOverlay}from'${root}frontend/src/components/OnboardingOverlay';
import{QuickActions}from'${root}frontend/src/components/apps/ChatApp/components/QuickActions';
import{appendChatExample}from'${root}frontend/src/utils/appendChatExample';
import{useDesktopStore}from'${root}frontend/src/store/desktopStore';
import '${root}frontend/src/styles/global.css';
const user=new URL(location.href).searchParams.get('user')||'first-use-fixture';localStorage.setItem('x-computer-user-id',user);await i18n.changeLanguage('zh-CN');
if(new URL(location.href).searchParams.has('existing')){useDesktopStore.getState().openApp('chat');useDesktopStore.getState().openApp('settings');}
function Harness(){const[draft,setDraft]=useState('我还没写完'),[sent,setSent]=useState(0),input=useRef(null),windows=useDesktopStore(state=>state.windows);
return <main className="h-dvh overflow-auto bg-desktop-bg p-4 text-desktop-text"><div className="mx-auto max-w-2xl space-y-4">
<button id="opener" autoFocus>测试页面入口</button><OnboardingOverlay/>
<QuickActions onSetInput={value=>setDraft(current=>appendChatExample(current,value))} onFocusInput={()=>input.current?.focus()}/>
<textarea ref={input} aria-label="试写一句话" value={draft} onChange={event=>setDraft(event.target.value)} className="w-full min-h-24 bg-desktop-window p-3"/>
<button onClick={()=>setSent(value=>value+1)}>发送</button><output data-testid="sent">{sent}</output><output data-testid="windows">{windows.length}</output><output data-testid="focused-app">{windows.find(window=>window.isFocused)?.appId??''}</output>
</div></main>;}
createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);
`,{mode:0o600});
const server=await createServer({configFile:false,root:path.join(root,'frontend'),plugins:[react(),{name:'first-use-owned-fixture',configureServer(server){server.middlewares.use('/__first_use',async(req,res)=>{
 const html=await server.transformIndexHtml('/__first_use','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>首次使用组件验收</title><div id="root"></div><script type="module" src="/@fs'+path.join(fixture,'main.tsx')+'"></script></html>');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});}}],css:{postcss:{plugins:[tailwindcss({...tailwindConfig,content:[path.join(root,'frontend/src/**/*.{ts,tsx}'),path.join(fixture,'main.tsx')]})]}},resolve:{alias:{'@':path.join(root,'frontend/src'),'@shared':path.join(root,'shared/src')},dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:0,fs:{allow:[root,fixture]}}});
let browser;
try{
 await server.listen();const address=server.httpServer.address(),origin=`http://127.0.0.1:${address.port}`;
 const fixtureOnly=route=>{const url=new URL(route.request().url());return url.origin===origin&&!url.pathname.startsWith('/api/')?route.continue():route.abort();};
 browser=await chromium.launch({headless:true,...(process.env.FIRST_USE_CHROME_PATH?{executablePath:process.env.FIRST_USE_CHROME_PATH}:{}),args:['--disable-background-networking']});
 const scenarios=[];
 for(const [name,width,height,scale=1]of[['desktop',1200,900],['mobile',320,640],['short-screen',320,360],['large-text',640,720,2]]){
  const context=await browser.newContext({viewport:{width,height},locale:'zh-CN'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',fixtureOnly);
  await page.goto(origin+'/__first_use');const dialog=page.getByRole('dialog',{name:'你好，我是 X'});await dialog.waitFor();
  if(scale!==1)await page.addStyleTag({content:`html{font-size:${scale*100}% !important}`});
  const geometry=await dialog.evaluate(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,scrollTop:element.scrollTop}));
  assert.ok(geometry.left>=0&&geometry.right<=width);assert.ok(geometry.scrollWidth<=geometry.clientWidth);assert.equal(geometry.scrollTop,0);
  assert.equal(await dialog.evaluate(element=>getComputedStyle(element).borderTopLeftRadius),`${16*scale}px`);
  for(const button of await dialog.getByRole('button').all()){const bounds=await button.boundingBox();assert.ok(bounds.width>=44&&bounds.height>=44);}
  const contrast=await page.getByRole('button',{name:'去说第一件事',exact:true}).evaluate(element=>{
    const style=getComputedStyle(element),light=value=>{const parts=value.match(/[\d.]+/g).slice(0,3).map(Number).map(channel=>{channel/=255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;});return parts[0]*0.2126+parts[1]*0.7152+parts[2]*0.0722;};
    const one=light(style.color),two=light(style.backgroundColor);return(Math.max(one,two)+0.05)/(Math.min(one,two)+0.05);
  });assert.ok(contrast>=4.5);
  await page.screenshot({path:path.join(out,`${name}-guide.png`)});
  for(let tab=0;tab<6;tab++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),true);}
  for(let tab=0;tab<6;tab++){await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),true);}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.locator('#opener').evaluate(element=>document.activeElement===element),true);
  await page.reload();await page.getByRole('button',{name:'帮我写一写',exact:false}).waitFor();assert.equal(await dialog.isVisible(),false);
  await page.getByRole('button',{name:'帮我写一写',exact:false}).click();const draft=await page.getByLabel('试写一句话').inputValue();
  assert.ok(draft.startsWith('我还没写完\n\n'));assert.ok(draft.includes('小兔子去月球.md'));assert.equal(await page.getByTestId('sent').textContent(),'0');
  assert.equal(await page.getByLabel('试写一句话').evaluate(element=>document.activeElement===element),true);
  await page.goto(origin+'/__first_use?user=different-fixture-user');await dialog.waitFor();await page.getByRole('button',{name:'去说第一件事',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await page.getByTestId('windows').textContent(),width<640?'0':'1');
  assert.deepEqual(errors,[]);scenarios.push({name,viewport:{width,height},textScale:scale,primaryContrast:contrast,guideFits:true,nativeFocusContained:true,escapeRestoresFocus:true,perUserGuide:true,draftPreserved:true,selectionDoesNotSend:true});await context.close();
 }
 const context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage();
 await page.route('**/*',fixtureOnly);await page.goto(origin+'/__first_use?user=existing-window-fixture&existing=1');
 await page.getByRole('dialog').waitFor();assert.equal(await page.getByTestId('focused-app').textContent(),'settings');
 await page.getByRole('button',{name:'去说第一件事',exact:true}).click();assert.equal(await page.getByTestId('windows').textContent(),'2');assert.equal(await page.getByTestId('focused-app').textContent(),'chat');await context.close();
 const evidence={success:true,scenarios,existingChatFocusedWithoutDuplicate:true,isolatedBrowserProfile:true,componentAcceptanceOnly:true,fullSignupAndDeliveryVerified:false,modelCalled:false,databaseAccessed:false,originalMysqlAccessed:false};
 await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify({success:true,evidence:path.join(out,'evidence.json')}));
}finally{await browser?.close();await server.close();}
