import {describe,it,expect,vi} from 'vitest';import{mkdtemp,mkdir,writeFile,readFile,rename,symlink}from'node:fs/promises';import path from'node:path';import os from'node:os';import{createHash}from'node:crypto';import{SandboxFS}from'../tooling/SandboxFS.js';
import{prepareExpertInputs}from'./ExpertInputStore.js';
const setup=async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'expert-input-')),workspace=path.join(root,'workspace');await mkdir(workspace);return {root,workspace};};
describe('complete expert input snapshots',()=>{
 it('preserves binary bytes, long text and duplicate filenames in separate slots',async()=>{
  const {workspace}=await setup();await mkdir(path.join(workspace,'a'));await mkdir(path.join(workspace,'b'));
  const binary=Buffer.from([0,255,128,10,0,42]),long=Buffer.from('x'.repeat(96*1024)+'TAIL_MARKER');await writeFile(path.join(workspace,'a/input.bin'),binary);await writeFile(path.join(workspace,'b/input.bin'),long);
  const files=await prepareExpertInputs(new SandboxFS(workspace),'run','agents/writer/runs/run',['a/input.bin','b/input.bin']);
  expect(await readFile(path.join(workspace,files[0].path))).toEqual(binary);expect(await readFile(path.join(workspace,files[1].path))).toEqual(long);expect(files[0].path).not.toBe(files[1].path);
  expect(files[1].sha256).toBe(createHash('sha256').update(long).digest('hex'));expect(files[1].size).toBe(long.length);expect(await readFile(path.join(workspace,'a/input.bin'))).toEqual(binary);
 });
 it('recovers a published capture after interruption even when the original was moved',async()=>{
  const {workspace}=await setup();await writeFile(path.join(workspace,'input.txt'),'original snapshot');let checks=0;
  await expect(prepareExpertInputs(new SandboxFS(workspace),'run','agents/writer/runs/run',['input.txt'],async()=>{if(++checks===2)throw new Error('simulated process loss');})).rejects.toThrow('process loss');
  await rename(path.join(workspace,'input.txt'),path.join(workspace,'moved-original.txt'));
  const files=await prepareExpertInputs(new SandboxFS(workspace),'run','agents/writer/runs/run',['input.txt']);expect((await readFile(path.join(workspace,files[0].path))).toString()).toBe('original snapshot');
  const sandbox=new SandboxFS(workspace);await expect(sandbox.read('../.expert-inputs/run/01')).rejects.toThrow('traversal');
 });
 it('does not overwrite a changed working copy or follow source and destination links',async()=>{
  const {root,workspace}=await setup();await writeFile(path.join(workspace,'input.txt'),'original');const first=await prepareExpertInputs(new SandboxFS(workspace),'run','agents/writer/runs/run',['input.txt']);
  await writeFile(path.join(workspace,first[0].path),'edited copy');await expect(prepareExpertInputs(new SandboxFS(workspace),'run','agents/writer/runs/run',['input.txt'])).rejects.toThrow('不会覆盖');expect((await readFile(path.join(workspace,first[0].path))).toString()).toBe('edited copy');
  await symlink('input.txt',path.join(workspace,'linked.txt'));await expect(prepareExpertInputs(new SandboxFS(workspace),'linked','agents/writer/runs/linked',['linked.txt'])).rejects.toThrow('符号链接');
  await expect(prepareExpertInputs(new SandboxFS(workspace),'escape','../outside',['input.txt'])).rejects.toThrow('目录');await writeFile(path.join(root,'outside.txt'),'private');
  await expect(prepareExpertInputs(new SandboxFS(workspace),'escape','agents/writer/runs/escape',['../outside.txt'])).rejects.toThrow('路径');
 });
 it('rejects oversized files before making a working copy',async()=>{
  const {workspace}=await setup();await writeFile(path.join(workspace,'large.bin'),Buffer.alloc(16*1024*1024+1));await expect(prepareExpertInputs(new SandboxFS(workspace),'large','agents/writer/runs/large',['large.bin'])).rejects.toThrow('16 MiB');
  expect(await new SandboxFS(workspace).exists('agents/writer/runs/large/输入/01/large.bin')).toBe(false);
 });
 it('accounts for private captures and working copies once in the existing storage ledger',async()=>{
  const {workspace}=await setup(),data=Buffer.from('input'),usage=vi.fn(async(..._args:unknown[])=>{});await writeFile(path.join(workspace,'input.txt'),data);
  const sandbox=new SandboxFS(workspace,{userId:'owner',subscriptionService:{recordUsage:usage} as never});
  await prepareExpertInputs(sandbox,'run','agents/writer/runs/run',['input.txt']);expect(usage).toHaveBeenCalledTimes(2);
  expect(usage.mock.calls.map(call=>call[2])).toEqual([data.length,data.length]);
  await prepareExpertInputs(sandbox,'run','agents/writer/runs/run',['input.txt']);expect(usage).toHaveBeenCalledTimes(2);
 });
});
