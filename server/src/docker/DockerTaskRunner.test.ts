/**
 * Docker 任务执行器测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerTaskRunner } from './DockerTaskRunner.js';

describe('DockerTaskRunner', () => {
  let runner: DockerTaskRunner;

  beforeAll(() => {
    runner = new DockerTaskRunner();
  });

  describe('基础任务执行', () => {
    it('should run a simple Node.js task', async () => {
      const config = DockerTaskRunner.templates.nodejs(`
        console.log('Hello from Node.js');
        console.log('Node version:', process.version);
      `);

      const result = await runner.runTask(config);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from Node.js');
      expect(result.stdout).toContain('Node version:');
    }, 30000);

    it('should run a simple Python task', async () => {
      const config = DockerTaskRunner.templates.python(`
import sys
print('Hello from Python')
print('Python version:', sys.version)
      `);

      const result = await runner.runTask(config);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from Python');
      expect(result.stdout).toContain('Python version:');
    }, 30000);

    it('should run a bash script', async () => {
      const config = DockerTaskRunner.templates.bash(`
echo "Hello from Bash"
uname -a
      `);

      const result = await runner.runTask(config);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from Bash');
      expect(result.stdout).toContain('Linux');
    }, 30000);
  });

  describe('错误处理', () => {
    it('should handle script errors', async () => {
      const config = DockerTaskRunner.templates.nodejs(`
        throw new Error('Test error');
      `);

      const result = await runner.runTask(config);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Error: Test error');
    }, 30000);

    it('should handle timeout', async () => {
      const config = DockerTaskRunner.templates.bash(
        `
sleep 10
echo "This should not print"
      `,
        { timeout: 2000 }
      );

      await expect(runner.runTask(config)).rejects.toThrow('timeout');
    }, 10000);
  });

  describe('环境变量', () => {
    it('should pass environment variables', async () => {
      const config = DockerTaskRunner.templates.nodejs(
        `
console.log('MY_VAR:', process.env.MY_VAR);
console.log('ANOTHER_VAR:', process.env.ANOTHER_VAR);
      `,
        {
          env: {
            MY_VAR: 'test-value',
            ANOTHER_VAR: '12345',
          },
        }
      );

      const result = await runner.runTask(config);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MY_VAR: test-value');
      expect(result.stdout).toContain('ANOTHER_VAR: 12345');
    }, 30000);
  });

  describe('资源限制', () => {
    it('should respect memory limits', async () => {
      const config = DockerTaskRunner.templates.nodejs(
        `
const used = process.memoryUsage();
console.log('Memory used:', Math.round(used.heapUsed / 1024 / 1024), 'MB');
      `,
        {
          memory: 128 * 1024 * 1024, // 128MB
        }
      );

      const result = await runner.runTask(config);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Memory used:');
    }, 30000);
  });

  describe('任务管理', () => {
    it('should list running tasks', async () => {
      const tasks = await runner.listRunningTasks();
      expect(Array.isArray(tasks)).toBe(true);
    });
  });
});
