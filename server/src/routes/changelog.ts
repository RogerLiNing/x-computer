/**
 * Changelog 路由：/api/changelog
 *
 * - GET    /api/changelog          → 列出更新日志（支持 ?year=）
 * - POST   /api/changelog          → 创建更新日志
 * - PUT    /api/changelog/:id      → 更新更新日志
 * - DELETE /api/changelog/:id      → 删除更新日志
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createChangelogRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    try {
      const entries = await db.listChangelogEntries(userId, { year });
      res.json(entries.map(mapEntry));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { version, title, titleEn, content, contentEn, tags, releasedAt } = req.body ?? {};
    try {
      if (!version || !title || !content) {
        res.status(400).json({ error: 'version、title 和 content 必填' });
        return;
      }
      const entry = await db.createChangelogEntry({
        userId,
        version: String(version),
        title: String(title),
        titleEn: titleEn !== undefined ? String(titleEn) : undefined,
        content: String(content),
        contentEn: contentEn !== undefined ? String(contentEn) : undefined,
        tags: Array.isArray(tags) ? tags.map(String) : undefined,
        releasedAt: releasedAt !== undefined ? String(releasedAt) : undefined,
      });
      res.status(201).json(mapEntry(entry));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '创建失败' });
    }
  });

  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { version, title, titleEn, content, contentEn, tags, releasedAt } = req.body ?? {};
    try {
      const updated = await db.updateChangelogEntry(id, userId, {
        version: version !== undefined ? String(version) : undefined,
        title: title !== undefined ? String(title) : undefined,
        titleEn: titleEn !== undefined ? (titleEn === null ? null : String(titleEn)) : undefined,
        content: content !== undefined ? String(content) : undefined,
        contentEn: contentEn !== undefined ? (contentEn === null ? null : String(contentEn)) : undefined,
        tags: tags !== undefined ? (Array.isArray(tags) ? tags.map(String) : undefined) : undefined,
        releasedAt: releasedAt !== undefined ? (releasedAt === null ? null : String(releasedAt)) : undefined,
      });
      if (!updated) { res.status(404).json({ error: '更新日志不存在' }); return; }
      res.json(mapEntry(updated));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.getChangelogEntry(id, userId);
      if (!existing) { res.status(404).json({ error: '更新日志不存在' }); return; }
      await db.deleteChangelogEntry(id, userId);
      res.status(204).send();
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '删除失败' });
    }
  });

  return router;
}

type ChangelogRow = {
  id: string; user_id: string; version: string; title: string; title_en: string | null;
  content: string; content_en: string | null; tags: string[];
  released_at: string | null; created_at: string;
};

function mapEntry(e: ChangelogRow) {
  return {
    id: e.id,
    version: e.version,
    title: e.title,
    titleEn: e.title_en,
    content: e.content,
    contentEn: e.content_en,
    tags: e.tags,
    releasedAt: e.released_at,
    createdAt: e.created_at,
  };
}
