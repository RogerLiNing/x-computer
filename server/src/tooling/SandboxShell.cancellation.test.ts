import { describe, expect, it } from 'vitest';
import os from 'node:os';
import { SandboxShell } from './SandboxShell.js';

describe('SandboxShell cancellation', () => {
  it('rejects before starting an already cancelled command', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new SandboxShell(os.tmpdir()).execute('echo never', undefined, undefined, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops a running process and waits for its close before returning cancellation', async () => {
    const controller = new AbortController();
    const execution = new SandboxShell(os.tmpdir()).execute('sleep 30', undefined, 30000, controller.signal);
    const stopped = expect(execution).rejects.toMatchObject({ name: 'AbortError' });
    setTimeout(() => controller.abort(), 30);
    await stopped;
  });
});
