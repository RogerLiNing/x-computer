import { Router } from 'express';
import { callLLMStream } from '../chat/chatService.js';
import { getAssembledSystemPrompt } from '../prompts/systemCore.js';
import { broadcast } from '../wsBroadcast.js';
import { serverLogger } from '../observability/ServerLogger.js';

type QuotaMiddleware = (req: any, res: any, next: any) => void;

export function createEditorAgentRouter(aiQuota: QuotaMiddleware): Router {
  const router = Router();

  /** 编辑器 Agent 流式写入：主 AI 对话驱动，由「编辑器 Agent」根据 instruction 生成内容并实时推送到指定编辑器窗口（WebSocket editor_stream） */
  router.post('/chat/editor-agent-stream', aiQuota, async (req, res) => {
    try {
      const { windowId, instruction, providerId, modelId, baseUrl, apiKey } = req.body as {
        windowId?: string;
        instruction?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      if (!windowId || typeof instruction !== 'string' || !providerId || !modelId) {
        serverLogger.warn('editor-agent-stream', '参数不完整', JSON.stringify({ windowId: !!windowId, instruction: typeof instruction, providerId: !!providerId, modelId: !!modelId }));
        res.status(400).json({ error: '缺少 windowId、instruction、providerId 或 modelId' });
        return;
      }

      serverLogger.info('editor-agent-stream', `开始 [${providerId}/${modelId}] windowId=${windowId}`, instruction.slice(0, 80));

      res.setHeader('Content-Type', 'application/json');
      res.status(202).json({ ok: true, windowId }); // 先返回接受，流通过 WS 推送
      res.end();

      const systemPrompt = getAssembledSystemPrompt({ scene: 'editor_agent', promptMode: 'minimal' });
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: instruction },
      ];
      try {
        for await (const chunk of callLLMStream({
          messages,
          providerId,
          modelId,
          baseUrl,
          apiKey,
        })) {
          broadcast({ type: 'editor_stream', data: { windowId, chunk } });
        }
      } catch (err: any) {
        serverLogger.error('editor-agent-stream', `流式生成失败: ${err.message}`, err.stack);
        broadcast({ type: 'editor_stream_error', data: { windowId, error: err.message || '生成失败' } });
      }
      broadcast({ type: 'editor_stream_end', data: { windowId } });
      serverLogger.info('editor-agent-stream', `结束 windowId=${windowId}`);
    } catch (err: any) {
      serverLogger.error('editor-agent-stream', `请求处理失败: ${err.message}`, err.stack);
      if (!res.headersSent) res.status(400).json({ error: err.message || '请求失败' });
    }
  });

  return router;
}
