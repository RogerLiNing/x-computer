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
  | { ok: true; content: string; fileType: string; warnings?: string[] }
  | { ok: false; error: string; fileType?: string };

function extOf(filePath: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filePath);
  return (m?.[1] ?? '').toLowerCase();
}

function safeUtf8(buffer: Buffer): string {
  if(buffer[0]===0xff&&buffer[1]===0xfe)return buffer.subarray(2).toString('utf16le').trim();
  if(buffer[0]===0xfe&&buffer[1]===0xff)return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le').trim();
  // Node's utf8 decoder uses U+FFFD for invalid sequences.
  // trim() removes leading/trailing whitespace so we never return blank content.
  return buffer.toString('utf-8').trim();
}

export async function parseFileToText(filePath: string, fileBuffer: Buffer, signal?: AbortSignal, ocr = false): Promise<LocalParseResult> {
  signal?.throwIfAborted();
  if(fileBuffer.length>16*1024*1024)return {ok:false,error:'文件超过 16 MiB，请拆分后读取'};
  const ext = extOf(filePath);

  // 纯文本/标记/数据文件：直接读取
  if (['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'log'].includes(ext)) {
    const content = safeUtf8(fileBuffer);
    return { ok: true, content, fileType: ext || 'text' };
  }

  // Word：只支持 docx（doc 属于旧二进制格式，mammoth 不支持）
  if (ext === 'docx') {
    try {
      const {readDocx}=await import('../office/index.js');
      const content=await readDocx(fileBuffer);
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
  if (ext === 'xlsx'||ext==='xls') {
    try {
      const {readXlsx}=await import('../office/index.js');
      const sheets=readXlsx(fileBuffer);
      const quote=(value:string)=>/[",\r\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;
      const content=sheets.map(sheet=>`### Sheet: ${sheet.name}${sheet.range?` (range ${sheet.range})`:''}\n${sheet.rows.map(row=>row.map(quote).join(',')).join('\n')}`).join('\n\n');
      return {ok:true,content,fileType:ext};
    }catch(error){return {ok:false,error:`Excel 解析失败: ${error instanceof Error?error.message:String(error)}`,fileType:ext};}
  }
  if(ext==='pptx'){
    try{
      const {readPptx}=await import('../office/index.js');const slides=await readPptx(fileBuffer);
      return {ok:true,fileType:ext,content:slides.map((slide,index)=>`### Slide ${index+1}: ${slide.title??''}\n${slide.content??''}`).join('\n\n')};
    }catch(error){return {ok:false,error:`PPTX 解析失败: ${error instanceof Error?error.message:String(error)}`,fileType:ext};}
  }

  if (ext === 'pdf') {
    try {
      const { readPdf } = await import('../office/pdf.js');
      const result = await readPdf(fileBuffer, signal, ocr);
      if (!result.pages.some(page => page.text.trim())) return { ok: false, error: ocr ? 'PDF 经 OCR 仍未识别出文字，请核对原件或提供更清晰的扫描件' : 'PDF 没有可提取文字，可能是扫描件；可用 file.extract_text 的 ocr=true 进行本地 OCR', fileType: 'pdf' };
      const content = result.pages.map(page => `### 第 ${page.page} 页\n${page.text || (ocr ? '[本页经 OCR 仍未识别出文字，请核对原件]' : '[本页没有可提取文字；可能包含图片或扫描内容，尚未进行 OCR]')}`).join('\n\n');
      return { ok: true, fileType: 'pdf', content, warnings: result.warnings };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ok: false, fileType: 'pdf', error: error instanceof Error ? error.message : 'PDF 解析失败' };
    }
  }
  // PPT/图片等：明确提示（避免误以为会走外部 API）
  if (ext === 'ppt' || ext === 'pptx') {
    return { ok: false, error: 'PPT/PPTX 暂未启用本地解析（当前实现不再调用外部 API）', fileType: ext };
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'heic'].includes(ext)) {
    return { ok: false, error: '图片暂未启用 OCR 本地解析（当前实现不再调用外部 API）', fileType: ext };
  }

  return { ok: false, error: `不支持的文件类型: ${ext || 'unknown'}` };
}

