/**
 * 聊天会话路由：/api/chat/sessions
 *
 * - GET    /api/chat/sessions                → 会话列表
 * - POST   /api/chat/sessions                → 创建会话
 * - GET    /api/chat/sessions/:id            → 会话详情
 * - PUT    /api/chat/sessions/:id            → 更新会话标题
 * - DELETE /api/chat/sessions/:id            → 删除会话
 * - GET    /api/chat/sessions/:id/messages   → 获取消息
 * - POST   /api/chat/sessions/:id/messages   → 追加消息
 * - DELETE /api/chat/sessions/:id/messages/:msgId → 删除单条消息
 */

import { Router } from 'express';
import type { AppDatabase } from '../db/database.js';

export interface ChatSessionRouterOptions {
  /** R014：用户追加消息后可选触发 X 事件驱动执行（由调用方节流） */
  onMessageAdded?: (userId: string) => void;
}

export function createChatSessionRouter(db: AppDatabase, options: ChatSessionRouterOptions = {}): Router {
  const { onMessageAdded } = options;
  const router = Router();

  /** GET /api/chat/sessions - 会话列表；query.scene 可选：x_direct（仅 X 主脑）、normal_chat（仅 AI 助手） */
  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const limit = parseInt(req.query.limit as string) || 50;
    const scene = typeof req.query.scene === 'string' ? req.query.scene : undefined;
    const sessions = await db.listSessions(userId, limit, scene);
    res.json(
      sessions.map((s: { id: string; title: string | null; created_at: string; updated_at: string }) => ({
        id: s.id,
        title: s.title,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
    );
  });

  /** POST /api/chat/sessions - 创建会话；body.scene 可选：x_direct（X 主脑）、normal_chat（AI 助手） */
  router.post('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { title, scene } = req.body ?? {};
    const session = await db.createSession(userId, title, typeof scene === 'string' ? scene : undefined);
    res.status(201).json({
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    });
  });

  /** GET /api/chat/sessions/:id - 会话详情 */
  router.get('/:id', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    // 只允许访问自己的会话
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.json({
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    });
  });

  /** PUT /api/chat/sessions/:id - 更新标题 */
  router.put('/:id', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { title } = req.body ?? {};
    if (typeof title !== 'string') {
      res.status(400).json({ error: 'Missing title' });
      return;
    }
    await db.updateSessionTitle(session.id, title);
    res.json({ success: true });
  });

  /** DELETE /api/chat/sessions/:id - 删除会话 */
  router.delete('/:id', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db.deleteSession(session.id);
    res.json({ success: true });
  });

  /** GET /api/chat/sessions/:id/messages - 获取消息列表 */
  router.get('/:id/messages', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 200;
    const messages = await db.getMessages(session.id, limit);
    res.json(
      messages.map((m: import('../db/database.js').ChatMessageRow) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : undefined,
        images: m.images_json ? JSON.parse(m.images_json) : undefined,
        attachedFiles: (m as { attached_files_json?: string | null }).attached_files_json
          ? JSON.parse((m as { attached_files_json: string }).attached_files_json)
          : undefined,
        createdAt: m.created_at,
      })),
    );
  });

  /** POST /api/chat/sessions/:id/messages - 追加消息 */
  router.post('/:id/messages', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { role, content, toolCalls, images, attachedFiles } = req.body ?? {};
    if (!role || typeof content !== 'string') {
      res.status(400).json({ error: 'Missing role or content' });
      return;
    }
    const toolCallsJson = toolCalls ? JSON.stringify(toolCalls) : undefined;
    const imagesJson = Array.isArray(images) ? JSON.stringify(images) : undefined;
    const attachedFilesJson = Array.isArray(attachedFiles) ? JSON.stringify(attachedFiles) : undefined;
    const msg = await db.addMessage(session.id, role, content, toolCallsJson, imagesJson, attachedFilesJson);
    if (onMessageAdded && session.user_id) onMessageAdded(session.user_id);
    res.status(201).json({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      toolCalls: msg.tool_calls_json ? JSON.parse(msg.tool_calls_json) : undefined,
      images: msg.images_json ? JSON.parse(msg.images_json) : undefined,
      attachedFiles: msg.attached_files_json ? JSON.parse(msg.attached_files_json) : undefined,
      createdAt: msg.created_at,
    });
  });

  /** DELETE /api/chat/sessions/:id/messages/:msgId - 删除单条消息 */
  router.delete('/:id/messages/:msgId', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await db.deleteMessage(req.params.msgId);
    res.json({ success: true });
  });

  return router;
}
