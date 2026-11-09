/**
 * 工作流任务执行测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import { executeWorkflowTask } from './executeTask.js';
import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';

describe('executeWorkflowTask', () => {
  const tmpDir = path.join(os.tmpdir(), `wf-exec-${Date.now()}`);

  const mockFs = {
    getRoot: () => tmpDir,
  } as unknown as SandboxFS;

  const mockUserSandboxManager = {
    getForUser: vi.fn().mockResolvedValue({ sandboxFS: mockFs, sandboxShell: {execute:vi.fn().mockResolvedValue({stdout:'done',stderr:'',exitCode:0})} }),
  } as unknown as UserSandboxManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('script 任务缺少 script 时返回错误', async () => {
    const result = await executeWorkflowTask(
      {
        userId: 'u1',
        instanceId: 'i1',
        nodeId: 'n1',
        taskType: 'script',
        config: {},
        variables: {},
      },
      { userSandboxManager: mockUserSandboxManager },
    );
    expect(result._error).toContain('script 或 command 必填');
  });

  it('script tasks reuse the user-provided isolated executor',async()=>{
    const execute=vi.fn().mockResolvedValue({stdout:'{"ok":true}',stderr:'',exitCode:0});
    const manager={getForUser:async()=>({sandboxFS:mockFs,sandboxShell:{execute}})} as unknown as UserSandboxManager;
    const result=await executeWorkflowTask({userId:'u',instanceId:'i',nodeId:'n',taskType:'script',config:{command:'echo safe'},variables:{}},{userSandboxManager:manager});
    expect(execute).toHaveBeenCalledWith('echo safe');expect(result._exitCode).toBe(0);
  });
  it('ai 任务调用 runIntent', async () => {
    const runIntent = vi.fn();
    const result = await executeWorkflowTask(
      {
        userId: 'u1',
        instanceId: 'i1',
        nodeId: 'n1',
        taskType: 'ai',
        config: { intent: '测试意图' },
        variables: {},
      },
      { runIntent },
    );
    expect(runIntent).toHaveBeenCalledWith('u1', '测试意图');
    expect(result._ai_done).toBe(true);
  });

  it('manual 任务返回 config', async () => {
    const result = await executeWorkflowTask(
      {
        userId: 'u1',
        instanceId: 'i1',
        nodeId: 'n1',
        taskType: 'manual',
        config: { foo: 'bar' },
        variables: {},
      },
      {},
    );
    expect(result).toEqual({ foo: 'bar' });
  });
});
