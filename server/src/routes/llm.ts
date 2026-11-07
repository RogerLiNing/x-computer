import type { AppDatabase } from '../db/database.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { loadDefaultConfig } from '../config/defaultConfig.js';
import { Router } from 'express';
import { fetchModelsFromProvider, ModelImportError } from '../llm/fetchModels.js';
import { resolveLLMCredentials, buildPublicLLMConfig } from '../llm/credentialResolver.js';

export function createLLMRouter(db?: AppDatabase, subscriptionService?: SubscriptionService): Router {
  const router = Router();

  /** GET /api/llm/config - 公开接口：返回服务器可用 LLM 配置（不含 apiKey） */
  router.get('/config', (_req, res) => {
    const config = buildPublicLLMConfig();
    res.json(config);
  });

  /** POST /api/llm/import-models - 由服务端请求提供商 /models 或 /v1/models，避免浏览器 CORS（如 NVIDIA） */
  router.post('/import-models', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      if (!userId || userId === 'anonymous') {
        return res.status(401).json({ error: '需要已登录用户' });
      }
      const body = req.body as { baseUrl?: string; apiKey?: string; providerId?: string };
      let baseUrl = String(body?.baseUrl ?? '').trim();
      let apiKey = body?.apiKey != null ? String(body.apiKey).trim() : undefined;
      let trustedServer = false;
      if (typeof body.providerId === 'string' && body.providerId) {
        const resolved = await resolveLLMCredentials(userId, db, subscriptionService, {providerId:body.providerId});
        if (!resolved) return res.status(400).json({error:'该模型提供商尚未配置'});
        baseUrl = resolved.baseUrl ?? ''; apiKey = resolved.apiKey;
        const preset = loadDefaultConfig().llm_config?.providers.find(provider=>provider.id===resolved.providerId);
        trustedServer = !!preset && preset.baseUrl===baseUrl && preset.apiKey===apiKey;
      }
      if (!baseUrl) {
        return res.status(400).json({ error: 'baseUrl 必填' });
      }
      const models = await fetchModelsFromProvider(baseUrl, apiKey, trustedServer);
      res.json({ models });
    } catch (error) {
      const msg = error instanceof ModelImportError ? error.message : '请检查模型服务地址和配置';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
