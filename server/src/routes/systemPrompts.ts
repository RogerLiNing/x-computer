import { Router } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

export function createSystemPromptsRouter(db: AsyncDatabase): Router {
  const router = Router();

  function mapPrompt(row: {
    id: string; mode: string; content: string; enabled: number; created_by: string | null; created_at: number; updated_at: number;
  }) {
    return {
      id: row.id,
      mode: row.mode,
      content: row.content,
      enabled: !!row.enabled,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // GET /api/admin/system-prompts — list all system prompts
  router.get('/', async (_req, res) => {
    try {
      const prompts = await db.listSystemPrompts();
      res.json({ success: true, data: prompts.map(mapPrompt) });
    } catch (err) {
      serverLogger.error('system-prompts', '列表失败', String(err));
      res.status(500).json({ success: false, error: '获取系统提示词失败' });
    }
  });

  // PUT /api/admin/system-prompts/:mode — create or update a system prompt for a mode
  router.put('/:mode', async (req, res) => {
    try {
      const { mode } = req.params;
      const { content, enabled } = req.body as { content?: string; enabled?: boolean };
      if (!content) {
        res.status(400).json({ success: false, error: 'content 必填' });
        return;
      }
      const existing = await db.getSystemPromptByMode(mode);
      const now = Date.now();
      await db.upsertSystemPrompt({
        id: existing?.id ?? `sp-${mode}-${now}`,
        mode,
        content,
        enabled: enabled ?? (existing?.enabled ? true : false),
        created_by: existing?.created_by ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
      const updated = await db.getSystemPromptByMode(mode);
      res.json({ success: true, data: updated ? mapPrompt(updated) : null });
    } catch (err) {
      serverLogger.error('system-prompts', '更新失败', String(err));
      res.status(500).json({ success: false, error: '更新系统提示词失败' });
    }
  });

  // DELETE /api/admin/system-prompts/:id — delete a system prompt
  router.delete('/:id', async (req, res) => {
    try {
      await db.deleteSystemPrompt(req.params.id);
      serverLogger.info('system-prompts', '提示词已删除', `id=${req.params.id}`);
      res.json({ success: true, data: { message: '已删除' } });
    } catch (err) {
      serverLogger.error('system-prompts', '删除失败', String(err));
      res.status(500).json({ success: false, error: '删除系统提示词失败' });
    }
  });

  return router;
}
