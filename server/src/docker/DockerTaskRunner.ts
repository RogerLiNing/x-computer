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
   * 使用 docker.run() API：自动处理输出流收集、容器生命周期和超时
   */
  async runTask(config: DockerTaskConfig): Promise<DockerTaskResult> {
    const startTime = Date.now();
    const timeout = config.timeout || 60000; // 默认 60 秒
    const autoRemove = config.autoRemove !== false;

    // 构建命令
    // 优先使用 config.command（直接命令数组，避免 BusyBox sh 的多行脚本限制）
    // config.script 用于纯脚本语言：写入临时文件后执行
    let cmd: string[];
    if (config.command) {
      cmd = config.command;
    } else if (config.script) {
      // 写入脚本到临时文件并执行，兼容 BusyBox sh
      const workdir = config.workdir || '/workspace';
      // 使用 cat heredoc 写入脚本（heredoc 不受引号和转义影响）
      const escaped = config.script.replace(/'/g, "'\\''");
      cmd = ['/bin/sh', '-c', `cat > /tmp/script << 'SCRIPT'\n${config.script}\nSCRIPT\n/bin/sh /tmp/script`];
    } else {
      cmd = ['echo', 'no command'];
    }

    // 构建环境变量
    const env: string[] | undefined = config.env
      ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`)
      : undefined;

    // 收集输出的可写流
    const { Writable } = await import('stream');
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutStream = new Writable({
      write(chunk, _, cb) { stdoutChunks.push(chunk); cb(); },
    });
    const stderrStream = new Writable({
      write(chunk, _, cb) { stderrChunks.push(chunk); cb(); },
    });

    try {
      // 使用 Promise.race 实现超时
      const [result, container] = await Promise.race([
        this.docker.run(
          config.image,
          cmd,
          [stdoutStream, stderrStream],
          {
            name: '',
            Tty: false,
            Env: env,
            WorkingDir: config.workdir || '/workspace',
            HostConfig: {
              Memory: config.memory || 512 * 1024 * 1024,
              NanoCpus: (config.cpus || 0.5) * 1e9,
              NetworkMode: config.network || 'bridge',
              AutoRemove: autoRemove,
              SecurityOpt: ['no-new-privileges:true'],
              CapDrop: ['ALL'],
              Binds: config.volumes
                ? Object.entries(config.volumes).map(([h, c]) => `${h}:${c}`)
                : undefined,
            },
          },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Task timeout after ${timeout}ms`)), timeout),
        ),
      ]).catch(async (err) => {
        // 超时后尝试停止并清理容器
        try {
          const containers = await this.docker.listContainers({ all: true });
          const running = containers.find((c) => c.Image === config.image && c.State === 'running');
          if (running) {
            const c = this.docker.getContainer(running.Id);
            await c.stop();
            await c.remove();
          }
        } catch {}
        throw err;
      });

      const duration = Date.now() - startTime;
      const containerId = (container as Docker.Container).id || '';
      serverLogger.info('docker-task', `任务完成: ${containerId.substring(0, 12)} (exitCode: ${result.StatusCode}, duration: ${duration}ms)`);

      return {
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        exitCode: result.StatusCode ?? 0,
        duration,
        containerId,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      serverLogger.error('docker-task', `任务失败`, error instanceof Error ? error.message : String(error));
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
   * container.logs() 在 dockerode 4.x 中：follow=true → 返回可读流；follow=false → 直接返回 Buffer
   */
  private async getContainerLogs(
    container: Docker.Container
  ): Promise<{ stdout: string; stderr: string }> {
    const data = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    // dockerode 4.x: follow=false 时 data 是 Buffer；follow=true 时是 ReadableStream
    const chunks: Buffer[] = [];
    if (Buffer.isBuffer(data)) {
      chunks.push(data);
    } else if (typeof (data as any).on === 'function') {
      // 是 Node.js 流，直接收集
      await new Promise<void>((resolve, reject) => {
        (data as NodeJS.ReadableStream).on('data', (chunk: Buffer) => chunks.push(chunk));
        (data as NodeJS.ReadableStream).on('end', () => resolve());
        (data as NodeJS.ReadableStream).on('error', () => resolve());
      });
    }

    // Docker 日志流在 non-TTY 模式下每帧有 8 字节头：[4字节长度, 1字节 stream type, 3字节保留]
    // stream type: 0=stdin, 1=stdout, 2=stderr
    let stdout = '';
    let stderr = '';
    for (const buf of chunks) {
      let offset = 0;
      while (offset + 8 <= buf.length) {
        const size = buf.readUInt32BE(offset);
        const streamType = buf[offset + 4];
        offset += 8;
        if (offset + size > buf.length) break;
        const payload = buf.slice(offset, offset + size).toString();
        if (streamType === 1) stdout += payload;
        else if (streamType === 2) stderr += payload;
        offset += size;
      }
    }
    return { stdout, stderr };
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
      command: ['node', '-e', script],
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Python 任务
     */
    python: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'python:3.11-slim',
      command: ['python3', '-c', script],
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Bash 脚本任务
     */
    bash: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'alpine:latest',
      command: ['/bin/sh', '-c', script],
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Go 任务
     */
    go: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'golang:1.21-alpine',
      command: ['go', 'run', '/dev/stdin'],
      env: { 'GONOSUMCHECK': '*', 'GOPROXY': 'off' },
      workdir: '/workspace',
      ...options,
    }),

    /**
     * Rust 任务
     */
    rust: (script: string, options?: Partial<DockerTaskConfig>): DockerTaskConfig => ({
      image: 'rust:1.75-alpine',
      command: ['rustc', '-', '--edition=2021'],
      workdir: '/workspace',
      ...options,
    }),
  };
}
