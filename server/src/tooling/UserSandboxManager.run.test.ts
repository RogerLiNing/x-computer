import {describe,it,expect,vi} from 'vitest';import {mkdtemp,mkdir,symlink} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {UserSandboxManager} from './UserSandboxManager.js';
describe('expert execution workspace routing',()=>{
 it('keeps tasks for the same expert separate and preserves the legacy workspace',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'expert-workspaces-')),manager=new UserSandboxManager(root);
  const old=await manager.getForAgent('owner','writer');await old.sandboxFS.writeOverwrite('report.md','legacy');
  const first=await manager.getForAgent('owner','writer','one'),second=await manager.getForAgent('owner','writer','two');
  await first.sandboxFS.writeOverwrite('report.md','first');expect(await second.sandboxFS.exists('report.md')).toBe(false);
  await second.sandboxFS.writeOverwrite('report.md','second');expect(await first.sandboxFS.read('report.md')).toBe('first');expect(await old.sandboxFS.read('report.md')).toBe('legacy');
  await expect(manager.getForAgent('owner','writer','../other')).rejects.toThrow('run ID');
 });
 it('runs container commands in the task directory and rejects sibling or linked working directories',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'expert-shell-'));const execInContainer=vi.fn(async()=>({stdout:'task',stderr:'',exitCode:0}));
  const manager=new UserSandboxManager(root,{useContainer:true,containerManager:{execInContainer} as never});
  const first=await manager.getForAgent('owner','writer','one');await first.sandboxShell.execute('pwd',first.sandboxFS.getRoot());
  expect(execInContainer).toHaveBeenCalledWith('owner','pwd',expect.objectContaining({cwd:'/workspace/agents/writer/runs/one'}));
  const sibling=path.join(path.dirname(first.sandboxFS.getRoot()),'one-other');await mkdir(sibling);await symlink(sibling,path.join(first.sandboxFS.getRoot(),'linked'));
  await expect(first.sandboxShell.execute('pwd',sibling)).rejects.toThrow('越界');await expect(first.sandboxShell.execute('pwd',path.join(first.sandboxFS.getRoot(),'linked'))).rejects.toThrow('越界');expect(execInContainer).toHaveBeenCalledTimes(1);
 });
});
