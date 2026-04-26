/**
 * 快速笔记路由：/api/notes
 *
 * - GET    /api/notes             → 列出所有笔记
 * - POST   /api/notes             → 创建笔记
 * - PUT    /api/notes/:id         → 更新笔记
 * - DELETE /api/notes/:id        → 删除笔记
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createNotesRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    try {
      const notes = await db.listQuickNotes(userId);
      res.json(notes.map(mapNote));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, content, color, pinned } = req.body;
    try {
      const note = await db.createQuickNote({
        userId,
        title: typeof title === 'string' ? title : '',
        content: typeof content === 'string' ? content : '',
        color: typeof color === 'string' ? color : undefined,
        pinned: !!pinned,
      });
      res.status(201).json(mapNote(note));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title, content, color, pinned } = req.body;
    try {
      const updated = await db.updateQuickNote(id, userId, {
        title: title !== undefined ? String(title) : undefined,
        content: content !== undefined ? String(content) : undefined,
        color: typeof color === 'string' ? color : undefined,
        pinned: pinned !== undefined ? !!pinned : undefined,
      });
      if (!updated) { res.status(404).json({ error: 'Note not found' }); return; }
      res.json(mapNote(updated));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.updateQuickNote(id, userId, {});
      if (!existing) { res.status(404).json({ error: 'Note not found' }); return; }
      await db.deleteQuickNote(id, userId);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function mapNote(n: { id: string; user_id: string; title: string; content: string; color: string; pinned: number; created_at: string; updated_at: string }) {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    color: n.color,
    pinned: !!n.pinned,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  };
}
