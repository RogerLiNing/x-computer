/**
 * 远程服务器管理
 * 让 X 可以连接和管理远程服务器
 */

import { Client, ConnectConfig } from 'ssh2';
import { serverLogger } from '../observability/ServerLogger.js';
import type { AsyncDatabase } from '../db/database.js';

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  description?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface ServerConnection {
  serverId: string;
  client: Client;
  connected: boolean;
  connectedAt: number;
}

/**
 * 远程服务器管理器
 */
export class ServerManager {
  private connections: Map<string, ServerConnection> = new Map();
  private db: AsyncDatabase;

  constructor(db: AsyncDatabase) {
    this.db = db;
  }

  /**
   * 添加服务器配置
   */
  async addServer(config: Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ServerConfig> {
    const id = `srv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();

    const serverConfig: ServerConfig = {
      id,
      ...config,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.run(
      `INSERT INTO servers (id, name, host, port, username, auth_type, password, private_key, passphrase, description, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        serverConfig.id,
        serverConfig.name,
        serverConfig.host,
        serverConfig.port,
        serverConfig.username,
        serverConfig.authType,
        serverConfig.password || null,
        serverConfig.privateKey || null,
        serverConfig.passphrase || null,
        serverConfig.description || null,
        serverConfig.tags ? JSON.stringify(serverConfig.tags) : null,
        serverConfig.createdAt,
        serverConfig.updatedAt,
      ]
    );

    serverLogger.info('server-manager', `服务器已添加: ${serverConfig.name} (${serverConfig.host})`);
    return serverConfig;
  }

  /**
   * 列出所有服务器
   */
  async listServers(userId?: string): Promise<ServerConfig[]> {
    const rows = await this.db.query<{
      id: string; name: string; host: string; port: number; username: string; auth_type: string;
      password?: string; private_key?: string; passphrase?: string; description?: string; tags?: string;
      created_at: number; updated_at: number;
    }>(`SELECT * FROM servers ORDER BY created_at DESC`);

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type as 'password' | 'privateKey',
      password: row.password,
      privateKey: row.private_key,
      passphrase: row.passphrase,
      description: row.description,
      tags: row.tags ? JSON.parse(row.tags) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * 获取服务器配置
   */
  async getServer(serverId: string): Promise<ServerConfig | null> {
    const row = await this.db.queryOne<{
      id: string; name: string; host: string; port: number; username: string; auth_type: string;
      password?: string; private_key?: string; passphrase?: string; description?: string; tags?: string;
      created_at: number; updated_at: number;
    }>(`SELECT * FROM servers WHERE id = ?`, [serverId]);

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type as 'password' | 'privateKey',
      password: row.password,
      privateKey: row.private_key,
      passphrase: row.passphrase,
      description: row.description,
      tags: row.tags ? JSON.parse(row.tags) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 更新服务器配置
   */
  async updateServer(serverId: string, updates: Partial<Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const now = Date.now();
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.host !== undefined) { fields.push('host = ?'); values.push(updates.host); }
    if (updates.port !== undefined) { fields.push('port = ?'); values.push(updates.port); }
    if (updates.username !== undefined) { fields.push('username = ?'); values.push(updates.username); }
    if (updates.authType !== undefined) { fields.push('auth_type = ?'); values.push(updates.authType); }
    if (updates.password !== undefined) { fields.push('password = ?'); values.push(updates.password); }
    if (updates.privateKey !== undefined) { fields.push('private_key = ?'); values.push(updates.privateKey); }
    if (updates.passphrase !== undefined) { fields.push('passphrase = ?'); values.push(updates.passphrase); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }

    fields.push('updated_at = ?');
    values.push(now, serverId);

    await this.db.run(`UPDATE servers SET ${fields.join(', ')} WHERE id = ?`, values);
    serverLogger.info('server-manager', `服务器已更新: ${serverId}`);
  }

  /**
   * 删除服务器配置
   */
  async removeServer(serverId: string): Promise<void> {
    await this.disconnect(serverId);
    await this.db.run(`DELETE FROM servers WHERE id = ?`, [serverId]);
    serverLogger.info('server-manager', `服务器已删除: ${serverId}`);
  }

  /**
   * 连接到服务器
   */
  async connect(serverId: string): Promise<void> {
    const config = await this.getServer(serverId);
    if (!config) {
      throw new Error(`服务器不存在: ${serverId}`);
    }

    // 如果已连接，先断开
    if (this.connections.has(serverId)) {
      await this.disconnect(serverId);
    }

    return new Promise((resolve, reject) => {
      const client = new Client();

      const sshConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
      };

      if (config.authType === 'password' && config.password) {
        sshConfig.password = config.password;
      } else if (config.authType === 'privateKey' && config.privateKey) {
        sshConfig.privateKey = config.privateKey;
        if (config.passphrase) {
          sshConfig.passphrase = config.passphrase;
        }
      } else {
        reject(new Error('无效的认证配置'));
        return;
      }

      client.on('ready', () => {
        this.connections.set(serverId, {
          serverId,
          client,
          connected: true,
          connectedAt: Date.now(),
        });

        serverLogger.info('server-manager', `已连接到服务器: ${config.name} (${config.host})`);
        resolve();
      });

      client.on('error', (error) => {
        serverLogger.error('server-manager', `连接失败: ${config.name}`, error.message);
        reject(new Error(`连接失败: ${error.message}`));
      });

      client.on('close', () => {
        this.connections.delete(serverId);
        serverLogger.info('server-manager', `连接已关闭: ${config.name}`);
      });

      client.connect(sshConfig);
    });
  }

