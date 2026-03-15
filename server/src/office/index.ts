/**
 * 办公文档：docx、xlsx、pptx 的创建与读取，供 X 与任务使用。
 * 生成结果为 Buffer，由调用方写入沙箱或返回。
 */

import { Document, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';

// ─── Word (docx) ───────────────────────────────────────────────────────────

/** 根据纯文本生成 docx Buffer，按换行拆成段落 */
export async function createDocx(content: string, title?: string): Promise<Buffer> {
  const lines = (content ?? '').trim().split(/\r?\n/).filter((s) => s.length > 0);
  const children: Paragraph[] = [];
  if (title?.trim()) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: title.trim(), bold: true })],
        spacing: { after: 200 },
      }),
    );
  }
  for (const line of lines.length ? lines : ['']) {
    children.push(new Paragraph(line));
  }
  const doc = new Document({
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

/** 从 docx Buffer 提取纯文本（供摘要、检索） */
export async function readDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result?.value ?? '').trim();
}

// ─── Excel (xlsx) ─────────────────────────────────────────────────────────

export interface SheetData {
  name: string;
  rows: string[][];
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
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const out: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
    out.push({ name, rows: rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)])) });
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
  const pptx = new PptxGenJS();
  for (const slide of slides?.length ? slides : [{ title: '未命名', content: '' }]) {
    const s = pptx.addSlide();
    if (slide.title?.trim()) {
      s.addText(slide.title.trim(), { x: 0.5, y: 0.5, w: 9, h: 0.75, fontSize: 24, bold: true });
    }
    if (slide.content?.trim()) {
      s.addText(slide.content.trim(), {
        x: 0.5,
        y: 1.4,
        w: 9,
        h: 5,
        fontSize: 14,
        valign: 'top',
      });
    }
  }
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
