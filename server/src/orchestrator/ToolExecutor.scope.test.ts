import { describe, it, expect, vi } from 'vitest';
import { ToolExecutor } from './ToolExecutor.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
const definition={name:'mcp.shared.inspect',description:'platform',domain:['agent'] as never,riskLevel:'low' as const,parameters:[],requiredPermissions:[]};
const step={id:'step',taskId:'task',action:definition.name,toolName:definition.name,toolInput:{},status:'pending' as const,riskLevel:'low' as const};
describe('MCP tool owner dispatch',()=>{
 it('uses the same owned definition for discovery and execution and never duplicates its tool name',async()=>{
  const executor=new ToolExecutor();const platform=vi.fn(async()=>({owner:'platform'}));const alice=vi.fn(async()=>({owner:'alice'}));
  executor.registerDynamicTool(definition,platform);executor.registerDynamicTool({...definition,description:'alice'},alice,'mcp:alice');
  expect(executor.getToolDefinition(definition.name,'alice')?.description).toBe('alice');
  expect(executor.getLLMToolDefs('alice').filter(tool=>tool.name===definition.name)).toHaveLength(1);
  expect((await executor.execute(step,'container',{userId:'alice'})).output).toEqual({owner:'alice'});
  expect(platform).not.toHaveBeenCalled();expect((await executor.execute(step,'container',{userId:'bob'})).output).toEqual({owner:'platform'});
 });
 it('propagates unknown outcomes to the durable checkpoint owner instead of manufacturing a completed tool receipt',async()=>{
  const executor=new ToolExecutor();executor.registerDynamicTool(definition,async()=>{throw new UncertainToolOutcomeError('unknown');},'mcp:alice');
  await expect(executor.execute(step,'container',{userId:'alice'})).rejects.toBeInstanceOf(UncertainToolOutcomeError);
 });
});
