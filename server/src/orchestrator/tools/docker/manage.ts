/**
 * Docker 容器管理工具
 * 让 AI 可以创建、管理、使用 Docker 容器做任何事情
 */

import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import Docker from 'dockerode';
import { serverLogger } from '../../../observability/ServerLogger.js';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * 创建并运行 Docker 容器
 */
export const dockerRunDefinition: ToolDefinition = {
  name: 'docker.run',
  displayName: 'Docker运行容器',
  description: `创建并运行 Docker 容器执行任务。可以：
- 运行任意镜像（node、python、nginx、mysql 等）
- 执行命令或脚本
- 挂载文件/目录
- 设置环境变量
- 暴露端口
- 后台运行或一次性任务

适用场景：编译网站、运行服务、数据处理、测试环境等任何需要 Docker 的场景。`,
  domain: ['coding', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'image', type: 'string', description: 'Docker 镜像名称（如 "node:20", "python:3.11", "nginx:alpine"）', required: true },
    { name: 'command', type: 'array', description: '要执行的命令数组（如 ["node", "app.js"] 或 ["python", "script.py"]）', required: false },
    { name: 'script', type: 'string', description: '要执行的脚本内容（会通过 sh -c 执行）', required: false },
    { name: 'name', type: 'string', description: '容器名称（便于后续管理）', required: false },
    { name: 'workdir', type: 'string', description: '工作目录（默认 /workspace）', required: false },
    { name: 'env', type: 'object', description: '环境变量对象', required: false },
    { name: 'volumes', type: 'object', description: '卷挂载对象，格式：{"宿主机路径": "容器路径"}', required: false },
    { name: 'ports', type: 'object', description: '端口映射对象，格式：{"容器端口": "宿主机端口"}', required: false },
    { name: 'detach', type: 'boolean', description: '是否后台运行（默认 false，执行完即删除）', required: false },
    { name: 'timeout', type: 'number', description: '超时毫秒数（仅非后台模式，默认 300000）', required: false },
    { name: 'memory', type: 'number', description: '内存限制（字节）', required: false },
    { name: 'cpus', type: 'number', description: 'CPU 限制（核心数，如 0.5）', required: false },
    { name: 'network', type: 'string', description: '网络模式（bridge/host/none）', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerRunHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input, _ctx) => {
    const image = String(input.image ?? '').trim();
    if (!image) throw new Error('docker.run: image is required');

    const name = input.name ? String(input.name).trim() : undefined;
    const workdir = input.workdir ? String(input.workdir).trim() : '/workspace';
    const detach = Boolean(input.detach);
    const timeout = Math.min(600000, Math.max(5000, Number(input.timeout) || 300000));

    // 处理命令
    let cmd: string[] | undefined;
    if (input.script) {
      cmd = ['/bin/sh', '-c', String(input.script)];
    } else if (Array.isArray(input.command)) {
      cmd = input.command.map(String);
    }

    // 处理环境变量
    const env = input.env && typeof input.env === 'object' 
      ? Object.entries(input.env).map(([k, v]) => `${k}=${v}`)
      : undefined;

    // 处理卷挂载
    const binds = input.volumes && typeof input.volumes === 'object'
      ? Object.entries(input.volumes).map(([host, container]) => `${host}:${container}`)
      : undefined;

    // 处理端口映射
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, {}> = {};
    if (input.ports && typeof input.ports === 'object') {
      for (const [containerPort, hostPort] of Object.entries(input.ports)) {
        const port = `${containerPort}/tcp`;
        exposedPorts[port] = {};
        portBindings[port] = [{ HostPort: String(hostPort) }];
      }
    }

    try {
      // 创建容器
      const container = await docker.createContainer({
        Image: image,
        name,
        Cmd: cmd,
        WorkingDir: workdir,
        Env: env,
        ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
        HostConfig: {
          Binds: binds,
          PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
          Memory: input.memory ? Number(input.memory) : undefined,
          NanoCpus: input.cpus ? Number(input.cpus) * 1e9 : undefined,
          NetworkMode: input.network ? String(input.network) : 'bridge',
          AutoRemove: !detach, // 非后台模式自动删除
          SecurityOpt: ['no-new-privileges:true'],
        },
        AttachStdout: !detach,
        AttachStderr: !detach,
      });

      const containerId = container.id;
      serverLogger.info('docker', `容器已创建: ${containerId.substring(0, 12)} (${image})`);

      // 启动容器
      await container.start();
      serverLogger.info('docker', `容器已启动: ${containerId.substring(0, 12)}`);

      if (detach) {
        // 后台运行模式
        const info = await container.inspect();
        return {
          mode: 'detached',
          containerId: containerId.substring(0, 12),
          name: info.Name.replace(/^\//, ''),
          image,
          status: 'running',
          message: '容器已在后台运行，使用 docker.logs 查看日志，docker.stop 停止容器',
        };
      } else {
        // 前台执行模式
        const startTime = Date.now();

        // 等待容器完成
        const waitResult = await Promise.race([
          container.wait(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), timeout)
          ),
        ]) as { StatusCode: number };

        // 获取日志
        const logs = await container.logs({
          stdout: true,
          stderr: true,
          follow: false,
        });

        let stdout = '';
        let stderr = '';

        // 解析日志
        const stdoutStream = { write: (chunk: Buffer) => { stdout += chunk.toString(); } };
        const stderrStream = { write: (chunk: Buffer) => { stderr += chunk.toString(); } };
        docker.modem.demuxStream(logs as any, stdoutStream as any, stderrStream as any);

        const duration = Date.now() - startTime;

        serverLogger.info('docker', `容器执行完成: ${containerId.substring(0, 12)} (exitCode: ${waitResult.StatusCode})`);

        return {
          mode: 'executed',
          containerId: containerId.substring(0, 12),
          exitCode: waitResult.StatusCode,
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 10000),
          duration,
          success: waitResult.StatusCode === 0,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('docker', `容器运行失败: ${msg}`);
      throw new Error(`docker.run 失败: ${msg}`);
    }
  };
}

