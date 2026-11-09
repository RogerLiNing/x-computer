import {lookup} from 'node:dns/promises';
import {createServer,request} from 'node:http';
import {connect,isIP} from 'node:net';

export function isPublicIPv4(address){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return a>0&&a<224&&![10,127].includes(a)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19))&&!(a===192&&b===0&&(c===0||c===2))&&!(a===192&&b===88&&c===99)&&!(a===198&&b===51&&c===100)&&!(a===203&&b===0&&c===113);
}
// Optional resolver for hosts using synthetic VPN DNS. TLS validation stays enabled.
export function createCloudflareResolver(fetchDNS=fetch){
 const cache=new Map();
 return async hostname=>{
  const cached=cache.get(hostname);if(cached&&cached.expires>Date.now())return cached.rows;
  let response;
  for(const endpoint of ['1.1.1.1','1.0.0.1']){
    try{response=await fetchDNS(`https://${endpoint}/dns-query?${new URLSearchParams({name:hostname,type:'A'})}`,{headers:{accept:'application/dns-json'},redirect:'error',signal:AbortSignal.timeout(3000)});if(response.ok)break;}catch{}
  }
  if(!response?.ok)throw new Error('公网域名解析失败，请检查加密DNS连通性');
  const body=await response.text();if(body.length>65536)throw new Error('域名解析响应过大');
  const result=JSON.parse(body);
  if(result.Status!==0||!Array.isArray(result.Answer))throw new Error('域名解析没有有效结果');
  const rows=result.Answer.filter(row=>row.type===1).map(row=>({address:row.data}));
  if(rows.length&&rows.every(row=>isPublicIPv4(row.address))){
    if(cache.size>=100)cache.delete(cache.keys().next().value);
    cache.set(hostname,{rows,expires:Date.now()+30000});
  }
  return rows;
 };
}
export function createBrowserPolicy(origins,resolve=lookup){
 if(!Array.isArray(origins))throw new Error('允许的网站列表无效');
 const allowed=new Set(origins.map(value=>{
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.origin!==value||url.username||url.password)throw new Error('请配置完整且无路径的网站来源');
  return value;
 }));
 const permits=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&allowed.has(url.origin);}catch{return false;}};
 return {
  permits,
  async resolve(value){
   if(!permits(value))throw new Error('此网站未获管理员允许');
   const url=new URL(value);const hostname=url.hostname;
   const rows=isIP(hostname)?[{address:hostname}]:await resolve(hostname,{all:true,family:4});
   if(!rows.length||!rows.every(row=>isPublicIPv4(row.address)))throw new Error('禁止连接内网或保留地址');
   return {address:rows[0].address,port:Number(url.port||(url.protocol==='https:'?443:80)),url};
  },
 };
}
const cleanHeaders=headers=>Object.fromEntries(Object.entries(headers).filter(([key])=>!['proxy-authorization','proxy-connection','connection','upgrade','host'].includes(key.toLowerCase())));

/** Resolve once and connect to that numeric address: DNS cannot change between validation and use. */
export async function startBrowserProxy(policy,port=0){
 let active=0;
 const proxy=createServer(async(req,res)=>{
  let upstream;active++;res.once('close',()=>{active--;});
  req.on('error',()=>upstream?.destroy());
  try{
   if(active>32)throw new Error('Too many connections');
   const target=await policy.resolve(req.url);
   if(req.destroyed||res.destroyed)return;
   if(target.url.protocol!=='http:')throw new Error('Use CONNECT for TLS');
   upstream=request({host:target.address,port:target.port,method:req.method,path:target.url.pathname+target.url.search,headers:{...cleanHeaders(req.headers),host:target.url.host}},remote=>{
    res.writeHead(remote.statusCode??502,cleanHeaders(remote.headers));remote.pipe(res);
   });
   upstream.setTimeout(15000,()=>upstream.destroy());
   upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
   res.on('close',()=>upstream.destroy());req.pipe(upstream);
  }catch{res.writeHead(403);res.end('This browser cannot access that destination.');}
 });
 proxy.on('connect',async(req,socket,head)=>{
  let upstream;active++;
  socket.on('error',()=>upstream?.destroy());
  socket.on('close',()=>{active--;upstream?.destroy();});
  try{
   if(active>32)throw new Error('Too many connections');
   // CONNECT carries only a host and port; paths, credentials and fragments are not destinations.
   if(!/^[a-zA-Z0-9.-]+:[0-9]{1,5}$/.test(req.url))throw new Error('Invalid tunnel');
   const target=await policy.resolve(`https://${req.url}`);
   if(socket.destroyed)return;
   upstream=connect({host:target.address,port:target.port});
   upstream.setTimeout(60000,()=>upstream.destroy());
   upstream.on('error',()=>socket.destroy());
   upstream.once('connect',()=>{
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
   });
   upstream.on('close',()=>socket.destroy());
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
 });
 proxy.on('clientError',(_error,socket)=>socket.destroy());
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(port,'127.0.0.1',resolve);});
 return {server:proxy,url:`http://127.0.0.1:${proxy.address().port}`};
}
