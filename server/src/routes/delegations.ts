/**
 * 委托追踪路由：/api/delegations
 *
 * - GET    /api/delegations           → 列出委托（支持 ?status=&search=）
 * - POST   /api/delegations          → 创建委托
 * - PUT    /api/delegations/:id     → 更新委托
 * - DELETE /api/delegations/:id      → 删除委托
 * - GET    /api/delegations/overdue  → 获取逾期委托
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createDelegationsRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const delegations = await db.listDelegations(userId, { status, search });
      res.json(delegations.map(mapDelegation));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, description, delegatedTo, dueAt, source, tags } = req.body ?? {};
    try {
      if (!title || !delegatedTo) {
        res.status(400).json({ error: 'title 和 delegatedTo 必填' });
        return;
      }
      const delegation = await db.createDelegation({
        userId,
        title: String(title),
        description: description !== undefined ? String(description) : undefined,
        delegatedTo: String(delegatedTo),
        dueAt: dueAt !== undefined ? String(dueAt) : undefined,
        source: source !== undefined ? String(source) : undefined,
        tags: Array.isArray(tags) ? tags.map(String) : undefined,
      });
      res.status(201).json(mapDelegation(delegation));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '创建失败' });
    }
  });

  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title, description, delegatedTo, dueAt, status, notes, tags } = req.body ?? {};
    try {
      const updated = await db.updateDelegation(id, userId, {
        title: title !== undefined ? String(title) : undefined,
        description: description !== undefined ? (description === null ? null : String(description)) : undefined,
        delegatedTo: delegatedTo !== undefined ? String(delegatedTo) : undefined,
        dueAt: dueAt !== undefined ? (dueAt === null ? null : String(dueAt)) : undefined,
        status: status !== undefined ? String(status) : undefined,
        notes: notes !== undefined ? (notes === null ? null : String(notes)) : undefined,
        tags: tags !== undefined ? (Array.isArray(tags) ? tags.map(String) : undefined) : undefined,
      });
      if (!updated) { res.status(404).json({ error: '委托不存在' }); return; }
      res.json(mapDelegation(updated));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.getDelegation(id, userId);
      if (!existing) { res.status(404).json({ error: '委托不存在' }); return; }
      await db.deleteDelegation(id, userId);
      res.status(204).send();
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '删除失败' });
    }
  });

  router.get('/overdue', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    try {
      const delegations = await db.getDelegationsForFollowUp(userId);
      res.json({ delegations });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  return router;
}

type DelegationRow = {
  id: string; user_id: string; title: string; description: string | null;
  delegated_to: string; due_at: string | null; last_checked_at: string | null;
  status: string; follow_up_count: number; notes: string | null; source: string | null;
  tags: string[]; created_at: string; updated_at: string;
};

function mapDelegation(d: DelegationRow) {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    delegatedTo: d.delegated_to,
    dueAt: d.due_at,
    lastCheckedAt: d.last_checked_at,
    status: d.status,
    followUpCount: d.follow_up_count,
    notes: d.notes,
    source: d.source,
    tags: d.tags,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}
