import express from 'express';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { createFSRouter } from './fs.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { readPdf } from '../office/pdf.js';
vi.mock('../office/pdf.js', () => ({ readPdf: vi.fn() }));
beforeEach(() => vi.mocked(readPdf).mockReset());
async function setup() {
  const fs = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'pdf-preview-ocr-'))); await fs.init();
  const bytes = Buffer.from('%PDF-1.7 preview fixture'); await fs.writeBinaryNew('scan.pdf', bytes);
  const app = express(); app.use('/fs', createFSRouter(fs));
  vi.mocked(readPdf).mockImplementation(async (_bytes, _signal, ocr) => ({ pages: [{ page: 1, text: ocr ? 'OCR_SCAN_RESULT' : '', ...(ocr ? { ocr: true } : {}) }], warnings: [] }));
  return { fs, bytes, app, sha: createHash('sha256').update(bytes).digest('hex') };
}
it('binds preview OCR to the viewed bytes and returns read-only page provenance', async () => {
  const f = await setup();
  const before = await request(f.app).get('/fs/read-office').query({ path: 'scan.pdf' });
  expect(before.body.sha256).toBe(f.sha);
  const after = await request(f.app).get('/fs/read-office').query({ path: 'scan.pdf', ocr: 'true', expected_sha256: f.sha });
  expect(after.status).toBe(200); expect(after.body.pages[0]).toMatchObject({ text: 'OCR_SCAN_RESULT', ocr: true });
  expect(after.body.sha256).toBe(f.sha);
  expect(vi.mocked(readPdf).mock.calls[1]).toEqual([f.bytes, expect.any(AbortSignal), true]);
  expect(await f.fs.readBinary('scan.pdf')).toEqual(f.bytes);
});
it('rejects missing, malformed and stale preview bindings before OCR starts', async () => {
  const f = await setup();
  for (const expected_sha256 of [undefined, 'invalid']) {
    const result = await request(f.app).get('/fs/read-office').query({ path: 'scan.pdf', ocr: 'true', expected_sha256 });
    expect(result.status).toBe(400);
  }
  const stale = await request(f.app).get('/fs/read-office').query({ path: 'scan.pdf', ocr: 'true', expected_sha256: '0'.repeat(64) });
  expect(stale.status).toBe(409); expect(stale.body.error).toContain('重新打开');
  expect(readPdf).not.toHaveBeenCalled();
});
it('rejects ambiguous OCR flags and non-PDF OCR requests', async () => {
  const f = await setup();
  for (const ocr of ['yes', '1', ['true', 'false']]) {
    expect((await request(f.app).get('/fs/read-office').query({ path: 'scan.pdf', ocr, expected_sha256: f.sha })).status).toBe(400);
  }
  expect((await request(f.app).get('/fs/read-office').query({ path: 'input.docx', ocr: 'true', expected_sha256: f.sha })).status).toBe(400);
  expect(readPdf).not.toHaveBeenCalled();
});


it('explains unavailable recognition without exposing engine setup details in the user flow', async () => {
  const f = await setup(); vi.mocked(readPdf).mockRejectedValueOnce(new Error('PDF OCR 不可用：请安装 Tesseract 和中英文语言包'));
  const result = await request(f.app).get('/fs/read-office').query({ path: 'scan.pdf', ocr: 'true', expected_sha256: f.sha });
  expect(result.status).toBe(400); expect(result.body.error).toBe('文字识别还没准备好，请联系管理员配置。');
  expect(JSON.stringify(result.body)).not.toContain('Tesseract');
});
