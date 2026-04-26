/**
 * Reading List 路由：/api/reading-list
 *
 * - GET    /api/reading-list              → 列出阅读项（支持 ?status=&search=）
 * - POST   /api/reading-list              → 创建阅读项
 * - PUT    /api/reading-list/:id           → 更新阅读项
 * - DELETE /api/reading-list/:id           → 删除阅读项
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createReadingListRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const items = await db.listReadingItems(userId, { status, search });
      res.json(items.map(mapItem));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, author, url, notes, priority, tags, source } = req.body ?? {};
    try {
      if (!title) { res.status(400).json({ error: 'title 必填' }); return; }
      const item = await db.createReadingItem({
        userId,
        title: String(title),
        author: author !== undefined ? String(author) : undefined,
        url: url !== undefined ? String(url) : undefined,
        notes: notes !== undefined ? String(notes) : undefined,
        priority: priority !== undefined ? String(priority) : undefined,
        tags: Array.isArray(tags) ? tags.map(String) : undefined,
        source: source !== undefined ? String(source) : undefined,
      });
      res.status(201).json(mapItem(item));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '创建失败' });
    }
  });

  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title, author, url, notes, priority, status, rating, tags, source } = req.body ?? {};
    try {
      const updated = await db.updateReadingItem(id, userId, {
        title: title !== undefined ? String(title) : undefined,
        author: author !== undefined ? (author === null ? null : String(author)) : undefined,
        url: url !== undefined ? (url === null ? null : String(url)) : undefined,
        notes: notes !== undefined ? (notes === null ? null : String(notes)) : undefined,
        priority: priority !== undefined ? String(priority) : undefined,
        status: status !== undefined ? String(status) : undefined,
        rating: rating !== undefined ? (rating === null ? null : Number(rating)) : undefined,
        tags: tags !== undefined ? (Array.isArray(tags) ? tags.map(String) : undefined) : undefined,
        source: source !== undefined ? (source === null ? null : String(source)) : undefined,
      });
      if (!updated) { res.status(404).json({ error: '阅读项不存在' }); return; }
      res.json(mapItem(updated));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.getReadingItem(id, userId);
      if (!existing) { res.status(404).json({ error: '阅读项不存在' }); return; }
      await db.deleteReadingItem(id, userId);
      res.status(204).send();
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '删除失败' });
    }
  });

  return router;
}

type ReadingItemRow = {
  id: string; user_id: string; title: string; author: string | null;
  url: string | null; notes: string | null; priority: string | null; status: string | null;
  rating: number | null; tags: string[]; source: string | null;
  created_at: string; updated_at: string;
};

function mapItem(i: ReadingItemRow) {
  return {
    id: i.id,
    title: i.title,
    author: i.author,
    url: i.url,
    notes: i.notes,
    priority: i.priority,
    status: i.status,
    rating: i.rating,
    tags: i.tags,
    source: i.source,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  };
}
