import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { listTools, callTool } from './client.js';
import { publicMcpAddress } from './httpTransport.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

describe('MCP transport trust boundaries', () => {
  const servers:http.Server[]=[];
  afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));});
  async function fixture(handler:(body:any,res:http.ServerResponse)=>void){
    const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>handler(JSON.parse(body),res));});servers.push(server);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  it('rejects private, metadata, fake-IP and non-HTTP targets before reaching a local server',async()=>{
    let hits=0;const url=await fixture((_body,res)=>{hits++;res.end('{}');});
    await expect(listTools({id:'user',url},{owner:'owner'})).rejects.toThrow();expect(hits).toBe(0);
    for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','198.18.1.1','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1'])expect(publicMcpAddress(address)).toBe(false);
    expect(publicMcpAddress('1.1.1.1')).toBe(true);
    await expect(listTools({id:'user',url:'file:///etc/passwd'},{owner:'owner'})).rejects.toThrow();
  });
  it('never resolves ambient host variables for a user-controlled server',async()=>{
    vi.stubEnv('MCP_HOST_SECRET','host-private-value');let hits=0;const url=await fixture((_body,res)=>{hits++;res.end('{}');});
    await expect(listTools({id:'user',url,headers:{Authorization:'${MCP_HOST_SECRET}'}},{owner:'owner'})).rejects.toThrow('未配置');
    expect(hits).toBe(0);
  });
  it('does not follow redirects or retry an uncertain tools/call',async()=>{
    let calls=0;const url=await fixture((body,res)=>{
      if(body.method==='tools/list'){res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{tools:[]}}));return;}
      calls++;res.writeHead(401);res.end('do-not-log-server-secret');
    });
    const config={id:'platform',url,headers:{Authorization:'Bearer do-not-log-server-secret'}};const context={owner:'platform',trustedServer:true};
    expect(await listTools(config,context)).toEqual([]);
    await expect(callTool(config,'effect',{},context)).rejects.toBeInstanceOf(UncertainToolOutcomeError);expect(calls).toBe(1);
    let destination=0;const other=await fixture((_body,res)=>{destination++;res.end('{}');});
    const redirect=await fixture((_body,res)=>{res.writeHead(302,{location:other});res.end();});
    await expect(listTools({id:'redirect',url:redirect},context)).rejects.toThrow();expect(destination).toBe(0);
  });
  it('requires matching JSON-RPC identities, including SSE streams',async()=>{
    const url=await fixture((body,res)=>{res.setHeader('content-type','text/event-stream');res.end(`data: ${JSON.stringify({id:body.id+1,result:{tools:[]}})}\n\n`);});
    await expect(listTools({id:'wrong-id',url},{owner:'platform',trustedServer:true})).rejects.toThrow('匹配');
  });
  it('rejects host stdio fallback even if a config spoofs a context property',async()=>{
    await expect(listTools({id:'host',command:'node',args:['-e','throw new Error("must not run")'],containerId:'a'.repeat(64)} as never)).rejects.toThrow('隔离容器');
  });
});
