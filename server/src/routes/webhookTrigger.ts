import { Router, Request, Response } from 'express';
import type { AppDatabase } from '../db/database.js';
import { WebhookService } from '../webhook/WebhookService.js';
import { serverLogger } from '../observability/ServerLogger.js';
import { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';

export function createWebhookTriggerRouter(
  db: AppDatabase,
  orchestrator: AgentOrchestrator,
): Router {
  const router = Router();
  const svc = new WebhookService(db);

  // GET /webhook/:path — Webhook 健康检查（供外部服务验证 URL 可达性）
  router.get('/:path', async (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'Webhook endpoint is active' });
  });

  // POST /webhook/:path — 触发 Webhook（无认证，外部服务调用）
  router.post('/:path', async (req: Request, res: Response) => {
    const { path } = req.params;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress ?? null;
    const signature = req.headers['x-hub-signature-256'] as string | null
      ?? req.headers['x-signature'] as string | null;
    const event = req.headers['x-github-event'] as string | null
      ?? req.headers['x-webhook-event'] as string | null
      ?? 'manual';
    const deliveryId = req.headers['x-github-delivery'] as string | null;

    const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);
    const contentType = req.headers['content-type'] ?? '';
    let payloadStr = '';
    if (typeof rawBody === 'string') {
      payloadStr = rawBody;
    } else {
      payloadStr = JSON.stringify(req.body);
    }

    // 解析请求头
    const reqHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') reqHeaders[k] = v;
      else if (Array.isArray(v)) reqHeaders[k] = v.join(', ');
    }

    // 查找 webhook
    const pathStr = Array.isArray(path) ? path.join('/') : path;
    const webhooks = await findWebhooksByPath(db, pathStr);
    if (!webhooks || !webhooks.webhook) {
      serverLogger.warn('webhook-trigger', `Webhook 不存在: path=/webhook/${pathStr} ip=${ip ?? 'unknown'}`);
      await svc.logWebhookCall({
        webhookId: pathStr, userId: 'unknown', event: event ?? 'unknown', payload: payloadStr,
        headers: reqHeaders, ipAddress: ip ?? null, signatureValid: false,
        responseStatus: 404, responseBody: 'Webhook not found',
      });
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }

    const webhook = webhooks.webhook;

    if (!webhook.enabled) {
      await svc.logWebhookCall({
        webhookId: webhook.id, userId: webhook.userId, event, payload: payloadStr,
        headers: reqHeaders, ipAddress: ip, signatureValid: false,
        responseStatus: 410, responseBody: 'Webhook disabled',
      });
      res.status(410).json({ error: 'Webhook disabled' });
      return;
    }

    // 验证签名
    const signatureValid = webhook.secret
      ? svc.verifySignature(webhook.secret, payloadStr, signature)
      : true;

    if (!signatureValid) {
      serverLogger.warn('webhook-trigger', `Webhook 签名验证失败: id=${webhook.id} ip=${ip}`);
      await svc.logWebhookCall({
        webhookId: webhook.id, userId: webhook.userId, event, payload: payloadStr,
        headers: reqHeaders, ipAddress: ip, signatureValid: false,
        responseStatus: 401, responseBody: 'Invalid signature',
      });
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    serverLogger.info('webhook-trigger', `Webhook 触发: id=${webhook.id} event=${event} ip=${ip}`);

    // 处理事件
    let taskId: string | null = null;
    let responseBody = '';
    let responseStatus = 200;

    try {
      if (event === 'ping') {
        responseBody = JSON.stringify({ message: 'Pong!', webhookId: webhook.id });
      } else if (webhook.events.includes('github.push') || webhook.events.includes('github.pull_request') || webhook.events.includes('github.issue_comment')) {
        const result = await handleGitHubEvent(orchestrator, webhook, event, req.body, deliveryId);
        taskId = result.taskId;
        responseBody = JSON.stringify({ received: true, event, taskId: result.taskId ?? null });
      } else if (webhook.events.includes('task.trigger') || webhook.events.includes('manual') || webhook.events.includes('schedule')) {
        const result = await handleGenericTrigger(orchestrator, webhook, event, req.body);
        taskId = result.taskId;
        responseBody = JSON.stringify({ received: true, event, taskId: result.taskId ?? null });
      } else {
        responseBody = JSON.stringify({ received: true, event, processed: false, reason: 'event not handled' });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      serverLogger.error('webhook-trigger', `Webhook 处理异常: id=${webhook.id}`, errMsg);
      responseStatus = 500;
      responseBody = JSON.stringify({ error: 'Internal error', detail: errMsg });
    }

    // 记录日志
    await svc.logWebhookCall({
      webhookId: webhook.id, userId: webhook.userId, event, payload: payloadStr,
      headers: reqHeaders, ipAddress: ip, signatureValid: true,
      responseStatus, responseBody: responseBody.slice(0, 2048),
      triggeredTaskId: taskId,
    });

    res.status(responseStatus).json(JSON.parse(responseBody));
  });

  return router;
}

