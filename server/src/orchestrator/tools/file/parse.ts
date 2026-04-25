import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { parseFileToText } from '../../../fileParser/localFileParser.js';
import { serverLogger } from '../../../observability/ServerLogger.js';
import { callEmbedding } from '../../../memory/embeddingService.js';

export const fileParseDefinition: ToolDefinition = {
  name: 'file.parse',
  displayName: '文件解析',
  description:
    '使用本地解析器解析文档并提取文本（不调用任何外部 API）。支持 txt/md/json/csv/html、docx、xls/xlsx；其他格式会返回明确的本地不支持提示。',
  domain: ['office', 'chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'path', type: 'string', description: '沙箱内待解析文件相对路径（如 文档/报告.pdf）', required: true },
    {
      name: 'tool_type',
      type: 'string',
      description: '（兼容参数，已忽略）旧版外部解析服务类型。当前仅使用本地解析器。',
      required: false,
    },
    {
      name: 'format_type',
      type: 'string',
      description: '（兼容参数，已忽略）旧版外部解析结果格式。当前仅返回 text。',
      required: false,
    },
    {
      name: 'embed_to_memory',
      type: 'boolean',
      description: '解析后是否加入向量库供 memory_search 搜索，默认 true',
      required: false,
    },
  ],
  requiredPermissions: ['fs.read'],
};

export function createFileParseHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const path = String(input.path ?? '').trim();
    if (!path || path.includes('..')) return { ok: false, error: 'path 必填且不能含 ..' };

    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法读取文件' };

    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readBinary(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `读取文件失败: ${msg}` };
    }

    try {
      const parsed = await parseFileToText(path, fileBuffer);
      if (!parsed.ok) return { ok: false, error: `文件解析失败: ${parsed.error}` };
      const content = parsed.content ?? '';

      let indexed = 0;
      const embedToMemory = input.embed_to_memory !== false;
      const userId = (ctx as { userId?: string })?.userId;
      if (content && embedToMemory) {
        if (userId && userId !== 'anonymous') {
          const mem = await deps.getMemoryServiceForUser?.(userId);
          const vecConfig = await deps.getVectorConfigForUser?.(userId);
          if (mem && vecConfig?.providerId && vecConfig?.modelId) {
            const chunkSize = 600;
            const overlap = 80;
            const chunks: string[] = [];
            for (let i = 0; i < content.length; i += chunkSize - overlap) {
              chunks.push(content.slice(i, i + chunkSize));
            }
            const date = new Date().toISOString().slice(0, 10);
            try {
              for (const chunk of chunks) {
                if (!chunk.trim()) continue;
                const vector = await callEmbedding(chunk, vecConfig);
                await mem.addToIndex({ filePath: path, date, text: chunk, vector }, userId);
                indexed++;
              }
            } catch (embedErr) {
              serverLogger.warn(
                'tool',
                'file.parse 解析成功但向量索引失败',
                embedErr instanceof Error ? embedErr.message : String(embedErr)
              );
            }
          }
        }
      }

      return {
        ok: true,
        status: 'succeeded',
        content,
        ...(indexed > 0 ? { indexed, message: `已解析并加入向量库 ${indexed} 条，X 可通过 memory_search 搜索` } : {}),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `文件解析失败: ${msg}` };
    }
  };
}
