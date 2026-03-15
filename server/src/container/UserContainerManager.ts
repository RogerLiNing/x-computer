/**
 * UserContainerManager - 用户容器管理器
 * 
 * 为每个用户创建独立的 Docker 容器，实现完全隔离：
 * - 独立文件系统
 * - 资源限制（CPU/内存/存储）
 * - 网络隔离
 * - 无法访问宿主机 Docker
 * - 清洁的环境变量
 * 
 * 安全加固方案 (R060)
 */

import Docker from 'dockerode';
import path from 'path';
import { serverLogger } from '../observability/ServerLogger.js';

export interface ContainerConfig {
  userId: string;
  cpuLimit?: number;      // CPU 核心数限制（默认 1）
  memoryLimit?: string;   // 内存限制（默认 "512m"）
  storageLimit?: string;  // 存储限制（默认 "1g"）
  networkMode?: string;   // 网络模式（默认 "none"）
}

export interface ExecOptions {
  cwd?: string;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface UserContainerManagerOptions {
  imageName?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  pidsLimit?: number;
  networkMode?: 'none' | 'bridge' | 'host';
}

export class UserContainerManager {
  private docker: Docker;
  private containers: Map<string, string> = new Map(); // userId -> containerId
  private workspaceBasePath: string;
  private imageName: string;
  private defaultCpuLimit: number;
  private defaultMemoryLimit: string;
  private defaultPidsLimit: number;
  private defaultNetworkMode: string;

  constructor(workspaceBasePath: string, options: UserContainerManagerOptions = {}) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.workspaceBasePath = workspaceBasePath;
    this.imageName = options.imageName ?? 'x-computer-sandbox:latest';
    this.defaultCpuLimit = options.cpuLimit ?? 1;
    this.defaultMemoryLimit = options.memoryLimit ?? '512m';
    this.defaultPidsLimit = options.pidsLimit ?? 100;
    this.defaultNetworkMode = options.networkMode ?? 'none';
  }

  /**
   * 为用户创建或获取容器
   */
  async getOrCreateContainer(config: ContainerConfig): Promise<string> {
    const { userId } = config;
    
    // 1. 检查内存缓存
    if (this.containers.has(userId)) {
      const containerId = this.containers.get(userId)!;
      const container = this.docker.getContainer(containerId);
      
      try {
        const info = await container.inspect();
        if (info.State.Running) {
          serverLogger.info('container', `用户容器已存在并运行中: ${userId}`);
          return containerId;
        }
        
        // 容器存在但未运行，尝试启动
        serverLogger.info('container', `启动已停止的用户容器: ${userId}`);
        await container.start();
        return containerId;
      } catch (error) {
        // 容器不存在或损坏，需要重新创建
        serverLogger.warn('container', `用户容器不可用，重新创建: ${userId}`);
        this.containers.delete(userId);
      }
    }

    // 2. 检查 Docker 中是否已有同名容器（服务器重启后缓存丢失的情况）
    const containerName = `x-computer-user-${userId}`;
    try {
      const containers = await this.docker.listContainers({ all: true });
      const existingContainer = containers.find(c => 
        c.Names.some(name => name === `/${containerName}`)
      );
      
      if (existingContainer) {
        serverLogger.info('container', `发现已存在的用户容器: ${userId} -> ${existingContainer.Id.substring(0, 12)}`);
        
        // 更新缓存
        this.containers.set(userId, existingContainer.Id);
        
        // 如果容器未运行，启动它
        if (existingContainer.State !== 'running') {
          serverLogger.info('container', `启动已停止的用户容器: ${userId}`);
          const container = this.docker.getContainer(existingContainer.Id);
          await container.start();
        }
        
        return existingContainer.Id;
      }
    } catch (error) {
      serverLogger.warn('container', `检查已存在容器失败: ${userId}`, error instanceof Error ? error.message : String(error));
    }

    // 3. 创建新容器
    return await this.createContainer(config);
  }

