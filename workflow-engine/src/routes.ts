/**
 * 工作流引擎 REST API
 */

import { Router } from 'express';
import type { WorkflowStore } from './store.js';
import type { WorkflowRunner } from './runner.js';
import type { WorkflowDefinition } from './types.js';
import { registerTimerTrigger, unregisterTimerTrigger, fireEventTrigger } from './triggers.js';

export function createRouter(deps: { store: WorkflowStore; runner: WorkflowRunner }): Router {
  const router = Router();

  /** 提取 userId：Header X-User-Id 或 body.userId */
  function getUserId(req: { headers: Record<string, string | string[] | undefined>; body?: { userId?: string } }): string | null {
    const h = req.headers['x-user-id'];
    const id = Array.isArray(h) ? h[0] : h;
    if (id && typeof id === 'string') return id;
    return req.body?.userId ?? null;
  }

  /** POST /deploy - 部署流程定义 */
  router.post('/deploy', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id 或 userId' });
    const def = req.body as WorkflowDefinition;
    if (!def?.id || !def?.nodes || !def?.edges) {
      return res.status(400).json({ error: '需要 id, nodes, edges' });
    }
    deps.store.deploy(userId, def);
    const triggers = def.triggers ?? [];
    for (const t of triggers) {
      if (t.type === 'timer' && t.cron) registerTimerTrigger(def.id, userId, t.cron);
    }
    res.json({ ok: true, definitionId: def.id });
  });

  /** GET /definitions - 列出流程定义 */
  router.get('/definitions', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    const list = deps.store.listDefinitions(userId);
    res.json({ definitions: list });
  });

  /** GET /definitions/:id - 获取单个定义 */
  router.get('/definitions/:id', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    const def = deps.store.getDefinition(userId, req.params.id);
    if (!def) return res.status(404).json({ error: '流程不存在' });
    res.json(def);
  });

  /** DELETE /definitions/:id - 删除流程定义 */
  router.delete('/definitions/:id', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    unregisterTimerTrigger(userId, req.params.id);
    const ok = deps.store.deleteDefinition(userId, req.params.id);
    res.json({ ok });
  });

  /** POST /start - 启动实例 */
  router.post('/start', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id 或 userId' });
    const { definitionId } = req.body ?? {};
    if (!definitionId) return res.status(400).json({ error: '需要 definitionId' });
    try {
      const result = await deps.runner.start(userId, definitionId);
      res.json(result);
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /instances - 列出实例 */
  router.get('/instances', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    const definitionId = req.query.definitionId as string | undefined;
    const list = deps.store.listInstances(userId, definitionId);
    res.json({ instances: list });
  });

  /** GET /instances/:id - 获取实例 */
  router.get('/instances/:id', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    const inst = deps.store.getInstance(userId, req.params.id);
    if (!inst) return res.status(404).json({ error: '实例不存在' });
    res.json(inst);
  });

  /** POST /instances/:id/signal - 向实例发送信号（用于 event 触发或外部继续） */
  router.post('/instances/:id/signal', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    const { nodeId, variables } = req.body ?? {};
    const inst = deps.store.getInstance(userId, req.params.id);
    if (!inst || inst.status !== 'running') return res.status(404).json({ error: '实例不存在或已结束' });
    const vars = typeof variables === 'object' && variables ? { ...inst.variables, ...variables } : inst.variables;
    deps.store.updateInstance(userId, req.params.id, { variables: vars });
    if (nodeId && typeof nodeId === 'string') {
      await deps.runner.continueAfterTask(userId, req.params.id, nodeId, variables ?? {});
    }
    res.json({ ok: true });
  });

  /** GET /instances/:id/variables - 获取实例变量 */
  router.get('/instances/:id/variables', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    const inst = deps.store.getInstance(userId, req.params.id);
    if (!inst) return res.status(404).json({ error: '实例不存在' });
    res.json(inst.variables);
  });

  /** POST /instances/:id/variables - 设置实例变量 */
  router.post('/instances/:id/variables', (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: '缺少 X-User-Id' });
    const inst = deps.store.getInstance(userId, req.params.id);
    if (!inst) return res.status(404).json({ error: '实例不存在' });
    const vars = typeof req.body === 'object' && req.body ? { ...inst.variables, ...req.body } : inst.variables;
    deps.store.updateInstance(userId, req.params.id, { variables: vars });
    res.json(vars);
  });

  /** POST /signal - 事件触发（主服务回调） */
  router.post('/signal', async (req, res) => {
    const { userId, eventName } = req.body ?? {};
    if (!userId || !eventName) return res.status(400).json({ error: '需要 userId, eventName' });
    const result = await fireEventTrigger(deps, userId, eventName);
    res.json(result);
  });

  return router;
}
