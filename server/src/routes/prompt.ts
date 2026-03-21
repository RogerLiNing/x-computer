import { Router } from 'express';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import type { VectorStore } from '../memory/vectorStore.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { AppDatabase } from '../db/database.js';
import { MemoryService } from '../memory/MemoryService.js';
import { getWelcomeMessage, getUserLanguage } from '../prompts/systemCore/promptLoader.js';

export function createPromptRouter(
  sandboxFS: SandboxFS,
  vectorStore: VectorStore,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
): Router {
  const router = Router();
  const memoryService = new MemoryService(sandboxFS, vectorStore);

  async function getMemoryServiceForUser(userId: string | undefined): Promise<MemoryService | null> {
    if (!userId || userId === 'anonymous' || !userSandboxManager) return null;
    const { sandboxFS: userFS } = await userSandboxManager.getForUser(userId);
    return new MemoryService(userFS, vectorStore);
  }

  async function getEvolvedCorePromptForUser(userId: string | undefined): Promise<string> {
    const mem = await getMemoryServiceForUser(userId);
    const svc = mem ?? memoryService;
    await svc.ensureEvolvedCorePromptExists();
    return svc.readEvolvedCorePrompt();
  }

  // ── 主脑提示词自我进化（可对话中触发或定时任务调用 evolve_system_prompt） ──
  router.get('/prompt/evolved', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const content = await getEvolvedCorePromptForUser(userId);
      res.json({ evolvedCorePrompt: content });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? '读取失败' });
    }
  });

  // ── Prompts (主脑提示词) ──
  router.get('/prompts/welcome', async (req, res) => {
    let lang: 'en' | 'zh-CN' = 'zh-CN';
    const queryLang = String(req.query?.lang ?? '').trim().toLowerCase();
    if (queryLang === 'en' || queryLang === 'zh-cn') {
      lang = queryLang === 'en' ? 'en' : 'zh-CN';
    } else if (db) {
      const userId = (req as { userId?: string }).userId;
      if (userId && userId !== 'anonymous') {
        lang = await getUserLanguage(db, userId);
      } else {
        const accept = (req.headers['accept-language'] as string) ?? '';
        lang = accept.includes('en') && !accept.startsWith('zh') ? 'en' : 'zh-CN';
      }
    }
    res.json({ content: getWelcomeMessage(lang) });
  });

  return router;
}
