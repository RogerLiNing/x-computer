import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { McpExecutionContext } from './types.js';

export function publicMcpAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return a > 0 && a < 224 && ![10,127].includes(a) && !(a===169&&b===254) && !(a===172&&b>=16&&b<=31) &&
    !(a===192&&b===168) && !(a===100&&b>=64&&b<=127) && !(a===198&&(b===18||b===19)) &&
    !(a===192&&b===0&&(c===0||c===2)) && !(a===192&&b===88&&c===99) && !(a===198&&b===51&&c===100) && !(a===203&&b===0&&c===113);
}

export async function boundedHttpRequest(url: string, headers: Record<string,string>, body: string, context?: Partial<McpExecutionContext> & { method?: 'GET' | 'POST'; allowHttpsProxyFakeIp?: boolean }): Promise<{ status:number; text:string; contentType:string }> {
  const target = new URL(url);
  if (!['http:','https:'].includes(target.protocol) || target.username || target.password) throw new Error('扩展地址必须是无账号密码的 HTTP(S) 地址');
  const hostname = target.hostname.replace(/^\[|\]$/g,'');
  if (!context?.trustedServer && isIP(hostname) && !publicMcpAddress(hostname)) throw new Error('用户扩展不能连接内网或保留地址');
  // A caller can opt a fixed HTTPS endpoint into OS proxy routing without allowing private addresses.
  const allowProxyFakeIp = context?.allowHttpsProxyFakeIp && target.protocol === 'https:' && !isIP(hostname);
  const allowedAddress = (address: string) => publicMcpAddress(address)
    || (allowProxyFakeIp && isIP(address) === 4 && /^198\.(18|19)\./.test(address));
  if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('扩展请求过大');
  context?.signal?.throwIfAborted();
  return new Promise((resolve,reject) => {
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method:context?.method ?? 'POST',headers,signal:context?.signal,
      ...(!context?.trustedServer ? { lookup: (name: string, options: { all?: boolean }, callback: (...args:any[])=>void) => {
        // Validation and the socket use the same numeric address; there is no second DNS lookup.
        void lookup(name,{all:true,family:4}).then(rows=>{
          if (!rows.length || !rows.every(row=>allowedAddress(row.address))) throw new Error('禁止访问内网地址');
          if(options?.all)callback(null,[{address:rows[0].address,family:4}]);else callback(null,rows[0].address,4);
        }).catch(()=>callback(new Error('用户扩展不能连接内网或保留地址')));
      }} : {}),
    }, response => {
      const chunks:Buffer[]=[]; let size=0;
      response.on('data',(chunk:Buffer)=>{
        size+=chunk.length;
        if (size>4*1024*1024) { request.destroy(new Error('扩展响应过大')); return; }
        chunks.push(chunk);
      });
      response.on('error',()=>reject(new Error('扩展连接中断')));
      response.on('end',()=>resolve({status:response.statusCode??500,text:Buffer.concat(chunks).toString('utf8'),contentType:String(response.headers['content-type']??'')}));
    });
    request.on('error',()=>reject(new Error('扩展连接失败或已停止')));
    const timer=setTimeout(()=>request.destroy(new Error('扩展请求超时')),context?.timeoutMs??20000);
    request.once('close',()=>clearTimeout(timer));
    request.end(body);
  });
}
export const mcpHttpRequest = boundedHttpRequest;
