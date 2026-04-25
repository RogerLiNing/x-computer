/**
 * Tasks Router 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Router } from 'express';
import { createTasksRouter } from './tasks.js';

// Mock AgentOrchestrator
function createMockOrchestrator(overrides: Partial<{
  createAndRun: ReturnType<typeof vi.fn>;
  getAllTasks: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
  pauseTask: ReturnType<typeof vi.fn>;
  resumeTask: ReturnType<typeof vi.fn>;
  approveStep: ReturnType<typeof vi.fn>;
  rejectStep: ReturnType<typeof vi.fn>;
  retryTask: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    createAndRun: vi.fn().mockResolvedValue({ id: 'task-1', title: 'Test Task', status: 'running' }),
    getAllTasks: vi.fn().mockReturnValue([
      { id: 'task-1', title: 'Task 1', metadata: { userId: 'user-1' }, status: 'running' },
      { id: 'task-2', title: 'Task 2', metadata: { userId: 'user-2' }, status: 'completed' },
    ]),
    getTask: vi.fn().mockImplementation((id: string) => {
      if (id === 'task-1') return { id, title: 'Task 1', metadata: { userId: 'user-1' }, status: 'running' };
      if (id === 'task-forbidden') return { id, title: 'Forbidden', metadata: { userId: 'other-user' }, status: 'running' };
      return undefined;
    }),
    pauseTask: vi.fn().mockReturnValue(true),
    resumeTask: vi.fn().mockReturnValue(true),
    approveStep: vi.fn().mockReturnValue(true),
    rejectStep: vi.fn().mockReturnValue(true),
    retryTask: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// Mock SubscriptionService (always allows)
function createMockSubscriptionService() {
  return {
    checkQuota: vi.fn().mockResolvedValue(true),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getQuotaLimits: vi.fn().mockResolvedValue({ ai_calls: 100, storage: 1024, tasks: 5 }),
    getCurrentUsage: vi.fn().mockResolvedValue({ ai_calls: 10, storage: 100, tasks: 1 }),
  };
}

// Helper: build a supertest-compatible app with the tasks router
function buildApp(router: Router) {
  const app = express();
  app.use(express.json());

  // Inject userId from header for auth simulation
  app.use((req, _res, next) => {
    (req as any).userId = req.headers['x-user-id'] as string || 'anonymous';
    next();
  });

  app.use('/api', router);
  return app;
}

// Tiny fetch-based request helper
async function request(app: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const http = await import('node:http');
  const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
  const reqHeaders = { 'content-type': 'application/json', ...headers };

  return new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      const req = http.request(
        { hostname: 'localhost', port, path, method, headers: reqHeaders as any },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => { data += chunk; });
          res.on('end', () => {
            server.close();
            try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode ?? 0, body: data }); }
          });
        },
      );
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

describe('POST /tasks', () => {
  it('returns 400 when domain is missing', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks', { title: 't', description: 'd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/domain/i);
  });

  it('returns 400 when title is missing', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks', { domain: 'chat', description: 'd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('returns 400 when description is missing', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks', { domain: 'chat', title: 't' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/description/i);
  });

  it('returns 201 with task on success', async () => {
    const mockTask = { id: 'task-new', title: 'My Task', status: 'running' };
    const orch = createMockOrchestrator({ createAndRun: vi.fn().mockResolvedValue(mockTask) });
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks', { domain: 'chat', title: 'My Task', description: 'Do stuff' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('task-new');
    expect(orch.createAndRun).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'chat', title: 'My Task', description: 'Do stuff' }),
      'anonymous',
    );
  });

  it('returns 500 when orchestrator throws', async () => {
    const orch = createMockOrchestrator({
      createAndRun: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks', { domain: 'chat', title: 't', description: 'd' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });

  it('records AI call usage for authenticated user', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    await request(app, 'POST', '/api/tasks', { domain: 'chat', title: 't', description: 'd' }, { 'x-user-id': 'user-123' });
    expect(sub.recordUsage).toHaveBeenCalledWith('user-123', 'ai_calls', 1, expect.any(Object));
  });
});

describe('GET /tasks', () => {
  it('returns all tasks for anonymous user', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'GET', '/api/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('filters tasks by userId', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'GET', '/api/tasks', undefined, { 'x-user-id': 'user-1' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('task-1');
  });

  it('returns only own tasks when userId matches', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'GET', '/api/tasks', undefined, { 'x-user-id': 'user-2' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('task-2');
  });
});

describe('GET /tasks/:id', () => {
  it('returns 404 for unknown task', async () => {
    const orch = createMockOrchestrator({ getTask: vi.fn().mockReturnValue(undefined) });
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'GET', '/api/tasks/unknown-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns task for owner', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'GET', '/api/tasks/task-1', undefined, { 'x-user-id': 'user-1' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('task-1');
  });

  it('returns 403 when userId does not match task owner', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'GET', '/api/tasks/task-forbidden', undefined, { 'x-user-id': 'user-1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/无权/i);
  });

  it('allows anonymous to view any task', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'GET', '/api/tasks/task-forbidden');
    expect(res.status).toBe(200);
  });
});

describe('POST /tasks/:id/pause', () => {
  it('pauses task and returns success', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks/task-1/pause');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(orch.pauseTask).toHaveBeenCalledWith('task-1');
  });
});

describe('POST /tasks/:id/resume', () => {
  it('resumes task and returns success', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks/task-1/resume');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(orch.resumeTask).toHaveBeenCalledWith('task-1');
  });
});

describe('POST /tasks/:id/steps/:stepId/approve', () => {
  it('approves step and returns success', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks/task-1/steps/step-a/approve');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(orch.approveStep).toHaveBeenCalledWith('task-1', 'step-a');
  });
});

describe('POST /tasks/:id/steps/:stepId/reject', () => {
  it('rejects step and returns success', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks/task-1/steps/step-a/reject');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(orch.rejectStep).toHaveBeenCalledWith('task-1', 'step-a');
  });
});

describe('POST /tasks/:id/retry', () => {
  it('retries task with default restart mode', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks/task-1/retry', {});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe('restart');
    expect(orch.retryTask).toHaveBeenCalledWith('task-1', 'restart');
  });

  it('retries task with from_failure mode when specified', async () => {
    const orch = createMockOrchestrator();
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks/task-1/retry', { mode: 'from_failure' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('from_failure');
    expect(orch.retryTask).toHaveBeenCalledWith('task-1', 'from_failure');
  });

  it('returns 400 when task not found', async () => {
    const orch = createMockOrchestrator({ retryTask: vi.fn().mockResolvedValue(false) });
    const sub = createMockSubscriptionService();
    const router = createTasksRouter(orch as any, undefined, undefined, sub as any);
    const app = buildApp(router);

    const res = await request(app, 'POST', '/api/tasks/nonexistent/retry', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });
});