/**
 * 列出 Docker 容器
 */
export const dockerListDefinition: ToolDefinition = {
  name: 'docker.list',
  displayName: 'Docker列出容器',
  description: '列出所有 Docker 容器（运行中或全部）。可以查看容器状态、名称、镜像等信息。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'all', type: 'boolean', description: '是否显示所有容器（包括已停止的），默认只显示运行中的', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerListHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input, _ctx) => {
    const all = Boolean(input.all);

    try {
      const containers = await docker.listContainers({ all });

      return {
        count: containers.length,
        containers: containers.map(c => ({
          id: c.Id.substring(0, 12),
          name: c.Names[0]?.replace(/^\//, '') || '',
          image: c.Image,
          status: c.Status,
          state: c.State,
          ports: c.Ports.map(p => ({
            container: p.PrivatePort,
            host: p.PublicPort,
            type: p.Type,
          })),
          created: new Date(c.Created * 1000).toISOString(),
        })),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.list 失败: ${msg}`);
    }
  };
}

/**
 * 查看容器日志
 */
export const dockerLogsDefinition: ToolDefinition = {
  name: 'docker.logs',
  displayName: 'Docker查看日志',
  description: '查看 Docker 容器的日志输出。可以查看运行中或已停止容器的日志。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'container', type: 'string', description: '容器 ID 或名称', required: true },
    { name: 'tail', type: 'number', description: '只显示最后 N 行（默认全部）', required: false },
    { name: 'since', type: 'number', description: '只显示最近 N 秒的日志', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerLogsHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input, _ctx) => {
    const containerId = String(input.container ?? '').trim();
    if (!containerId) throw new Error('docker.logs: container is required');

    try {
      const container = docker.getContainer(containerId);
      
      const logsStream = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        tail: input.tail ? Number(input.tail) : undefined,
        since: input.since ? Math.floor(Date.now() / 1000 - Number(input.since)) : undefined,
      });

      let stdout = '';
      let stderr = '';

      const stdoutStream = { write: (chunk: Buffer) => { stdout += chunk.toString(); } };
      const stderrStream = { write: (chunk: Buffer) => { stderr += chunk.toString(); } };
      docker.modem.demuxStream(logsStream as any, stdoutStream as any, stderrStream as any);

      return {
        containerId: containerId.substring(0, 12),
        stdout: stdout.slice(0, 50000),
        stderr: stderr.slice(0, 10000),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.logs 失败: ${msg}`);
    }
  };
}

/**
 * 停止容器
 */
