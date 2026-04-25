import { describe, it, expect } from 'vitest';
import { parseFileToText } from './localFileParser.js';

describe('parseFileToText', () => {
  it('parses plain text', async () => {
    const res = await parseFileToText('文档/a.txt', Buffer.from('hello\nworld', 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('hello');
      expect(res.fileType).toBe('txt');
    }
  });

  it('parses json as text', async () => {
    const res = await parseFileToText('data.json', Buffer.from('{"a":1}', 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toContain('"a"');
  });

  it('rejects pdf without external API', async () => {
    const res = await parseFileToText('a.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46])); // %PDF
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/PDF/);
  });

  // --- text / markup / data formats ---

  it('parses markdown', async () => {
    const res = await parseFileToText('readme.md', Buffer.from('# Hello\n\nSome **bold** text', 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('Hello');
      expect(res.fileType).toBe('md');
    }
  });

  it('parses csv', async () => {
    const res = await parseFileToText('data.csv', Buffer.from('name,age\nAlice,30\nBob,25', 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('name');
      expect(res.content).toContain('Alice');
      expect(res.fileType).toBe('csv');
    }
  });

  it('parses html', async () => {
    const res = await parseFileToText('page.html', Buffer.from('<html><body><p>Hello</p></body></html>', 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('Hello');
      expect(res.fileType).toBe('html');
    }
  });

  it('parses xml', async () => {
    const res = await parseFileToText('data.xml', Buffer.from('<root><item>value</item></root>', 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('item');
      expect(res.fileType).toBe('xml');
    }
  });

  it('parses log file', async () => {
    const res = await parseFileToText('app.log', Buffer.from('INFO 2026-04-15 server started\nERROR connection refused', 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('INFO');
      expect(res.fileType).toBe('log');
    }
  });

  // --- unsupported but clearly-identified file types ---

  it('rejects ppt/pptx with helpful message', async () => {
    const res = await parseFileToText('slide.pptx', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/PPT/);
  });

  it('rejects png image with helpful message', async () => {
    const res = await parseFileToText('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/图片/);
  });

  it('rejects doc (old word format) with explicit note', async () => {
    const res = await parseFileToText('old.doc', Buffer.from([0xd0, 0xcf]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/DOC.*不支持|\.docx/);
  });

  it('rejects completely unknown extension', async () => {
    const res = await parseFileToText('file.xyz', Buffer.from('anything'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/不支持/);
  });

  // --- Excel (.xlsx) ---

  it('parses xlsx and returns sheet names and CSV content', async () => {
    // Build a minimal xlsx buffer using the xlsx library directly
    const xlsx = await import('xlsx');
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([
      ['Name', 'Age', 'City'],
      ['Alice', '30', 'Beijing'],
      ['Bob', '25', 'Shanghai'],
    ]);
    xlsx.utils.book_append_sheet(wb, ws, 'People');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const res = await parseFileToText('staff.xlsx', buf);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('Name');
      expect(res.content).toContain('Alice');
      expect(res.content).toContain('People');
      expect(res.fileType).toBe('xlsx');
    }
  });

  it('parses xls (legacy Excel format) as CSV', async () => {
    const xlsx = await import('xlsx');
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([['Item', 'Qty'], ['Apple', '5']]);
    xlsx.utils.book_append_sheet(wb, ws, 'Inventory');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xls' });

    const res = await parseFileToText('inventory.xls', buf);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('Item');
      expect(res.content).toContain('Apple');
      expect(res.fileType).toBe('xls');
    }
  });

  // --- DOCX ---

  it('extracts text from a valid docx buffer', async () => {
    // Use the docx package to generate a real valid DOCX buffer
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ children: [new TextRun('Hello World')] }),
        ],
      }],
    });
    const buf = await Packer.toBuffer(doc);

    const res = await parseFileToText('report.docx', buf);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.content).toContain('Hello World');
      expect(res.fileType).toBe('docx');
    }
  });

  it('docx parse error returns ok=false without throwing', async () => {
    // Corrupt DOCX (ZIP header but invalid content) → mammoth should throw, parser catches it
    const corruptZip = Buffer.concat([
      Buffer.from('PK\x03\x04'),            // local file header signature
      Buffer.alloc(26),                      // rest of local file header (all zeros)
    ]);
    const res = await parseFileToText('corrupt.docx', corruptZip);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/DOCX|解析/);
  });

  // --- edge cases ---

  it('trims trailing whitespace from text content', async () => {
    const withTrailing = 'data\n' + '  \n'.repeat(10);
    const res = await parseFileToText('trim.txt', Buffer.from(withTrailing, 'utf-8'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content.endsWith('  \n')).toBe(false);
  });

  it('returns unknown fileType when extension is absent', async () => {
    const res = await parseFileToText('noextension', Buffer.from('some text', 'utf-8'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/不支持|unknown/);
  });
});

