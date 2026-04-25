/**
 * 日历事件路由：/api/calendar/events
 *
 * - GET    /api/calendar/events             → 列出事件（支持 year/month 过滤）
 * - POST   /api/calendar/events             → 创建事件
 * - GET    /api/calendar/events/:id         → 获取单个事件
 * - PUT    /api/calendar/events/:id         → 更新事件
 * - DELETE /api/calendar/events/:id         → 删除事件
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export function createCalendarRouter(db: AppDatabase): Router {
  const router = Router();

  // List events
  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const year = req.query.year != null ? parseInt(req.query.year as string, 10) : undefined;
    const month = req.query.month != null ? parseInt(req.query.month as string, 10) : undefined;
    try {
      const events = await db.listCalendarEvents(userId, { year, month });
      res.json(events.map(mapEvent));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create event
  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, description, startTime, endTime, allDay, color } = req.body;
    if (!title || typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (startTime == null || typeof startTime !== 'number') {
      res.status(400).json({ error: 'startTime (number, Unix ms) is required' });
      return;
    }
    try {
      const event = await db.createCalendarEvent({
        userId,
        title: title.trim(),
        description: description?.trim() || null,
        startTime,
        endTime: endTime ?? null,
        allDay: !!allDay,
        color,
      });
      res.status(201).json(mapEvent(event));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single event
  router.get('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const event = await db.getCalendarEvent(id, userId);
      if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }
      res.json(mapEvent(event));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update event
  router.put('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { title, description, startTime, endTime, allDay, color } = req.body;
    try {
      const existing = await db.getCalendarEvent(id, userId);
      if (!existing) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }
      const updated = await db.updateCalendarEvent(id, userId, {
        title: title?.trim(),
        description: description === undefined ? undefined : (description?.trim() ?? null),
        startTime,
        endTime,
        allDay,
        color,
      });
      res.json(mapEvent(updated!));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete event
  router.delete('/:id', async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    try {
      const existing = await db.getCalendarEvent(id, userId);
      if (!existing) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }
      await db.deleteCalendarEvent(id, userId);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

function mapEvent(e: {
  id: string; user_id: string; title: string; description: string | null;
  start_time: number; end_time: number | null; all_day: number; color: string;
  created_at: string; updated_at: string;
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startTime: e.start_time,
    endTime: e.end_time,
    allDay: !!e.all_day,
    color: e.color,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}
