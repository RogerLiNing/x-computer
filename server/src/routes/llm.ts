import { Router } from 'express';
import { fetchModelsFromProvider } from '../llm/fetchModels.js';

export function createLLMRouter(): Router {
  const router = Router();

  /** POST /api/llm/import-models - 由服务端请求提供商 /models 或 /v1/models，避免浏览器 CORS（如 NVIDIA） */
  router.post('/import-models', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as { baseUrl?: string; apiKey?: string };
      const baseUrl = String(body?.baseUrl ?? '').trim();
      if (!baseUrl) {
        return res.status(400).json({ error: 'baseUrl 必填' });
      }
      const apiKey = body?.apiKey != null ? String(body.apiKey).trim() : undefined;
      const models = await fetchModelsFromProvider(baseUrl, apiKey);
      res.json({ models });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
