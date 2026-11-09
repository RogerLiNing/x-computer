import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { officeReadFixtures } from './readFixtures.js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { readPptx } from './index.js';
import { editOfficeXml } from './edit.js';

describe('Office XML edits preserve the source package', () => {
  it.each(['noBreakHyphen','softHyphen','cr','sym'])('does not mistake %s word boundaries for continuous text', async boundary => {
    const source=await officeReadFixtures({word:'AB',sheet:'old',slide:'old'}),zip=await JSZip.loadAsync(source.docx);
    zip.file('word/document.xml',(await zip.file('word/document.xml')!.async('string')).replace('AB',`A</w:t><w:${boundary}/><w:t>B`));
    await expect(editOfficeXml(await zip.generateAsync({type:'nodebuffer'}),'docx',{find:'AB',replace:'changed',expected_occurrences:1})).rejects.toThrow('边界');
  });
  it('edits a displayed slide with split text runs and preserves every other package part', async () => {
    const source = await officeReadFixtures({ word: 'old', sheet: 'old', slide: 'OLD_CODE' });
    const zip = await JSZip.loadAsync(source.pptx);
    const part = 'ppt/slides/slide1.xml';
    const ns = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const document = new DOMParser().parseFromString(await zip.file(part)!.async('string'), 'application/xml');
    const node = Array.from(document.getElementsByTagNameNS(ns, 't')).find(item => item.textContent?.includes('OLD_CODE'))!;
    const run = node.parentNode!;
    node.textContent = 'LAST_CODE: OLD_';
    const continuation = document.createElementNS(ns, 'a:r');
    const style = document.createElementNS(ns, 'a:rPr');
    style.setAttribute('b', '1');
    continuation.appendChild(style);
    const tail = document.createElementNS(ns, 'a:t');
    tail.textContent = 'CODE';
    continuation.appendChild(tail);
    run.parentNode!.insertBefore(continuation, run.nextSibling);
    zip.file(part, new XMLSerializer().serializeToString(document));
    zip.file('ppt/media/preserved.bin', Buffer.from('preserved-image-bytes'));
    const original = await zip.generateAsync({ type: 'nodebuffer' });
    const unchanged = Buffer.from(original);
    const result = await editOfficeXml(original, 'pptx', {
      slide: 2, find: 'OLD_CODE', replace: '新的<&>说明', expected_occurrences: 1,
    });
    expect(original).toEqual(unchanged);
    expect(result.changes).toBe(1);
    const slides = await readPptx(result.buffer);
    expect(slides[0].title).toBe('实际第一页');
    expect(slides[1].content).toContain('新的<&>说明');
    const edited = await JSZip.loadAsync(result.buffer);
    expect(await edited.file(part)!.async('string')).toContain('b="1"');
    for (const name of Object.keys(zip.files).filter(name => !zip.files[name].dir && name !== part)) {
      expect(await edited.file(name)!.async('nodebuffer')).toEqual(await zip.file(name)!.async('nodebuffer'));
    }
    await expect(editOfficeXml(original, 'pptx', { slide: 1, find: 'OLD_CODE', replace: 'wrong page', expected_occurrences: 1 })).rejects.toThrow('实际匹配');
    await expect(editOfficeXml(original, 'pptx', { slide: 2, find: 'OLD_CODE', replace: 'wrong count', expected_occurrences: 2 })).rejects.toThrow('实际匹配');
    await expect(editOfficeXml(original, 'pptx', { slide: 3, find: 'OLD_CODE', replace: 'wrong range', expected_occurrences: 1 })).rejects.toThrow('超出');
    run.parentNode!.insertBefore(document.createElementNS(ns, 'a:br'), continuation);
    zip.file(part, new XMLSerializer().serializeToString(document));
    await expect(editOfficeXml(await zip.generateAsync({ type: 'nodebuffer' }), 'pptx', {
      slide: 2, find: 'OLD_CODE', replace: 'not continuous', expected_occurrences: 1,
    })).rejects.toThrow('边界');
  });

  it('refuses a shared slide part instead of changing two displayed pages at once', async () => {
    const source = await officeReadFixtures({ word: 'old', sheet: 'old', slide: 'old' });
    const zip = await JSZip.loadAsync(source.pptx);
    const presentation = new DOMParser().parseFromString(await zip.file('ppt/presentation.xml')!.async('string'), 'application/xml');
    const slides = Array.from(presentation.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId'));
    const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    slides[1].setAttributeNS(relationships, 'r:id', slides[0].getAttributeNS(relationships, 'id')!);
    zip.file('ppt/presentation.xml', new XMLSerializer().serializeToString(presentation));
    await expect(editOfficeXml(await zip.generateAsync({ type: 'nodebuffer' }), 'pptx', {
      slide: 1, find: 'FIRST_PAGE_ONLY', replace: 'changed', expected_occurrences: 1,
    })).rejects.toThrow('共享内容');
  });

  it('clears all array formula output caches after modifying an input',async()=>{
    const source=await officeReadFixtures({word:'old',sheet:'old',slide:'old'}),zip=await JSZip.loadAsync(source.xlsx);
    zip.file('xl/worksheets/sheet1.xml',(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace(/<sheetData>[\s\S]*?<\/sheetData>/,'<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="array" ref="B1:B3">A1*ROW(A1:A3)</f><v>1</v></c></row><row r="2"><c r="B2"><v>2</v></c></row><row r="3"><c r="B3"><v>3</v></c></row></sheetData>'));
    const result=await editOfficeXml(await zip.generateAsync({type:'nodebuffer'}),'xlsx',{cells:[{sheet:'材料表',cell:'A1',value:'2'}]}),after=await JSZip.loadAsync(result.buffer),xml=await after.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<f t="array" ref="B1:B3">');expect(xml).toContain('<c r="B2"/>');expect(xml).toContain('<c r="B3"/>');expect(xml).toContain('<c r="A1" t="n"><v>2</v></c>');
  });
  it('replaces text split across styled Word runs and retains untouched parts', async () => {
    const source = await officeReadFixtures({ word: 'OLD_CODE', sheet: 'old', slide: 'old' });
    const zip = await JSZip.loadAsync(source.docx);
    const xml = (await zip.file('word/document.xml')!.async('string')).replace('OLD_CODE', 'OLD_</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>CODE');
    zip.file('word/document.xml', xml); zip.file('word/media/keep.bin', Buffer.from('image-preserve'));
    const bytes = await zip.generateAsync({ type: 'nodebuffer' }), original = Buffer.from(bytes);
    const result = await editOfficeXml(bytes, 'docx', { find: 'OLD_CODE', replace: 'NEW<&>文字', expected_occurrences: 1 });
    const edited = await JSZip.loadAsync(result.buffer), output = await edited.file('word/document.xml')!.async('string');
    expect(output).toContain('NEW&lt;&amp;&gt;文字'); expect(output).toContain('<w:b/>');
    expect(await edited.file('word/media/keep.bin')!.async('string')).toBe('image-preserve');
    expect(await edited.file('[Content_Types].xml')!.async('string')).toBe(await zip.file('[Content_Types].xml')!.async('string'));
    expect(bytes).toEqual(original); expect(result.changes).toBe(1);
    await expect(editOfficeXml(bytes, 'docx', { find: 'OLD_CODE', replace: 'x', expected_occurrences: 2 })).rejects.toThrow('匹配');
  });

  it('patches spreadsheet cells while retaining formulas, styles, package parts and original bytes', async () => {
    const source = await officeReadFixtures({ word: 'old', sheet: 'old', slide: 'old' });
    const zip = await JSZip.loadAsync(source.xlsx);
    zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace('r="B2"', 'r="B2" s="4"'));
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await editOfficeXml(bytes, 'xlsx', { cells: [{ sheet: '材料表', cell: 'B2', value: '=not-a-formula' }] });
    const edited = await JSZip.loadAsync(result.buffer), xml = await edited.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('=not-a-formula'); expect(xml).toContain('s="4"'); expect(xml).toContain('<f>SUM(3,4,5)</f>');
    expect(xml).not.toContain(`<v>${[3,4,5].reduce((sum,n)=>sum+n,0)}</v>`);
    expect(await edited.file('xl/workbook.xml')!.async('string')).toContain('fullCalcOnLoad="1"');
    expect(result.warnings.join('')).toContain('重算');
    expect(await edited.file('[Content_Types].xml')!.async('string')).toBe(await zip.file('[Content_Types].xml')!.async('string'));
    await expect(editOfficeXml(bytes, 'xlsx', { cells: [{ sheet: '材料表', cell: 'B3', value: '0' }] })).rejects.toThrow('公式');
    await expect(editOfficeXml(bytes, 'xlsx', { cells: [{ sheet: '材料表', cell: 'XFD1', value: 'x' }] })).rejects.toThrow('范围');
  });
});
