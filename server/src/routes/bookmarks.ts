/**
 * 书签路由：/api/bookmarks
 *
 * - GET    /api/bookmarks              → 列出所有书签（支持 ?folder=&search=）
 * - POST   /api/bookmarks             → 创建书签
 * - PUT    /api/bookmarks/:id         → 更新书签
 * - DELETE /api/bookmarks/:id         → 删除书签
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createBookmarksRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    try {
      const folder = typeof req.query.folder === 'string' ? req.query.folder : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const bookmarks = await db.listBookmarks(userId, { folder, search });
      res.json(bookmarks.map(mapBookmark));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, url, description, folder, tags, favicon } = req.body;
    try {
      const bookmark = await db.createBookmark({
        userId,
        title: typeof title === 'string' ? title : '',
        url: typeof url === 'string' ? url : '',
        description: typeof description === 'string' ? description : undefined,
        folder: typeof folder === 'string' ? folder : '/',
        tags: Array.isArray(tags) ? tags : [],
        favicon: typeof favicon === 'string' ? favicon : undefined,
      });
      res.status(201).json(mapBookmark(bookmark));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title, url, description, folder, tags, favicon } = req.body;
    try {
      const updated = await db.updateBookmark(id, userId, {
        title: title !== undefined ? String(title) : undefined,
        url: url !== undefined ? String(url) : undefined,
        description: description !== undefined ? (description === null ? null : String(description)) : undefined,
        folder: folder !== undefined ? String(folder) : undefined,
        tags: tags !== undefined ? (Array.isArray(tags) ? tags : undefined) : undefined,
        favicon: favicon !== undefined ? (favicon === null ? null : String(favicon)) : undefined,
      });
      if (!updated) { res.status(404).json({ error: 'Bookmark not found' }); return; }
      res.json(mapBookmark(updated));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.getBookmark(id, userId);
      if (!existing) { res.status(404).json({ error: 'Bookmark not found' }); return; }
      await db.deleteBookmark(id, userId);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

type BookmarkRow = {
  id: string; user_id: string; title: string; url: string;
  description: string | null; folder: string; tags: string[];
  favicon: string | null; created_at: string; updated_at: string;
};

function mapBookmark(b: BookmarkRow) {
  return {
    id: b.id,
    title: b.title,
    url: b.url,
    description: b.description,
    folder: b.folder,
    tags: b.tags,
    favicon: b.favicon,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}
