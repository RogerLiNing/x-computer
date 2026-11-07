import { Router } from 'express';
import type { LivingAIConfig, LivingAIGoal } from '../../../shared/src/index.js';
import type { LivingAIKernel } from '../living-ai/LivingAIKernel.js';
import {serverLogger} from '../observability/ServerLogger.js';

function getUserId(req: { userId?: string }): string {
  const userId = req.userId?.trim();
  if (!userId || userId === 'anonymous') {
    throw new Error('需要已识别的用户身份');
  }
  return userId;
}

export function createLivingAIRouter(kernel: LivingAIKernel): Router {
  const router = Router();

  router.get('/status', async (req, res) => {
    try {
      res.json(await kernel.getStatus(getUserId(req)));
    } catch (error) {
      res.status(401).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch('/config', async (req, res) => {
    try {
      const patch = (req.body ?? {}) as Partial<LivingAIConfig>;
      res.json(await kernel.updateConfig(getUserId(req), patch));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/wake', async (req, res) => {
    try {
      const userId = getUserId(req);
      void kernel.runCycle(userId, 'manual').catch(error=>serverLogger.warn('living-ai','自主运行请求失败',error instanceof Error?error.name:'unknown'));
      res.status(202).json(await kernel.getStatus(userId));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/goals', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        title?: string;
        description?: string;
        priority?: number;
      };
      res.status(201).json(await kernel.addGoal(getUserId(req), {
        title: body.title ?? '',
        description: body.description,
        priority: body.priority,
        origin: 'user',
      }));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch('/goals/:goalId', async (req, res) => {
    try {
      const patch = (req.body ?? {}) as Partial<
        Pick<LivingAIGoal, 'title' | 'description' | 'priority' | 'status' | 'progress'>
      >;
      res.json(await kernel.updateGoal(getUserId(req), req.params.goalId, patch));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
