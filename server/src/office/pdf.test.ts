import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPdf } from './pdf.js';
import { parseFileToText } from '../fileParser/localFileParser.js';

const fixture = () => readFile(new URL('./fixtures/text-pages.pdf', import.meta.url));

describe('local PDF text extraction', () => {
  afterEach(() => vi.useRealTimers());

  it('reads Chinese and preserves real page numbers, empty-page warnings and input bytes', async () => {
    const bytes = await fixture(), original = Buffer.from(bytes);
    const result = await readPdf(bytes);
    expect(result.pages.map(page => page.page)).toEqual([1, 2, 3]);
    expect(result.pages[0].text).toContain('中文 PDF 读取验收');
    expect(result.pages[2].text).toContain('PDF_LAST_CODE: last-page-93');
    expect(result.warnings.join('')).toContain('第 2 页');
    expect(bytes).toEqual(original);
    const parsed = await parseFileToText('中文.pdf', bytes);
    expect(parsed).toMatchObject({ ok: true, fileType: 'pdf', warnings: result.warnings });
    if (parsed.ok) expect(parsed.content).toContain('### 第 3 页');
  });

  it('rejects locked, corrupt, oversized and excessive-page PDFs without returning document text', async () => {
    await expect(readPdf(await readFile(new URL('./fixtures/password.pdf', import.meta.url)))).rejects.toThrow('需要密码');
    await expect(readPdf(Buffer.from('%PDF-1.7\nnot a PDF'))).rejects.toThrow('PDF 解析失败');
    await expect(readPdf(Buffer.alloc(16 * 1024 * 1024 + 1))).rejects.toThrow('16 MiB');
    await expect(readPdf(await readFile(new URL('./fixtures/too-many-pages.pdf', import.meta.url)))).rejects.toThrow('200 页');
    await expect(readPdf(await readFile(new URL('./fixtures/too-much-text.pdf', import.meta.url)))).rejects.toThrow('1 MiB');
  });

  it('does not call unread scans successfully parsed empty documents', async () => {
    const bytes = await readFile(new URL('./fixtures/no-text.pdf', import.meta.url));
    const result = await readPdf(bytes);
    expect(result.pages).toEqual([{ page: 1, text: '' }]);
    expect(result.warnings.join('')).toContain('尚未进行 OCR');
    expect(await parseFileToText('scan.pdf', bytes)).toMatchObject({ ok: false, error: expect.stringContaining('OCR') });
  });

  it('terminates cancelled readers and rejects excess concurrent readers without leaking admission', async () => {
    const bytes = await fixture(), a = new AbortController(), b = new AbortController();
    const first = readPdf(bytes, a.signal), second = readPdf(bytes, b.signal);
    const settled = Promise.allSettled([first, second]);
    await expect(readPdf(bytes)).rejects.toThrow('稍后重试');
    a.abort(); b.abort();
    expect((await settled).every(result => result.status === 'rejected')).toBe(true);
    expect((await readPdf(bytes)).pages).toHaveLength(3);
    await expect(readPdf(bytes, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('kills a reader at its deadline and releases admission for later reads', async () => {
    const bytes = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reading = readPdf(bytes);
    const rejected = expect(reading).rejects.toThrow('读取超时');
    vi.advanceTimersByTime(30_000);
    await rejected;
    vi.useRealTimers();
    expect((await readPdf(bytes)).pages).toHaveLength(3);
  });
});
