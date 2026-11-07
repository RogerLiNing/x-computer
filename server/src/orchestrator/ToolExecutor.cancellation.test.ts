import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { ToolExecutor } from './ToolExecutor.js';
import { SandboxFS } from '../tooling/SandboxFS.js';

describe('built-in tool cancellation', () => {
  const fs = new SandboxFS(path.join(os.tmpdir(), `x-tool-stop-${Date.now()}`));
  let executor: ToolExecutor;
  beforeAll(async () => {
    await fs.init();
    await fs.write('wait.py', 'import time\ntime.sleep(10)\n');
    executor = new ToolExecutor(fs);
  });

  it.each([
    ['sleep', { seconds: 10 }],
    ['python.run', { scriptPath: 'wait.py' }],
  ] as const)('stops %s before its normal completion', async (toolName, toolInput) => {
    const controller = new AbortController();
    const execution = executor.execute({ id: 'step', taskId: 'task', action: toolName, toolName,
      toolInput, status: 'pending', riskLevel: 'low' }, 'container', { signal: controller.signal });
    const stopped = expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    setTimeout(() => controller.abort(), 25);
    await stopped;
  }, 2000);
});
