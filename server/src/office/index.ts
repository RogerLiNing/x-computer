/**
 * 办公文档：docx、xlsx、pptx 的创建与读取，供 X 与任务使用。
 * 生成结果为 Buffer，由调用方写入沙箱或返回。
 */

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import PptxGenJSImport from 'pptxgenjs';
import JSZip from 'jszip';
import path from 'node:path';
import {validateOfficeArchive,validateSpreadsheetFile} from './archiveGuard.js';

const MAX_TEXT=1024*1024;
function boundedText(text:string){if(Buffer.byteLength(text)>MAX_TEXT)throw new Error('提取文本超过 1 MiB，请按章节拆分文档');return text;}

// ─── Word (docx) ───────────────────────────────────────────────────────────

function markdownInlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
    const index = match.index ?? 0;
    if (index > cursor) runs.push(new TextRun(text.slice(cursor, index)));
    runs.push(new TextRun({ text: match[1], bold: true }));
    cursor = index + match[0].length;
  }
  if (cursor < text.length) runs.push(new TextRun(text.slice(cursor)));
  return runs.length ? runs : [new TextRun(text)];
}

/** 根据纯文本生成 docx Buffer，按换行拆成段落 */
export async function createDocx(content: string, title?: string): Promise<Buffer> {
  const lines = (content ?? '').trim().split(/\r?\n/);
  const children: Paragraph[] = [];
  if (title?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: title.trim(), bold: true, size: 36 })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
      }),
    );
  }
  for (const rawLine of lines.length ? lines : ['']) {
    const line = rawLine.trim();
    if (!line) {
      children.push(new Paragraph(''));
      continue;
    }
    if (/^[-*_]{3,}$/.test(line)) continue;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length === 1
        ? HeadingLevel.HEADING_1
        : heading[1].length === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      children.push(
        new Paragraph({
          text: heading[2],
          heading: level,
          spacing: { before: 240, after: 120 },
        }),
      );
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      children.push(
        new Paragraph({
          children: markdownInlineRuns(bullet[1]),
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      );
      continue;
    }
    children.push(
      new Paragraph({
        children: markdownInlineRuns(line),
        spacing: { after: 120, line: 360 },
      }),
    );
  }
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

/** 从 docx Buffer 提取纯文本（供摘要、检索） */
export async function readDocx(buffer: Buffer): Promise<string> {
  validateOfficeArchive(buffer);
  const result = await mammoth.extractRawText({ buffer });
  return boundedText((result?.value ?? '').trim());
}

// ─── Excel (xlsx) ─────────────────────────────────────────────────────────

export interface SheetData {
  name: string;
  rows: string[][];
  range?:string;
}

/** 根据表数据生成 xlsx Buffer；sheets 为多表，每表有 name 和 rows（二维数组） */
export function createXlsx(sheets: SheetData[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const name = (sheet.name || 'Sheet').slice(0, 31);
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows ?? []);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return Buffer.from(
    XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: false }),
  );
}

/** 从 xlsx Buffer 读取所有表为 { name, rows }[] */
export function readXlsx(buffer: Buffer): SheetData[] {
  validateSpreadsheetFile(buffer);
  const headers=XLSX.read(buffer,{type:'buffer',bookSheets:true});
  if(headers.SheetNames.length>32||headers.SheetNames.some(name=>name.length>31)||new Set(headers.SheetNames.map(name=>name.toLowerCase())).size!==headers.SheetNames.length)throw new Error('工作表数量或名称不符合读取限制');
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellFormula:false,cellHTML:false,cellStyles:false,bookVBA:false,sheetRows:10001 });
  if(wb.SheetNames.length>32)throw new Error('工作表超过 32 张，请拆分工作簿');
  const out: SheetData[] = [];
  let cells=0,textBytes=0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if(name.length>31)throw new Error('工作表名称超过标准长度');
    const reference=ws['!fullref']??ws['!ref'];
    if(reference){
      const range=XLSX.utils.decode_range(reference);const rows=range.e.r-range.s.r+1,columns=range.e.c-range.s.c+1;cells+=rows*columns;
      if(range.e.r>=10000||range.e.c>=256||rows>10000||columns>256||cells>100000)throw new Error('表格范围超过读取上限，请拆分工作表或清除多余格式');
    }
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
    const normalized=rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]));
    for(const row of normalized)for(const value of row){textBytes+=Buffer.byteLength(value);if(textBytes>MAX_TEXT)throw new Error('表格文本超过 1 MiB，请拆分工作表');}
    out.push({ name, rows: normalized,range:reference });
  }
  return out;
}

// ─── PowerPoint (pptx) ───────────────────────────────────────────────────────

export interface SlideData {
  title?: string;
  content?: string;
}

