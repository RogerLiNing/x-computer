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

export function createCodeExecRouter(shell: SandboxShell, userSandboxManager?: UserSandboxManager): Router {
  const router = Router();

  const EXECUTABLE = new Set(['python', 'python3', 'python2', 'bash', 'sh', 'shell', 'js', 'javascript', 'node']);

  function wrapCommand(lang: string, code: string): string {
    switch (lang) {
      case 'python':
      case 'python3':
      case 'python2':
        return `python3 << 'XEOF'\n${code}\nXEOF`;
      case 'js':
      case 'javascript':
      case 'node':
        return `node << 'XEOF'\n${code}\nXEOF`;
      case 'bash':
      case 'sh':
      case 'shell':
        return code;
      default:
        return code;
    }
  }

  /** POST /api/code/exec — Execute code in the sandbox and return stdout/stderr/exitCode */
  router.post('/exec', async (req, res) => {
    try {
      const sh = await getUserShell(req, shell, userSandboxManager);
      const { code, language = 'bash' } = req.body ?? {};

      if (typeof code !== 'string' || !code.trim()) {
        res.status(400).json({ error: 'Missing code' });
        return;
      }

      if (!EXECUTABLE.has(language.toLowerCase())) {
        res.status(400).json({ error: `Language '${language}' is not executable` });
        return;
      }

      const command = wrapCommand(language.toLowerCase(), code.trim());
      const result = await sh.execute(command);
      res.json({
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? 0,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
