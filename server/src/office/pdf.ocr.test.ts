import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readPdf } from './pdf.js';
import { parseFileToText } from '../fileParser/localFileParser.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { createFileExtractHandler } from '../orchestrator/tools/file/extract.js';

const nativeOcr = (() => { try { const langs = execFileSync(process.env.X_COMPUTER_TESSERACT_BIN || 'tesseract', ['--list-langs'], { encoding: 'utf8', timeout: 5000 }); return /^chi_sim$/m.test(langs) && /^eng$/m.test(langs) && process.platform !== 'win32'; } catch { return false; } })();

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const fixture = () => readFile(new URL('./fixtures/scanned-pages.pdf', import.meta.url));

it.runIf(nativeOcr)('reads Chinese scans locally, keeps real page numbers and does not change source bytes', async () => {
  const bytes = await fixture(), original = Buffer.from(bytes);
  const before = await readPdf(bytes);
  expect(before.pages[0].text).toBe('');
  const result = await readPdf(bytes, undefined, true);
  expect(result.pages[0]).toMatchObject({ page: 1, ocr: true });
  expect(result.pages[0].text).toContain('OCR-SCAN-8264');
  expect(result.pages[0].text.replace(/\s/g, '')).toContain('扫描件识别验收');
  expect(result.pages[1]).toMatchObject({ page: 2, ocr: true });
  expect(result.pages[1].text).toContain(before.pages[1].text);
  expect(result.warnings.join('')).toContain('核对原件');
  expect(bytes).toEqual(original);
});

it.runIf(nativeOcr)('uses the same fingerprint pagination and never writes memory while reading scans', async () => {
  const sandbox = new SandboxFS(await mkdtemp(path.join(os.tmpdir(), 'ocr-read-'))); await sandbox.init();
  const bytes = await fixture(); await sandbox.writeBinaryNew('scan.pdf', bytes);
  const memory = vi.fn();
  const read = createFileExtractHandler({ resolveFS: async () => sandbox, getMemoryServiceForUser: memory } as never);
  const first = await read({ path: 'scan.pdf', ocr: true, max_chars: 30 }, { userId: 'owner' }) as any;
  expect(first.ok).toBe(true); expect(first.truncated).toBe(true);
  const rest = await read({ path: 'scan.pdf', ocr: true, offset: first.next_offset, expected_sha256: first.sha256 }, { userId: 'owner' }) as any;
  expect(first.content + rest.content).toContain('OCR-SCAN-8264');
  expect(rest.extraction_scope).toContain('local-OCR');
  expect(memory).not.toHaveBeenCalled(); expect(await sandbox.readBinary('scan.pdf')).toEqual(bytes);
  expect(await read({ path: 'scan.png', ocr: true })).toMatchObject({ ok: false });
  expect(await read({ path: 'scan.pdf', ocr: 'yes' })).toMatchObject({ ok: false });
  expect(await read({ path: 'scan.pdf', ocr: true, offset: 1 })).toMatchObject({ ok: false });
});

it.skipIf(process.platform === 'win32')('reports unavailable OCR without returning document contents or a false success', async () => {
  vi.stubEnv('X_COMPUTER_TESSERACT_BIN', '/nonexistent-x-computer-ocr-engine');
  await expect(readPdf(await fixture(), undefined, true)).rejects.toThrow('OCR 不可用');
  expect(await parseFileToText('scan.pdf', await fixture(), undefined, true)).toMatchObject({ ok: false, error: expect.stringContaining('OCR 不可用') });
});

it.runIf(nativeOcr)('keeps unread blank pages explicit and bounds OCR page counts', async () => {
  const blank = await readPdf(await readFile(new URL('./fixtures/no-text.pdf', import.meta.url)), undefined, true);
  expect(blank.pages[0]).toMatchObject({ text: '', ocr: true });
  expect(blank.warnings.join('')).toContain('未识别出文字');
  await expect(readPdf(await readFile(new URL('./fixtures/too-many-pages.pdf', import.meta.url)), undefined, true)).rejects.toThrow('10 页');
});

