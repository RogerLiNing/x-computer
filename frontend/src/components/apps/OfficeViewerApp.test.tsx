import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PresentationText, PdfTextPreview, sheetCellAddress} from './OfficeViewerApp';
vi.mock('@/utils/api',()=>({api:{}}));
vi.mock('@/store/desktopStore',()=>({useDesktopStore:vi.fn()}));
vi.mock('@/store/connectionStore',()=>({useConnectionStore:vi.fn()}));

describe('presentation text preview',()=>{
 it('maps displayed cells to their actual source address when ranges start after A1',()=>{
  expect(sheetCellAddress('C8:F10',0,0)).toBe('C8');expect(sheetCellAddress('Z9:AB12',1,2)).toBe('AB10');expect(sheetCellAddress(undefined,0,0)).toBe('A1');
 });
 it('shows original PDF page numbers, escapes text and warns about unread scans',()=>{
  const html=renderToStaticMarkup(<PdfTextPreview pages={[{page:1,text:'<script>alert(1)</script>'},{page:2,text:''},{page:3,text:'中文结尾'}]} warnings={['第 2 页尚未进行 OCR']}/>);
  expect(html).toContain('第 3 页');expect(html).toContain('中文结尾');expect(html).not.toContain('<script>');
  expect(html).toContain('role="status"');expect(html).toContain('第 2 页尚未进行 OCR');expect(html).toContain('下载原文件');expect(html).not.toContain('保存');
 });
 it('keeps presentation order, escapes document text and explains image-only pages',()=>{
  const html=renderToStaticMarkup(<PresentationText slides={[{title:'第一页',content:'<script>alert(1)</script>'},{title:'最后一页',content:'LAST_CODE'},{title:'',content:''}]}/>);
  expect(html.indexOf('第一页')).toBeLessThan(html.indexOf('最后一页'));
  expect(html).toContain('LAST_CODE');expect(html).not.toContain('<script>');
  expect(html).toContain('这一页没有可读取的文字');expect(html).toContain('图片、版式和演讲备注');
  expect(html).not.toContain('保存');expect(html).not.toContain('即将支持');
 });
});


it('labels recognized PDF pages and keeps scan warnings visible', () => {
  const html = renderToStaticMarkup(<PdfTextPreview pages={[{ page: 1, text: '识别内容', ocr: true }]} warnings={['请核对原件']} />);
  expect(html).toContain('识别完成'); expect(html).toContain('第 1 页'); expect(html).toContain('请核对原件');
  expect(html).not.toContain('尚未进行扫描件 OCR'); expect(html).not.toContain('保存');
});


it('does not call an unread blank scan successfully recognized', () => {
  const html = renderToStaticMarkup(<PdfTextPreview pages={[{ page: 1, text: '', ocr: true }]} warnings={['第 1 页未识别出文字']} />);
  expect(html).toContain('没有识别出文字'); expect(html).not.toContain('识别完成'); expect(html).toContain('更清晰');
});
