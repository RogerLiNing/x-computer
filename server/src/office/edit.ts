import JSZip from 'jszip';
import { DOMParser, XMLSerializer, onWarningStopParsing, type Element } from '@xmldom/xmldom';
import * as XLSX from 'xlsx';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pptxSlidePaths } from './index.js';
import { validateOfficeArchive } from './archiveGuard.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const parse = (xml: string) => new DOMParser({ onError: onWarningStopParsing }).parseFromString(xml, 'application/xml');
const serialize = (xml: ReturnType<typeof parse>) => new XMLSerializer().serializeToString(xml);
const elements = (parent: Element, ns: string, name: string) => Array.from(parent.getElementsByTagNameNS(ns, name));
const direct = (parent: Element, ns: string, name: string) => Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && node.namespaceURI === ns && node.localName === name);
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff]/u.test(value)) throw new Error('修改文字无效或过长');
  return value;
}

/** Modify selected XML nodes only; untouched ZIP parts retain their original bytes. */
export async function editOfficeXml(buffer: Buffer, type: 'docx' | 'xlsx' | 'pptx', input: Record<string, unknown>) {
  validateOfficeArchive(buffer);
  const zip = await JSZip.loadAsync(buffer);
  if (Object.keys(zip.files).some(name => name.toLowerCase().startsWith('_xmlsignatures/') || /vbaProject\.bin$/i.test(name))) throw new Error('暂不修改签名或宏文档，请提供无签名的普通副本');
  const warnings: string[] = [];
  let changes = 0;
  if (type === 'docx' || type === 'pptx') {
    const find = text(input.find, 1000), replacement = text(input.replace, 10000), expected = input.expected_occurrences;
    if (!find || /[\r\n\t]/.test(find + replacement) || replacement === find || typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1 || expected > 10000) throw new Error('请填写单段查找文字、不同的替换文字及预期匹配次数');
    const word = type === 'docx';
    let target = 'word/document.xml';
    if (!word) {
      if (!Number.isSafeInteger(input.slide) || Number(input.slide) < 1) throw new Error('请提供从 1 开始的演示页码');
      if (!zip.file('ppt/presentation.xml') || !zip.file('ppt/_rels/presentation.xml.rels')) throw new Error('演示稿缺少页面顺序信息');
      const slides = await pptxSlidePaths(zip);
      if (Number(input.slide) > slides.length) throw new Error('演示页码超出范围');
      target = slides[Number(input.slide) - 1];
      if (slides.filter(slide => slide === target).length !== 1) throw new Error('该页面与其他页共享内容，请先用办公软件拆分页面');
    }
    const namespace = word ? WORD : DRAWING;
    const entry = zip.file(target);
    if (!entry) throw new Error('正文 XML 不存在');
    const document = parse(await entry.async('string'));
    if (document.documentElement?.namespaceURI !== (word ? WORD : PRESENTATION)
      || (!word && document.documentElement.localName !== 'sld')) throw new Error('暂不支持该办公 XML 格式');
    for (const paragraph of Array.from(document.getElementsByTagNameNS(namespace, 'p'))) {
      const nodes = elements(paragraph, namespace, 't').filter(node => {
        let ancestor = node.parentNode;
        while (ancestor && !(ancestor.nodeType === 1 && ancestor.namespaceURI === namespace && ancestor.localName === 'p')) ancestor = ancestor.parentNode;
        return ancestor === paragraph;
      });
      const values = nodes.map(node => node.textContent ?? ''), whole = values.join(''), matches: number[] = [];
      for (let at = whole.indexOf(find); at >= 0; at = whole.indexOf(find, at + find.length)) matches.push(at);
      if (!matches.length) continue;
      const boundaries = word ? ['fldChar','instrText','tab','br','cr','noBreakHyphen','softHyphen','sym','drawing','pict','object','footnoteReference','endnoteReference','delText','delInstrText'] : ['br', 'fld'];
      if (boundaries.some(name => elements(paragraph, namespace, name).length)) throw new Error('匹配段落包含特殊文字、域或图文边界，暂不自动修改，请另行处理');
      const starts: number[] = []; let offset = 0;
      for (const value of values) { starts.push(offset); offset += value.length; }
      // Work backwards so original run offsets remain valid across repeated matches.
      for (const at of matches.reverse()) {
        const end = at + find.length;
        const first = values.findIndex((value, i) => starts[i] <= at && starts[i] + value.length > at);
        const last = values.findIndex((value, i) => starts[i] < end && starts[i] + value.length >= end);
        if (first < 0 || last < 0) throw new Error('段落文字边界无效');
        for (let i = first; i <= last; i++) {
          const current = nodes[i].textContent ?? '';
          nodes[i].textContent = (i === first ? current.slice(0, at - starts[i]) + replacement : '') + (i === last ? current.slice(end - starts[i]) : '');
          nodes[i].setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        }
        changes++;
      }
    }
    if (changes !== expected) throw new Error(`实际匹配 ${changes} 处，与预期 ${expected} 处不同；未保存修改`);
    zip.file(target, serialize(document));
    warnings.push(word
      ? '仅替换正文及表格段落文字；替换文字沿用起始位置样式，页眉、脚注等未修改。页码可能随文字长度变化。'
      : '仅替换指定页的文字，跨样式替换沿用起始位置样式。文字长度变化可能影响排版，请打开副本核对。');
  } else if (type === 'xlsx') {
    if (!Array.isArray(input.cells) || !input.cells.length || input.cells.length > 1000) throw new Error('请提供 1 至 1000 个单元格修改');
    const workbook = parse(await zip.file('xl/workbook.xml')?.async('string') ?? '');
    const workbookRoot = workbook.documentElement;
    if (!workbookRoot || workbookRoot.namespaceURI !== SHEET) throw new Error('工作簿 XML 格式不受支持');
    const relationships = parse(await zip.file('xl/_rels/workbook.xml.rels')?.async('string') ?? '');
    const targets = new Map(Array.from(relationships.getElementsByTagNameNS(REL, 'Relationship')).map(node => [node.getAttribute('Id'), node]));
    const sheets = new Map<string, { target: string; document: ReturnType<typeof parse> }>();
    for (const sheet of Array.from(workbook.getElementsByTagNameNS(SHEET, 'sheet'))) {
      const relation = targets.get(sheet.getAttributeNS(OFFICE_REL, 'id'));
      const raw = relation?.getAttribute('Target');
      if (!raw || relation?.getAttribute('TargetMode') === 'External' || !relation?.getAttribute('Type')?.endsWith('/worksheet') || /[\\%?#]|^[a-z]+:/i.test(raw)) throw new Error('工作表引用不受支持');
      const target = path.posix.normalize(raw.startsWith('/') ? raw.slice(1) : path.posix.join('xl', raw));
      if (!target.startsWith('xl/') || !zip.file(target)) throw new Error('工作表 XML 不存在');
      sheets.set(sheet.getAttribute('name') ?? '', { target, document: parse(await zip.file(target)!.async('string')) });
    }
    if (!sheets.size || sheets.size > 32) throw new Error('工作表数量不受支持');
    const seen = new Set<string>(), touched = new Set<string>();
    for (const raw of input.cells) {
      if (!raw || typeof raw !== 'object') throw new Error('单元格修改无效');
      const edit = raw as Record<string, unknown>, address = typeof edit.cell === 'string' ? edit.cell.toUpperCase() : '';
      const value = text(edit.value, 32767), sheet = sheets.get(String(edit.sheet));
      if (!sheet || !/^[A-Z]{1,3}[1-9]\d{0,4}$/.test(address)) throw new Error('工作表或单元格地址无效');
      const index = XLSX.utils.decode_cell(address), key = String(edit.sheet) + ':' + address;
      if (index.r >= 10000 || index.c >= 256) throw new Error('单元格超出支持范围');
      if (seen.has(key)) throw new Error('不能重复修改同一个单元格');
      seen.add(key);
      const document = sheet.document, root = document.documentElement;
      if (!root || root.namespaceURI !== SHEET) throw new Error('工作表 XML 格式不受支持');
      const data = direct(root, SHEET, 'sheetData')[0], dimension = direct(root, SHEET, 'dimension')[0]?.getAttribute('ref');
      if (!data || !dimension) throw new Error('工作表没有可编辑范围');
      const range = XLSX.utils.decode_range(dimension);
      if (index.r < range.s.r || index.r > range.e.r || index.c < range.s.c || index.c > range.e.c) throw new Error('单元格超出原工作表范围');
      for (const merged of elements(root, SHEET, 'mergeCell')) {
        const region = XLSX.utils.decode_range(merged.getAttribute('ref') ?? '');
        if (index.r >= region.s.r && index.r <= region.e.r && index.c >= region.s.c && index.c <= region.e.c && (index.r !== region.s.r || index.c !== region.s.c)) throw new Error('请修改合并单元格的左上角');
      }
      for (const formula of elements(root, SHEET, 'f')) {
        if (!formula.getAttribute('ref')) continue;
        const region = XLSX.utils.decode_range(formula.getAttribute('ref')!);
        if (index.r >= region.s.r && index.r <= region.e.r && index.c >= region.s.c && index.c <= region.e.c) throw new Error('数组或共享公式区域暂不直接修改');
      }
      let row = direct(data, SHEET, 'row').find(node => Number(node.getAttribute('r')) === index.r + 1);
      if (!row) {
        row = document.createElementNS(SHEET, 'row'); row.setAttribute('r', String(index.r + 1));
        data.insertBefore(row, direct(data, SHEET, 'row').find(node => Number(node.getAttribute('r')) > index.r + 1) ?? null);
      }
      let cell = direct(row, SHEET, 'c').find(node => node.getAttribute('r') === address);
      if (!cell) {
        cell = document.createElementNS(SHEET, 'c'); cell.setAttribute('r', address);
        row.insertBefore(cell, direct(row, SHEET, 'c').find(node => XLSX.utils.decode_cell(node.getAttribute('r') ?? '').c > index.c) ?? null);
      }
      if (direct(cell, SHEET, 'f').length) throw new Error('公式单元格暂不直接修改，请修改输入数据');
      const numeric = (!cell.getAttribute('t') || cell.getAttribute('t') === 'n') && value !== '' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
      for (const child of [...direct(cell, SHEET, 'v'), ...direct(cell, SHEET, 'is')]) cell.removeChild(child);
      cell.setAttribute('t', numeric ? 'n' : 'inlineStr');
      const node = document.createElementNS(SHEET, numeric ? 'v' : 'is');
      if (numeric) node.textContent = value;
      else { const t = document.createElementNS(SHEET, 't'); t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.textContent = value; node.appendChild(t); }
      cell.appendChild(node); touched.add(sheet.target); changes++;
    }
    // Keep formulas, but never present stale cached results after an input changes.
    for (const sheet of sheets.values()) {
      const root = sheet.document.documentElement!;
      const formulaRegions = elements(root, SHEET, 'f').flatMap(formula => formula.getAttribute('ref') ? [XLSX.utils.decode_range(formula.getAttribute('ref')!)] : []);
      for (const cell of Array.from(sheet.document.getElementsByTagNameNS(SHEET, 'c'))) {
        const index = XLSX.utils.decode_cell(cell.getAttribute('r') ?? '');
        if (!direct(cell, SHEET, 'f').length && !formulaRegions.some(region => index.r >= region.s.r && index.r <= region.e.r && index.c >= region.s.c && index.c <= region.e.c)) continue;
        for (const cached of [...direct(cell, SHEET, 'v'), ...direct(cell, SHEET, 'is')]) { cell.removeChild(cached); touched.add(sheet.target); }
      }
      if (touched.has(sheet.target)) zip.file(sheet.target, serialize(sheet.document));
    }
    let calculation = direct(workbookRoot, SHEET, 'calcPr')[0];
    if (!calculation) {
      calculation = workbook.createElementNS(SHEET, 'calcPr');
      const later = ['oleSize','customWorkbookViews','pivotCaches','smartTagPr','smartTagTypes','webPublishing','fileRecoveryPr','webPublishObjects','extLst'];
      workbookRoot.insertBefore(calculation, Array.from(workbookRoot.childNodes).find(node => node.nodeType === 1 && node.namespaceURI === SHEET && later.includes(node.localName ?? '')) ?? null);
    }
    for (const [key, value] of Object.entries({ calcMode: 'auto', fullCalcOnLoad: '1', forceFullCalc: '1' })) calculation.setAttribute(key, value);
    zip.file('xl/workbook.xml', serialize(workbook));
    warnings.push('公式和样式保留，公式缓存值已清除；请用支持计算的表格软件打开副本重算，当前预览不重算公式。');
  } else throw new Error('仅支持 DOCX、XLSX 和 PPTX 的 XML 修改');
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  validateOfficeArchive(output);
  return { buffer: output, changes, warnings };
}

export async function saveOfficeEdit(sandbox: SandboxFS, filePath: string, expectedSha: unknown, input: Record<string, unknown>) {
  const extension = path.posix.extname(filePath).toLowerCase();
  if (!['.docx', '.xlsx', '.pptx'].includes(extension) || typeof expectedSha !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha)) throw new Error('请提供 DOCX/XLSX/PPTX 路径及查看时的文件指纹');
  const original = await sandbox.readBinaryBounded(filePath), hash = createHash('sha256').update(original).digest('hex');
  if (hash !== expectedSha.toLowerCase()) throw new Error('原文件已变化，请重新打开后修改；未保存副本');
  const result = await editOfficeXml(original, extension.slice(1) as 'docx' | 'xlsx' | 'pptx', input);
  const name = Array.from(path.posix.basename(filePath, path.posix.extname(filePath))).slice(0, 40).join('');
  const outputPath = path.posix.join(path.posix.dirname(filePath), `${name}-修改-${randomUUID()}${extension}`).replace(/^\//, '');
  await sandbox.writeBinaryNew(outputPath, result.buffer);
  return { ok: true, created: true, path: outputPath, sourcePath: filePath, sourceSha256: hash, sha256: createHash('sha256').update(result.buffer).digest('hex'), changes: result.changes, warnings: result.warnings };
}