export const dockerStopDefinition: ToolDefinition = {
  name: 'docker.stop',
  displayName: 'Docker停止容器',
  description: '停止运行中的 Docker 容器。可以选择是否删除容器。',
  domain: ['agent'],
  riskLevel: 'medium',
  parameters: [
    { name: 'container', type: 'string', description: '容器 ID 或名称', required: true },
    { name: 'remove', type: 'boolean', description: '是否删除容器（默认 true）', required: false },
    { name: 'timeout', type: 'number', description: '优雅停止的超时秒数（默认 10）', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerStopHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input, _ctx) => {
    const containerId = String(input.container ?? '').trim();
    if (!containerId) throw new Error('docker.stop: container is required');

    const remove = input.remove !== false; // 默认删除
    const timeout = Math.min(60, Math.max(1, Number(input.timeout) || 10));

    try {
      const container = docker.getContainer(containerId);

      // 停止容器
      await container.stop({ t: timeout });
      serverLogger.info('docker', `容器已停止: ${containerId.substring(0, 12)}`);

      // 删除容器
      if (remove) {
        await container.remove({ force: true });
        serverLogger.info('docker', `容器已删除: ${containerId.substring(0, 12)}`);
      }

      return {
        containerId: containerId.substring(0, 12),
        stopped: true,
        removed: remove,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.stop 失败: ${msg}`);
    }
  };
}

/**
 * 在运行中的容器内执行命令
 */
export const dockerExecDefinition: ToolDefinition = {
  name: 'docker.exec',
  displayName: 'Docker执行命令',
  description: '在运行中的 Docker 容器内执行命令。可以用于调试、管理容器内的进程等。',
  domain: ['agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'container', type: 'string', description: '容器 ID 或名称', required: true },
    { name: 'command', type: 'array', description: '要执行的命令数组（如 ["ls", "-la"]）', required: false },
    { name: 'script', type: 'string', description: '要执行的脚本内容', required: false },
    { name: 'workdir', type: 'string', description: '工作目录', required: false },
    { name: 'timeout', type: 'number', description: '超时毫秒数（默认 60000）', required: false },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerExecHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input, _ctx) => {
    const containerId = String(input.container ?? '').trim();
    if (!containerId) throw new Error('docker.exec: container is required');

    const timeout = Math.min(300000, Math.max(5000, Number(input.timeout) || 60000));

    // 处理命令
    let cmd: string[];
    if (input.script) {
      cmd = ['/bin/sh', '-c', String(input.script)];
    } else if (Array.isArray(input.command)) {
      cmd = input.command.map(String);
    } else {
      throw new Error('docker.exec: command or script is required');
    }

    try {
      const container = docker.getContainer(containerId);

      // 创建 exec 实例
      const exec = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: input.workdir ? String(input.workdir) : undefined,
      });

      // 执行命令
      const stream = await exec.start({ Detach: false });

      let stdout = '';
      let stderr = '';

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          (stream as any).destroy();
          reject(new Error(`Command execution timeout after ${timeout}ms`));
        }, timeout);

        const stdoutStream = { write: (chunk: Buffer) => { stdout += chunk.toString(); } };
        const stderrStream = { write: (chunk: Buffer) => { stderr += chunk.toString(); } };
        docker.modem.demuxStream(stream as any, stdoutStream as any, stderrStream as any);

        (stream as any).on('end', async () => {
          clearTimeout(timeoutId);
          
          try {
            const inspectResult = await exec.inspect();
            resolve({
              containerId: containerId.substring(0, 12),
              exitCode: inspectResult.ExitCode || 0,
              stdout: stdout.slice(0, 50000),
              stderr: stderr.slice(0, 10000),
              success: (inspectResult.ExitCode || 0) === 0,
            });
          } catch (error) {
            reject(error);
          }
        });

        (stream as any).on('error', (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.exec 失败: ${msg}`);
    }
  };
}

/**
 * 拉取 Docker 镜像
 */
export const dockerPullDefinition: ToolDefinition = {
  name: 'docker.pull',
  displayName: 'Docker拉取镜像',
  description: '拉取 Docker 镜像到本地。在使用新镜像前可以先拉取，避免首次运行时等待。',
  domain: ['agent'],
  riskLevel: 'low',
  parameters: [
    { name: 'image', type: 'string', description: '镜像名称（如 "node:20", "python:3.11-slim"）', required: true },
  ],
  requiredPermissions: ['docker'],
};

export function createDockerPullHandler(_deps: ToolExecutorDeps): ToolHandler {
  return async (input, _ctx) => {
    const image = String(input.image ?? '').trim();
    if (!image) throw new Error('docker.pull: image is required');

    try {
      serverLogger.info('docker', `开始拉取镜像: ${image}`);
      
      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }

          docker.modem.followProgress(stream, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });

      serverLogger.info('docker', `镜像拉取完成: ${image}`);

      return {
        image,
        status: 'pulled',
        message: '镜像已成功拉取到本地',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`docker.pull 失败: ${msg}`);
    }
  };
}