/** 根据幻灯片列表生成 pptx Buffer */
export async function createPptx(slides: SlideData[]): Promise<Buffer> {
  const PptxGenJS = (
    typeof PptxGenJSImport === 'function'
      ? PptxGenJSImport
      : (PptxGenJSImport as unknown as { default: typeof PptxGenJSImport }).default
  );
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'X-Computer';
  pptx.company = 'X-Computer';
  pptx.subject = 'AI generated presentation';
  pptx.title = slides?.[0]?.title || 'X-Computer 演示文稿';

  const normalizedSlides = slides?.length ? slides : [{ title: '未命名', content: '' }];
  normalizedSlides.forEach((slide, index) => {
    const s = pptx.addSlide();
    s.background = { color: index === 0 ? '101827' : 'F7F5F0' };
    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: index === 0 ? 0.18 : 0.12,
      h: 7.5,
      line: { color: 'C8A96E', transparency: 100 },
      fill: { color: 'C8A96E' },
    });
    if (slide.title?.trim()) {
      s.addText(slide.title.trim(), {
        x: 0.7,
        y: index === 0 ? 1.55 : 0.55,
        w: 11.8,
        h: index === 0 ? 1.2 : 0.7,
        fontFace: 'Aptos Display',
        fontSize: index === 0 ? 30 : 24,
        bold: true,
        color: index === 0 ? 'F7F5F0' : '18212F',
        margin: 0,
      });
    }
    if (slide.content?.trim()) {
      s.addText(slide.content.trim(), {
        x: 0.75,
        y: index === 0 ? 3.05 : 1.55,
        w: 11.4,
        h: index === 0 ? 2.6 : 4.95,
        fontFace: 'Aptos',
        fontSize: index === 0 ? 18 : 16,
        color: index === 0 ? 'D8DEE9' : '354052',
        breakLine: false,
        paraSpaceAfter: 12,
        lineSpacingMultiple: 1.1,
        valign: 'top',
        margin: 0.04,
      });
    }
    s.addText(`${index + 1}  ·  X-Computer`, {
      x: 10.8,
      y: 7.05,
      w: 1.8,
      h: 0.22,
      fontSize: 8,
      color: index === 0 ? '8D99AA' : '8A8F98',
      align: 'right',
      margin: 0,
    });
  });
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

/** Resolve displayed slide order once for reading and copy edits. */
export async function pptxSlidePaths(zip: JSZip): Promise<string[]> {
  let slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => {
      const leftNo = Number(left.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const rightNo = Number(right.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return leftNo - rightNo;
    });
  const structuralXml=(value:string|undefined)=>value?.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
  const presentation=structuralXml(await zip.file('ppt/presentation.xml')?.async('string')),relations=structuralXml(await zip.file('ppt/_rels/presentation.xml.rels')?.async('string'));
  if(presentation&&relations){
    const attributes=(tag:string)=>Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)].map(match=>[match[1],match[3]]));
    const targets=new Map<string,string>();
    for(const match of relations.matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)){
      const attrs=attributes(match[0]);if(!attrs.Type?.endsWith('/slide'))continue;
      if(attrs.TargetMode==='External'||!attrs.Target||/^[a-z]+:/i.test(attrs.Target))throw new Error('不支持外部幻灯片引用');
      const decoded=decodeURIComponent(attrs.Target.replace(/&amp;/g,'&'));const target=path.posix.normalize(decoded.startsWith('/')?decoded.slice(1):path.posix.join('ppt',decoded));if(!target.startsWith('ppt/')||!zip.file(target))throw new Error('幻灯片引用无效');targets.set(attrs.Id,target);
    }
    const ordered=[...presentation.matchAll(/<(?:[\w.-]+:)?sldId\b[^>]*>/g)].map(match=>{const attrs=attributes(match[0]),id=Object.entries(attrs).find(([key])=>key.endsWith(':id'))?.[1];return id?targets.get(id):undefined;});
    if(ordered.some(value=>!value))throw new Error('幻灯片顺序引用不完整');if(ordered.length)slidePaths=ordered as string[];
  }
  if(slidePaths.length>200)throw new Error('幻灯片超过 200 页，请拆分演示文稿');
  return slidePaths;

}

/** 从 pptx Buffer 提取每页文本，供验证、摘要和检索 */
export async function readPptx(buffer: Buffer): Promise<SlideData[]> {
  validateOfficeArchive(buffer);
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = await pptxSlidePaths(zip);

  const decodeXml = (value: string) =>
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(x[0-9a-f]+|\d+);/gi,(entity,value:string)=>{const code=value[0].toLowerCase()==='x'?parseInt(value.slice(1),16):Number(value);return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):entity;})
      .replace(/&amp;/g, '&');

  const slides: SlideData[] = [];
  for (const slidePath of slidePaths) {
    const xml = (await zip.file(slidePath)?.async('string'))?.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g,part=>part.startsWith('<![CDATA[')?part:'');
    const texts = Array.from((xml ?? '').matchAll(/<a:t(?:\s[^>]*)?>((?:<!\[CDATA\[[\s\S]*?\]\]>|(?:(?!<\/a:t>)[\s\S]))*)<\/a:t>/g))
      .map((match) => match[1].split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g).map(part=>part.startsWith('<![CDATA[')?part.slice(9,-3):decodeXml(part)).join('').trim())
      .filter(Boolean);
    slides.push({
      title: texts[0] ?? '',
      content: texts.slice(1).join('\n'),
    });
  }
  boundedText(slides.map(slide=>`${slide.title??''}\n${slide.content??''}`).join('\n'));
  return slides;
}
