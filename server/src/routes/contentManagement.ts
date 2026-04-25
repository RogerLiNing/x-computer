/**
 * 内容管理 API 路由（公告、邮件模板）
 */

import { Router, type Request, type Response } from 'express';
import type { AsyncDatabase } from '../db/database.js';
import { serverLogger } from '../observability/ServerLogger.js';

interface Announcement {
  id: string;
  title: string;
  title_en: string | null;
  content: string;
  content_en: string | null;
  type: string;
  target: string;
  priority: number;
  is_active: number;
  start_at: number | null;
  end_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface EmailTemplate {
  id: string;
  name: string;
  name_en: string | null;
  subject: string;
  subject_en: string | null;
  body: string;
  body_en: string | null;
  variables: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export function createContentManagementRoutes(db: AsyncDatabase): Router {
  const router = Router();

  // ============================================================
  // 检查管理员权限的中间件
  // ============================================================
  const requireAdmin = async (req: Request, res: Response, next: Function) => {
    const userId = (req as any).userId;
    
    if (!userId || userId === 'anonymous') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Email is stored in auth_accounts, not users
      const email = await db.queryOne<{ email: string } | undefined>(
        'SELECT email FROM auth_accounts WHERE user_id = ?',
        [userId]
      );

      if (!email?.email) {
        return res.status(401).json({ error: 'User not found' });
      }

      const config = (global as any).__xComputerConfig;
      const adminEmails = config?.admin?.emails ? config.admin.emails.split(',').map((e: string) => e.trim().toLowerCase()) : [];
      const isAdmin = adminEmails.includes(email.email.toLowerCase());

      if (!isAdmin) {
        return res.status(403).json({ error: 'Forbidden: Admin only' });
      }

      next();
    } catch (err) {
      serverLogger.error('content-admin-check', '管理员权限检查失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to check admin permission' });
    }
  };

  // ============================================================
  // 公告管理 API
  // ============================================================

