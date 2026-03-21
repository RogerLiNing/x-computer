import { Router } from 'express';
import path from 'path';
import type { AppDatabase } from '../db/database.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import { getDiscoveredSkills, getSkillContentByName, enrichSkillsWithLLMExtraction, deleteSkill } from '../skills/discovery.js';
import { installFromSkillHub, searchSkillHub } from '../skills/install.js';
import { RECOMMENDED_SKILLS } from '../config/recommendedSkills.js';

export function createSkillsRouter(
  getLLMConfigForScheduler: (uid: string) => Promise<{ providerId: string; modelId: string; apiKey?: string; baseUrl?: string } | null>,
  userSandboxManager?: UserSandboxManager,
  db?: AppDatabase,
): Router {
  const router = Router();

  /** Skill 搜索：从 SkillHub 搜索技能，供前端市场与 X 工具使用 */
  router.get('/skills/search', async (req, res) => {
    try {
      const q = String(req.query?.q ?? '').trim();
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query?.limit)) || 20));
      const result = await searchSkillHub(q, limit);
      if (result.ok) {
        res.json({ ok: true, skills: result.skills });
      } else {
        res.status(400).json({ ok: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message ?? 'Skill 搜索失败' });
    }
  });

  /** 精选 Skill 推荐：返回预设的推荐列表，供试用/个人版一键安装。已安装的会标记 installed。 */
  router.get('/skills/recommended', (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      const installed = getDiscoveredSkills(userId).map((s) => s.dirName ?? s.name);
      const list = RECOMMENDED_SKILLS.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        category: s.category,
        source: s.source || 'skillhub',
        installed: installed.includes(s.slug),
      }));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取推荐 Skills 失败' });
    }
  });

  /** 安装 Skill：source 格式 skillhub:<slug> 或 openclaw:<slug>，安装到用户工作区或默认 skills 目录 */
  router.post('/skills/install', async (req, res) => {
    try {
      const { source } = req.body as { source?: string };
      if (!source || typeof source !== 'string') {
        res.status(400).json({ error: '缺少 source，格式：skillhub:<slug> 或 openclaw:<slug>' });
        return;
      }
      const lower = source.trim().toLowerCase();
      if (!lower.startsWith('skillhub:') && !lower.startsWith('openclaw:')) {
        res.status(400).json({ error: 'source 须以 skillhub: 或 openclaw: 开头，如 skillhub:serpapi-search 或 openclaw:weather' });
        return;
      }
      const isOpenClaw = lower.startsWith('openclaw:');
      const slug = lower.slice(isOpenClaw ? 8 : 8).trim();
      if (!slug) {
        res.status(400).json({ error: `${isOpenClaw ? 'openclaw' : 'skillhub'}: 后需填写 slug` });
        return;
      }
      const userId = (req as { userId?: string }).userId;
      const targetRoot =
        userId && userId !== 'anonymous' && userSandboxManager
          ? path.join(userSandboxManager.getUserWorkspaceRoot(userId), 'skills')
          : undefined;

      let result;
      if (isOpenClaw) {
        // 从 GitHub 下载 OpenClaw skill (直接下载 SKILL.md)
        const skillsRoot = targetRoot || path.join(process.cwd(), 'skills');
        const skillDir = path.join(skillsRoot, slug);

        try {
          const fs = await import('fs/promises');
          await fs.mkdir(skillDir, { recursive: true });

          // 下载 SKILL.md
          const skillMdUrl = `https://raw.githubusercontent.com/openclaw/openclaw/main/skills/${slug}/SKILL.md`;
          const response = await fetch(skillMdUrl);
          if (!response.ok) {
            res.status(404).json({ error: `未找到 OpenClaw Skill: ${slug}，请检查 slug 是否正确` });
            return;
          }
          const content = await response.text();
          await fs.writeFile(path.join(skillDir, 'SKILL.md'), content);

          result = { ok: true, message: `OpenClaw Skill "${slug}" 安装成功`, dirName: slug };
        } catch (e: any) {
          result = { ok: false, message: `安装 OpenClaw Skill 失败: ${e.message}` };
        }
      } else {
        result = await installFromSkillHub(slug, targetRoot);
      }
      if (result.ok) {
        res.json({ success: true, message: result.message, dirName: result.dirName });
      } else {
        res.status(400).json({ error: result.message });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '安装 Skill 失败' });
    }
  });

  /** 获取 OpenClaw Skill 详情：从 GitHub 获取 SKILL.md 内容 */
  router.get('/skills/openclaw/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      if (!slug) {
        res.status(400).json({ error: '缺少 slug' });
        return;
      }
      const url = `https://raw.githubusercontent.com/openclaw/openclaw/main/skills/${slug}/SKILL.md`;
      const response = await fetch(url);
      if (!response.ok) {
        res.status(404).json({ error: `未找到 Skill: ${slug}` });
        return;
      }
      const content = await response.text();
      res.json({ slug, content });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取 Skill 详情失败' });
    }
  });

  /** Skill 发现：扫描 skills 目录，返回可配置的 Skill 列表。?extract=llm 时对无 configFields 的 Skill 用大模型提取。 */
  router.get('/skills', async (req, res) => {
    try {
      const userId = (req as { userId?: string }).userId;
      let skills = getDiscoveredSkills(userId);
      const extract = (req.query.extract as string)?.toLowerCase();
      if (extract === 'llm') {
        const llmConfig = userId ? await getLLMConfigForScheduler(userId) : null;
        if (llmConfig?.providerId && llmConfig?.modelId) {
          skills = await enrichSkillsWithLLMExtraction(
            skills,
            llmConfig,
            (name) => getSkillContentByName(name, userId)?.content ?? null
          );
        }
      }
      res.json(skills);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '获取 Skills 列表失败' });
    }
  });

  /** 删除 Skill：移除 skills/<dirName> 目录 */
  router.delete('/skills/:dirName', (req, res) => {
    try {
      const dirName = (req.params.dirName ?? '').trim();
      const userId = (req as { userId?: string }).userId;
      const result = deleteSkill(dirName, userId);
      if (result.ok) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? '删除 Skill 失败' });
    }
  });

  return router;
}
