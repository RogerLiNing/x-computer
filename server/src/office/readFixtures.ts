/** Synthetic OOXML packages for parser regression tests and local acceptance; no user document is edited. */
import JSZip from 'jszip';
import {createPptx}from'./index.js';
const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const REL='http://schemas.openxmlformats.org/package/2006/relationships',OFFICE='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const types=(parts:Array<[string,string]>)=>`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.map(([name,type])=>`<Override PartName="/${name}" ContentType="${type}"/>`).join('')}</Types>`;
const rootRelationship=(target:string)=>`<Relationships xmlns="${REL}"><Relationship Id="rRoot" Type="${OFFICE}/officeDocument" Target="${target}"/></Relationships>`;
async function pack(files:Record<string,string>){const zip=new JSZip();for(const[name,xml]of Object.entries(files))zip.file(name,'<?xml version="1.0" encoding="UTF-8"?>'+xml);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
export async function officeReadFixtures(codes:{word:string;sheet:string;slide:string}){
 const docx=await pack({
  '[Content_Types].xml':types([['word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml']]),'_rels/.rels':rootRelationship('word/document.xml'),
  'word/document.xml':`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>文档读取验收样本</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">WORD_CODE: ${escape(codes.word)}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
 });
 const cachedValue=[3,4,5].reduce((sum,value)=>sum+value,0);
 const cell=(ref:string,text:string)=>`<c r="${ref}" t="inlineStr"><is><t>${escape(text)}</t></is></c>`;
 const xlsx=await pack({
  '[Content_Types].xml':types([['xl/workbook.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],['xl/worksheets/sheet1.xml','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']]),'_rels/.rels':rootRelationship('xl/workbook.xml'),
  'xl/workbook.xml':`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OFFICE}"><sheets><sheet name="材料表" sheetId="1" r:id="sheetRel"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${REL}"><Relationship Id="sheetRel" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B3"/><sheetData><row r="1">${cell('A1','字段')}${cell('B1','值')}</row><row r="2">${cell('A2','SHEET_CODE')}${cell('B2',codes.sheet)}</row><row r="3">${cell('A3','CACHED_TOTAL')}<c r="B3"><f>SUM(3,4,5)</f><v>${cachedValue}</v></c></row></sheetData></worksheet>`,
 });
 const originalDeck=await createPptx([{title:'实际最后一页',content:`LAST_CODE: ${codes.slide}`},{title:'实际第一页',content:'NOT_LAST_CODE: FIRST_PAGE_ONLY'}]);
 const deck=await JSZip.loadAsync(originalDeck),presentation=await deck.file('ppt/presentation.xml')!.async('string');
 const ids=[...presentation.matchAll(/<p:sldId\b[^>]*\/>/g)].map(match=>match[0]);if(ids.length!==2)throw new Error('Unexpected fixture slide count');
 deck.file('ppt/presentation.xml',presentation.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,`<p:sldIdLst>${ids[1]}${ids[0]}</p:sldIdLst>`));
 const pptx=await deck.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 return {docx,xlsx,pptx,cachedValue};
}
