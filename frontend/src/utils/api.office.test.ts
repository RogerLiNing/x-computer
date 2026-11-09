import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

vi.mock('@/store/systemLogStore', () => ({ getSystemLogStore: () => ({ addLog: vi.fn() }) }));
vi.mock('./userId.js', () => ({ getUserId: () => 'test-user', getUserIdOrNull: () => 'test-user' }));
vi.mock('../i18n.js', () => ({ default: { language: 'zh-CN' } }));
afterEach(() => vi.unstubAllGlobals());

describe('abortable PDF preview', () => {
  it('submits XML copy edits with the viewed source fingerprint',async()=>{
    const fetcher=vi.fn(async()=>new Response('{"ok":true,"path":"new.docx","changes":1,"warnings":[]}'));vi.stubGlobal('fetch',fetcher);
    await api.editOfficeCopy('source.docx','a'.repeat(64),{find:'old',replace:'new',expected_occurrences:1});
    expect(fetcher).toHaveBeenCalledWith('/api/fs/edit-office',expect.objectContaining({method:'POST',body:JSON.stringify({path:'source.docx',expectedSha256:'a'.repeat(64),content:{find:'old',replace:'new',expected_occurrences:1}})}));
  });
  it('forwards the window signal and preserves original PDF page metadata', async () => {
    const controller = new AbortController();
    const pages = [{ page: 1, text: '中文' }, { page: 2, text: '' }];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ type: 'pdf', pages, warnings: ['第 2 页未 OCR'] })));
    vi.stubGlobal('fetch', fetcher);
    expect(await api.readOfficeFile('材料.pdf', controller.signal)).toMatchObject({ type: 'pdf', pages, warnings: ['第 2 页未 OCR'] });
    expect(fetcher).toHaveBeenCalledWith('/api/fs/read-office?path=' + encodeURIComponent('材料.pdf'), expect.objectContaining({ signal: controller.signal }));
  });
});


it('binds OCR requests to the preview fingerprint and preserves abort signals', async () => {
  const signal = new AbortController().signal, sha = 'b'.repeat(64);
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ type: 'pdf', sha256: sha, pages: [{ page: 1, text: '识别内容', ocr: true }], warnings: [] })));
  vi.stubGlobal('fetch', fetcher);
  const result = await api.readOfficeFile('扫描 件.pdf', signal, { ocr: true, expectedSha256: sha });
  expect(result.pages?.[0].ocr).toBe(true);
  expect(fetcher).toHaveBeenCalledWith('/api/fs/read-office?path=' + encodeURIComponent('扫描 件.pdf') + '&ocr=true&expected_sha256=' + sha, expect.objectContaining({ signal }));
});
