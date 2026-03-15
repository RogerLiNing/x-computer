import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import {
  createParseTask,
  getParseResult,
  getFileTypeFromPath,
  type ToolType as ZhipuToolType,
  type FormatType as ZhipuFormatType,
} from '../../../fileParser/zhipuFileParser.js';
import { serverLogger } from '../../../observability/ServerLogger.js';
import { callEmbedding } from '../../../memory/embeddingService.js';

export const fileParseDefinition: ToolDefinition = {
  name: 'file.parse',
  displayName: '文件解析',
  description:
    '使用智谱文件解析 API 解析 PDF、Word、Excel、PPT 等文档，提取文本或结构化内容。适合用户上传文档后需要提取文字、表格、图片信息供大模型分析。需在设置→大模型中配置智谱 GLM 提供商并填写 API Key。',
  domain: ['office', 'chat', 'agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'path', type: 'string', description: '沙箱内待解析文件相对路径（如 文档/报告.pdf）', required: true },
    {
      name: 'tool_type',
      type: 'string',
      description: '解析服务：lite（免费、纯文本）、expert（PDF 高精度）、prime（多格式、高精度）。默认 lite',
      required: false,
    },
    {
      name: 'format_type',
      type: 'string',
      description: '结果格式：text（纯文本，适合大模型）、download_link（下载链接含图片）。默认 text',
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

    const apiKey = deps.getZhipuApiKey(ctx);
    if (!apiKey)
      return {
        ok: false,
        error:
          '未配置智谱 API Key。请在设置→大模型中添加「智谱 GLM」提供商并保存 API Key，或配置环境变量 ZHIPU_API_KEY',
      };

    const fs = await deps.resolveFS(ctx);
    if (!fs) return { ok: false, error: '沙箱不可用，无法读取文件' };

    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readBinary(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `读取文件失败: ${msg}` };
    }

    const toolType = (String(input.tool_type ?? 'lite').toLowerCase() || 'lite') as ZhipuToolType;
    if (!['lite', 'expert', 'prime'].includes(toolType)) {
      return { ok: false, error: 'tool_type 须为 lite、expert 或 prime' };
    }
    const formatType = (String(input.format_type ?? 'text').toLowerCase() || 'text') as ZhipuFormatType;
    if (formatType !== 'text' && formatType !== 'download_link') {
      return { ok: false, error: 'format_type 须为 text 或 download_link' };
    }

    const fileType = getFileTypeFromPath(path);

    try {
      const createRes = await createParseTask(apiKey, fileBuffer, fileType, toolType);
      if (!createRes.success || !createRes.task_id) {
        return { ok: false, error: createRes.message ?? '创建解析任务失败' };
      }

      const result = await getParseResult(apiKey, createRes.task_id, formatType);
      if (result.status === 'failed') {
        return { ok: false, error: result.message ?? '解析失败' };
      }

      let indexed = 0;
      const embedToMemory = input.embed_to_memory !== false;
      const userId = (ctx as { userId?: string })?.userId;
      if (formatType === 'text' && result.content && embedToMemory) {
        if (userId && userId !== 'anonymous') {
          const mem = await deps.getMemoryServiceForUser?.(userId);
          const vecConfig = await deps.getVectorConfigForUser?.(userId);
          if (mem && vecConfig?.providerId && vecConfig?.modelId) {
            const chunkSize = 600;
            const overlap = 80;
            const chunks: string[] = [];
            for (let i = 0; i < result.content.length; i += chunkSize - overlap) {
              chunks.push(result.content.slice(i, i + chunkSize));
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
        status: result.status,
        content: result.content,
        parsing_result_url: result.parsing_result_url,
        task_id: createRes.task_id,
        ...(indexed > 0 ? { indexed, message: `已解析并加入向量库 ${indexed} 条，X 可通过 memory_search 搜索` } : {}),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `文件解析失败: ${msg}` };
    }
  };
}
