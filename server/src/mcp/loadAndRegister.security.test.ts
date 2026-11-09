import { describe, it, expect, vi } from 'vitest';
import { loadMcpAndRegisterForUser, getMcpStatus } from './loadAndRegister.js';
import { listTools, callTool } from './client.js';
import { closeAllStdioConnections } from './clientStdio.js';
vi.mock('./client.js',()=>({listTools:vi.fn(async()=>[{name:'inspect',description:'fixture',inputSchema:{type:'object'}}]),callTool:vi.fn(async()=>({text:'ok',isError:false}))}));
vi.mock('./clientStdio.js',()=>({closeAllStdioConnections:vi.fn(async()=>{}),validateStdioServer:vi.fn()}));
vi.mock('../config/defaultConfig.js',()=>({loadDefaultConfig:()=>({})}));
describe('MCP registration owner boundaries',()=>{
 function orchestrator(){return {clearMcpToolsByScope:vi.fn(),registerDynamicTool:vi.fn(),getMcpContainerId:vi.fn(async(owner:string)=>owner==='alice'?'a'.repeat(64):'b'.repeat(64))};}
 const server={id:'same',command:'node',args:['/workspace/own.cjs'],trustedServer:true,env:{OWN_KEY:'own-value'}};
 it('serializes discovery and reuses unchanged connections without interrupting another user',async()=>{
  const o=orchestrator();const read=async()=>JSON.stringify([server]);
  await Promise.all([loadMcpAndRegisterForUser(o as never,'alice',()=>'/not-used',read),loadMcpAndRegisterForUser(o as never,'alice',()=>'/not-used',read)]);
  expect(listTools).toHaveBeenCalledTimes(1);expect(listTools).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({owner:'alice',trustedServer:false,containerId:'a'.repeat(64)}));
  await loadMcpAndRegisterForUser(o as never,'bob',()=>'/not-used',read);
  expect(closeAllStdioConnections).toHaveBeenCalledWith('bob');expect(closeAllStdioConnections).not.toHaveBeenCalledWith();
  const handler=o.registerDynamicTool.mock.calls[0][1] as unknown as (input:object,ctx:object)=>Promise<unknown>;
  const signal=new AbortController().signal;await handler({}, {signal});
  expect(callTool).toHaveBeenCalledWith(expect.anything(),'inspect',{},expect.objectContaining({owner:'alice',signal,containerId:'a'.repeat(64)}));
  expect(getMcpStatus(o as never,'alice')?.servers[0].id).toBe('same');
  await loadMcpAndRegisterForUser(o as never,'alice',()=>'/not-used',async()=>JSON.stringify([{...server,args:['/workspace/changed.cjs']}]));
  expect(closeAllStdioConnections).toHaveBeenLastCalledWith('alice');
 });
 it('does not fall back to the host if the user container is unavailable',async()=>{
  const o=orchestrator();o.getMcpContainerId.mockRejectedValue(new Error('container unavailable'));
  const result=await loadMcpAndRegisterForUser(o as never,'alice',()=>'/not-used',async()=>JSON.stringify([server]));
  expect(result.totalTools).toBe(0);expect(result.servers[0].error).toContain('container unavailable');expect(listTools).not.toHaveBeenCalled();
 });
});