// ── GitHub 事件处理 ──────────────────────────────────────────────

async function handleGitHubEvent(
  orchestrator: AgentOrchestrator,
  webhook: { id: string; userId: string },
  event: string,
  body: any,
  deliveryId: string | null,
): Promise<{ taskId: string | null }> {
  if (event === 'push') {
    const repo = body?.repository?.full_name ?? 'unknown';
    const branch = body?.ref ? body.ref.replace('refs/heads/', '') : 'unknown';
    const commits = body?.commits?.length ?? 0;
    const title = `GitHub push: ${repo}/${branch}`;
    const description = `${commits} commit(s). ${body?.head_commit?.message ?? ''}`;
    const task = await orchestrator.createAndRun({ domain: 'agent', title, description }, webhook.userId);
    return { taskId: task.id };
  }

  if (event === 'pull_request') {
    const repo = body?.repository?.full_name ?? 'unknown';
    const pr = body?.pull_request;
    const action = body?.action ?? 'unknown';
    const title = `GitHub PR: ${action} on ${repo}#${pr?.number ?? '?'}`;
    const description = pr?.title ?? '';
    const task = await orchestrator.createAndRun({ domain: 'agent', title, description }, webhook.userId);
    return { taskId: task.id };
  }

  if (event === 'issue_comment') {
    const repo = body?.repository?.full_name ?? 'unknown';
    const comment = body?.comment?.body ?? '';
    const issue = body?.issue;
    const title = `GitHub comment: ${repo}#${issue?.number ?? '?'}`;
    const description = comment;
    const task = await orchestrator.createAndRun({ domain: 'agent', title, description }, webhook.userId);
    return { taskId: task.id };
  }

  return { taskId: null };
}

async function handleGenericTrigger(
  orchestrator: AgentOrchestrator,
  webhook: { id: string; userId: string },
  event: string,
  body: any,
): Promise<{ taskId: string | null }> {
  const title = body?.title ?? body?.name ?? 'Webhook 触发任务';
  const description = body?.prompt ?? body?.text ?? body?.message ?? JSON.stringify(body);
  if (!description || description === '{}') return { taskId: null };

  const task = await orchestrator.createAndRun({ domain: 'agent', title, description }, webhook.userId);
  return { taskId: task.id };
}

// ── 工具函数 ─────────────────────────────────────────────────────

async function findWebhooksByPath(
  db: AppDatabase,
  path: string,
): Promise<{ webhook: Awaited<ReturnType<WebhookService['getWebhook']>>; svc: WebhookService } | null> {
  // 先通过 url_path 查找（path 是 /webhook/xxx 中的 xxx 部分）
  const urlPath = `/webhook/${path}`;
  const rows = await db.queryAll<{ id: string }>(
    `SELECT id FROM webhooks WHERE url_path = ? AND enabled = 1`,
    [urlPath]
  );
  if (rows.length === 0) return null;
  const svc = new WebhookService(db);
  const webhook = await svc.getWebhook(rows[0].id);
  if (!webhook) return null;
  return { webhook, svc };
}
