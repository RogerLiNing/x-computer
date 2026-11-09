/** This function is serialized into the opaque preview; it closes over no server state. */
function bootstrap(appId:string|null,initial:Record<string,string>,source:string,sourceAppId?:string){
  let receiveStorage=(key:string,value:string|null)=>{};
  const nativeFetch=fetch.bind(window);
  const root=location.href.match(/^(.*\/api\/apps\/preview\/[\w-]+\/[\w-]+\/)/)?.[1]??location.href;
  const runtime=new URL('__runtime',root).href;
  const call=async(op:string,args:unknown={})=>{
    const response=await nativeFetch(runtime,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,args})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'应用请求未完成');return result;
  };
  const makeStorage=(seed:Record<string,string>,persistent:boolean)=>{
    const values=Object.assign(Object.create(null),seed);
    if(persistent)receiveStorage=(key,value)=>{
      const oldValue=values[key]??null;if(oldValue===value)return;
      if(value===null)delete values[key];else values[key]=value;
      const event=new StorageEvent('storage',{key,newValue:value,oldValue,url:new URL('/app#'+appId,location.href).href});
      Object.defineProperty(event,'storageArea',{value:window.localStorage});dispatchEvent(event);
    };
    const persist=(op:string,args:unknown)=>{
      if(!persistent)return;
      const request=new XMLHttpRequest();request.open('POST',runtime,false);request.setRequestHeader('Content-Type','application/json');request.send(JSON.stringify({op,args}));
      if(request.status!==200)throw new Error('存档尚未保存，请稍后重试');
    };
    const storage={getItem:(key:string)=>Object.hasOwn(values,String(key))?values[String(key)]:null,
      setItem:(key:string,value:string)=>{key=String(key);value=String(value);persist('storage.set',{key,value});values[key]=value;},
      removeItem:(key:string)=>{key=String(key);persist('storage.remove',{key});delete values[key];},
      clear:()=>{for(const key of Object.keys(values))storage.removeItem(key);},key:(index:number)=>Object.keys(values)[index]??null,
      get length(){return Object.keys(values).length;}};
    return storage;
  };
  Object.defineProperty(window,'localStorage',{value:makeStorage(initial,!!appId)});
  Object.defineProperty(window,'sessionStorage',{value:makeStorage({},false)});
  addEventListener('message',event=>{
    const change=event.data?.data;
    if(event.source===parent&&event.data?.type==='x_app_channel'&&change?.type==='x_storage_change'&&change.source!==source&&typeof change.key==='string'&&(typeof change.value==='string'||change.value===null))receiveStorage(change.key,change.value);
  });
  const report=(message:string)=>{if(appId)void call('log',{message}).catch(()=>{});};
  window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    const match=url.pathname.match(/^\/api\/x-apps\/backend\/(kv|queue)\/([^/]+)(.*)$/);
    if(match){
      if(url.origin!==new URL(location.href).origin)throw new Error('应用数据地址无效');
      const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
      const shared=new Headers(init?.headers??(input instanceof Request?input.headers:undefined)).get('X-App-Read-Token');
      if(shared&&method==='GET'&&match[1]==='kv'&&match[3]===''){
        const result=await call('public.read',{appId:decodeURIComponent(match[2]),token:shared,key:url.searchParams.get('key'),prefix:url.searchParams.get('prefix')});
        return new Response(result.raw??JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':'application/json'}});
      }
      if(!appId||(decodeURIComponent(match[2])!==appId&&decodeURIComponent(match[2])!==sourceAppId))throw new Error('不能访问其他应用的数据');
      const raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
      let body:unknown={};try{body=raw?JSON.parse(raw):{};}catch{throw new Error('应用请求格式无效');}
      const result=await call('backend',{kind:match[1],suffix:match[3],method,key:url.searchParams.get('key'),prefix:url.searchParams.get('prefix'),body});
      return new Response(result.raw??JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':'application/json'}});
    }
    return nativeFetch(input,{...init,credentials:'omit'});
  };
  (window as any).xComputer={request:call};
  addEventListener('error',event=>report(String(event.message??'应用运行出错')));
  addEventListener('unhandledrejection',event=>report(String(event.reason?.message??event.reason??'应用请求失败')));
  const resize=()=>parent.postMessage({type:'x_render_height',height:Math.min(720,Math.max(120,document.body?.scrollHeight??320))},'*');
  addEventListener('load',()=>{resize();new ResizeObserver(resize).observe(document.body);});
}
const json=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c');
export function injectAppBootstrap(html:string,appId:string|null,initial:Record<string,string>,source='',sourceAppId?:string):string{
  // tsx may retain function names through this helper; the serialized runtime has no module closure.
  const script=`<script>const __name=(value,name)=>{Object.defineProperty(value,'name',{value:name,configurable:true});return value;};(${bootstrap.toString()})(${json(appId)},${json(initial)},${json(source)},${json(sourceAppId??null)});</script>`;
  const doctype=html.match(/^\s*<!doctype[^>]*>/i)?.[0]??'';
  return doctype+script+html.slice(doctype.length);
}
