import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import { UserContainerManager } from './UserContainerManager.js';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';

function fixture(info:object={Running:false,ExitCode:0}) {
  const stream=new PassThrough(),inspect=vi.fn(async()=>info),start=vi.fn(async()=>stream),exec=vi.fn(async()=>({start,inspect}));
  let ready!:(value?:unknown)=>void;const prepared=new Promise(resolve=>ready=resolve),modem=new Docker().modem;
  const manager=Object.create(UserContainerManager.prototype) as UserContainerManager;
  Object.assign(manager,{getOrCreateContainer:vi.fn(async()=>'owned'),lastActivity:new Map(),docker:{getContainer:()=>({exec}),modem:{demuxStream:(...args:Parameters<typeof modem.demuxStream>)=>{modem.demuxStream(...args);ready();}}}});
  return {manager,stream,inspect,start,exec,prepared};
}
function packet(type:number,payload:Buffer|string){const data=Buffer.from(payload),header=Buffer.alloc(8);header[0]=type;header.writeUInt32BE(data.length,4);return Buffer.concat([header,data]);}

describe('container command receipts',()=>{
  it('bounds an exec.start that never returns and destroys a late response stream',async()=>{
    const f=fixture();let resolve!:(stream:PassThrough)=>void;f.start.mockImplementation(()=>new Promise(done=>resolve=done));
    await expect(f.manager.execInContainer('owner','test',{timeout:10})).rejects.toBeInstanceOf(UncertainToolOutcomeError);
    resolve(f.stream);await Promise.resolve();expect(f.stream.destroyed).toBe(true);
  });
  it.each([Buffer.from([1,0,0]),packet(1,'abcde').subarray(0,10)])('rejects incomplete Docker framing instead of claiming success',async bytes=>{
    const f=fixture(),running=f.manager.execInContainer('owner','test');await f.prepared;f.stream.end(bytes);await expect(running).rejects.toBeInstanceOf(UncertainToolOutcomeError);expect(f.inspect).not.toHaveBeenCalled();
  });
  it('uses Docker WorkingDir without interpolating directory text and decodes fragmented UTF-8 frames',async()=>{
    const f=fixture(),command='printf test',cwd='/workspace/a; echo not-a-command',running=f.manager.execInContainer('owner',command,{cwd});await f.prepared;
    expect(f.exec).toHaveBeenCalledWith(expect.objectContaining({Cmd:['/bin/sh','-c',command],WorkingDir:cwd}));
    const text=Buffer.from('中文🙂'),bytes=Buffer.concat([packet(1,text.subarray(0,1)),packet(2,'warning'),packet(1,text.subarray(1))]);
    for(const byte of bytes)f.stream.write(Buffer.from([byte]));f.stream.end();
    expect(await running).toEqual({stdout:'中文🙂',stderr:'warning',exitCode:0});
  });
  it.each([{Running:true,ExitCode:null},{Running:false,ExitCode:null}])('never assumes success without a finished exit code: %j',async info=>{
    const f=fixture(info),running=f.manager.execInContainer('owner','test');await f.prepared;f.stream.end();await expect(running).rejects.toBeInstanceOf(UncertainToolOutcomeError);
  });
  it('keeps abrupt stream closure uncertain',async()=>{
    const f=fixture(),running=f.manager.execInContainer('owner','test');await f.prepared;f.stream.destroy();await expect(running).rejects.toBeInstanceOf(UncertainToolOutcomeError);
  });
  it('keeps timeout uncertain and closes the owned response stream',async()=>{
    const f=fixture(),running=f.manager.execInContainer('owner','test',{timeout:10});await expect(running).rejects.toBeInstanceOf(UncertainToolOutcomeError);expect(f.stream.destroyed).toBe(true);
  });
  it('treats a lost start response as unknown, without retrying start',async()=>{
    const f=fixture();f.start.mockRejectedValue(new Error('lost response'));await expect(f.manager.execInContainer('owner','test')).rejects.toBeInstanceOf(UncertainToolOutcomeError);expect(f.start).toHaveBeenCalledTimes(1);
  });
});
