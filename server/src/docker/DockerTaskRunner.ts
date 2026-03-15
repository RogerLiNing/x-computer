/**
 * Docker 任务执行器
 * 按需创建 Docker 容器执行任务，支持多种语言和环境
 */

import Docker from 'dockerode';
import { serverLogger } from '../observability/ServerLogger.js';

export interface DockerTaskConfig {
  image: string;                    // Docker 镜像（如 node:20-alpine, python:3.11-slim）
  command?: string[];               // 执行的命令
  script?: string;                  // 执行的脚本内容
  workdir?: string;                 // 工作目录
  env?: Record<string, string>;     // 环境变量
  timeout?: number;                 // 超时时间（毫秒）
  memory?: number;                  // 内存限制（字节）
  cpus?: number;                    // CPU 限制
  volumes?: Record<string, string>; // 卷挂载 { hostPath: containerPath }
  network?: string;                 // 网络模式
  autoRemove?: boolean;             // 任务完成后自动删除容器
}

export interface DockerTaskResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  containerId: string;
}

export class DockerTaskRunner {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  /**
   * 执行 Docker 任务
   */
  async runTask(config: DockerTaskConfig): Promise<DockerTaskResult> {
    const startTime = Date.now();
    const timeout = config.timeout || 60000; // 默认 60 秒
    const autoRemove = config.autoRemove !== false; // 默认自动删除

    let containerId = '';

    try {
      // 1. 创建容器
      const container = await this.createContainer(config);
      containerId = container.id;

      serverLogger.info('docker-task', `容器已创建: ${containerId.substring(0, 12)}`);

      // 2. 启动容器
      await container.start();
      serverLogger.info('docker-task', `容器已启动: ${containerId.substring(0, 12)}`);

      // 3. 等待容器完成（带超时）
      const result = await this.waitForContainer(container, timeout);

      // 4. 获取日志
      const logs = await this.getContainerLogs(container);

      const duration = Date.now() - startTime;

      serverLogger.info('docker-task', `任务完成: ${containerId.substring(0, 12)} (exitCode: ${result.StatusCode}, duration: ${duration}ms)`);

      // 5. 自动删除容器
      if (autoRemove) {
        await this.removeContainer(container);
      }

      return {
        stdout: logs.stdout,
        stderr: logs.stderr,
        exitCode: result.StatusCode,
        duration,
        containerId,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      serverLogger.error('docker-task', `任务失败: ${containerId.substring(0, 12)}`, error instanceof Error ? error.message : String(error));

      // 清理容器
      if (containerId && autoRemove) {
        try {
          const container = this.docker.getContainer(containerId);
          await this.removeContainer(container);
        } catch (cleanupError) {
          serverLogger.warn('docker-task', '清理容器失败', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
        }
      }

      throw error;
    }
  }

  /**
   * 创建容器
   */
  private async createContainer(config: DockerTaskConfig): Promise<Docker.Container> {
    const createOptions: Docker.ContainerCreateOptions = {
      Image: config.image,
      WorkingDir: config.workdir || '/workspace',
      Env: config.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`) : undefined,
      HostConfig: {
        Memory: config.memory || 512 * 1024 * 1024, // 默认 512MB
        NanoCpus: (config.cpus || 0.5) * 1e9, // 默认 0.5 核心
        NetworkMode: config.network || 'bridge',
        AutoRemove: false, // 手动控制删除
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
      },
      AttachStdout: true,
      AttachStderr: true,
    };

    // 处理命令或脚本
    if (config.script) {
      // 如果提供了脚本内容，写入临时文件并执行
      createOptions.Cmd = ['/bin/sh', '-c', config.script];
    } else if (config.command) {
      createOptions.Cmd = config.command;
    }

    // 处理卷挂载
    if (config.volumes) {
      createOptions.HostConfig!.Binds = Object.entries(config.volumes).map(
        ([host, container]) => `${host}:${container}`
      );
    }

    return await this.docker.createContainer(createOptions);
  }

  /**
   * 等待容器完成
   */
  private async waitForContainer(
    container: Docker.Container,
    timeout: number
  ): Promise<{ StatusCode: number }> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        container.stop().catch(() => {});
        reject(new Error(`Container execution timeout after ${timeout}ms`));
      }, timeout);

      container.wait((err, data) => {
        clearTimeout(timeoutId);
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  /**
   * 获取容器日志
   */
  private async getContainerLogs(
    container: Docker.Container
  ): Promise<{ stdout: string; stderr: string }> {
    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    let stdout = '';
    let stderr = '';

    return new Promise((resolve) => {
      // Docker 的 demuxStream 需要 NodeJS.WritableStream
      const stdoutStream = {
        write: (chunk: Buffer) => {
          stdout += chunk.toString();
        },
      };
      
      const stderrStream = {
        write: (chunk: Buffer) => {
          stderr += chunk.toString();
        },
      };

      this.docker.modem.demuxStream(stream as any, stdoutStream as any, stderrStream as any);

      (stream as any).on('end', () => {
        resolve({ stdout, stderr });
      });
    });
  }

  /**
   * 删除容器
   */
  private async removeContainer(container: Docker.Container): Promise<void> {
    try {
      await container.remove({ force: true });
      serverLogger.debug('docker-task', `容器已删除: ${container.id.substring(0, 12)}`);
    } catch (error) {
      serverLogger.warn('docker-task', '删除容器失败', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 列出所有运行中的任务容器
   */
  async listRunningTasks(): Promise<Array<{ id: string; image: string; status: string }>> {
    const containers = await this.docker.listContainers({
      all: false,
      filters: { status: ['running'] },
    });

    return containers.map((c) => ({
      id: c.Id.substring(0, 12),
      image: c.Image,
      status: c.Status,
    }));
  }

  /**
   * 停止任务
   */
  async stopTask(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.stop();
    await container.remove({ force: true });
    serverLogger.info('docker-task', `任务已停止: ${containerId.substring(0, 12)}`);
  }

  /**
   * 预定义的任务模板
   */
  static templates = {
    /**
     * Node.js 任务
     */
    nodejs: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'node:20-alpine',
      script,
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Python 任务
     */
    python: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'python:3.11-slim',
      script,
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Bash 脚本任务
     */
    bash: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'alpine:latest',
      script,
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Go 任务
     */
    go: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'golang:1.21-alpine',
      script,
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Rust 任务
     */
    rust: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'rust:1.75-alpine',
      script,
      workdir: '/workspace',
      ...options,
    }),
  };
}
