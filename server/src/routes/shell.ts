import { Router } from 'express';
import type { SandboxShell } from '../tooling/SandboxShell.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';

async function getUserShell(
  req: Express.Request,
  defaultShell: SandboxShell,
  manager?: UserSandboxManager,
): Promise<SandboxShell> {
  if (manager && req.userId && req.userId !== 'anonymous') {
    const sandbox = await manager.getForUser(req.userId);
    return sandbox.sandboxShell;
  }
  return defaultShell;
}

export function createShellRouter(shell: SandboxShell, userSandboxManager?: UserSandboxManager): Router {
  const router = Router();

  /** Execute a command in the sandbox */
  router.post('/exec', async (req, res) => {
    try {
      const sh = await getUserShell(req, shell, userSandboxManager);
      const { command, cwd } = req.body;
      if (!command) {
        res.status(400).json({ error: 'Missing command' });
        return;
      }
      const result = await sh.execute(command, cwd);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
