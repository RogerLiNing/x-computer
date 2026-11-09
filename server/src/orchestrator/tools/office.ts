import type { ToolDefinition } from '@x-computer/shared';
import {
  createDocx,
  createPptx,
  createXlsx,
  readDocx,
  readPptx,
  readXlsx,
  type SheetData,
  type SlideData,
} from '../../office/index.js';
import type { ToolExecutorDeps, ToolHandler } from './types.js';
import { saveOfficeEdit } from '../../office/edit.js';

function normalizePath(value: unknown, extension: string): string {
  const path = String(value ?? '').trim().replace(/^\//, '');
  if (!path || path.includes('..')) throw new Error('path 必填且不能含 ..');
  if (!path.toLowerCase().endsWith(extension)) {
    throw new Error(`path 必须以 ${extension} 结尾`);
  }
  return path;
}

function normalizeSlides(value: unknown): SlideData[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error('slides 必须是幻灯片数组');
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('slides 至少需要一页');
  }
  return raw.slice(0, 50).map((slide, index) => {
    if (!slide || typeof slide !== 'object') {
      throw new Error(`第 ${index + 1} 页格式无效`);
    }
    const item = slide as Record<string, unknown>;
    return {
      title: String(item.title ?? '').trim(),
      content: String(item.content ?? item.body ?? '').trim(),
    };
  });
}

function normalizeSheets(value: unknown): SheetData[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error('sheets 必须是工作表数组');
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('sheets 至少需要一个工作表');
  }
  return raw.slice(0, 30).map((sheet, index) => {
    if (!sheet || typeof sheet !== 'object') {
      throw new Error(`第 ${index + 1} 个工作表格式无效`);
    }
    const item = sheet as Record<string, unknown>;
    const rows = Array.isArray(item.rows)
      ? item.rows.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [String(row ?? '')])
      : [];
    return {
      name: String(item.name ?? `Sheet${index + 1}`).trim() || `Sheet${index + 1}`,
      rows,
    };
  });
}

export const officeDefinitions: ToolDefinition[] = [
  {
    name: 'office.edit_copy', displayName: '修改办公文件副本', domain: ['office', 'chat', 'agent'], riskLevel: 'low',
    description: '按原 Office XML 修改并生成新副本，保留原稿。先用 file.extract_text 获得 sha256。DOCX 仅替换正文/表格段落中的单段文字，提供 find、replace、expected_occurrences；替换跨样式文字沿用起始样式。PPTX 提供 slide 页码（从 1 开始，按演示顺序）以及 find、replace、expected_occurrences，仅修改该页的普通文字和表格文字，保留其他页面和备注。XLSX 提供 cells 数组，每项 {sheet,cell,value}，value 为字符串，仅改原范围内的输入格；不直接修改公式，保留公式/样式并清除公式缓存，需办公软件打开重算。成功后用 file.present 交付返回的 path。',
    requiredPermissions: ['fs.read', 'fs.write'],
    parameters: [
      { name: 'path', type: 'string', description: '原稿相对路径，DOCX、XLSX 或 PPTX', required: true },
      { name: 'expected_sha256', type: 'string', description: '读取原稿时的 sha256', required: true },
      { name: 'find', type: 'string', description: 'DOCX/PPTX 查找文字（不跨段）', required: false },
      { name: 'replace', type: 'string', description: 'DOCX/PPTX 替换文字，可为空', required: false },
      { name: 'expected_occurrences', type: 'number', description: 'DOCX/PPTX 预期替换次数，必须与实际匹配相同', required: false },
      { name: 'slide', type: 'number', description: 'PPTX 修改的演示页码，从 1 开始；先读取文件核对页面顺序', required: false },
      { name: 'cells', type: 'array', description: 'XLSX 修改数组，每项 {sheet,cell,value}，如 {sheet:"数据",cell:"B2",value:"新值"}', required: false },
    ],
  },
  {
    name: 'office.create_docx',
    displayName: '创建 Word 文档',
    description:
      '创建真实可下载的 Word .docx 文件。用户要求制作 Word、DOCX、报告、方案或正式文档并保存时使用；content 支持 Markdown 风格标题和项目符号。',
    domain: ['office', 'chat', 'agent'],
    riskLevel: 'low',
    parameters: [
      { name: 'path', type: 'string', description: '沙箱内保存路径，必须以 .docx 结尾，如 文档/报告.docx', required: true },
      { name: 'title', type: 'string', description: '文档主标题', required: false },
      { name: 'content', type: 'string', description: '完整正文内容', required: true },
    ],
    requiredPermissions: ['fs.write'],
  },
  {
    name: 'office.read_docx',
    displayName: '读取 Word 文档',
    description: '读取沙箱内真实 .docx 文件并提取文本，用于核对、总结或继续编辑。',
    domain: ['office', 'chat', 'agent'],
    riskLevel: 'low',
    parameters: [
      { name: 'path', type: 'string', description: '沙箱内 .docx 文件路径', required: true },
    ],
    requiredPermissions: ['fs.read'],
  },
  {
    name: 'office.create_xlsx',
    displayName: '创建 Excel 工作簿',
    description: '创建真实可下载的 Excel .xlsx 文件。sheets 是包含 name 和二维 rows 的工作表数组。',
    domain: ['office', 'chat', 'agent'],
    riskLevel: 'low',
    parameters: [
      { name: 'path', type: 'string', description: '沙箱内保存路径，必须以 .xlsx 结尾', required: true },
      { name: 'sheets', type: 'array', description: '工作表数组，每项为 {name, rows}', required: true },
    ],
    requiredPermissions: ['fs.write'],
  },
  {
    name: 'office.read_xlsx',
    displayName: '读取 Excel 工作簿',
    description: '读取沙箱内真实 .xlsx 文件，返回工作表名称和二维表格数据。',
    domain: ['office', 'chat', 'agent'],
    riskLevel: 'low',
    parameters: [
      { name: 'path', type: 'string', description: '沙箱内 .xlsx 文件路径', required: true },
    ],
    requiredPermissions: ['fs.read'],
  },
  {
    name: 'office.create_pptx',
    displayName: '创建 PowerPoint 演示稿',
    description:
      '创建真实可下载的 PowerPoint .pptx 文件。用户要求制作 PPT、演示稿、汇报或幻灯片并保存时使用；slides 是由 title 和 content 组成的页面数组。',
    domain: ['office', 'chat', 'agent'],
    riskLevel: 'low',
    parameters: [
      { name: 'path', type: 'string', description: '沙箱内保存路径，必须以 .pptx 结尾，如 文档/汇报.pptx', required: true },
      { name: 'slides', type: 'array', description: '幻灯片数组，每项为 {title, content}', required: true },
    ],
    requiredPermissions: ['fs.write'],
  },
  {
    name: 'office.read_pptx',
    displayName: '读取 PowerPoint 演示稿',
    description: '读取沙箱内真实 .pptx 文件并按页提取标题与正文，用于核对和总结。',
    domain: ['office', 'chat', 'agent'],
    riskLevel: 'low',
    parameters: [
      { name: 'path', type: 'string', description: '沙箱内 .pptx 文件路径', required: true },
    ],
    requiredPermissions: ['fs.read'],
  },
];

