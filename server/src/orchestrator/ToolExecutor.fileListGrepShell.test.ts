import path from 'path';
import os from 'os';
import { describe, it, expect, beforeAll } from 'vitest';
import { ToolExecutor } from './ToolExecutor.js';
import { SandboxFS } from '../tooling/SandboxFS.js';
import { shellApprovalRequest, ShellApprovalRequiredError } from '../tooling/shellApproval.js';

describe('ToolExecutor file.list / grep / shell.run（对齐 OpenClaw/OpenCode）', () => {
  const workspaceRoot = path.join(os.tmpdir(), `x-computer-file-grep-shell-${Date.now()}`);
  let sandboxFS: SandboxFS;
  let executor: ToolExecutor;

  beforeAll(async () => {
    sandboxFS = new SandboxFS(workspaceRoot);
    await sandboxFS.init();
    await sandboxFS.write('文档/测试.md', 'Hello World\n\n# 标题\n\n关键词：AI 与机器学习');
    await sandboxFS.write('项目/x-computer/README.md', 'x-computer\nAI 自主电脑');
    await sandboxFS.write('scripts/hello.py', 'print("hello from python")');
    await sandboxFS.write('scripts/with_args.py', 'import sys\nprint("args:", sys.argv[1:])\n');
    executor = new ToolExecutor(sandboxFS);
  });

  describe('file.list', () => {
    it('列出根目录返回 entries 与 count', async () => {
      const step = {
        id: 's1',
        taskId: 't1',
        action: '列出根目录',
        toolName: 'file.list',
        toolInput: {},
        status: 'pending' as const,
        riskLevel: 'low' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toBeUndefined();
      const out = call.output as { path: string; entries: unknown[]; count: number };
      expect(out.path).toBe('.');
      expect(Array.isArray(out.entries)).toBe(true);
      expect(out.count).toBe(out.entries.length);
      const names = (out.entries as { name: string }[]).map((e) => e.name);
      expect(names).toContain('文档');
      expect(names).toContain('项目');
    });

    it('列出指定子目录', async () => {
      const step = {
        id: 's2',
        taskId: 't1',
        action: '列出文档目录',
        toolName: 'file.list',
        toolInput: { path: '文档' },
        status: 'pending' as const,
        riskLevel: 'low' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toBeUndefined();
      const out = call.output as { path: string; entries: unknown[]; count: number };
      expect(out.path).toBe('文档');
      const names = (out.entries as { name: string }[]).map((e) => e.name);
      expect(names).toContain('测试.md');
    });
  });

  describe('grep', () => {
    it('按关键词搜索返回匹配行', async () => {
      const step = {
        id: 's3',
        taskId: 't1',
        action: '搜索关键词',
        toolName: 'grep',
        toolInput: { pattern: 'AI' },
        status: 'pending' as const,
        riskLevel: 'low' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toBeUndefined();
      const out = call.output as { matches: number; output: string };
      expect(out.matches).toBeGreaterThanOrEqual(1);
      expect(out.output).toContain('AI');
    });

    it('指定 path 与 include 缩小范围', async () => {
      const step = {
        id: 's4',
        taskId: 't1',
        action: '在文档目录搜 md',
        toolName: 'grep',
        toolInput: { pattern: 'World', path: '文档', include: '*.md' },
        status: 'pending' as const,
        riskLevel: 'low' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toBeUndefined();
      const out = call.output as { matches: number; output: string };
      expect(out.matches).toBe(1);
      expect(out.output).toContain('Hello World');
    });

    it('pattern 必填，缺则报错', async () => {
      const step = {
        id: 's5',
        taskId: 't1',
        action: 'grep 无 pattern',
        toolName: 'grep',
        toolInput: {},
        status: 'pending' as const,
        riskLevel: 'low' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toContain('pattern');
    });
  });

  describe('shell.run', () => {
    const runContext = { userId: 'owner', runId: 'run-1', toolCallId: 'call-1' };
    const approvedContext = async (input: Record<string, unknown>) => {
      const request = await shellApprovalRequest(input, sandboxFS.getRoot(), runContext, 'host');
      return { ...runContext, approvedShellHash: request.hash };
    };
    const shellStep = (id: string, toolInput: Record<string, unknown>) => ({
      id,
      taskId: 't1',
      action: '执行 shell',
      toolName: 'shell.run',
      toolInput,
      status: 'pending' as const,
      riskLevel: 'high' as const,
    });

    it('没有交办记录时拒绝执行', async () => {
      const call = await executor.execute(shellStep('s6a', { command: 'echo hello' }), 'container');
      expect(call.error).toContain('可确认的交办记录');
    });

    it('未经确认时要求审批，不执行命令', async () => {
      await expect(
        executor.execute(shellStep('s6c', { command: 'touch should-not-exist.txt' }), 'container', runContext),
      ).rejects.toBeInstanceOf(ShellApprovalRequiredError);
      expect(await sandboxFS.exists('should-not-exist.txt')).toBe(false);
    });

    it('确认后在沙箱内执行命令并返回 stdout', async () => {
      const input = { command: 'echo hello' };
      const call = await executor.execute(shellStep('s6', input), 'container', await approvedContext(input));
      expect(call.error).toBeUndefined();
      const out = call.output as { exitCode?: number; stdout: string; stderr: string };
      expect(out.stdout.trim()).toContain('hello');
      expect(out.exitCode).toBe(0);
    });

    it('sleep 等待指定秒数', async () => {
      const step = {
        id: 's6b',
        taskId: 't1',
        action: '等待 1 秒',
        toolName: 'sleep',
        toolInput: { seconds: 1 },
        status: 'pending' as const,
        riskLevel: 'low' as const,
      };
      const start = Date.now();
      const call = await executor.execute(step, 'container');
      const elapsed = Date.now() - start;
      expect(call.error).toBeUndefined();
      const out = call.output as { slept: number; message: string };
      expect(out.slept).toBe(1);
      expect(elapsed).toBeGreaterThanOrEqual(900);
    });

    it('workdir 相对沙箱根', async () => {
      const input = { command: process.platform === 'win32' ? 'cd' : 'pwd', workdir: '文档' };
      const call = await executor.execute(shellStep('s7', input), 'container', await approvedContext(input));
      expect(call.error).toBeUndefined();
      const out = call.output as { exitCode?: number; stdout: string };
      expect(out.stdout).toContain('文档');
    });
  });

  describe('python.run', () => {
    it('执行沙箱内 .py 脚本并返回 stdout', async () => {
      const step = {
        id: 's8',
        taskId: 't1',
        action: '执行 Python 脚本',
        toolName: 'python.run',
        toolInput: { scriptPath: 'scripts/hello.py' },
        status: 'pending' as const,
        riskLevel: 'high' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toBeUndefined();
      const out = call.output as { exitCode?: number; stdout: string; stderr: string };
      expect(out.stdout.trim()).toContain('hello from python');
      expect(out.exitCode).toBe(0);
    });

    it('可传 args 给脚本', async () => {
      const step = {
        id: 's9',
        taskId: 't1',
        action: '执行带参 Python 脚本',
        toolName: 'python.run',
        toolInput: { scriptPath: 'scripts/with_args.py', args: ['a', 'b'] },
        status: 'pending' as const,
        riskLevel: 'high' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toBeUndefined();
      const out = call.output as { exitCode?: number; stdout: string };
      expect(out.stdout).toContain('args:');
      expect(out.stdout).toContain('a');
      expect(out.stdout).toContain('b');
      expect(out.exitCode).toBe(0);
    });

    it('scriptPath 必填且须为 .py', async () => {
      const step = {
        id: 's10',
        taskId: 't1',
        action: '无 scriptPath',
        toolName: 'python.run',
        toolInput: {},
        status: 'pending' as const,
        riskLevel: 'high' as const,
      };
      const call = await executor.execute(step, 'container');
      expect(call.error).toMatch(/scriptPath|必填/);
    });
  });
});
