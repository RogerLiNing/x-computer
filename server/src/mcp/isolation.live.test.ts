import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { UserContainerManager } from '../container/UserContainerManager.js';
import { listTools, callTool } from './client.js';
import { closeAllStdioConnections, closeStdioConnection } from './clientStdio.js';
import type { McpExecutionContext, McpServerConfig } from './types.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
const exec=promisify(execFile);
const live=process.env.X_MCP_TEST_IMAGE?describe:describe.skip;
live('real per-owner MCP containers',()=>{
 let root:string;let prefix:string;let manager:UserContainerManager;let a:McpExecutionContext;let b:McpExecutionContext;let platform:McpExecutionContext;
 const config=(owner:string):McpServerConfig=>({id:'same-id',command:'node',args:['/workspace/mcp-fixture.cjs'],env:{MCP_FIXTURE:owner}});
 beforeAll(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'x-mcp-live-'));prefix=`x-mcp-fixture-${Date.now()}`;
  manager=new UserContainerManager(root,{imageName:process.env.X_MCP_TEST_IMAGE,namePrefix:prefix,networkMode:'none',idleTimeout:0,maxIdleTime:0});
  vi.stubEnv('MCP_HOST_SECRET','host-secret-must-stay-out');
  await writeFile(path.join(root,'host-sentinel'),'host-only');
  for(const owner of ['alice','bob']){
   const workspace=path.join(root,'users',owner,'workspace');await mkdir(workspace,{recursive:true});await writeFile(path.join(workspace,'marker'),owner);
   await writeFile(path.join(workspace,'mcp-fixture.cjs'),`const fs=require('node:fs'),os=require('node:os');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id==null)return;let result={};if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(m.method==='tools/list')result={tools:[{name:'inspect',inputSchema:{type:'object'}},{name:'effect_then_wait',inputSchema:{type:'object'}}]};if(m.method==='tools/call'){if(m.params.name==='wait'){fs.writeFileSync('/workspace/waiting','yes');return;}if(m.params.name==='effect_then_wait'){fs.appendFileSync('/workspace/effects','once\\n');return;}result={content:[{type:'text',text:JSON.stringify({owner:fs.readFileSync('/workspace/marker','utf8'),configured:process.env.MCP_FIXTURE,hostSecret:process.env.MCP_HOST_SECRET??null,hostSentinel:fs.existsSync(${JSON.stringify(path.join(root,'host-sentinel'))}),dockerSocket:fs.existsSync('/var/run/docker.sock'),otherUser:fs.existsSync('/workspace/../bob/workspace/marker'),hostname:os.hostname(),pid:process.pid,uid:process.getuid(),home:process.env.HOME,cwd:process.cwd()})}]};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  }
  a={owner:'alice',containerId:await manager.getOrCreateMcpContainer('alice','user-server'),timeoutMs:5000};
  b={owner:'bob',containerId:await manager.getOrCreateMcpContainer('bob','user-server'),timeoutMs:5000};
  platform={owner:'alice',containerId:await manager.getOrCreateMcpContainer('alice','platform-server'),timeoutMs:5000};
 },30000);
 afterAll(async()=>{
  await closeAllStdioConnections();manager?.stopMonitoring();vi.unstubAllEnvs();
  if(prefix){const ids=(await exec('docker',['ps','-q','--filter',`name=${prefix}`])).stdout.trim().split(/\s+/).filter(Boolean);if(ids.length)await exec('docker',['stop','--time','1',...ids]);}
 });
 it('isolates matching server ids by owner, never inherits host secrets, and separates platform processes',async()=>{
  await Promise.all([listTools(config('alice'),a),listTools(config('bob'),b)]);
  const left=JSON.parse((await callTool(config('alice'),'inspect',{},a)).text);const right=JSON.parse((await callTool(config('bob'),'inspect',{},b)).text);
  expect(left).toMatchObject({owner:'alice',configured:'alice',hostSecret:null,hostSentinel:false,dockerSocket:false,otherUser:false,home:'/tmp/x-mcp',cwd:'/tmp/x-mcp'});
  expect(left.uid).toBeGreaterThan(0);expect(right.owner).toBe('bob');expect(left.hostname).not.toBe(right.hostname);expect(a.containerId).not.toBe(platform.containerId);
  await closeStdioConnection('same-id','alice');
  expect(JSON.parse((await callTool(config('bob'),'inspect',{},b)).text).owner).toBe('bob');
  await vi.waitFor(async()=>{const check=await exec('docker',['exec',a.containerId!,'node','-e',`try{process.kill(${left.pid},0);process.exit(1)}catch{process.exit(0)}`]);expect(check.stderr).toBe('');});
  const out=process.env.X_MCP_EVIDENCE_DIR;
  if(out){await mkdir(out,{recursive:true});await writeFile(path.join(out,'containers.json'),JSON.stringify({success:true,root,prefix,containerIds:[a.containerId,b.containerId,platform.containerId],probe:left,otherOwner:right.owner},null,2));}
 });
 it('records one real side effect and treats lost receipts as unknown without replay',async()=>{
  await listTools(config('alice'),a);
  await expect(callTool(config('alice'),'effect_then_wait',{}, {...a,timeoutMs:300})).rejects.toBeInstanceOf(UncertainToolOutcomeError);
  expect(await readFile(path.join(root,'users/alice/workspace/effects'),'utf8')).toBe('once\n');
 });
 it('stops an active extension process when cancellation arrives and preserves unknown outcome',async()=>{
  await listTools(config('alice'),a);const controller=new AbortController();
  const work=callTool(config('alice'),'wait',{}, {...a,signal:controller.signal});
  const rejected=expect(work).rejects.toBeInstanceOf(UncertainToolOutcomeError);
  await vi.waitFor(async()=>expect(await readFile(path.join(root,'users/alice/workspace/waiting'),'utf8')).toBe('yes'));
  controller.abort();await rejected;
 });

});
