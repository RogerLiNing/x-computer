import {describe,it,expect,vi} from 'vitest';
import {runWithRetry,runScheduledIntent} from './runScheduledIntent.js';
import type {RunScheduledIntentDeps} from './runScheduledIntent.js';
describe('background execution replay safety',()=>{
 it('does not replay an agent turn after a network error following a side effect',async()=>{
  let writes=0;const action=vi.fn(async()=>{writes++;throw new Error('fetch failed after write');});
  await expect(runWithRetry(action,{})).rejects.toThrow('fetch failed');expect(writes).toBe(1);expect(action).toHaveBeenCalledTimes(1);
 });
 it('still permits explicit retry of an idempotent read',async()=>{
  const read=vi.fn().mockRejectedValueOnce(new Error('network failure')).mockResolvedValueOnce('read result');
  expect(await runWithRetry(read,{maxRetries:1,initialBackoffMs:0})).toBe('read result');expect(read).toHaveBeenCalledTimes(2);
 });
 it('does not retry non-transient errors even when a read opted in',async()=>{
  const read=vi.fn(async()=>{throw new Error('permission denied');});await expect(runWithRetry(read,{maxRetries:1,initialBackoffMs:0})).rejects.toThrow('permission denied');expect(read).toHaveBeenCalledTimes(1);
 });
 it('scheduled intent failures cannot create repeated model tasks',async()=>{
  const run=vi.fn(async()=>{throw new Error('network timeout after tool execution');});const complete=vi.fn();
  const deps={orchestrator:{runIntentAsPersistedTask:run},getSystemPrompt:async()=>'',getLLMConfig:async()=>({providerId:'test',modelId:'test'}),onRoundComplete:complete} as unknown as RunScheduledIntentDeps;
  await runScheduledIntent({id:'scheduled-test',userId:'owner',intent:'test',runAt:1,createdAt:1},deps);
  expect(run).toHaveBeenCalledTimes(1);expect(complete).not.toHaveBeenCalled();
 });
});