  /**
   * 断开服务器连接
   */
  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (connection) {
      connection.client.end();
      this.connections.delete(serverId);
      serverLogger.info('server-manager', `已断开连接: ${serverId}`);
    }
  }

  /**
   * 执行命令
   */
  async executeCommand(serverId: string, command: string, timeoutMs: number = 30000): Promise<CommandResult> {
    let connection = this.connections.get(serverId);

    // 如果未连接，先连接
    if (!connection || !connection.connected) {
      await this.connect(serverId);
      connection = this.connections.get(serverId);
    }

    if (!connection) {
      throw new Error(`无法连接到服务器: ${serverId}`);
    }

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      const timeout = setTimeout(() => {
        reject(new Error(`命令超时 (${timeoutMs}ms): ${command}`));
      }, timeoutMs);

      connection!.client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          reject(new Error(`执行失败: ${err.message}`));
          return;
        }

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (code: number) => {
          clearTimeout(timeout);
          exitCode = code;

          const duration = Date.now() - startTime;

          const result: CommandResult = {
            command,
            stdout,
            stderr,
            exitCode,
            duration,
          };

          serverLogger.debug('server-manager', `命令执行完成: ${command}`, JSON.stringify({
            serverId,
            exitCode,
            duration,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          }));

          resolve(result);
        });

        stream.on('error', (error: Error) => {
          clearTimeout(timeout);
          reject(new Error(`流错误: ${error.message}`));
        });
      });
    });
  }

  /**
   * 上传文件
   */
  async uploadFile(serverId: string, localPath: string, remotePath: string): Promise<void> {
    let connection = this.connections.get(serverId);

    if (!connection || !connection.connected) {
      await this.connect(serverId);
      connection = this.connections.get(serverId);
    }

    if (!connection) {
      throw new Error(`无法连接到服务器: ${serverId}`);
    }

    return new Promise((resolve, reject) => {
      connection!.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP 连接失败: ${err.message}`));
          return;
        }

        sftp.fastPut(localPath, remotePath, (error) => {
          if (error) {
            reject(new Error(`上传失败: ${error.message}`));
          } else {
            serverLogger.info('server-manager', `文件已上传: ${localPath} -> ${remotePath}`);
            resolve();
          }
        });
      });
    });
  }

  /**
   * 下载文件
   */
  async downloadFile(serverId: string, remotePath: string, localPath: string): Promise<void> {
    let connection = this.connections.get(serverId);

    if (!connection || !connection.connected) {
      await this.connect(serverId);
      connection = this.connections.get(serverId);
    }

    if (!connection) {
      throw new Error(`无法连接到服务器: ${serverId}`);
    }

    return new Promise((resolve, reject) => {
      connection!.client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP 连接失败: ${err.message}`));
          return;
        }

        sftp.fastGet(remotePath, localPath, (error) => {
          if (error) {
            reject(new Error(`下载失败: ${error.message}`));
          } else {
            serverLogger.info('server-manager', `文件已下载: ${remotePath} -> ${localPath}`);
            resolve();
          }
        });
      });
    });
  }

  /**
   * 列出所有连接
   */
  listConnections(): Array<{ serverId: string; connected: boolean; connectedAt: number }> {
    return Array.from(this.connections.values()).map(conn => ({
      serverId: conn.serverId,
      connected: conn.connected,
      connectedAt: conn.connectedAt,
    }));
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.connections.keys());
    for (const serverId of serverIds) {
      await this.disconnect(serverId);
    }
    serverLogger.info('server-manager', `所有连接已断开 (${serverIds.length} 个)`);
  }

  /**
   * 测试服务器连接
   */
  async testConnection(serverId: string): Promise<{ success: boolean; message: string; duration: number }> {
    const startTime = Date.now();

    try {
      await this.connect(serverId);
      const result = await this.executeCommand(serverId, 'echo "connection test"', 5000);
      const duration = Date.now() - startTime;

      if (result.exitCode === 0 && result.stdout.includes('connection test')) {
        return {
          success: true,
          message: '连接成功',
          duration,
        };
      } else {
        return {
          success: false,
          message: '连接测试失败',
          duration,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: msg,
        duration,
      };
    }
  }
}

// 全局服务器管理器实例（在 index.ts 中初始化）
let globalServerManager: ServerManager | null = null;

export function initServerManager(db: AsyncDatabase): ServerManager {
  globalServerManager = new ServerManager(db);
  return globalServerManager;
}

export function getServerManager(): ServerManager {
  if (!globalServerManager) {
    throw new Error('ServerManager not initialized');
  }
  return globalServerManager;
}
