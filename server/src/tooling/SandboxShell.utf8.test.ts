import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { SandboxShell } from './SandboxShell.js';

describe('native Shell UTF-8 receipts',()=>{
  it('keeps characters intact when the process splits encoded bytes across writes',async()=>{
    const executable="'"+process.execPath.replace(/'/g,"'\\''")+"'";
    const code='const b=Buffer.from("中文🙂");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),50);';
    const result=await new SandboxShell(os.tmpdir()).execute(`${executable} -e '${code}'`);
    expect(result.exitCode).toBe(0);expect(result.stdout).toBe('中文🙂');
  });
});