it.skipIf(process.platform === 'win32')('cancels the entire OCR process group and releases the PDF reader slot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ocr-cancel-'));
  const executable = path.join(root, 'slow-engine'), pidFile = path.join(root, 'engine.pid');
  await writeFile(executable, '#!' + process.execPath + '\n' + `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.stdin.resume();setInterval(()=>{},1000);`, { mode: 0o700 });
  vi.stubEnv('X_COMPUTER_TESSERACT_BIN', executable);
  const controller = new AbortController(), reading = readPdf(await fixture(), controller.signal, true);
  const settled = reading.then(() => undefined, error => error);
  let pid = 0;
  try {
    await vi.waitFor(async () => { pid = Number(await readFile(pidFile, 'utf8')); expect(pid).toBeGreaterThan(0); }, { timeout: 5000 });
  } finally { controller.abort(); expect(await settled).toMatchObject({ name: 'AbortError' }); }
  await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  vi.unstubAllEnvs();
  expect((await readPdf(await fixture())).pages).toHaveLength(2);
});

it.runIf(nativeOcr)('rejects missing language data rather than silently changing recognition language', async () => {
  vi.stubEnv('TESSDATA_PREFIX', await mkdtemp(path.join(os.tmpdir(), 'empty-ocr-languages-')));
  await expect(readPdf(await fixture(), undefined, true)).rejects.toThrow('语言包');
});

it.skipIf(process.platform === 'win32')('bounds recognizer output and keeps private engine stderr out of errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ocr-errors-')), executable = path.join(root, 'engine');
  for (const body of ["process.stderr.write('private-document-secret');process.exit(3);", "process.stdout.write('x'.repeat(1024*1024+1));"]) {
    await writeFile(executable, '#!' + process.execPath + '\nprocess.stdin.resume();' + body, { mode: 0o700 });
    vi.stubEnv('X_COMPUTER_TESSERACT_BIN', executable);
    await expect(readPdf(await fixture(), undefined, true)).rejects.toThrow('PDF OCR 识别失败');
  }
});

it.skipIf(process.platform === 'win32')('terminates OCR readers at the total deadline and returns their slot', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const reading = readPdf(await fixture(), undefined, true);
  const rejected = expect(reading).rejects.toThrow('读取超时');
  vi.advanceTimersByTime(60_000); await rejected; vi.useRealTimers();
  expect((await readPdf(await fixture())).pages).toHaveLength(2);
});

it.skipIf(process.platform === 'win32')('does not leave the OCR engine alive when its server process disappears', async () => {
  const { spawn } = await import('node:child_process'), { once } = await import('node:events');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ocr-orphan-'));
  const executable = path.join(root, 'engine'), pidFile = path.join(root, 'engine.pid'), workerPid = path.join(root, 'worker.pid'), helper = path.join(root, 'parent.mjs');
  await writeFile(executable, '#!' + process.execPath + '\n' + `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.stdin.resume();setInterval(()=>{},1000);`, { mode: 0o700 });
  await writeFile(helper, `import {fork} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';const worker=fork(new URL(${JSON.stringify(new URL('./pdfWorker.mjs', import.meta.url).href)}),[],{detached:true,serialization:'advanced',env:{PATH:process.env.PATH,X_COMPUTER_TESSERACT_BIN:${JSON.stringify(executable)}},stdio:['ignore','ignore','ignore','ipc']});writeFileSync(${JSON.stringify(workerPid)},String(worker.pid));worker.send({bytes:readFileSync(new URL(${JSON.stringify(new URL('./fixtures/scanned-pages.pdf', import.meta.url).href)})),ocr:true});`);
  const parent = spawn(process.execPath, [helper], { stdio: 'ignore' });
  const closed = once(parent, 'close'); let engine = 0;
  try {
    await vi.waitFor(async () => { engine = Number(await readFile(pidFile, 'utf8')); expect(engine).toBeGreaterThan(0); }, { timeout: 5000 });
    parent.kill('SIGKILL'); await closed;
    await vi.waitFor(() => expect(() => process.kill(engine, 0)).toThrow(), { timeout: 2000 });
  } finally {
    parent.kill('SIGKILL');
    try { process.kill(-Number(await readFile(workerPid, 'utf8')), 'SIGKILL'); } catch { /* Already exited. */ }
    await closed;
  }
});

it.runIf(nativeOcr)('recognizes scans that already have a footer text layer', async () => {
  const bytes = await readFile(new URL('./fixtures/scanned-mixed-pages.pdf', import.meta.url));
  const before = await readPdf(bytes);
  expect(before.pages[0].text).toContain('TEXT_FOOTER_PAGE_1'); expect(before.pages[0].text).not.toContain('MIXED-SCAN-9172');
  const after = await readPdf(bytes, undefined, true);
  expect(after.pages[0].text).toContain('TEXT_FOOTER_PAGE_1'); expect(after.pages[0].text).toContain('MIXED-SCAN-9172');
});
