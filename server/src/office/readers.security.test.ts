import{describe,it,expect}from'vitest';import JSZip from'jszip';
import{officeReadFixtures}from'./readFixtures.js';import{readDocx,readXlsx,readPptx}from'./index.js';import{validateOfficeArchive}from'./archiveGuard.js';
const codes={word:'WORD_SAMPLE',sheet:'SHEET_SAMPLE',slide:'SLIDE_SAMPLE'};
describe('bounded Office extraction',()=>{
 it('extracts OOXML text and cached spreadsheet values without modifying input buffers',async()=>{
  const sample=await officeReadFixtures(codes),copy=Buffer.from(sample.docx);expect(await readDocx(sample.docx)).toContain(codes.word);expect(sample.docx).toEqual(copy);
  const sheets=readXlsx(sample.xlsx);expect(sheets[0].rows[1][1]).toBe(codes.sheet);expect(sheets[0].rows[2][1]).toBe(String(sample.cachedValue));
  const slides=await readPptx(sample.pptx);expect(slides.map(slide=>slide.title)).toEqual(['实际第一页','实际最后一页']);expect(slides[1].content).toContain(codes.slide);
 });
 it('rejects dishonest expansion sizes before Office parsing',async()=>{
  const zip=new JSZip();zip.file('word/document.xml','x'.repeat(4*1024*1024+1024),{createFolders:false});const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const central=buffer.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));buffer.writeUInt32LE(1,central+24);buffer.writeUInt32LE(1,22);
  expect(()=>validateOfficeArchive(buffer)).toThrow(/解压|过大/);
 });
 it('applies XML bounds to renamed document parts and ignores commented slide references',async()=>{
  const sample=await officeReadFixtures(codes),word=await JSZip.loadAsync(sample.docx);
  const body=await word.file('word/document.xml')!.async('string');
  word.file('word/body.bin',body.replace('<w:body>','<w:body>'+'<x>'.repeat(150)).replace('</w:body>','</x>'.repeat(150)+'</w:body>'));
  for(const name of ['_rels/.rels','[Content_Types].xml'])word.file(name,(await word.file(name)!.async('string')).replaceAll('word/document.xml','word/body.bin'));
  await expect(readDocx(await word.generateAsync({type:'nodebuffer'}))).rejects.toThrow(/层级/);
  const deck=await JSZip.loadAsync(sample.pptx),presentation=await deck.file('ppt/presentation.xml')!.async('string');
  const reference=presentation.match(/<p:sldId\b[^>]*\/>/)![0];
  deck.file('ppt/presentation.xml',presentation.replace('</p:sldIdLst>',`<!--${reference}--><![CDATA[${reference}]]></p:sldIdLst>`));
  const slides=await readPptx(await deck.generateAsync({type:'nodebuffer'}));
  expect(slides.map(slide=>slide.title)).toEqual(['实际第一页','实际最后一页']);
  const slidePath='ppt/slides/slide1.xml',slideXml=await deck.file(slidePath)!.async('string');
  deck.file(slidePath,slideXml.replace(/<a:t>LAST_CODE:[\s\S]*?<\/a:t>/,'<a:t><![CDATA[before <!-- literal --> </a:t> after]]></a:t>'));
  const literalSlides=await readPptx(await deck.generateAsync({type:'nodebuffer'}));
  expect(literalSlides[1].content).toContain('before <!-- literal --> </a:t> after');
 });
 it('rejects entities, excessive nesting, checksum corruption and unsafe paths',async()=>{
  for(const xml of ['<!DOCTYPE x [<!ENTITY x "unsafe">]><x>&x;</x>','<x>'.repeat(130)+'</x>'.repeat(130)]){const zip=new JSZip();zip.file('word/document.xml',xml);const data=await zip.generateAsync({type:'nodebuffer'});expect(()=>validateOfficeArchive(data)).toThrow(/声明|层级/);}
  const zip=new JSZip();zip.file('word/document.xml','<x>safe</x>',{createFolders:false});const data=await zip.generateAsync({type:'nodebuffer'});const start=30+data.readUInt16LE(26)+data.readUInt16LE(28);data[start]^=1;expect(()=>validateOfficeArchive(data)).toThrow(/校验/);
  const bad=new JSZip();bad.file('../escape.xml','<x/>');await expect(Promise.resolve(bad.generateAsync({type:'nodebuffer'})).then(value=>validateOfficeArchive(value))).rejects.toThrow(/路径/);
 });
 it('rejects extreme spreadsheet dimensions instead of allocating a sparse range',async()=>{
  const sample=await officeReadFixtures(codes),zip=await JSZip.loadAsync(sample.xlsx),xml=await zip.file('xl/worksheets/sheet1.xml')!.async('string');zip.file('xl/worksheets/sheet1.xml',xml.replace('A1:B3','A1:XFD1048576'));
  expect(()=>readXlsx(sample.xlsx)).not.toThrow();const data=await zip.generateAsync({type:'nodebuffer'});expect(()=>readXlsx(data)).toThrow(/范围/);
  zip.file('xl/worksheets/sheet1.xml',xml.replace('A1:B3','Z10001:Z10001'));const sparse=await zip.generateAsync({type:'nodebuffer'});expect(()=>readXlsx(sparse)).toThrow(/范围/);
 });
});
