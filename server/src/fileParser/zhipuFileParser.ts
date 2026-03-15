/**
 * 智谱文件解析 API 封装
 * 文档: https://docs.bigmodel.cn
 * 接口: POST /api/paas/v4/files/parser/create → GET /api/paas/v4/files/parser/result/{taskId}/{format_type}
 */

const ZHIPU_PARSER_BASE = 'https://open.bigmodel.cn/api/paas/v4/files/parser';

export type ToolType = 'lite' | 'expert' | 'prime';
export type FormatType = 'text' | 'download_link';

const EXT_TO_FILE_TYPE: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  doc: 'DOC',
  xls: 'XLS',
  xlsx: 'XLSX',
  ppt: 'PPT',
  pptx: 'PPTX',
  png: 'PNG',
  jpg: 'JPG',
  jpeg: 'JPEG',
  csv: 'CSV',
  txt: 'TXT',
  md: 'MD',
  html: 'HTML',
  epub: 'EPUB',
  bmp: 'BMP',
  gif: 'GIF',
  webp: 'WEBP',
  heic: 'HEIC',
  tiff: 'TIFF',
};

export function getFileTypeFromPath(filePath: string): string {
  const ext = filePath.replace(/^.*\./, '').toLowerCase();
  return EXT_TO_FILE_TYPE[ext] ?? 'TXT';
}

export interface CreateResult {
  success: boolean;
  task_id?: string;
  message?: string;
}

export interface ParseResultResponse {
  status: 'succeeded' | 'processing' | 'failed';
  message?: string;
  content?: string;
  task_id?: string;
  parsing_result_url?: string;
}

/**
 * 创建文件解析任务
 */
export async function createParseTask(
  apiKey: string,
  fileBuffer: Buffer,
  fileType: string,
  toolType: ToolType,
): Promise<CreateResult> {
  const ext = fileType.toLowerCase();
  const filename = `file.${ext === 'docx' ? 'docx' : ext === 'xlsx' ? 'xlsx' : ext === 'pptx' ? 'pptx' : ext}`;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(fileBuffer)]), filename);
  form.append('tool_type', toolType);
  form.append('file_type', fileType.toUpperCase());

  const res = await fetch(`${ZHIPU_PARSER_BASE}/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const raw = (await res.json()) as Record<string, unknown>;
  // 兼容智谱 API 将结果包装在 data 中的情况（部分实现会返回 { data: { task_id, ... } }）
  const inner = raw?.data && typeof raw.data === 'object' && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
  const top = raw as Record<string, unknown>;

  if (!res.ok) {
    const errMsg = (top.message ?? inner?.message) as string | undefined;
    return { success: false, message: errMsg?.trim() || `HTTP ${res.status}` };
  }

  const task_id = (inner?.task_id ?? inner?.taskId ?? top.task_id ?? top.taskId) as string | undefined;
  const message = (top.message ?? inner?.message) as string | undefined;
  // 智谱 API 可能不返回 success 字段，HTTP 200 + 有 task_id 即视为成功
  const success = task_id ? (top.success ?? inner?.success ?? true) : !!(top.success ?? inner?.success);

  return { success: !!success, task_id, message };
}

/**
 * 获取解析结果（轮询直到完成或失败）
 * - 支持 API 返回体包装在 data 字段的情况
 * - format_type=text 时：只有拿到非空 content 才返回 succeeded，避免 API 提前返回 success 导致 AI 未等待结果
 */
export async function getParseResult(
  apiKey: string,
  taskId: string,
  formatType: FormatType,
  options?: { maxRetries?: number; intervalMs?: number },
): Promise<ParseResultResponse> {
  const maxRetries = options?.maxRetries ?? 100;
  const intervalMs = options?.intervalMs ?? 2000;
  /** text 模式下，succeeded 但 content 为空时继续轮询的次数上限（防止误判为已完成） */
  const maxEmptyContentRetries = 15;

  let emptySucceededCount = 0;

  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(
      `${ZHIPU_PARSER_BASE}/result/${encodeURIComponent(taskId)}/${formatType}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const raw = (await res.json()) as Record<string, unknown> | ParseResultResponse;
    // 兼容智谱 API 将结果包装在 data 中的情况
    const data =
      raw && typeof (raw as Record<string, unknown>).data === 'object' && (raw as Record<string, unknown>).data !== null
        ? ((raw as Record<string, unknown>).data as ParseResultResponse)
        : (raw as ParseResultResponse);

    if (!res.ok) {
      return { status: 'failed', message: (data?.message as string) ?? `HTTP ${res.status}` };
    }

    const status = ((data?.status as string) ?? '').toLowerCase();
    if (status === 'failed') {
      return data;
    }
    if (status === 'succeeded') {
      const content = data?.content;
      // text 模式下，只有拿到非空内容才视为真正完成，避免 API 提前返回 success 导致 AI 未等待结果
      if (formatType === 'text') {
        if (typeof content === 'string' && content.trim().length > 0) {
          return data;
        }
        emptySucceededCount++;
        if (emptySucceededCount >= maxEmptyContentRetries) {
          return data; // 多次仍为空，视为文档本身无文本，返回当前结果
        }
      } else {
        return data;
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { status: 'failed', message: '解析超时，请稍后重试' };
}
