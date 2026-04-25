/**
 * 本地文件解析：不依赖任何外部 API。
 * - 文本类（txt/md/json/csv/html）直接 UTF-8 读取
 * - docx 使用 mammoth 抽取纯文本（lazy import，按需加载）
 * - xls/xlsx 使用 xlsx 转成 CSV（lazy import，按需加载）
 *
 * mammoth 和 xlsx 均为重型依赖，采用 dynamic import 延迟加载，
 * 解析其他格式时不付出打包和启动代价。
 */

export type LocalParseResult =
  | { ok: true; content: string; fileType: string }
  | { ok: false; error: string; fileType?: string };

function extOf(filePath: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filePath);
  return (m?.[1] ?? '').toLowerCase();
}

function safeUtf8(buffer: Buffer): string {
  // Node's utf8 decoder uses U+FFFD for invalid sequences.
  // trim() removes leading/trailing whitespace so we never return blank content.
  return buffer.toString('utf-8').trim();
}

export async function parseFileToText(filePath: string, fileBuffer: Buffer): Promise<LocalParseResult> {
  const ext = extOf(filePath);

  // 纯文本/标记/数据文件：直接读取
  if (['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'log'].includes(ext)) {
    const content = safeUtf8(fileBuffer);
    return { ok: true, content, fileType: ext || 'text' };
  }

  // Word：只支持 docx（doc 属于旧二进制格式，mammoth 不支持）
  if (ext === 'docx') {
    try {
      const mammoth = await import('mammoth');
      const res = await mammoth.extractRawText({ buffer: fileBuffer });
      const content = (res.value ?? '').trimEnd();
      return { ok: true, content, fileType: 'docx' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `DOCX 解析失败: ${msg}`, fileType: 'docx' };
    }
  }
  if (ext === 'doc') {
    return { ok: false, error: 'DOC（旧 Word 格式）暂不支持本地解析，请另存为 .docx 后重试', fileType: 'doc' };
  }

  // Excel
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const xlsx = await import('xlsx');
      const wb = xlsx.read(fileBuffer, { type: 'buffer' });
      const parts: string[] = [];
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name];
        const csv = xlsx.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' });
        const trimmed = (csv ?? '').trim();
        if (!trimmed) continue;
        parts.push(`### Sheet: ${name}\n${trimmed}`);
      }
      const content = parts.join('\n\n').trim();
      return { ok: true, content, fileType: ext };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Excel 解析失败: ${msg}`, fileType: ext };
    }
  }

  // PPT/PDF/图片等：明确提示（避免误以为会走外部 API）
  if (ext === 'pdf') {
    return { ok: false, error: 'PDF 暂未启用本地解析（当前实现不再调用外部 API）', fileType: 'pdf' };
  }
  if (ext === 'ppt' || ext === 'pptx') {
    return { ok: false, error: 'PPT/PPTX 暂未启用本地解析（当前实现不再调用外部 API）', fileType: ext };
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'heic'].includes(ext)) {
    return { ok: false, error: '图片暂未启用 OCR 本地解析（当前实现不再调用外部 API）', fileType: ext };
  }

  return { ok: false, error: `不支持的文件类型: ${ext || 'unknown'}` };
}

