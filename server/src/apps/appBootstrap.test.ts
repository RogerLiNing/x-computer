import {describe,it,expect,vi} from 'vitest';import vm from 'node:vm';
import {injectAppBootstrap} from './appBootstrap.js';
describe('self-contained generated app runtime',()=>{
 it('maps restored source URLs to the copy runtime without granting original-app access',async()=>{
  const source=injectAppBootstrap('<body/>','copy',{},'view','original').match(/<script>([\s\S]*?)<\/script>/)![1];
  const window:Record<string,any>={};const fetch=vi.fn(async(_url:string,_init?:RequestInit)=>({ok:true,json:async()=>({status:200,raw:'"copy-data"'})}));
  vm.runInNewContext(source,{window,fetch,URL,Headers,Request,Response,location:{href:'https://x.example/api/apps/preview/alice/token/index.html'},parent:{postMessage(){}},addEventListener(){}});
  expect(await (await window.fetch('/api/x-apps/backend/kv/original?key=count')).json()).toBe('copy-data');
  expect(fetch.mock.calls[0][0]).toBe('https://x.example/api/apps/preview/alice/token/__runtime');
  expect(JSON.parse((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body as string).args.appId).toBeUndefined();
  await expect(window.fetch('/api/x-apps/backend/kv/other?key=count')).rejects.toThrow('其他应用');
 });
 it('initializes storage without relying on server/module helpers',()=>{
  const html=injectAppBootstrap('<!doctype html><body></body>','counter',{count:'3'});
  const source=html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const window:Record<string,any>={};
  vm.runInNewContext(source,{window,fetch:()=>{},URL,location:{href:'https://x.example/api/apps/preview/alice/token/index.html'},parent:{postMessage(){}},addEventListener(){}});
  expect(window.localStorage.getItem('count')).toBe('3');expect(window.sessionStorage.getItem('count')).toBeNull();
 });
 it('escapes stored values before placing them in the bootstrap script',()=>{
  const html=injectAppBootstrap('<body>safe</body>','counter',{value:'</script><script>bad()</script>'});
  expect(html.match(/<script>/g)).toHaveLength(1);expect(html).toContain('\\u003c');
 });
 it('updates only the app-local storage cache for peer window events',()=>{
  const source=injectAppBootstrap('<body/>','counter',{count:'3'},'this-view').match(/<script>([\s\S]*?)<\/script>/)![1];
  const window:Record<string,any>={};const parent={postMessage(){}};const handlers:((event:any)=>void)[]=[];const events:any[]=[];
  vm.runInNewContext(source,{window,parent,fetch(){},URL,location:{href:'https://x.example/api/apps/preview/alice/token/index.html'},addEventListener:(name:string,fn:(event:any)=>void)=>{if(name==='message')handlers.push(fn);},StorageEvent:class{constructor(type:string,props:object){Object.assign(this,{type},props);}},dispatchEvent:(event:any)=>events.push(event)});
  const send=(from:object,source:string,value:string)=>handlers.forEach(handler=>handler({source:from,data:{type:'x_app_channel',data:{type:'x_storage_change',source,key:'count',value}}}));
  send({},'peer','4');expect(window.localStorage.getItem('count')).toBe('3');
  send(parent,'peer','4');expect(window.localStorage.getItem('count')).toBe('4');expect(events[0].key).toBe('count');
  send(parent,'this-view','5');expect(window.localStorage.getItem('count')).toBe('4');expect(window.sessionStorage.getItem('count')).toBeNull();
 });
});
