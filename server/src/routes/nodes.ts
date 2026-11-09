import { Router } from 'express';
import type { NodeSpecs } from '../../../shared/src/nodeProtocol.js';
import type { NodeRuntime } from '../nodes/index.js';
import { serverLogger } from '../observability/ServerLogger.js';

const ID = /^[\w-]{1,64}$/;

function requireUser(req: { userId?: string }): string | undefined {
  return req.userId && req.userId !== 'anonymous' ? req.userId : undefined;
}

function fail(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown, fallback: string, code = 400): void {
  const message = error instanceof Error ? error.message : fallback;
  serverLogger.warn('nodes', fallback, message);
  res.status(code).json({ error: message });
}

/** Public: a node presents its one-time token and receives its id and key. Mounted before user auth. */
export function createNodeEnrollRouter(nodes: NodeRuntime): Router {
  const router = Router();
  router.post('/enroll', async (req, res) => {
    const body = (req.body ?? {}) as { token?: unknown; specs?: unknown };
    if (typeof body.token !== 'string' || !body.token.startsWith('xn_')) return res.status(400).json({ error: '需要注册令牌' });
    try {
      const enrollment = await nodes.registry.enroll(body.token, body.specs && typeof body.specs === 'object' ? (body.specs as NodeSpecs) : undefined);
      res.json({ nodeId: enrollment.node.id, nodeKey: enrollment.nodeKey, name: enrollment.node.name, labels: enrollment.node.labels });
    } catch (error: unknown) { fail(res, error, '节点注册失败', 401); }
  });
  return router;
}

/** The owner's view: mint tokens, list nodes, run tasks and commands. */
export function createNodesRouter(nodes: NodeRuntime): Router {
  const router = Router();

  router.post('/nodes/enroll-tokens', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    const body = (req.body ?? {}) as { name?: unknown; labels?: unknown };
    try { res.json(await nodes.registry.createEnrollToken(userId, { name: String(body.name ?? ''), labels: body.labels })); }
    catch (error: unknown) { fail(res, error, '生成注册令牌失败'); }
  });

  router.get('/nodes', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    const list = await nodes.registry.list(userId);
    res.json({ nodes: list.map((node) => ({ ...node, online: nodes.gateway.isOnline(node.id) })) });
  });

  router.delete('/nodes/:id', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    if (!ID.test(req.params.id)) return res.status(400).json({ error: '节点 id 非法' });
    res.json({ ok: await nodes.registry.remove(userId, req.params.id) });
  });

  router.post('/nodes/:id/exec', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    const node = await nodes.registry.get(userId, req.params.id);
    if (!node) return res.status(404).json({ error: '节点不存在' });
    const body = (req.body ?? {}) as { command?: unknown; cwd?: unknown; timeoutMs?: unknown };
    if (typeof body.command !== 'string' || !body.command.trim()) return res.status(400).json({ error: 'command 必填' });
    let stdout = ''; let stderr = '';
    try {
      const exit = await nodes.gateway.exec(node.id, body.command, { onOutput: (stream, data) => { if (stream === 'stdout') stdout = (stdout + data).slice(-200_000); else stderr = (stderr + data).slice(-50_000); } }, { cwd: typeof body.cwd === 'string' ? body.cwd : undefined, timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined });
      res.json({ ...exit, stdout, stderr });
    } catch (error: unknown) { fail(res, error, '节点命令执行失败', 502); }
  });

  router.get('/nodes/tasks', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    res.json({ tasks: await nodes.tasks.list(userId) });
  });

  router.post('/nodes/tasks', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    const body = (req.body ?? {}) as { node?: unknown; goal?: unknown; context?: unknown };
    try { res.json({ task: await nodes.tasks.create(userId, String(body.node ?? ''), String(body.goal ?? ''), { context: typeof body.context === 'string' ? body.context : undefined }) }); }
    catch (error: unknown) { fail(res, error, '创建节点任务失败'); }
  });

  router.get('/nodes/tasks/:id', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    const task = await nodes.tasks.get(userId, req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ task });
  });

  router.post('/nodes/tasks/:id/answer', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    const answer = (req.body as { answer?: unknown } | undefined)?.answer;
    if (typeof answer !== 'string') return res.status(400).json({ error: 'answer 必填' });
    try { res.json({ ok: await nodes.tasks.answer(userId, req.params.id, answer) }); }
    catch (error: unknown) { fail(res, error, '回答节点提问失败', 409); }
  });

  router.post('/nodes/tasks/:id/cancel', async (req, res) => {
    const userId = requireUser(req);
    if (!userId) return res.status(401).json({ error: '需要登录' });
    res.json({ ok: await nodes.tasks.cancel(userId, req.params.id) });
  });

  return router;
}
