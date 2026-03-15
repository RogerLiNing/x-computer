/**
 * 远程服务器管理工具
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { getServerManager } from '../../../server/ServerManager.js';

/**
 * 添加服务器
 */
export const serverAddDefinition: ToolDefinition = {
  name: 'server.add',
  displayName: '添加服务器',
  description: `添加远程服务器配置。支持：
- SSH 密码认证
- SSH 密钥认证
- 自定义端口
- 标签分类

添加后可使用 server.connect 连接并执行命令。`,
  domain: ['agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'name', type: 'string', description: '服务器名称（如 "生产服务器"）', required: true },
    { name: 'host', type: 'string', description: '服务器地址（IP 或域名）', required: true },
    { name: 'port', type: 'number', description: 'SSH 端口（默认 22）', required: false },
    { name: 'username', type: 'string', description: '用户名', required: true },
    { name: 'authType', type: 'string', description: '认证方式：password 或 privateKey', required: true },
    { name: 'password', type: 'string', description: '密码（authType 为 password 时必需）', required: false },
    { name: 'privateKey', type: 'string', description: '私钥内容（authType 为 privateKey 时必需）', required: false },
    { name: 'passphrase', type: 'string', description: '私钥密码（如果私钥有密码）', required: false },
    { name: 'description', type: 'string', description: '服务器描述', required: false },
    { name: 'tags', type: 'array', description: '标签数组（如 ["生产", "Web服务器"]）', required: false },
  ],
  requiredPermissions: ['server'],
};

export function createServerAddHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const name = String(input.name ?? '').trim();
    const host = String(input.host ?? '').trim();
    const port = Number(input.port) || 22;
    const username = String(input.username ?? '').trim();
    const authType = String(input.authType ?? '').trim() as 'password' | 'privateKey';

    if (!name) throw new Error('server.add: name is required');
    if (!host) throw new Error('server.add: host is required');
    if (!username) throw new Error('server.add: username is required');
    if (!['password', 'privateKey'].includes(authType)) {
      throw new Error('server.add: authType must be "password" or "privateKey"');
    }

    const password = input.password ? String(input.password) : undefined;
    const privateKey = input.privateKey ? String(input.privateKey) : undefined;
    const passphrase = input.passphrase ? String(input.passphrase) : undefined;
    const description = input.description ? String(input.description) : undefined;
    const tags = Array.isArray(input.tags) ? input.tags.map(String) : undefined;

    if (authType === 'password' && !password) {
      throw new Error('server.add: password is required when authType is "password"');
    }
    if (authType === 'privateKey' && !privateKey) {
      throw new Error('server.add: privateKey is required when authType is "privateKey"');
    }

    try {
      const manager = getServerManager();
      const server = await manager.addServer({
        name,
        host,
        port,
        username,
        authType,
        password,
        privateKey,
        passphrase,
        description,
        tags,
      });

      return {
        serverId: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        message: `服务器已添加: ${server.name} (${server.host})`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.add 失败: ${msg}`);
    }
  };
}

/**
 * 列出服务器
 */
export const serverListDefinition: ToolDefinition = {
  name: 'server.list',
  displayName: '列出服务器',
  description: '列出所有已配置的远程服务器。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [],
  requiredPermissions: ['server'],
};

export function createServerListHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    try {
      const manager = getServerManager();
      const servers = await manager.listServers();

      return {
        count: servers.length,
        servers: servers.map((s: { id: string; name: string; host: string; port: number; username: string; authType: string; description?: string; tags?: string[]; createdAt: number }) => ({
          serverId: s.id,
          name: s.name,
          host: s.host,
          port: s.port,
          username: s.username,
          authType: s.authType,
          description: s.description,
          tags: s.tags,
          createdAt: new Date(s.createdAt).toISOString(),
        })),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.list 失败: ${msg}`);
    }
  };
}

/**
 * 连接服务器
 */
export const serverConnectDefinition: ToolDefinition = {
  name: 'server.connect',
  displayName: '连接服务器',
  description: '连接到远程服务器。连接后可使用 server.exec 执行命令。',
  domain: ['agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'serverId', type: 'string', description: '服务器 ID', required: true },
  ],
  requiredPermissions: ['server'],
};

export function createServerConnectHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const serverId = String(input.serverId ?? '').trim();
    if (!serverId) throw new Error('server.connect: serverId is required');

    try {
      const manager = getServerManager();
      await manager.connect(serverId);

      const server = await manager.getServer(serverId);

      return {
        serverId,
        name: server?.name,
        host: server?.host,
        message: `已连接到服务器: ${server?.name} (${server?.host})`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.connect 失败: ${msg}`);
    }
  };
}

/**
 * 执行命令
 */
export const serverExecDefinition: ToolDefinition = {
  name: 'server.exec',
  displayName: '执行命令',
  description: `在远程服务器上执行命令。
- 自动连接（如果未连接）
- 返回 stdout、stderr、exitCode
- 支持超时设置

注意：长时间运行的命令应使用后台执行（& 或 nohup）。`,
  domain: ['coding', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'serverId', type: 'string', description: '服务器 ID', required: true },
    { name: 'command', type: 'string', description: '要执行的命令', required: true },
    { name: 'timeout', type: 'number', description: '超时毫秒数（默认 30000）', required: false },
  ],
  requiredPermissions: ['server'],
};

export function createServerExecHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const serverId = String(input.serverId ?? '').trim();
    const command = String(input.command ?? '').trim();

    if (!serverId) throw new Error('server.exec: serverId is required');
    if (!command) throw new Error('server.exec: command is required');

    const timeout = Math.min(300000, Math.max(5000, Number(input.timeout) || 30000));

    try {
      const manager = getServerManager();
      const result = await manager.executeCommand(serverId, command, timeout);

      return {
        command: result.command,
        stdout: result.stdout.slice(0, 50000),
        stderr: result.stderr.slice(0, 10000),
        exitCode: result.exitCode,
        duration: result.duration,
        success: result.exitCode === 0,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.exec 失败: ${msg}`);
    }
  };
}

