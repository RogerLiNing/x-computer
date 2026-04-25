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
import { callLLM } from '../chat/chatService.js';
import type { AppDatabase } from '../db/database.js';

/** 提取搜索关键词周围的文本片段 */
function extractSnippet(content: string, q: string, context = 60): string {
  const idx = content.toLowerCase().indexOf(q);
  if (idx === -1) return content.slice(0, 120);
  const start = Math.max(0, idx - context);
  const end = Math.min(content.length, idx + q.length + context);
  const snippet = content.slice(start, end);
  return (start > 0 ? '…' : '') + snippet + (end < content.length ? '…' : '');
}

export interface ChatSessionRouterOptions {
  /** R014：用户追加消息后可选触发 X 事件驱动执行（由调用方节流） */
  onMessageAdded?: (userId: string) => void;
}

export function createChatSessionRouter(db: AppDatabase, options: ChatSessionRouterOptions = {}): Router {
  const { onMessageAdded } = options;
  const router = Router();

  /** GET /api/chat/sessions - 会话列表；query.scene 可选：x_direct（仅 X 主脑）、normal_chat（仅 AI 助手）；query.search 搜索标题；query.tag 标签过滤 */
  router.get('/', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const limit = parseInt(req.query.limit as string) || 50;
    const scene = typeof req.query.scene === 'string' ? req.query.scene : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : undefined;
    const includeArchived = req.query.archived === 'true';
    const sessions = await db.listSessions(userId, limit, scene, includeArchived);
    const mapped = sessions.map((s: { id: string; title: string | null; created_at: string; updated_at: string; tags?: string | null; is_pinned?: number; is_archived?: number }) => {
      const tags = s.tags ? JSON.parse(s.tags) as string[] : [];
      return {
        id: s.id,
        title: s.title,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        tags,
        isPinned: !!s.is_pinned,
        isArchived: !!s.is_archived,
      };
    });
    let result = mapped;
    if (tag) {
      result = result.filter((s) => s.tags.includes(tag));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s) => (s.title ?? '').toLowerCase().includes(q));
    }
    res.json(result);
  });

  /** GET /api/chat/sessions/bookmarks - 获取当前用户所有会话中被收藏的消息 */
  router.get('/bookmarks', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const limit = parseInt(req.query.limit as string) || 100;
    try {
      const messages = await db.getBookmarkedMessages(userId, limit);
      res.json(
        messages.map((m: import('../db/database.js').ChatMessageRow) => ({
          id: m.id,
          sessionId: m.session_id,
          role: m.role,
          content: m.content,
          toolCalls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : undefined,
          images: m.images_json ? JSON.parse(m.images_json) : undefined,
          reactions: m.reactions ? JSON.parse(m.reactions) : undefined,
          bookmarked: !!m.bookmarked,
          createdAt: m.created_at,
        })),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to get bookmarks', detail: msg });
    }
  });

  /** GET /api/chat/sessions/archived - 列出已归档的会话 */
  router.get('/archived', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const limit = parseInt(req.query.limit as string) || 50;
    try {
      const sessions = await db.listArchivedSessions(userId, limit);
      res.json(sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        tags: s.tags ? JSON.parse(s.tags) : [],
        isPinned: !!s.is_pinned,
        isArchived: true,
      })));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to list archived sessions', detail: msg });
    }
  });

  /** GET /api/chat/sessions/search?q=keyword - 跨会话全文搜索消息 */
  router.get('/search', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) { res.json([]); return; }
    const limit = parseInt(req.query.limit as string) || 50;
    try {
      const messages = await db.searchMessages(userId, q, limit);
      res.json(
        messages.map((m) => ({
          id: m.id,
          sessionId: m.session_id,
          sessionTitle: (m as { session_title?: string | null }).session_title ?? null,
          role: m.role,
          content: m.content,
          snippet: extractSnippet(m.content || '', q),
          createdAt: m.created_at,
        })),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Search failed', detail: msg });
    }
  });

  /** POST /api/chat/sessions/branch - 从指定消息分支创建新会话 */
  router.post('/branch', async (req, res) => {
    const userId = req.userId;
    await db.ensureUser(userId);
    const { messageId } = req.body ?? {};
    if (!messageId || typeof messageId !== 'string') {
      res.status(400).json({ error: 'Missing messageId' });
      return;
    }
    try {
      const newSession = await db.branchSession(messageId, userId);
      if (!newSession) {
        res.status(404).json({ error: 'Message not found or access denied' });
        return;
      }
      res.status(201).json({ id: newSession.id, title: newSession.title, createdAt: newSession.created_at });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to branch session', detail: msg });
    }
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

  /** PATCH /api/chat/sessions/:id/pin - 置顶/取消置顶会话 */
  router.patch('/:id/pin', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    const { pinned } = req.body ?? {};
    if (typeof pinned !== 'boolean') { res.status(400).json({ error: 'Missing pinned (boolean)' }); return; }
    await db.updateSessionPin(session.id, pinned);
    res.json({ success: true, pinned });
  });

  /** PATCH /api/chat/sessions/:id/archive - 归档会话 */
  router.patch('/:id/archive', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    await db.archiveSession(session.id);
    res.json({ success: true, is_archived: true });
  });

  /** PATCH /api/chat/sessions/:id/unarchive - 取消归档会话 */
  router.patch('/:id/unarchive', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
    await db.unarchiveSession(session.id);
    res.json({ success: true, is_archived: false });
  });

  /** PATCH /api/chat/sessions/:id/tags - 更新会话标签 */
  router.patch('/:id/tags', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const { tags } = req.body ?? {};
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
      res.status(400).json({ error: 'tags must be an array of strings' });
      return;
    }
    const tagsJson = tags.length > 0 ? JSON.stringify(tags) : null;
    await db.updateSessionTags(session.id, tagsJson);
    res.json({ success: true, tags: tagsJson ? JSON.parse(tagsJson) : [] });
  });

  /**
   * POST /api/chat/sessions/:id/title — 使用 LLM 为会话生成标题（仅当标题为空时）
   * body: { providerId, modelId, baseUrl?, apiKey? }
   * 返回: { title: string }
   */
  router.post('/:id/title', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }

    // 已有标题直接返回
    if (session.title) { res.json({ title: session.title }); return; }

    const { providerId, modelId, baseUrl, apiKey } = req.body ?? {};
    if (!providerId || !modelId) { res.status(400).json({ error: 'Missing providerId or modelId' }); return; }

    // 获取第一条用户消息作为标题生成素材
    const messages = await db.getMessages(req.params.id, 200);
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (!firstUserMsg?.content) { res.json({ title: '' }); return; }

    const content = firstUserMsg.content.trim().slice(0, 500);
    try {
      const result = await callLLM({
        messages: [
          { role: 'user', content: `根据以下对话首条用户消息，生成一个简短标题（中文≤40字，英文≤60字符）。只输出标题，不要解释。\n\n用户消息：${content}` },
        ],
        providerId,
        modelId,
        baseUrl,
        apiKey,
      });
      const title = (result ?? '').trim().slice(0, 60);
      if (title) {
        await db.updateSessionTitle(session.id, title);
        res.json({ title });
      } else {
        res.json({ title: '' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Title generation failed', detail: msg });
    }
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
        reactions: m.reactions ? JSON.parse(m.reactions) : undefined,
        createdAt: m.created_at,
      })),
    );
  });

  /** GET /api/chat/sessions/:id/messages/search?q= - 搜索会话内的消息 */
  router.get('/:id/messages/search', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (!q) {
      res.json([]);
      return;
    }
    const messages = await db.getMessages(session.id, 500);
    const results = messages
      .filter((m) => m.content && m.content.toLowerCase().includes(q))
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
        snippet: extractSnippet(m.content, q),
      }));
    res.json(results);
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

  /** PATCH /api/chat/sessions/messages/:msgId/bookmark - 收藏/取消收藏消息 */
  router.patch('/messages/:msgId/bookmark', async (req, res) => {
    const { bookmarked } = req.body ?? {};
    if (typeof bookmarked !== 'boolean') {
      res.status(400).json({ error: 'Missing bookmarked (boolean)' });
      return;
    }
    try {
      await db.updateMessageBookmark(req.params.msgId, bookmarked);
      res.json({ success: true, bookmarked });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to update bookmark', detail: msg });
    }
  });

  /** PATCH /api/chat/messages/:msgId - 更新消息内容（用于消息编辑） */
  router.patch('/messages/:msgId', async (req, res) => {
    const { content } = req.body ?? {};
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'Missing content' });
      return;
    }
    try {
      await db.updateMessage(req.params.msgId, content);
      res.json({ success: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to update message', detail: msg });
    }
  });

  /** PATCH /api/chat/messages/:msgId/reactions - 更新消息表情反应 */
  router.patch('/messages/:msgId/reactions', async (req, res) => {
    const { reactions } = req.body ?? {};
    if (reactions === undefined || reactions === null) {
      res.status(400).json({ error: 'Missing reactions' });
      return;
    }
    try {
      const reactionsJson = typeof reactions === 'object' ? JSON.stringify(reactions) : String(reactions);
      await db.updateMessageReactions(req.params.msgId, reactionsJson);
      res.json({ success: true, reactions: JSON.parse(reactionsJson) });
    } catch {
      res.status(500).json({ error: 'Failed to update reactions' });
    }
  });

  /** GET /api/chat/sessions/:id/export - 导出会话为 Markdown 或 JSON */
  router.get('/:id/export', async (req, res) => {
    const session = await db.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const messages = await db.getMessages(session.id, 2000);
    const format = (req.query.format as string) || 'markdown';

    if (format === 'json') {
      res.json({
        session: { id: session.id, title: session.title, createdAt: session.created_at, updatedAt: session.updated_at },
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : undefined,
          images: m.images_json ? JSON.parse(m.images_json) : undefined,
          createdAt: m.created_at,
        })),
      });
      return;
    }

    if (format === 'html') {
      const htmlLines: string[] = [
        `<!DOCTYPE html>`,
        `<html lang="en">`,
        `<head>`,
        `<meta charset="UTF-8">`,
        `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
        `<title>${session.title || 'Conversation'}</title>`,
        `<style>`,
        `  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #1a1a1a; background: #fff; }`,
        `  h1 { border-bottom: 2px solid #e5e5e5; padding-bottom: 10px; }`,
        `  .message { margin: 24px 0; padding: 16px; border-radius: 8px; }`,
        `  .user { background: #f0f7ff; border-left: 4px solid #3b82f6; }`,
        `  .assistant { background: #f9fafb; border-left: 4px solid #10b981; }`,
        `  .role { font-weight: 600; margin-bottom: 8px; color: #555; font-size: 12px; }`,
        `  .time { font-size: 11px; color: #999; margin-bottom: 8px; }`,
        `  .content { white-space: pre-wrap; word-break: break-word; line-height: 1.6; }`,
        `  .content pre { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }`,
        `  .tools { margin-top: 8px; font-size: 12px; color: #666; }`,
        `  .tool { background: #f3f4f6; padding: 4px 8px; border-radius: 4px; margin: 2px; display: inline-block; }`,
        `  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }`,
        `  @media print { body { margin: 20px; } .message { break-inside: avoid; } }`,
        `</style>`,
        `</head>`,
        `<body>`,
        `<h1>${session.title || 'Untitled Conversation'}</h1>`,
        `<p class="time">Exported: ${new Date().toLocaleString()}</p>`,
      ];

      for (const m of messages) {
        const roleClass = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : '';
        const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role;
        const time = new Date(m.created_at).toLocaleString();
        const content = (m.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');

        htmlLines.push(`<div class="message ${roleClass}">`);
        htmlLines.push(`<div class="role">${roleLabel}</div>`);
        htmlLines.push(`<div class="time">${time}</div>`);

        if (m.tool_calls_json) {
          try {
            const tools = JSON.parse(m.tool_calls_json);
            if (tools.length > 0) {
              htmlLines.push(`<div class="tools">Tools: ${tools.map((t: { name: string }) => `<span class="tool">${t.name}</span>`).join(' ')}</div>`);
            }
          } catch { /* ignore */ }
        }

        htmlLines.push(`<div class="content">${content}</div>`);
        htmlLines.push(`</div>`);
      }

      htmlLines.push(`<div class="footer">Exported from X-Computer · ${new Date().toLocaleString()}</div>`);
      htmlLines.push(`</body></html>`);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="conversation-${session.id}.html"`);
      res.send(htmlLines.join('\n'));
      return;
    }

    // Markdown export
    const lines: string[] = [
      `# ${session.title || 'Untitled Conversation'}`,
      '',
      `> Export date: ${new Date().toLocaleString()}`,
      '',
      '---',
      '',
    ];

    for (const m of messages) {
      const roleLabel = m.role === 'user' ? '**User**' : m.role === 'assistant' ? '**Assistant**' : `**${m.role}**`;
      const time = new Date(m.created_at).toLocaleString();
      lines.push(`### ${roleLabel}  \n*<small>${time}</small>*`);
      lines.push('');
      if (m.tool_calls_json) {
        try {
          const tools = JSON.parse(m.tool_calls_json);
          if (tools.length > 0) {
            lines.push('*Tools used:*');
            for (const t of tools) {
              lines.push(`- \`${t.name}\`: ${JSON.stringify(t.arguments ?? {}).slice(0, 200)}`);
            }
            lines.push('');
          }
        } catch { /* ignore */ }
      }
      lines.push(m.content || '');
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conversation-${session.id}.md"`);
    res.send(lines.join('\n'));
  });

  return router;
}