  /**
   * 创建用户容器
   */
  private async createContainer(config: ContainerConfig): Promise<string> {
    const { 
      userId, 
      cpuLimit = this.defaultCpuLimit, 
      memoryLimit = this.defaultMemoryLimit, 
      networkMode = this.defaultNetworkMode 
    } = config;
    
    serverLogger.info('container', `创建用户容器: ${userId}`);
    
    const workspacePath = path.join(this.workspaceBasePath, 'users', userId, 'workspace');
    
    try {
      const container = await this.docker.createContainer({
        name: `x-computer-user-${userId}`,
        Image: this.imageName,
        
        // 资源限制
        HostConfig: {
          Memory: this.parseMemoryLimit(memoryLimit),
          NanoCpus: cpuLimit * 1e9,
          
          // 挂载用户工作区（只读宿主机，读写容器内）
          Binds: [
            `${workspacePath}:/workspace:rw`
          ],
          
          // 网络隔离（默认无网络，需要时可配置 bridge）
          NetworkMode: networkMode,
          // bridge 模式下显式设置 DNS，避免 "Could not contact DNS servers"
          ...(networkMode === 'bridge' ? { Dns: ['8.8.8.8', '114.114.114.114', '223.5.5.5'] } : {}),
          
          // 禁止访问 Docker Socket
          // 不挂载 /var/run/docker.sock
          
          // 禁止特权模式
          Privileged: false,
          
          // 只读根文件系统（除了 /workspace 和 /tmp）
          ReadonlyRootfs: true,
          
          // 临时文件系统
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=100m',
            '/home/xuser': 'rw,noexec,nosuid,size=50m',
          },
          
          // 资源限制
          PidsLimit: this.defaultPidsLimit, // 最大进程数限制
          
          // 安全选项
          SecurityOpt: [
            'no-new-privileges', // 禁止提升权限
          ],
          
          // 禁用容器内的设备访问
          DeviceRequests: [],
          
          // 自动删除（容器停止后自动清理）
          AutoRemove: false, // 保留容器以便调试
        },
        
        // 环境变量（HOME 指向可写的 workspace；PATH 含 ~/.local/bin 便于 skillhub 等工具）
        Env: [
          'HOME=/workspace',
          'USER=xuser',
          'TERM=xterm-256color',
          'LANG=en_US.UTF-8',
          'PATH=/workspace/.local/bin:/usr/local/bin:/usr/bin:/bin',
          // 不传递任何敏感环境变量
        ],
        
        // 工作目录
        WorkingDir: '/workspace',
        
        // 用户（非 root）
        User: '1000:1000',
      });

      await container.start();
      
      const containerId = container.id;
      this.containers.set(userId, containerId);
      
      serverLogger.info('container', `用户容器创建成功: ${userId} -> ${containerId.substring(0, 12)}`);
      
      return containerId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('container', `创建用户容器失败: ${userId}`, msg);
      throw new Error(`创建用户容器失败: ${msg}`);
    }
  }

  /**
   * 在用户容器中执行命令
   */
  async execInContainer(
    userId: string,
    command: string,
    options: ExecOptions = {}
  ): Promise<ExecResult> {
    const containerId = await this.getOrCreateContainer({ userId });
    const container = this.docker.getContainer(containerId);
    
    const { cwd = '/workspace', timeout = 30000 } = options;
    
    // 安全审计日志（R060）
    serverLogger.info('security-audit', `[SHELL_EXEC] userId=${userId} cmd=${command.substring(0, 200)} cwd=${cwd}`);
    
    try {
      // 创建 exec 实例
      const exec = await container.exec({
        Cmd: ['/bin/sh', '-c', `cd ${cwd} && ${command}`],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });

      // 执行命令
      const stream = await exec.start({ Detach: false });
      
      let stdout = '';
      let stderr = '';
      
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          stream.destroy();
          reject(new Error('命令执行超时'));
        }, timeout);

        stream.on('data', (chunk: Buffer) => {
          // Docker stream format: 8-byte header + payload
          // Header[0] = stream type (1=stdout, 2=stderr)
          if (chunk.length > 8) {
            const streamType = chunk[0];
            const payload = chunk.slice(8).toString();
            
            if (streamType === 1) {
              stdout += payload;
            } else if (streamType === 2) {
              stderr += payload;
            }
          }
        });

        stream.on('end', async () => {
          clearTimeout(timeoutId);
          
          try {
            const info = await exec.inspect();
            resolve({
              stdout: stdout.slice(0, 50000),
              stderr: stderr.slice(0, 10000),
              exitCode: info.ExitCode ?? 0,
            });
          } catch (error) {
            reject(error);
          }
        });

        stream.on('error', (error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('container', `命令执行失败: ${userId}`, msg);
      throw new Error(`命令执行失败: ${msg}`);
    }
  }

  /**
   * 停止并删除用户容器
   */
  async removeContainer(userId: string): Promise<void> {
    const containerId = this.containers.get(userId);
    if (!containerId) {
      serverLogger.info('container', `用户容器不存在，无需删除: ${userId}`);
      return;
    }

    try {
      const container = this.docker.getContainer(containerId);
      
      serverLogger.info('container', `停止用户容器: ${userId}`);
      await container.stop({ t: 10 });
      
      serverLogger.info('container', `删除用户容器: ${userId}`);
      await container.remove();
      
      this.containers.delete(userId);
      
      serverLogger.info('container', `用户容器已删除: ${userId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('container', `删除用户容器失败: ${userId}`, msg);
      // 不抛出错误，允许继续清理其他容器
    }
  }

  /**
   * 清理所有容器
   */
  async cleanup(): Promise<void> {
    serverLogger.info('container', `清理所有用户容器，共 ${this.containers.size} 个`);
    
    const promises = Array.from(this.containers.keys()).map(userId =>
      this.removeContainer(userId)
    );
    
    await Promise.all(promises);
    
    serverLogger.info('container', '所有用户容器已清理');
  }

  /**
   * 获取容器统计信息
   */
  async getContainerStats(userId: string): Promise<Docker.ContainerStats | null> {
    const containerId = this.containers.get(userId);
    if (!containerId) return null;

    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      return stats;
    } catch (error) {
      serverLogger.error('container', `获取容器统计失败: ${userId}`);
      return null;
    }
  }

  /**
   * 检查镜像是否存在
   */
  async ensureImageExists(): Promise<void> {
    try {
      await this.docker.getImage(this.imageName).inspect();
      serverLogger.info('container', `沙箱镜像已存在: ${this.imageName}`);
    } catch (error) {
      serverLogger.warn('container', `沙箱镜像不存在: ${this.imageName}，请先构建镜像`);
      throw new Error(
        `沙箱镜像不存在: ${this.imageName}\n` +
        `请运行: docker build -f docker/sandbox.Dockerfile -t ${this.imageName} .`
      );
    }
  }

  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([kmg]?)$/i);
    if (!match) throw new Error(`Invalid memory limit: ${limit}`);
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    switch (unit) {
      case 'k': return value * 1024;
      case 'm': return value * 1024 * 1024;
      case 'g': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }
}
