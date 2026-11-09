import {test} from 'node:test';import assert from 'node:assert/strict';
import {connect} from 'node:net';import {request} from 'node:http';
import {isPublicIPv4,createBrowserPolicy,startBrowserProxy,createCloudflareResolver} from './browser-network.mjs';
test('denies private, mapped, special-use and alternate-form local addresses',()=>{
 for(const ip of ['0.0.0.0','10.1.1.1','127.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','198.18.0.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isPublicIPv4(ip),false,ip);
 assert.equal(isPublicIPv4('1.1.1.1'),true);
});
test('requires exact allowed origins and rejects credential and protocol tricks before DNS',async()=>{
 let calls=0;const policy=createBrowserPolicy(['https://example.com'],async()=>{calls++;return [{address:'1.1.1.1'}];});
 for(const url of ['https://example.com.evil.test','http://example.com','https://example.com:8443','https://user:pass@example.com','file:///etc/passwd','ftp://example.com'])await assert.rejects(()=>policy.resolve(url));
 assert.equal(calls,0);assert.equal((await policy.resolve('https://example.com/path?q=1')).address,'1.1.1.1');
 assert.throws(()=>createBrowserPolicy(['https://example.com/path']));
});
test('pins each connection to a validated address and rechecks later DNS answers',async()=>{
 let calls=0;const policy=createBrowserPolicy(['https://example.com'],async()=>[{address:++calls===1?'1.1.1.1':'127.0.0.1'}]);
 const target=await policy.resolve('https://example.com');assert.equal(target.address,'1.1.1.1');assert.equal(target.port,443);
 await assert.rejects(()=>policy.resolve('https://example.com'),/内网/);
 const mixed=createBrowserPolicy(['https://example.com'],async()=>[{address:'1.1.1.1'},{address:'10.0.0.1'}]);await assert.rejects(()=>mixed.resolve('https://example.com'),/内网/);
 const alternate=createBrowserPolicy(['https://127.0.0.1']);await assert.rejects(()=>alternate.resolve('https://2130706433'),/内网/);
});
test('actual HTTP and CONNECT requests cannot reach a local destination',async()=>{
 const {server,url}=await startBrowserProxy(createBrowserPolicy(['http://127.0.0.1','https://example.com'],async()=>[{address:'127.0.0.1'}]));
 try{
  const status=await new Promise((resolve,reject)=>{const req=request(url,{path:'http://127.0.0.1/'},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);
  const response=await new Promise((resolve,reject)=>{const socket=connect(server.address().port,'127.0.0.1');let body='';socket.on('error',reject);socket.on('data',chunk=>body+=chunk);socket.on('end',()=>resolve(body));socket.on('connect',()=>socket.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'));});assert.match(response,/403 Forbidden/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('opt-in encrypted DNS still rejects a private answer and does not follow redirects',async()=>{
 let options;const resolver=createCloudflareResolver(async(url,init)=>{assert.ok(url.startsWith('https://1.1.1.1/dns-query?'));options=init;return {ok:true,text:async()=>JSON.stringify({Status:0,Answer:[{type:1,data:'127.0.0.1'}]})};});
 const policy=createBrowserPolicy(['https://example.com'],resolver);await assert.rejects(()=>policy.resolve('https://example.com'),/内网/);assert.equal(options.redirect,'error');
 const broken=createCloudflareResolver(async()=>({ok:false}));await assert.rejects(()=>broken('example.com'),/解析失败/);
});

test('encrypted DNS cache retains only validated public numeric addresses',async()=>{
 let calls=0;const resolver=createCloudflareResolver(async()=>{calls++;return {ok:true,text:async()=>JSON.stringify({Status:0,Answer:[{type:1,data:'1.1.1.1'}]})};});
 const policy=createBrowserPolicy(['https://example.com'],resolver);assert.equal((await policy.resolve('https://example.com')).address,'1.1.1.1');assert.equal((await policy.resolve('https://example.com')).address,'1.1.1.1');assert.equal(calls,1);
});

test('retries a failed read-only DNS query against the same provider secondary endpoint',async()=>{
 const seen=[];const resolver=createCloudflareResolver(async url=>{seen.push(new URL(url).hostname);if(seen.length===1)throw new Error('unreachable');return {ok:true,text:async()=>JSON.stringify({Status:0,Answer:[{type:1,data:'1.1.1.1'}]})};});
 assert.equal((await resolver('example.com'))[0].address,'1.1.1.1');assert.deepEqual(seen,['1.1.1.1','1.0.0.1']);
});
