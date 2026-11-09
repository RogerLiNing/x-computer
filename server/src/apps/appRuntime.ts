import type { AppDatabase } from '../db/database.js';
import type { MiniAppLogStore } from '../miniAppLogStore.js';
import { APP_STORAGE_PREFIX, PreviewService } from './PreviewService.js';
import { broadcastToAppChannel } from '../wsBroadcast.js';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const key=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>255)throw new Error('数据名称无效');return value;};
export async function appRuntime(db:AppDatabase,previews:PreviewService,logs:MiniAppLogStore|undefined,userId:string,appId:string,op:string,input:unknown,source=''){
  await previews.readAppAsset(userId,appId,'index.html');
  const args=object(input);
  if(op==='public.read'){
    const target=key(args.appId);const token=key(args.token);const owner=await db.resolveAppPublicReadToken(token,target);
    if(target.startsWith('@'))throw new Error('共享授权不包含内部存档');
    if(!owner)throw new Error('共享授权无效');
    if(args.key!=null&&args.key!==''){const name=key(args.key);if(name.startsWith(APP_STORAGE_PREFIX))throw new Error('共享授权不包含浏览器存档');const value=await db.appBackendKvGet(owner,target,name);return value===undefined?{status:404,body:{error:'数据不存在'}}:{status:200,raw:value};}
    return {status:200,body:{keys:(await db.appBackendKvList(owner,target,typeof args.prefix==='string'?args.prefix:undefined)).filter(name=>!name.startsWith(APP_STORAGE_PREFIX))}};
  }
  if(op==='log'){logs?.append(userId,appId,{level:'error',message:String(args.message??'应用运行出错').replace(/\/api\/apps\/preview\/[^/]+\/[^/]+\//g,'/api/apps/preview/[scoped]/').slice(0,2000)});return {ok:true};}
  if(op==='storage.set'||op==='storage.remove'){
    const value=op==='storage.remove'?null:args.value;await previews.store(userId,appId,args.key,value);
    broadcastToAppChannel(userId,appId,{type:'x_storage_change',source,key:args.key,value});return {ok:true};
  }
  if(op!=='backend')throw new Error('应用没有这项权限');
  const method=String(args.method??'GET');const body=object(args.body);const missing={status:404,body:{error:'数据不存在'}};
  if(args.kind==='kv'&&args.suffix===''){
    const name=args.key==null||args.key===''?undefined:key(args.key);
    if(method==='GET'){
      if(!name)return {status:200,body:{keys:await db.appBackendKvList(userId,appId,typeof args.prefix==='string'?args.prefix:undefined)}};
      const value=await db.appBackendKvGet(userId,appId,name);if(value===undefined)return missing;
      return {status:200,raw:value};
    }
    const selected=name??key(body.key);
    if(method==='PUT'){
      const value=Object.hasOwn(body,'value')?body.value:body;const raw=typeof value==='string'?value:JSON.stringify(value);
      if(Buffer.byteLength(raw)>65536)throw new Error('应用数据过大');
      const keys=await db.appBackendKvList(userId,appId);if(keys.length>=256&&!keys.includes(selected))throw new Error('应用数据数量已达到上限');
      await db.appBackendKvSet(userId,appId,selected,raw);return {status:200,body:{ok:true}};
    }
    if(method==='DELETE'){await db.appBackendKvDelete(userId,appId,selected);return {status:200,body:{ok:true}};}
  }
  if(args.kind==='queue'&&typeof args.suffix==='string'){
    const match=args.suffix.match(/^\/([\w-]{1,128})\/(push|pop|len)$/);if(!match)throw new Error('队列请求无效');
    const [,queue,action]=match;
    if(action==='push'&&method==='POST'){
      const value=body.payload??body;const raw=typeof value==='string'?value:JSON.stringify(value);if(Buffer.byteLength(raw)>65536)throw new Error('队列消息过大');
      const size=await db.queryOne<{count:number}>('SELECT COUNT(*) AS count FROM app_backend_queue WHERE user_id=? AND app_id=?',[userId,appId]);if((size?.count??0)>=256)throw new Error('应用队列已满');
      await db.appBackendQueuePush(userId,appId,queue,raw);return {status:200,body:{ok:true}};
    }
    if(action==='pop'&&method==='GET'){const payload=await db.appBackendQueuePop(userId,appId,queue);return payload===null?missing:{status:200,body:{payload}};}
    if(action==='len'&&method==='GET')return {status:200,body:{length:await db.appBackendQueueLen(userId,appId,queue)}};
  }
  throw new Error('应用没有这项权限');
}