/**
 * 断开连接
 */
export const serverDisconnectDefinition: ToolDefinition = {
  name: 'server.disconnect',
  displayName: '断开连接',
  description: '断开与远程服务器的连接。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'serverId', type: 'string', description: '服务器 ID', required: true },
  ],
  requiredPermissions: ['server'],
};

export function createServerDisconnectHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const serverId = String(input.serverId ?? '').trim();
    if (!serverId) throw new Error('server.disconnect: serverId is required');

    try {
      const manager = getServerManager();
      await manager.disconnect(serverId);

      return {
        serverId,
        message: '连接已断开',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.disconnect 失败: ${msg}`);
    }
  };
}

/**
 * 上传文件
 */
export const serverUploadDefinition: ToolDefinition = {
  name: 'server.upload',
  displayName: '上传文件',
  description: '通过 SFTP 上传文件到远程服务器。',
  domain: ['agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'serverId', type: 'string', description: '服务器 ID', required: true },
    { name: 'localPath', type: 'string', description: '本地文件路径', required: true },
    { name: 'remotePath', type: 'string', description: '远程文件路径', required: true },
  ],
  requiredPermissions: ['server'],
};

export function createServerUploadHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const serverId = String(input.serverId ?? '').trim();
    const localPath = String(input.localPath ?? '').trim();
    const remotePath = String(input.remotePath ?? '').trim();

    if (!serverId) throw new Error('server.upload: serverId is required');
    if (!localPath) throw new Error('server.upload: localPath is required');
    if (!remotePath) throw new Error('server.upload: remotePath is required');

    try {
      const manager = getServerManager();
      await manager.uploadFile(serverId, localPath, remotePath);

      return {
        serverId,
        localPath,
        remotePath,
        message: `文件已上传: ${localPath} -> ${remotePath}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.upload 失败: ${msg}`);
    }
  };
}

/**
 * 下载文件
 */
export const serverDownloadDefinition: ToolDefinition = {
  name: 'server.download',
  displayName: '下载文件',
  description: '通过 SFTP 从远程服务器下载文件。',
  domain: ['agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'serverId', type: 'string', description: '服务器 ID', required: true },
    { name: 'remotePath', type: 'string', description: '远程文件路径', required: true },
    { name: 'localPath', type: 'string', description: '本地文件路径', required: true },
  ],
  requiredPermissions: ['server'],
};

export function createServerDownloadHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const serverId = String(input.serverId ?? '').trim();
    const remotePath = String(input.remotePath ?? '').trim();
    const localPath = String(input.localPath ?? '').trim();

    if (!serverId) throw new Error('server.download: serverId is required');
    if (!remotePath) throw new Error('server.download: remotePath is required');
    if (!localPath) throw new Error('server.download: localPath is required');

    try {
      const manager = getServerManager();
      await manager.downloadFile(serverId, remotePath, localPath);

      return {
        serverId,
        remotePath,
        localPath,
        message: `文件已下载: ${remotePath} -> ${localPath}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.download 失败: ${msg}`);
    }
  };
}

/**
 * 删除服务器
 */
export const serverRemoveDefinition: ToolDefinition = {
  name: 'server.remove',
  displayName: '删除服务器',
  description: '删除服务器配置。会先断开连接，然后删除配置。',
  domain: ['agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'serverId', type: 'string', description: '服务器 ID', required: true },
  ],
  requiredPermissions: ['server'],
};

export function createServerRemoveHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const serverId = String(input.serverId ?? '').trim();
    if (!serverId) throw new Error('server.remove: serverId is required');

    try {
      const manager = getServerManager();
      await manager.removeServer(serverId);

      return {
        serverId,
        message: '服务器已删除',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.remove 失败: ${msg}`);
    }
  };
}

/**
 * 测试连接
 */
export const serverTestDefinition: ToolDefinition = {
  name: 'server.test',
  displayName: '测试连接',
  description: '测试与远程服务器的连接。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'serverId', type: 'string', description: '服务器 ID', required: true },
  ],
  requiredPermissions: ['server'],
};

export function createServerTestHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const serverId = String(input.serverId ?? '').trim();
    if (!serverId) throw new Error('server.test: serverId is required');

    try {
      const manager = getServerManager();
      const result = await manager.testConnection(serverId);

      return {
        serverId,
        success: result.success,
        message: result.message,
        duration: result.duration,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`server.test 失败: ${msg}`);
    }
  };
}