export function createOfficeHandlers(deps: ToolExecutorDeps): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  handlers.set('office.edit_copy', async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '工作区不可用' };
    if (typeof input.path !== 'string' || !input.path.trim()) return { ok: false, error: '请提供原稿路径' };
    return saveOfficeEdit(fs, input.path, input.expected_sha256, input);
  });

  handlers.set('office.create_docx', async (input, ctx) => {
    const path = normalizePath(input.path, '.docx');
    const content = String(input.content ?? input.text ?? input.body ?? '').trim();
    if (!content) return { ok: false, error: 'content 必填' };
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法创建 Word 文档' };
    const buffer = await createDocx(content, String(input.title ?? '').trim() || undefined);
    await fs.writeBinaryNew(path, buffer);
    return { ok: true, created: true, path, bytes: buffer.length, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  });

  handlers.set('office.read_docx', async (input, ctx) => {
    const path = normalizePath(input.path, '.docx');
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法读取 Word 文档' };
    const buffer = await fs.readBinaryBounded(path);
    return { ok: true, path, content: await readDocx(buffer), bytes: buffer.length };
  });

  handlers.set('office.create_xlsx', async (input, ctx) => {
    const path = normalizePath(input.path, '.xlsx');
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法创建 Excel 工作簿' };
    const sheets = normalizeSheets(input.sheets);
    const buffer = createXlsx(sheets);
    await fs.writeBinaryNew(path, buffer);
    return { ok: true, created: true, path, sheets: sheets.length, bytes: buffer.length, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  });

  handlers.set('office.read_xlsx', async (input, ctx) => {
    const path = normalizePath(input.path, '.xlsx');
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法读取 Excel 工作簿' };
    const buffer = await fs.readBinaryBounded(path);
    return { ok: true, path, sheets: readXlsx(buffer), bytes: buffer.length };
  });

  handlers.set('office.create_pptx', async (input, ctx) => {
    const path = normalizePath(input.path, '.pptx');
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法创建 PowerPoint 演示稿' };
    const slides = normalizeSlides(input.slides);
    const buffer = await createPptx(slides);
    await fs.writeBinaryNew(path, buffer);
    return { ok: true, created: true, path, slides: slides.length, bytes: buffer.length, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  });

  handlers.set('office.read_pptx', async (input, ctx) => {
    const path = normalizePath(input.path, '.pptx');
    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法读取 PowerPoint 演示稿' };
    const buffer = await fs.readBinaryBounded(path);
    return { ok: true, path, slides: await readPptx(buffer), bytes: buffer.length };
  });

  return handlers;
}
