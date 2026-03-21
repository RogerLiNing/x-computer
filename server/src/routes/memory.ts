import { Router } from 'express';
import { MemoryService } from '../memory/MemoryService.js';
import type { VectorStore } from '../memory/vectorStore.js';
import { callEmbedding, callEmbeddingBatch } from '../memory/embeddingService.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { SubscriptionService } from '../subscription/SubscriptionService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { fire as fireHook } from '../hooks/HookRegistry.js';
import { MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT } from '../prompts/systemCore.js';
import { callLLM } from '../chat/chatService.js';

const MEMORY_DIR = 'memory';
const EMBED_BATCH_SIZE = 10;

export function createMemoryRouter(
  memoryService: MemoryService,
  sandboxFS: SandboxFS,
  vectorStore: VectorStore,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
  subscriptionService?: SubscriptionService,
): Router {
  const router = Router();
  let lastMemoryEmbedError: string | undefined;

  function dailyPath(date: string): string {
    return `${MEMORY_DIR}/${date}.md`;
  }

  /** 按用户取 MemoryService（多用户时用该用户沙箱，否则用默认） */
  async function getMemoryServiceForUser(userId: string | undefined): Promise<MemoryService | null> {
    if (!userId || userId === 'anonymous' || !userSandboxManager) return null;
    const { sandboxFS: userFS } = await userSandboxManager.getForUser(userId);
    return new MemoryService(userFS, vectorStore);
  }

  /** 后台执行：根据本轮对话判断是否写入记忆并可选建向量索引（不向调用方返回结果，参考 OpenClaw） */
  async function runConsiderCapture(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    vectorProviderId?: string;
    vectorModelId?: string;
    vectorBaseUrl?: string;
    vectorApiKey?: string;
    memoryService: MemoryService;
    workspaceId?: string;
  }): Promise<void> {
    const {
      userMessage,
      assistantReply,
      providerId,
      modelId,
      baseUrl,
      apiKey,
      vectorProviderId,
      vectorModelId,
      vectorBaseUrl,
      vectorApiKey,
      memoryService,
      workspaceId,
    } = params;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: MEMORY_CONSIDER_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${userMessage}\n\n助手：${assistantReply}` },
      ],
      providerId,
      modelId,
      baseUrl,
      apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
    const typeLine = (lines[0] ?? '').toUpperCase();
    const typeMap = { PREFERENCE: 'preference' as const, DECISION: 'decision' as const, FACT: 'fact' as const };
    const type = typeMap[typeLine as keyof typeof typeMap] ?? 'fact';
    const content = (lines.slice(1).join(' ').trim() || lines[0] || trimmed).trim();
    if (!content) return;
    await memoryService.capture(content, type);
    const date = new Date().toISOString().slice(0, 10);
    fireHook('memory_captured', {
      workspaceId,
      type,
      content,
      filePath: dailyPath(date),
    });
    if (vectorProviderId && vectorModelId) {
      try {
        const vector = await callEmbedding(content, {
          providerId: vectorProviderId,
          modelId: vectorModelId,
          baseUrl: vectorBaseUrl,
          apiKey: vectorApiKey,
        });
        await memoryService.addToIndex(
          {
            filePath: dailyPath(date),
            date,
            text: content,
            vector,
          },
          workspaceId,
        );
        await memoryService.updateStatusMeta(
          {
            retrievalMode: 'hybrid',
            provider: {
              configured: true,
              available: true,
              providerId: vectorProviderId,
              modelId: vectorModelId,
            },
            lastEmbedError: undefined,
            fallback: { active: false },
          },
          workspaceId,
        );
      } catch (embedErr: any) {
        serverLogger.error('memory/consider-capture (index)', embedErr.message);
        await memoryService.updateStatusMeta(
          {
            retrievalMode: 'keyword_fallback',
            provider: {
              configured: true,
              available: false,
              providerId: vectorProviderId,
              modelId: vectorModelId,
            },
            lastEmbedError: embedErr?.message ?? String(embedErr),
            fallback: { active: true, reason: 'embedding_failed' },
          },
          workspaceId,
        );
      }
    }
  }

  /** 后台执行：从本轮对话中抽取「希望主脑长期遵守的规则/偏好」，追加到 LEARNED_PROMPT，使提示词随对话不断丰富 */
  async function runLearnPromptExtract(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    memoryService: MemoryService;
  }): Promise<void> {
    const { userMessage, assistantReply, providerId, modelId, baseUrl, apiKey, memoryService } = params;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${userMessage}\n\n助手：${assistantReply}` },
      ],
      providerId,
      modelId,
      baseUrl,
      apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    for (const line of lines) {
      if (line.length > 200) continue;
      await memoryService.appendLearnedPrompt(line);
    }
  }

  // ── Memory (主脑记忆：召回与捕获，OpenClaw 式向量检索) ─────────

  /** GET：记忆状态（对齐 OpenClaw MemorySearchManager.status），供设置页/调试展示。按用户隔离：已登录用户返回其工作区路径 */
  router.get('/memory/status', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const effectiveWorkspaceId = userId && userId !== 'anonymous' ? userId : undefined;
      const memSvc =
        effectiveWorkspaceId && userSandboxManager
          ? await getMemoryServiceForUser(userId)
          : memoryService;
      const status = await (memSvc ?? memoryService).getStatus(effectiveWorkspaceId);
      const workspaceRoot =
        userId && userId !== 'anonymous' && userSandboxManager
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();
      res.json({
        ...status,
        workspaceRoot,
        lastEmbedError: status.lastEmbedError ?? lastMemoryEmbedError ?? undefined,
      });
    } catch (err: any) {
      serverLogger.error('memory/status', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '获取状态失败' });
    }
  });

  /** GET：按路径读记忆文件全文或片段（对齐 OpenClaw readFile）。Query: path（必填）, from?, lines? */
  router.get('/memory/read', async (req, res) => {
    try {
      const pathParam = String(req.query?.path ?? '').trim();
      if (!pathParam) {
        res.status(400).json({ error: '缺少 path，例如 path=memory/2026-02-11.md' });
        return;
      }
      const from = req.query?.from != null ? parseInt(String(req.query.from), 10) : undefined;
      const lines = req.query?.lines != null ? parseInt(String(req.query.lines), 10) : undefined;
      const result = await memoryService.readFile(pathParam, {
        from: Number.isFinite(from) ? from : undefined,
        lines: Number.isFinite(lines) ? lines : undefined,
      });
      res.json(result);
    } catch (err: any) {
      serverLogger.error('memory/read', err.message, err.stack);
      res.status(400).json({ error: err.message ?? '读取失败' });
    }
  });

  /** GET：关键词召回（兼容旧版，无向量配置时前端也可用） */
  router.get('/memory/recall', async (req, res) => {
    try {
      const q = String(req.query?.q ?? '').trim();
      const days = Math.min(5, Math.max(1, parseInt(String(req.query?.days), 10) || 2));
      const content = await memoryService.recall(q, { days });
      res.json({ content });
    } catch (err: any) {
      serverLogger.error('memory/recall', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '召回失败' });
    }
  });

  /** POST：支持向量召回、混合检索、多 workspace。body: query, days, topK, useHybrid, vectorWeight, textWeight, workspaceId；若带 providerId/modelId 则用向量/混合 */
  router.post('/memory/recall', async (req, res) => {
    try {
      const {
        query,
        days,
        topK,
        useHybrid,
        vectorWeight,
        textWeight,
        workspaceId: bodyWorkspaceId,
        providerId,
        modelId,
        baseUrl,
        apiKey,
      } = req.body as {
        query?: string;
        days?: number;
        topK?: number;
        useHybrid?: boolean;
        vectorWeight?: number;
        textWeight?: number;
        workspaceId?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      const q = (query ?? '').trim();
      const daysVal = Math.min(5, Math.max(1, parseInt(String(days), 10) || 2));
      const topKVal = Math.min(10, Math.max(1, parseInt(String(topK), 10) || 5));
      const workspaceId = typeof bodyWorkspaceId === 'string' ? bodyWorkspaceId.trim() || undefined : undefined;

      if (providerId && modelId && q) {
        try {
          const queryVector = await callEmbedding(q, { providerId, modelId, baseUrl, apiKey });
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'hybrid',
              provider: {
                configured: true,
                available: true,
                providerId,
                modelId,
              },
              lastEmbedError: undefined,
              fallback: { active: false },
            },
            workspaceId,
          );
          const content = await memoryService.recall(q, {
            queryVector,
            topK: topKVal,
            useHybrid: Boolean(useHybrid),
            vectorWeight: typeof vectorWeight === 'number' ? vectorWeight : undefined,
            textWeight: typeof textWeight === 'number' ? textWeight : undefined,
            workspaceId,
          });
          res.json({ content });
          return;
        } catch (embedErr: any) {
          const embedError = embedErr?.message ?? String(embedErr);
          lastMemoryEmbedError = embedError;
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'keyword_fallback',
              lastEmbedError: embedError,
              fallback: { active: true, reason: 'embedding_failed' },
            },
            workspaceId,
          );
          serverLogger.error('memory/recall (embed)', embedError);
          const content = await memoryService.recall(q, { days: daysVal, workspaceId });
          res.json({ content, vectorUsed: false, embedError });
          return;
        }
      }
      const content = await memoryService.recall(q, { days: daysVal, workspaceId });
      res.json({ content });
    } catch (err: any) {
      serverLogger.error('memory/recall', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '召回失败' });
    }
  });

  router.post('/memory/capture', async (req, res) => {
    try {
      const {
        content: rawContent,
        type,
        providerId,
        modelId,
        baseUrl,
        apiKey,
        workspaceId: bodyWorkspaceId,
      } = req.body as {
        content?: string;
        type?: 'preference' | 'decision' | 'fact';
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        workspaceId?: string;
      };
      if (!rawContent || typeof rawContent !== 'string') {
        res.status(400).json({ error: '缺少 content' });
        return;
      }
      const content = rawContent.trim();
      await memoryService.capture(content, type);

      const workspaceId = typeof bodyWorkspaceId === 'string' ? bodyWorkspaceId.trim() || undefined : undefined;
      if (providerId && modelId) {
        try {
          const vector = await callEmbedding(content, { providerId, modelId, baseUrl, apiKey });
          const date = new Date().toISOString().slice(0, 10);
          await memoryService.addToIndex(
            { filePath: dailyPath(date), date, text: content, vector },
            workspaceId,
          );
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'hybrid',
              provider: {
                configured: true,
                available: true,
                providerId,
                modelId,
              },
              lastEmbedError: undefined,
              fallback: { active: false },
            },
            workspaceId,
          );
        } catch (embedErr: any) {
          serverLogger.error('memory/capture (index)', embedErr.message);
          await memoryService.updateStatusMeta(
            {
              retrievalMode: 'keyword_fallback',
              provider: {
                configured: true,
                available: false,
                providerId,
                modelId,
              },
              lastEmbedError: embedErr?.message ?? String(embedErr),
              fallback: { active: true, reason: 'embedding_failed' },
            },
            workspaceId,
          );
        }
      }
      res.json({ success: true });
    } catch (err: any) {
      serverLogger.error('memory/capture', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '写入失败' });
    }
  });

  /** 测试向量嵌入连接（用于校验 Base URL、模型、API Key） */
  router.post('/memory/test-embedding', async (req, res) => {
    try {
      const { providerId, modelId, baseUrl, apiKey } = req.body as {
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
      };
      if (!providerId || !modelId) {
        res.status(400).json({ ok: false, error: '缺少 providerId 或 modelId' });
        return;
      }
      const vector = await callEmbedding('测试文本', { providerId, modelId, baseUrl, apiKey });
      await memoryService.updateStatusMeta(
        {
          retrievalMode: 'hybrid',
          provider: {
            configured: true,
            available: true,
            providerId,
            modelId,
          },
          lastEmbedError: undefined,
          fallback: { active: false },
        },
        undefined,
      );
      res.json({ ok: true, dimensions: vector?.length ?? 0 });
    } catch (err: any) {
      await memoryService.updateStatusMeta(
        {
          retrievalMode: 'keyword_fallback',
          provider: { configured: true, available: false },
          lastEmbedError: err?.message ?? String(err),
          fallback: { active: true, reason: 'embedding_probe_failed' },
        },
        undefined,
      );
      res.json({ ok: false, error: err?.message ?? '请求失败' });
    }
  });

  /** 从已有记忆文件重建向量索引。按用户隔离：已登录用户从其工作区 memory/ 读取并索引 */
  router.post('/memory/rebuild-index', async (req, res) => {
    try {
      const { providerId, modelId, baseUrl, apiKey, workspaceId: bodyWorkspaceId } = req.body as {
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        workspaceId?: string;
      };
      if (!providerId || !modelId) {
        res.status(400).json({ error: '缺少 providerId 或 modelId（向量嵌入）' });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      const effectiveWorkspaceId = userId && userId !== 'anonymous' ? userId : undefined;
      let fsToUse = sandboxFS;
      if (effectiveWorkspaceId && userSandboxManager && userId) {
        const { sandboxFS: userFS } = await userSandboxManager.getForUser(userId);
        fsToUse = userFS;
      }
      const workspaceRoot =
        userId && userId !== 'anonymous' && userSandboxManager
          ? userSandboxManager.getUserWorkspaceRoot(userId)
          : sandboxFS.getRoot();

      await vectorStore.clear(effectiveWorkspaceId);
      try {
        await fsToUse.mkdir(MEMORY_DIR);
      } catch {
        /* 目录已存在或创建失败均继续 */
      }
      let list: { name: string; type: string }[] = [];
      try {
        list = await fsToUse.list(MEMORY_DIR);
      } catch (listErr: any) {
        serverLogger.error('memory/rebuild-index (list)', listErr?.message);
        res.json({
          indexed: 0,
          filesFound: 0,
          fileNames: [],
          workspaceRoot,
          error: `无法读取 memory 目录: ${listErr?.message ?? ''}`,
        });
        return;
      }
      const mdFiles = list.filter(
        (e) => e.type !== 'directory' && e.name.toLowerCase().endsWith('.md'),
      );
      serverLogger.info('memory/rebuild-index', `list 返回 ${list.length} 项，.md 文件 ${mdFiles.length} 个: ${mdFiles.map((f) => f.name).join(', ') || '(无)'}`);
      const blocks: { filePath: string; date: string; text: string }[] = [];
      for (const e of mdFiles) {
        const filePath = `${MEMORY_DIR}/${e.name}`;
        let raw = '';
        try {
          raw = await fsToUse.read(filePath);
        } catch (readErr: any) {
          serverLogger.error('memory/rebuild-index (read)', filePath, readErr?.message);
          continue;
        }
        const dateFromFile = e.name.replace(/\.md$/i, '');
        const date = /^\d{4}-\d{2}-\d{2}$/.test(dateFromFile) ? dateFromFile : new Date().toISOString().slice(0, 10);
        const parts = raw.split(/\n---\n/).map((b) => b.trim()).filter(Boolean);
        for (const block of parts) {
          const text = block.replace(/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?\n?/, '').trim();
          if (!text || text.length < 2) continue;
          blocks.push({ filePath, date, text: text.slice(0, 8000) });
        }
      }
      const embedConfig = { providerId, modelId, baseUrl, apiKey };
      let indexed = 0;
      let lastEmbedError: string | undefined;
      for (let i = 0; i < blocks.length; i += EMBED_BATCH_SIZE) {
        const chunk = blocks.slice(i, i + EMBED_BATCH_SIZE);
        const texts = chunk.map((b) => b.text);
        try {
          const vectors = await callEmbeddingBatch(texts, embedConfig);
          for (let j = 0; j < chunk.length; j++) {
            await memoryService.addToIndex(
              { filePath: chunk[j].filePath, date: chunk[j].date, text: chunk[j].text, vector: vectors[j] },
              effectiveWorkspaceId,
            );
            indexed++;
          }
        } catch (embedErr: any) {
          lastEmbedError = embedErr?.message ?? String(embedErr);
          lastMemoryEmbedError = lastEmbedError;
          serverLogger.error('memory/rebuild-index (embed)', lastEmbedError ?? 'unknown');
          for (const b of chunk) {
            try {
              const vector = await callEmbedding(b.text, embedConfig);
              await memoryService.addToIndex({ filePath: b.filePath, date: b.date, text: b.text, vector }, effectiveWorkspaceId);
              indexed++;
            } catch (e2: any) {
              lastMemoryEmbedError = e2?.message ?? String(e2);
            }
          }
        }
      }
      const body: { indexed: number; filesFound: number; fileNames: string[]; workspaceRoot: string; embedError?: string } = {
        indexed,
        filesFound: mdFiles.length,
        fileNames: mdFiles.map((f) => f.name),
        workspaceRoot,
      };
      await memoryService.updateStatusMeta(
        {
          retrievalMode: lastEmbedError ? 'keyword_fallback' : 'hybrid',
          provider: {
            configured: true,
            available: !lastEmbedError,
            providerId,
            modelId,
          },
          lastEmbedError: lastEmbedError ?? undefined,
          fallback: lastEmbedError ? { active: true, reason: 'embedding_rebuild_partial_failure' } : { active: false },
        },
        effectiveWorkspaceId,
      );
      if (lastEmbedError !== undefined) body.embedError = lastEmbedError;
      res.json(body);
    } catch (err: any) {
      serverLogger.error('memory/rebuild-index', err.message, err.stack);
      res.status(500).json({ error: err.message ?? '重建失败' });
    }
  });

  /** OpenClaw 式自动记忆：后台执行，不向前端返回 captured/content；客户端仅触发，不展示记忆结果 */
  router.post('/memory/consider-capture', async (req, res) => {
    try {
      const {
        userMessage,
        assistantReply,
        providerId,
        modelId,
        baseUrl,
        apiKey,
        vectorProviderId,
        vectorModelId,
        vectorBaseUrl,
        vectorApiKey,
        workspaceId: bodyWorkspaceId,
      } = req.body as {
        userMessage?: string;
        assistantReply?: string;
        providerId?: string;
        modelId?: string;
        baseUrl?: string;
        apiKey?: string;
        vectorProviderId?: string;
        vectorModelId?: string;
        vectorBaseUrl?: string;
        vectorApiKey?: string;
        workspaceId?: string;
      };
      if (typeof userMessage !== 'string' || typeof assistantReply !== 'string' || !providerId || !modelId) {
        res.status(400).json({ error: '缺少 userMessage、assistantReply、providerId 或 modelId' });
        return;
      }
      const workspaceId = typeof bodyWorkspaceId === 'string' ? bodyWorkspaceId.trim() || undefined : undefined;
      const userId = (req as { userId?: string }).userId;
      setImmediate(() => {
        (async () => {
          const memSvc = (await getMemoryServiceForUser(userId)) ?? memoryService;
          const wid = workspaceId ?? userId;
          await runConsiderCapture({
            userMessage,
            assistantReply,
            providerId,
            modelId,
            baseUrl,
            apiKey,
            vectorProviderId,
            vectorModelId,
            vectorBaseUrl,
            vectorApiKey,
            memoryService: memSvc,
            workspaceId: wid,
          });
          await runLearnPromptExtract({
            userMessage,
            assistantReply,
            providerId,
            modelId,
            baseUrl,
            apiKey,
            memoryService: memSvc,
          });
        })().catch((err: any) => serverLogger.error('memory/consider-capture', err.message, err.stack));
      });
      res.json({ ok: true });
    } catch (err: any) {
      serverLogger.error('memory/consider-capture', err.message, err.stack);
      res.status(400).json({ error: err.message ?? '参数错误' });
    }
  });

  return router;
}
