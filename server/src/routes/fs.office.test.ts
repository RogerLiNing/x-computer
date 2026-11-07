import express from 'express';
import request from 'supertest';
import {mkdtemp, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {createFSRouter} from './fs.js';
import {SandboxFS} from '../tooling/SandboxFS.js';
import {officeReadFixtures} from '../office/readFixtures.js';

describe('Office file preview',()=>{
 it('saves independent XML edit copies and rejects stale sources and legacy overwrites',async()=>{
  const sandbox=new SandboxFS(await mkdtemp(path.join(os.tmpdir(),'office-edit-api-'))),app=express();app.use(express.json());app.use('/fs',createFSRouter(sandbox));
  const fixtures=await officeReadFixtures({word:'OLD_CODE',sheet:'old',slide:'old'});await sandbox.writeBinary('original.docx',fixtures.docx);
  const source=(await request(app).get('/fs/read-office').query({path:'original.docx'})).body;
  const body={path:'original.docx',expectedSha256:source.sha256,content:{find:'OLD_CODE',replace:'新内容',expected_occurrences:1}};
  const [one,two]=await Promise.all([request(app).post('/fs/edit-office').send(body),request(app).post('/fs/edit-office').send(body)]);
  expect(one.status).toBe(200);expect(two.status).toBe(200);expect(one.body.path).not.toBe(two.body.path);
  expect((await request(app).get('/fs/read-office').query({path:one.body.path})).body.text).toContain('新内容');
  expect(await sandbox.readBinary('original.docx')).toEqual(fixtures.docx);
  const overwrite=await request(app).post('/fs/write-office').send({path:'original.docx',type:'docx',content:{text:'replacement'}});expect(overwrite.status).toBe(409);expect(await sandbox.readBinary('original.docx')).toEqual(fixtures.docx);
  expect((await request(app).post('/fs/edit-office').send({...body,expectedSha256:'0'.repeat(64)})).status).toBe(400);
  expect((await request(app).post('/fs/edit-office').send({...body,content:{find:'OLD_CODE',replace:'new',expected_occurrences:2}})).body.error).toContain('匹配');
 });
 it('previews actual PDF text with original page numbers and warns for unread pages',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pdf-preview-')),sandbox=new SandboxFS(root),app=express();app.use('/fs',createFSRouter(sandbox));
  const bytes=await readFile(new URL('../office/fixtures/text-pages.pdf',import.meta.url));await sandbox.writeBinary('中文.pdf',bytes);
  const result=await request(app).get('/fs/read-office').query({path:'中文.pdf'});
  expect(result.status).toBe(200);expect(result.body.type).toBe('pdf');expect(result.body.pages[2]).toMatchObject({page:3,text:expect.stringContaining('last-page-93')});expect(result.body.warnings[0]).toContain('第 2 页');
  expect(await sandbox.readBinary('中文.pdf')).toEqual(bytes);
  await sandbox.writeBinary('locked.pdf',await readFile(new URL('../office/fixtures/password.pdf',import.meta.url)));
  const locked=await request(app).get('/fs/read-office').query({path:'locked.pdf'});expect(locked.status).toBe(400);expect(locked.body.error).toContain('密码');
 });
 it('returns actual presentation order and preserves the stored Office originals',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'office-preview-')),sandbox=new SandboxFS(root),app=express();
  app.use('/fs',createFSRouter(sandbox));
  const fixtures=await officeReadFixtures({word:'WORD_PREVIEW',sheet:'SHEET_PREVIEW',slide:'LAST_PREVIEW'});
  for(const extension of ['docx','xlsx','pptx'] as const)await sandbox.writeBinary(`input.${extension}`,fixtures[extension]);
  const word=await request(app).get('/fs/read-office').query({path:'input.docx'});
  expect(word.status).toBe(200);expect(word.body.text).toContain('WORD_PREVIEW');
  const sheet=await request(app).get('/fs/read-office').query({path:'input.xlsx'});
  expect(sheet.status).toBe(200);expect(sheet.body.sheets[0].rows[1][1]).toBe('SHEET_PREVIEW');
  const deck=await request(app).get('/fs/read-office').query({path:'input.pptx'});
  expect(deck.status).toBe(200);expect(deck.body.unsupported).toBeUndefined();
  expect(deck.body.slides.map((slide:{title:string})=>slide.title)).toEqual(['实际第一页','实际最后一页']);
  expect(deck.body.slides[1].content).toContain('LAST_PREVIEW');
  for(const extension of ['docx','xlsx','pptx'] as const)expect(await sandbox.readBinary(`input.${extension}`)).toEqual(fixtures[extension]);
  await sandbox.writeBinary('broken.pptx',Buffer.from('not-an-office-file'));
  expect((await request(app).get('/fs/read-office').query({path:'broken.pptx'})).status).toBe(400);
 });
});
