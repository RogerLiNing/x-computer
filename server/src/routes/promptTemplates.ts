import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createPromptTemplatesRouter(db: AsyncDatabase): Router {
  const router = Router();

  function mapTemplate(row: {
    id: string; user_id: string; name: string; content: string;
    category: string | null; description: string | null; variables: string | null; created_at: number; updated_at: number;
  }) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      content: row.content,
      category: row.category,
      description: row.description,
      variables: row.variables ? JSON.parse(row.variables) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // GET /api/prompt-templates — list user's templates
  router.get('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { category } = req.query as { category?: string };
      let templates = await db.listPromptTemplatesByUser(userId);
      if (category) {
        templates = templates.filter((t) => t.category === category);
      }
      res.json({ success: true, data: templates.map(mapTemplate) });
    } catch (err) {
      serverLogger.error('prompt-templates', '列表失败', String(err));
      res.status(500).json({ success: false, error: '获取模板列表失败' });
    }
  });

  // POST /api/prompt-templates — create template
  router.post('/', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { name, content, category, description, variables } = req.body as {
        name?: string; content?: string; category?: string; description?: string; variables?: string[];
      };
      if (!name || !content) {
        res.status(400).json({ success: false, error: 'name 和 content 必填' });
        return;
      }
      const id = crypto.randomUUID();
      const now = Date.now();
      await db.insertPromptTemplate({
        id,
        user_id: userId,
        name,
        content,
        category: category || null,
        description: description || null,
        variables: variables ? JSON.stringify(variables) : null,
        created_at: now,
        updated_at: now,
      });
      serverLogger.info('prompt-templates', '模板已创建', `id=${id} userId=${userId}`);
      res.json({ success: true, data: mapTemplate({ id, user_id: userId, name, content, category: category || null, description: description || null, variables: variables ? JSON.stringify(variables) : null, created_at: now, updated_at: now }) });
    } catch (err) {
      serverLogger.error('prompt-templates', '创建失败', String(err));
      res.status(500).json({ success: false, error: '创建模板失败' });
    }
  });

  // GET /api/prompt-templates/:id — get single template
  router.get('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const row = await db.getPromptTemplate(req.params.id, userId);
      if (!row) { res.status(404).json({ success: false, error: '模板不存在' }); return; }
      res.json({ success: true, data: mapTemplate(row) });
    } catch (err) {
      serverLogger.error('prompt-templates', '获取失败', String(err));
      res.status(500).json({ success: false, error: '获取模板失败' });
    }
  });

  // PUT /api/prompt-templates/:id — update template
  router.put('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const existing = await db.getPromptTemplate(req.params.id, userId);
      if (!existing) { res.status(404).json({ success: false, error: '模板不存在' }); return; }
      const { name, content, category, description, variables } = req.body as {
        name?: string; content?: string; category?: string | null; description?: string | null; variables?: string[] | null;
      };
      await db.updatePromptTemplate(req.params.id, userId, {
        name,
        content,
        category: category !== undefined ? (category || null) : undefined,
        description: description !== undefined ? (description || null) : undefined,
        variables: variables !== undefined ? (variables ? JSON.stringify(variables) : null) : undefined,
      });
      const updated = await db.getPromptTemplate(req.params.id, userId);
      res.json({ success: true, data: updated ? mapTemplate(updated) : null });
    } catch (err) {
      serverLogger.error('prompt-templates', '更新失败', String(err));
      res.status(500).json({ success: false, error: '更新模板失败' });
    }
  });

  // DELETE /api/prompt-templates/:id — delete template
  router.delete('/:id', async (req, res) => {
    try {
      const userId = (req as any).userId;
      const existing = await db.getPromptTemplate(req.params.id, userId);
      if (!existing) { res.status(404).json({ success: false, error: '模板不存在' }); return; }
      await db.deletePromptTemplate(req.params.id, userId);
      serverLogger.info('prompt-templates', '模板已删除', `id=${req.params.id}`);
      res.json({ success: true, data: { message: '模板已删除' } });
    } catch (err) {
      serverLogger.error('prompt-templates', '删除失败', String(err));
      res.status(500).json({ success: false, error: '删除模板失败' });
    }
  });

  return router;
}
