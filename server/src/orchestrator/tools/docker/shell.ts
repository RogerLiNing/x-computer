/**
 * Docker 交互式 Shell 工具
 * 让 AI 可以进入容器，持续执行命令并查看结果
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { shellSessionManager } from '../../../docker/DockerShellSession.js';

/**
 * 进入容器 Shell（创建交互式会话）
 */
export const dockerShellEnterDefinition: ToolDefinition = {
  name: 'docker.shell.enter',
  displayName: 'Docker进入Shell',
  description: `进入 Docker 容器的交互式 Shell。创建一个持久化的 Shell 会话，可以：
- 持续执行命令
- 保持工作目录和环境变量
- 命令之间有状态连续性
- 像真人操作终端一样

使用场景：需要多步操作、调试、开发等。`,
  domain: ['coding', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'container', type: 'string', description: '容器 ID 或名称', required: true },
    { name: 'workdir', type: 'string', description: '初始工作目录', required: false },
    { name: 'shell', type: 'string', description: 'Shell 类型（/bin/sh, /bin/bash 等），默认 /bin/sh', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerShellEnterHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const containerId = String(input.container ?? '').trim();
    if (!containerId) throw new Error('docker.shell.enter: container is required');

    const workdir = input.workdir ? String(input.workdir) : undefined;
    const shell = input.shell ? String(input.shell) : '/bin/sh';

    // 使用 userId 作为 sessionId（每个用户一个会话）
    const userId = (ctx as any)?.userId || 'default';
    const sessionId = `${userId}-${containerId}`;

    try {
      const session = await shellSessionManager.getOrCreateSession(sessionId, {
        container: containerId,
        workdir,
        shell,
      });

      // 获取初始工作目录
      const pwd = await session.pwd();

      return {
        sessionId,
        containerId: containerId.substring(0, 12),
        shell,
        workdir: pwd,
        message: `已进入容器 ${containerId.substring(0, 12)}，当前目录：${pwd}。使用 docker.shell.exec 执行命令。`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.shell.enter 失败: ${msg}`);
    }
  };
}

/**
 * 在 Shell 会话中执行命令
 */
export const dockerShellExecDefinition: ToolDefinition = {
  name: 'docker.shell.exec',
  displayName: 'Shell执行命令',
  description: `在已建立的 Shell 会话中执行命令。
- 保持工作目录（cd 后目录会保持）
- 保持环境变量（export 后变量会保持）
- 可以看到实时输出
- 像真人操作终端一样

必须先使用 docker.shell.enter 进入容器。`,
  domain: ['coding', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'container', type: 'string', description: '容器 ID 或名称', required: true },
    { name: 'command', type: 'string', description: '要执行的命令', required: true },
    { name: 'timeout', type: 'number', description: '超时毫秒数（默认 30000）', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerShellExecHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const containerId = String(input.container ?? '').trim();
    const command = String(input.command ?? '').trim();
    if (!containerId) throw new Error('docker.shell.exec: container is required');
    if (!command) throw new Error('docker.shell.exec: command is required');

    const timeout = Math.min(300000, Math.max(5000, Number(input.timeout) || 30000));

    const userId = (ctx as any)?.userId || 'default';
    const sessionId = `${userId}-${containerId}`;

    try {
      const session = shellSessionManager.getSession(sessionId);
      if (!session || !session.isActive()) {
        throw new Error(`没有找到活跃的 Shell 会话。请先使用 docker.shell.enter 进入容器。`);
      }

      const result = await session.execute(command, timeout);

      return {
        command: result.command,
        output: result.output.slice(0, 50000),
        duration: result.duration,
        success: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.shell.exec 失败: ${msg}`);
    }
  };
}

/**
 * 退出 Shell 会话
 */
export const dockerShellExitDefinition: ToolDefinition = {
  name: 'docker.shell.exit',
  displayName: 'Shell退出',
  description: '退出当前的 Shell 会话，释放资源。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'container', type: 'string', description: '容器 ID 或名称', required: true },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerShellExitHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const containerId = String(input.container ?? '').trim();
    if (!containerId) throw new Error('docker.shell.exit: container is required');

    const userId = (ctx as any)?.userId || 'default';
    const sessionId = `${userId}-${containerId}`;

    try {
      await shellSessionManager.closeSession(sessionId);

      return {
        sessionId,
        containerId: containerId.substring(0, 12),
        message: 'Shell 会话已关闭',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.shell.exit 失败: ${msg}`);
    }
  };
}

/**
 * 列出所有 Shell 会话
 */
export const dockerShellListDefinition: ToolDefinition = {
  name: 'docker.shell.list',
  displayName: 'Shell列出会话',
  description: '列出所有活跃的 Shell 会话。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: ['docker'],
};

export function createDockerShellListHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (_input, _ctx) => {
    const sessions = shellSessionManager.listSessions();

    return {
      count: sessions.length,
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        containerId: s.containerId.substring(0, 12),
        active: s.active,
      })),
    };
  };
}

/**
 * 执行交互式命令（如 MySQL、PostgreSQL、Redis 客户端）
 */
export const dockerShellInteractiveDefinition: ToolDefinition = {
  name: 'docker.shell.interactive',
  displayName: 'Shell交互式命令',
  description: `在 Shell 会话中执行交互式程序（如数据库客户端）。
支持：
- MySQL: mysql -uroot -p
- PostgreSQL: psql -U postgres
- Redis: redis-cli
- MongoDB: mongo

用法：传入程序名和要执行的命令数组。
例如：program: "mysql -uroot -ppassword", commands: ["SHOW DATABASES;", "USE mydb;", "SELECT * FROM users;"]`,
  domain: ['coding', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'container', type: 'string', description: '容器 ID 或名称', required: true },
    { name: 'program', type: 'string', description: '交互式程序（如 "mysql -uroot -ppassword"）', required: true },
    { name: 'commands', type: 'array', description: '要执行的命令数组', required: true },
    { name: 'timeout', type: 'number', description: '超时毫秒数（默认 30000）', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerShellInteractiveHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const containerId = String(input.container ?? '').trim();
    const program = String(input.program ?? '').trim();
    const commands = Array.isArray(input.commands) ? input.commands.map(String) : [];
    
    if (!containerId) throw new Error('docker.shell.interactive: container is required');
    if (!program) throw new Error('docker.shell.interactive: program is required');
    if (commands.length === 0) throw new Error('docker.shell.interactive: commands array is required');

    const timeout = Math.min(300000, Math.max(5000, Number(input.timeout) || 30000));

    const userId = (ctx as any)?.userId || 'default';
    const sessionId = `${userId}-${containerId}`;

    try {
      const session = shellSessionManager.getSession(sessionId);
      if (!session || !session.isActive()) {
        throw new Error(`没有找到活跃的 Shell 会话。请先使用 docker.shell.enter 进入容器。`);
      }

      const result = await session.executeInteractive(program, commands, timeout);

      return {
        program,
        commandCount: commands.length,
        output: result.output.slice(0, 50000),
        duration: result.duration,
        success: true,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.shell.interactive 失败: ${msg}`);
    }
  };
}
