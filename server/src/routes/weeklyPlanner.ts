/**
 * Weekly Planner 路由：/api/weekly-plans
 *
 * - GET    /api/weekly-plans              → 列出周计划（支持 ?status=&year=）
 * - POST   /api/weekly-plans              → 创建周计划
 * - GET    /api/weekly-plans/:id         → 获取单个周计划（含条目）
 * - PUT    /api/weekly-plans/:id          → 更新周计划
 * - DELETE /api/weekly-plans/:id         → 删除周计划
 * - PUT    /api/weekly-plans/:id/entries → 更新日条目
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createWeeklyPlannerRouter(db: AppDatabase): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    try {
      const plans = await db.listWeeklyPlans(userId, { status, year });
      res.json(plans.map(mapPlan));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, weekStart, weekEnd, goals, tags } = req.body ?? {};
    try {
      if (!title || !weekStart || !weekEnd) {
        res.status(400).json({ error: 'title、weekStart 和 weekEnd 必填' });
        return;
      }
      const plan = await db.createWeeklyPlan({
        userId,
        title: String(title),
        weekStart: String(weekStart),
        weekEnd: String(weekEnd),
        goals: Array.isArray(goals) ? goals.map(String) : undefined,
        tags: Array.isArray(tags) ? tags.map(String) : undefined,
      });
      res.status(201).json(mapPlan(plan));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '创建失败' });
    }
  });

  router.get('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const plan = await db.getWeeklyPlan(id, userId);
      if (!plan) { res.status(404).json({ error: '周计划不存在' }); return; }
      const entries = await db.listWeeklyPlanEntries(id);
      res.json({ ...mapPlan(plan), entries: entries.map(mapEntry) });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '读取失败' });
    }
  });

  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title, weekStart, weekEnd, status, goals, reflection, rating, tags } = req.body ?? {};
    try {
      const updated = await db.updateWeeklyPlan(id, userId, {
        title: title !== undefined ? String(title) : undefined,
        weekStart: weekStart !== undefined ? String(weekStart) : undefined,
        weekEnd: weekEnd !== undefined ? String(weekEnd) : undefined,
        status: status !== undefined ? String(status) : undefined,
        goals: goals !== undefined ? (Array.isArray(goals) ? goals.map(String) : undefined) : undefined,
        reflection: reflection !== undefined ? (reflection === null ? null : String(reflection)) : undefined,
        rating: rating !== undefined ? (rating === null ? null : Number(rating)) : undefined,
        tags: tags !== undefined ? (Array.isArray(tags) ? tags.map(String) : undefined) : undefined,
      });
      if (!updated) { res.status(404).json({ error: '周计划不存在' }); return; }
      res.json(mapPlan(updated));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
    }
  });

  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.getWeeklyPlan(id, userId);
      if (!existing) { res.status(404).json({ error: '周计划不存在' }); return; }
      await db.deleteWeeklyPlan(id, userId);
      res.status(204).send();
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '删除失败' });
    }
  });

  router.put('/:id/entries', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { date, completed, notes } = req.body ?? {};
    try {
      const plan = await db.getWeeklyPlan(id, userId);
      if (!plan) { res.status(404).json({ error: '周计划不存在' }); return; }
      if (!date) { res.status(400).json({ error: 'date 必填' }); return; }
      const entry = await db.upsertWeeklyPlanEntry({
        planId: id,
        userId,
        date: String(date),
        completed: completed !== undefined ? Boolean(completed) : undefined,
        notes: notes !== undefined ? String(notes) : undefined,
      });
      res.json(mapEntry(entry));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '更新失败' });
    }
  });

  return router;
}

type PlanRow = {
  id: string; user_id: string; title: string; week_start: string; week_end: string;
  status: string; goals: string[]; reflection: string | null; rating: number | null;
  tags: string[]; created_at: string; updated_at: string;
};

type EntryRow = {
  id: string; plan_id: string; user_id: string; date: string;
  completed: boolean; notes: string | null; created_at: string; updated_at: string;
};

function mapPlan(p: PlanRow) {
  return {
    id: p.id,
    title: p.title,
    weekStart: p.week_start,
    weekEnd: p.week_end,
    status: p.status,
    goals: p.goals,
    reflection: p.reflection,
    rating: p.rating,
    tags: p.tags,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function mapEntry(e: EntryRow) {
  return {
    id: e.id,
    planId: e.plan_id,
    date: e.date,
    completed: e.completed,
    notes: e.notes,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}