  /**
   * GET /api/admin/announcements
   * 获取所有公告（管理后台）
   */
  router.get('/announcements', requireAdmin, async (req, res) => {
    try {
      const announcements = await db.query<Announcement>(
        `SELECT * FROM announcements ORDER BY priority DESC, created_at DESC`
      );
      res.json({ announcements });
    } catch (err) {
      serverLogger.error('admin/announcements/list', '获取公告列表失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch announcements' });
    }
  });

  /**
   * GET /api/announcements/active
   * 获取当前活跃的公告（用户端）
   */
  router.get('/active', async (req, res) => {
    const userId = (req as any).userId;
    const language = req.query.language || 'zh-CN';
    const now = Date.now();

    try {
      const userPlan = userId && userId !== 'anonymous'
        ? await db.queryOne<{ planId: string } | undefined>(
            'SELECT planId FROM subscriptions WHERE userId = ? AND status IN (?, ?, ?)',
            [userId, 'active', 'trialing', 'past_due']
          )
        : null;

      // targetParam is used for the target= condition; free/anonymous users see 'free', paid users see their planId
      const targetParam = userPlan?.planId ?? 'free';
      const queryParams: (string | number)[] = [targetParam, now, now];

      const announcements = await db.query<Announcement>(
        `SELECT * FROM announcements
         WHERE is_active = 1
         AND (target = 'all' OR target = ?)
         AND (start_at IS NULL OR start_at <= ?)
         AND (end_at IS NULL OR end_at >= ?)
         ORDER BY priority DESC, created_at DESC
         LIMIT 10`,
        queryParams
      );

      const formatted = announcements.map((a: Announcement) => ({
        id: a.id,
        title: language === 'en' ? (a.title_en || a.title) : a.title,
        content: language === 'en' ? (a.content_en || a.content) : a.content,
        type: a.type,
        priority: a.priority,
        created_at: a.created_at,
      }));

      res.json({ announcements: formatted });
    } catch (err) {
      serverLogger.error('announcements/active', '获取活跃公告失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch active announcements' });
    }
  });

  /**
   * POST /api/admin/announcements
   * 创建公告
   */
  router.post('/announcements', requireAdmin, async (req, res) => {
    const userId = (req as any).userId;
    const { title, title_en, content, content_en, type, target, priority, start_at, end_at } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    try {
      const id = `ann-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();

      const params: (string | number | null)[] = [
        id, 
        title, 
        title_en || null, 
        content, 
        content_en || null, 
        type || 'info', 
        target || 'all', 
        priority || 0, 
        start_at || null, 
        end_at || null, 
        userId || null, 
        now, 
        now
      ];

      await db.run(
        `INSERT INTO announcements (id, title, title_en, content, content_en, type, target, priority, is_active, start_at, end_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        params
      );

      const announcement = await db.queryOne<Announcement>('SELECT * FROM announcements WHERE id = ?', [id]);
      res.status(201).json(announcement);
    } catch (err) {
      serverLogger.error('admin/announcements/create', '创建公告失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to create announcement' });
    }
  });

  /**
   * PUT /api/admin/announcements/:id
   * 更新公告
   */
  router.put('/announcements/:id', requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const { title, title_en, content, content_en, type, target, priority, is_active, start_at, end_at } = req.body;

    try {
      const now = Date.now();
      const fields: string[] = [];
      const values: (string | number | null)[] = [];

      if (title !== undefined) { fields.push('title = ?'); values.push(title); }
      if (title_en !== undefined) { fields.push('title_en = ?'); values.push(title_en || null); }
      if (content !== undefined) { fields.push('content = ?'); values.push(content); }
      if (content_en !== undefined) { fields.push('content_en = ?'); values.push(content_en || null); }
      if (type !== undefined) { fields.push('type = ?'); values.push(type); }
      if (target !== undefined) { fields.push('target = ?'); values.push(target); }
      if (priority !== undefined) { fields.push('priority = ?'); values.push(priority); }
      if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }
      if (start_at !== undefined) { fields.push('start_at = ?'); values.push(start_at || null); }
      if (end_at !== undefined) { fields.push('end_at = ?'); values.push(end_at || null); }

      fields.push('updated_at = ?');
      values.push(now);
      values.push(id);

      await db.run(
        `UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`,
        values as (string | number | null)[]
      );

      const announcement = await db.queryOne<Announcement>('SELECT * FROM announcements WHERE id = ?', [id]);
      res.json(announcement);
    } catch (err) {
      serverLogger.error('admin/announcements/update', '更新公告失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to update announcement' });
    }
  });

  /**
   * DELETE /api/admin/announcements/:id
   * 删除公告
   */
  router.delete('/announcements/:id', requireAdmin, async (req, res) => {
    const id = req.params.id as string;

    try {
      await db.run('DELETE FROM announcements WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      serverLogger.error('admin/announcements/delete', '删除公告失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to delete announcement' });
    }
  });

  // ============================================================
  // 邮件模板管理 API
  // ============================================================

  /**
   * GET /api/admin/email-templates
   * 获取所有邮件模板
   */
  router.get('/email-templates', requireAdmin, async (_req, res) => {
    try {
      const templates = await db.query<EmailTemplate>(
        `SELECT id, name, name_en, subject, subject_en,
         substr(body, 0, 100) as body_preview,
         substr(body_en, 0, 100) as body_en_preview,
         variables, is_active, created_at, updated_at
         FROM email_templates ORDER BY name`
      );

      res.json({ templates });
    } catch (err) {
      serverLogger.error('admin/email-templates/list', '获取邮件模板列表失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch email templates' });
    }
  });

  /**
   * GET /api/admin/email-templates/:id
   * 获取单个邮件模板详情
   */
  router.get('/email-templates/:id', requireAdmin, async (req, res) => {
    const id = req.params.id as string;

    try {
      const template = await db.queryOne<EmailTemplate>(
        'SELECT * FROM email_templates WHERE id = ?',
        [id]
      );

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json(template);
    } catch (err) {
      serverLogger.error('admin/email-templates/get', '获取邮件模板失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to fetch email template' });
    }
  });

  /**
   * PUT /api/admin/email-templates/:id
   * 更新邮件模板
   */
  router.put('/email-templates/:id', requireAdmin, async (req, res) => {
    const id = req.params.id as string;
    const { subject, subject_en, body, body_en, variables, is_active } = req.body;

    try {
      const now = Date.now();
      const fields: string[] = [];
      const values: (string | number | null)[] = [];

      if (subject !== undefined) { fields.push('subject = ?'); values.push(subject); }
      if (subject_en !== undefined) { fields.push('subject_en = ?'); values.push(subject_en || null); }
      if (body !== undefined) { fields.push('body = ?'); values.push(body); }
      if (body_en !== undefined) { fields.push('body_en = ?'); values.push(body_en || null); }
      if (variables !== undefined) { fields.push('variables = ?'); values.push(JSON.stringify(variables)); }
      if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active ? 1 : 0); }

      fields.push('updated_at = ?');
      values.push(now);
      values.push(id);

      await db.run(
        `UPDATE email_templates SET ${fields.join(', ')} WHERE id = ?`,
        values as (string | number | null)[]
      );

      const template = await db.queryOne<EmailTemplate>('SELECT * FROM email_templates WHERE id = ?', [id]);
      res.json(template);
    } catch (err) {
      serverLogger.error('admin/email-templates/update', '更新邮件模板失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to update email template' });
    }
  });

  /**
   * POST /api/admin/email-templates
   * 创建邮件模板（可选）
   */
  router.post('/email-templates', requireAdmin, async (req, res) => {
    const { name, name_en, subject, subject_en, body, body_en, variables } = req.body;

    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject and body are required' });
    }

    try {
      const id = `tpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();

      const params: (string | number | null)[] = [
        id, 
        name, 
        name_en || null, 
        subject, 
        subject_en || null, 
        body, 
        body_en || null, 
        variables ? JSON.stringify(variables) : null, 
        now, 
        now
      ];

      await db.run(
        `INSERT INTO email_templates (id, name, name_en, subject, subject_en, body, body_en, variables, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        params
      );

      const template = await db.queryOne<EmailTemplate>('SELECT * FROM email_templates WHERE id = ?', [id]);
      res.status(201).json(template);
    } catch (err) {
      serverLogger.error('admin/email-templates/create', '创建邮件模板失败', `error=${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'Failed to create email template' });
    }
  });

  return router;
}