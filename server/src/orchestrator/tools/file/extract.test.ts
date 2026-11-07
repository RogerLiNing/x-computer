import{describe,it,expect,vi}from'vitest';import{mkdtemp,rename,readFile}from'node:fs/promises';import path from'node:path';import os from'node:os';
import{SandboxFS}from'../../../tooling/SandboxFS.js';import{createFileExtractHandler}from'./extract.js';import{officeReadFixtures}from'../../../office/readFixtures.js';
const setup=async()=>{const sandbox=new SandboxFS(await mkdtemp(path.join(os.tmpdir(),'extract-docs-')));await sandbox.init();const memory=vi.fn(async()=>{throw new Error('must not index memory');});return {sandbox,memory,read:createFileExtractHandler({resolveFS:async()=>sandbox,getMemoryServiceForUser:memory,getVectorConfigForUser:memory} as never)};};
describe('readonly paged file extraction',()=>{
 it('pages a real Chinese PDF without losing warnings or indexing memory',async()=>{
  const {sandbox,read,memory}=await setup(),bytes=await readFile(new URL('../../../office/fixtures/text-pages.pdf',import.meta.url));await sandbox.writeBinary('input.pdf',bytes);
  const first=await read({path:'input.pdf',max_chars:40},{userId:'owner'}) as any;expect(first.ok).toBe(true);expect(first.truncated).toBe(true);expect(first.warnings[0]).toContain('第 2 页');
  const rest=await read({path:'input.pdf',offset:first.next_offset,expected_sha256:first.sha256},{userId:'owner'}) as any;
  expect(first.content+rest.content).toContain('PDF_LAST_CODE: last-page-93');expect(rest.extraction_scope).toContain('page-numbered-text');
  expect(memory).not.toHaveBeenCalled();expect(await sandbox.readBinary('input.pdf')).toEqual(bytes);
 });
 it('extracts real Office packages through the same handler without memory writes',async()=>{
  const {sandbox,read,memory}=await setup(),sample=await officeReadFixtures({word:'WORD_READ_OK',sheet:'SHEET_READ_OK',slide:'SLIDE_READ_OK'});
  for(const [ext,buffer,marker]of[['docx',sample.docx,'WORD_READ_OK'],['xlsx',sample.xlsx,'SHEET_READ_OK'],['pptx',sample.pptx,'SLIDE_READ_OK']] as const){await sandbox.writeBinary(`sample.${ext}`,buffer);const result=await read({path:`sample.${ext}`},{userId:'owner'}) as any;expect(result.ok).toBe(true);expect(result.content).toContain(marker);expect(result.truncated).toBe(false);expect(result.next_offset).toBeNull();}
  expect(memory).not.toHaveBeenCalled();
 });
 it('preserves Unicode characters across pages and rejects mixed file versions',async()=>{
  const {sandbox,read}=await setup(),text='AB🙂中文CD';await sandbox.writeOverwrite('page.txt',text);let offset=0,joined='',sha:string|undefined;
  for(let page=0;page<20;page++){const result=await read({path:'page.txt',offset,max_chars:1,expected_sha256:sha}) as any;expect(result.ok).toBe(true);joined+=result.content;sha=result.sha256;if(result.next_offset===null)break;expect(result.next_offset).toBeGreaterThan(offset);offset=result.next_offset;}
  expect(joined).toBe(text);await rename(path.join(sandbox.getRoot(),'page.txt'),path.join(sandbox.getRoot(),'page.original.txt'));await sandbox.writeOverwrite('page.txt','new content');
  expect(await read({path:'page.txt',offset:1,expected_sha256:sha})).toMatchObject({ok:false,error:expect.stringContaining('版本')});
  expect(await read({path:'page.txt',offset:1})).toMatchObject({ok:false,error:expect.stringContaining('sha256')});
 });
 it('keeps unsupported scans explicit and applies existing sensitive-data filtering',async()=>{
  const {sandbox,read}=await setup();await sandbox.writeOverwrite('data.txt','api_key: sk-test-secret-should-not-leak-1234567890');const result=await read({path:'data.txt'}) as any;expect(result.ok).toBe(true);expect(result.content).not.toContain('sk-test-secret');
  await sandbox.writeBinary('scan.pdf',Buffer.from('%PDF-test'));expect(await read({path:'scan.pdf'})).toMatchObject({ok:false,error:expect.stringContaining('PDF')});
  expect(await read({path:'data.txt',max_chars:64001})).toMatchObject({ok:false});
 });
});
