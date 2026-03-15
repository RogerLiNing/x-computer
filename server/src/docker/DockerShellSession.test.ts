/**
 * Docker Shell Session 测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Docker from 'dockerode';
import { DockerShellSession, DockerShellSessionManager } from './DockerShellSession.js';

describe('DockerShellSession', () => {
  let docker: Docker;
  let containerId: string;

  beforeAll(async () => {
    docker = new Docker({ socketPath: '/var/run/docker.sock' });

    // 创建测试容器
    const container = await docker.createContainer({
      Image: 'node:20-alpine',
      Cmd: ['sleep', '300'],
      Tty: true,
      WorkingDir: '/workspace',
    });

    containerId = container.id;
    await container.start();

    console.log(`测试容器已创建: ${containerId.substring(0, 12)}`);
  });

  afterAll(async () => {
    if (containerId) {
      const container = docker.getContainer(containerId);
      try {
        await container.stop();
        await container.remove();
        console.log(`测试容器已删除: ${containerId.substring(0, 12)}`);
      } catch (error) {
        console.error('清理容器失败:', error);
      }
    }
  }, 30000);

  it('should start shell session', async () => {
    const session = new DockerShellSession({
      container: containerId,
      workdir: '/workspace',
    });

    await session.start();
    expect(session.isActive()).toBe(true);

    await session.close();
  }, 30000);

  it('should execute commands', async () => {
    const session = new DockerShellSession({
      container: containerId,
      workdir: '/workspace',
    });

    await session.start();

    const result = await session.execute('echo "Hello World"');
    expect(result.command).toBe('echo "Hello World"');
    expect(result.output).toContain('Hello World');
    expect(result.duration).toBeGreaterThan(0);

    await session.close();
  }, 30000);

  it('should maintain working directory', async () => {
    const session = new DockerShellSession({
      container: containerId,
      workdir: '/workspace',
    });

    await session.start();

    // 创建目录并进入
    await session.execute('mkdir -p /workspace/test');
    await session.cd('/workspace/test');

    // 验证工作目录
    const pwd = await session.pwd();
    expect(pwd).toBe('/workspace/test');

    // 创建文件
    await session.execute('touch file.txt');

    // 验证文件存在
    const result = await session.execute('ls -la');
    expect(result.output).toContain('file.txt');

    await session.close();
  }, 30000);

  it('should maintain environment variables', async () => {
    const session = new DockerShellSession({
      container: containerId,
      workdir: '/workspace',
    });

    await session.start();

    // 设置环境变量
    await session.execute('export MY_VAR="test123"');

    // 验证环境变量
    const result = await session.execute('echo $MY_VAR');
    expect(result.output).toContain('test123');

    await session.close();
  }, 30000);

  it('should track command history', async () => {
    const session = new DockerShellSession({
      container: containerId,
      workdir: '/workspace',
    });

    await session.start();

    await session.execute('echo "cmd1"');
    await session.execute('echo "cmd2"');
    await session.execute('echo "cmd3"');

    const history = session.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].command).toBe('echo "cmd1"');
    expect(history[1].command).toBe('echo "cmd2"');
    expect(history[2].command).toBe('echo "cmd3"');

    await session.close();
  }, 30000);
});

describe('DockerShellSessionManager', () => {
  let docker: Docker;
  let containerId: string;
  let manager: DockerShellSessionManager;

  beforeAll(async () => {
    docker = new Docker({ socketPath: '/var/run/docker.sock' });

    // 创建测试容器
    const container = await docker.createContainer({
      Image: 'node:20-alpine',
      Cmd: ['sleep', '300'],
      Tty: true,
      WorkingDir: '/workspace',
    });

    containerId = container.id;
    await container.start();

    manager = new DockerShellSessionManager();

    console.log(`测试容器已创建: ${containerId.substring(0, 12)}`);
  });

  afterAll(async () => {
    await manager.closeAll();

    if (containerId) {
      const container = docker.getContainer(containerId);
      try {
        await container.stop();
        await container.remove();
        console.log(`测试容器已删除: ${containerId.substring(0, 12)}`);
      } catch (error) {
        console.error('清理容器失败:', error);
      }
    }
  }, 30000);

  it('should create and manage sessions', async () => {
    const session = await manager.getOrCreateSession('test-session', {
      container: containerId,
      workdir: '/workspace',
    });

    expect(session.isActive()).toBe(true);

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('test-session');

    await manager.closeSession('test-session');

    const sessionsAfter = manager.listSessions();
    expect(sessionsAfter).toHaveLength(0);
  }, 30000);

  it('should reuse existing sessions', async () => {
    const session1 = await manager.getOrCreateSession('test-session', {
      container: containerId,
      workdir: '/workspace',
    });

    const session2 = await manager.getOrCreateSession('test-session', {
      container: containerId,
      workdir: '/workspace',
    });

    expect(session1).toBe(session2);

    await manager.closeSession('test-session');
  }, 30000);

  it('should manage multiple sessions', async () => {
    const session1 = await manager.getOrCreateSession('session-1', {
      container: containerId,
      workdir: '/workspace',
    });

    const session2 = await manager.getOrCreateSession('session-2', {
      container: containerId,
      workdir: '/workspace',
    });

    expect(session1).not.toBe(session2);

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(2);

    await manager.closeAll();

    const sessionsAfter = manager.listSessions();
    expect(sessionsAfter).toHaveLength(0);
  }, 30000);
});
