import { mkdir } from 'node:fs/promises';
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
import { createDockerClient } from '../docker/dockerSocket.js';
import path from 'path';
import { createHash } from 'node:crypto';
import { PassThrough, Transform } from 'node:stream';
import { UncertainToolOutcomeError } from '../tooling/UncertainToolOutcomeError.js';
import { serverLogger } from '../observability/ServerLogger.js';

function completeDockerFrames() {
  let header=Buffer.alloc(0),remaining=0;
  return new Transform({
    transform(chunk:Buffer,_encoding,callback){
      let offset=0;
      while(offset<chunk.length){
        if(remaining){const count=Math.min(remaining,chunk.length-offset);remaining-=count;offset+=count;continue;}
        const count=Math.min(8-header.length,chunk.length-offset);header=Buffer.concat([header,chunk.subarray(offset,offset+count)]);offset+=count;
        if(header.length===8){
          remaining=header.readUInt32BE(4);
          if(![1,2].includes(header[0])||header[1]||header[2]||header[3]||remaining>4*1024*1024){callback(new UncertainToolOutcomeError('容器回执帧无效'));return;}
          header=Buffer.alloc(0);
        }
      }
      callback(null,chunk);
    },
    flush(callback){callback(header.length||remaining?new UncertainToolOutcomeError('容器回执帧不完整'):undefined);},
  });
}

export interface ContainerConfig {
  userId: string;
  cpuLimit?: number;      // CPU 核心数限制（默认 1）
  memoryLimit?: string;   // 内存限制（默认 "512m"）
  storageLimit?: string;  // 存储限制（默认 "1g"）
  networkMode?: string;   // 网络模式（默认 "none"）
  workspacePath?: string; // Internal mount chosen by the authenticated workspace manager.
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
  namePrefix?: string;
  browserAllowedOrigins?: string[];
  browserDnsMode?: 'system' | 'cloudflare';
  cpuLimit?: number;
  memoryLimit?: string;
  pidsLimit?: number;
  networkMode?: 'none' | 'bridge' | 'host';
  /** 容器空闲超时（毫秒），超时后自动停止容器，默认 300000（5分钟），0=禁用 */
  idleTimeout?: number;
  /** 容器最大空闲时间（毫秒），超时后自动删除容器，默认 86400000（24小时），0=禁用 */
  maxIdleTime?: number;
}

export class UserContainerManager {
  private docker: Docker;
  private browserAllowedOrigins: string[];
  private browserDnsMode: 'system' | 'cloudflare';
  private containers: Map<string, string> = new Map(); // userId -> containerId
  private lastActivity: Map<string, number> = new Map(); // userId -> timestamp
  private workspaceBasePath: string;
  private imageName: string;
  private namePrefix: string;
  private defaultCpuLimit: number;
  private defaultMemoryLimit: string;
  private defaultPidsLimit: number;
  private defaultNetworkMode: string;
  private idleTimeout: number;
  private maxIdleTime: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private mcpManager?: UserContainerManager;

  constructor(workspaceBasePath: string, options: UserContainerManagerOptions = {}, private mcp = false) {
    this.docker = createDockerClient();
    this.workspaceBasePath = workspaceBasePath;
    this.browserDnsMode = options.browserDnsMode ?? 'system';
    this.browserAllowedOrigins = options.browserAllowedOrigins ?? [];
    this.namePrefix = options.namePrefix ?? 'x-computer-user';
    this.imageName = options.imageName ?? 'x-computer-sandbox:latest';
    this.defaultCpuLimit = options.cpuLimit ?? 1;
    this.defaultMemoryLimit = options.memoryLimit ?? '512m';
    this.defaultPidsLimit = options.pidsLimit ?? 100;
    this.defaultNetworkMode = options.networkMode ?? 'none';
    // 0 表示禁用，默认 5 分钟空闲停止，24 小时最大空闲删除
    this.idleTimeout = options.idleTimeout ?? 300000;
    this.maxIdleTime = options.maxIdleTime ?? 86400000;

    // 启动后台清理定时器（每分钟检查一次）
    this.startCleanupTimer();
  }

  async getOrCreateMcpContainer(userId: string, serverKey: string): Promise<string> {
    if (!/^[\w-]{1,128}$/.test(userId)) throw new Error('Invalid extension owner');
    this.mcpManager ??= new UserContainerManager(this.workspaceBasePath, {
      imageName: this.imageName, namePrefix: `${this.namePrefix}-mcp`, cpuLimit: this.defaultCpuLimit,
      memoryLimit: this.defaultMemoryLimit, pidsLimit: this.defaultPidsLimit,
      networkMode: this.defaultNetworkMode === 'host' ? 'none' : this.defaultNetworkMode as 'none' | 'bridge',
      idleTimeout: this.idleTimeout, maxIdleTime: this.maxIdleTime,
    }, true);
    const id = createHash('sha256').update(JSON.stringify([this.workspaceBasePath, userId, serverKey])).digest('hex').slice(0, 32);
    return this.mcpManager.getOrCreateContainer({ userId: id, workspacePath: path.join(this.workspaceBasePath, 'users', userId, 'workspace') });
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleContainers().catch((err) => {
        serverLogger.error('container', '空闲容器清理失败', err instanceof Error ? err.message : String(err));
      });
    }, 60_000);
    serverLogger.info('container', `容器清理定时器已启动（idleTimeout=${this.idleTimeout}ms, maxIdleTime=${this.maxIdleTime}ms）`);
  }

  /**
   * 清理空闲超时的容器
   */
  private async cleanupIdleContainers(): Promise<void> {
    const now = Date.now();

    for (const [userId, lastActive] of this.lastActivity.entries()) {
      const idleMs = now - lastActive;

      // 检查是否超过最大空闲时间（删除容器）
      if (this.maxIdleTime > 0 && idleMs >= this.maxIdleTime) {
        serverLogger.info('container', `容器超过最大空闲时间(${this.maxIdleTime}ms)，删除: ${userId}`);
        await this.removeContainer(userId);
        continue;
      }

      // 检查是否超过空闲超时（停止容器）
      if (this.idleTimeout > 0 && idleMs >= this.idleTimeout) {
        const containerId = this.containers.get(userId);
        if (!containerId) continue;

        try {
          const container = this.docker.getContainer(containerId);
          const info = await container.inspect();
          if (info.State.Running) {
            serverLogger.info('container', `容器超过空闲超时(${this.idleTimeout}ms)，停止: ${userId}`);
            await container.stop({ t: 10 });
            // 停止后不删除缓存，下次使用会重新启动
          }
        } catch (err) {
          // 容器可能已被删除，忽略错误
        }
      }
    }
  }

  /**
   * 为用户创建或获取容器
   */
  async findRunningContainer(userId: string): Promise<string | undefined> {
    const rows = await this.docker.listContainers();
    return rows.find(row => row.Names.includes(`/${this.namePrefix}-${userId}`))?.Id;
  }

  async getOrCreateContainer(config: ContainerConfig): Promise<string> {
    const { userId } = config;
    
    // 1. 检查内存缓存
    if (this.containers.has(userId)) {
      const containerId = this.containers.get(userId)!;
      const container = this.docker.getContainer(containerId);

      try {
        const info = await container.inspect();
        if (info.State.Running) {
          this.lastActivity.set(userId, Date.now());
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
    const containerName = `${this.namePrefix}-${userId}`;
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
    
    const workspacePath = config.workspacePath ?? path.join(this.workspaceBasePath, 'users', userId, 'workspace');
    await mkdir(workspacePath, { recursive: true });
    
    try {
      const container = await this.docker.createContainer({
        name: `${this.namePrefix}-${userId}`,
        Image: this.imageName,
        OpenStdin: true,
        Tty: true,
        
        // 资源限制
        HostConfig: {
          Memory: this.parseMemoryLimit(memoryLimit),
          NanoCpus: cpuLimit * 1e9,
          
          // 仅绑定当前用户的工作区；宿主机其他目录不挂载。
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
            '/tmp': this.mcp ? 'rw,nosuid,nodev,size=100m' : 'rw,noexec,nosuid,size=100m',
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
          `X_BROWSER_DNS_MODE=${this.browserDnsMode}`,
          `X_BROWSER_ALLOWED_ORIGINS=${JSON.stringify(this.browserAllowedOrigins)}`,
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
        User: process.getuid?.() ? `${process.getuid()}:${process.getgid?.() ?? 1000}` : '1000:1000',
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
    const { cwd = '/workspace', timeout = 30000 } = options;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>300000)throw new Error('命令超时参数须在 1 至 300000 毫秒之间');
    let dispatched=false,finished=false;
    const cleanup:Array<()=>void>=[];
    let timer:ReturnType<typeof setTimeout>;
    const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(dispatched?new UncertainToolOutcomeError('容器命令回执超时，结果未知'):new Error('执行环境准备超时，命令尚未启动')),timeout);});
    try {
      const containerId=await Promise.race([this.getOrCreateContainer({userId}),deadline]);
      this.lastActivity.set(userId,Date.now());
      serverLogger.info('security-audit',`[SHELL_EXEC] userId=${userId}`);
      const exec=await Promise.race([this.docker.getContainer(containerId).exec({Cmd:['/bin/sh','-c',command],WorkingDir:cwd,AttachStdout:true,AttachStderr:true,Tty:false}),deadline]);
      dispatched=true;
      const starting=exec.start({Detach:false});
      void starting.then(stream=>{stream.on('error',()=>{});if(finished)stream.destroy();else cleanup.push(()=>stream.destroy());}).catch(()=>{});
      const stream=await Promise.race([starting,deadline]);
      if(stream.destroyed)throw new UncertainToolOutcomeError('容器响应在读取前已断开');
      const validated=completeDockerFrames(),stdoutStream=new PassThrough(),stderrStream=new PassThrough();
      cleanup.push(()=>{validated.destroy();stdoutStream.destroy();stderrStream.destroy();});
      stdoutStream.setEncoding('utf8');stderrStream.setEncoding('utf8');
      let stdout='',stderr='';
      stdoutStream.on('data',text=>{stdout=(stdout+text).slice(0,50000);});
      stderrStream.on('data',text=>{stderr=(stderr+text).slice(0,10000);});
      const result=new Promise<ExecResult>((resolve,reject)=>{
        let ended=false;
        const uncertain=()=>reject(new UncertainToolOutcomeError('容器命令回执未完整取得，结果未知，禁止自动重试'));
        stream.on('end',()=>{ended=true;});stream.on('close',()=>{if(!ended)uncertain();});stream.on('error',uncertain);validated.on('error',uncertain);
        validated.on('end',async()=>{
          try{const info=await Promise.race([exec.inspect(),deadline]);if(info.Running!==false||!Number.isInteger(info.ExitCode))throw new Error('无确定退出码');resolve({stdout,stderr,exitCode:info.ExitCode!});}catch{uncertain();}
        });
        this.docker.modem.demuxStream(validated,stdoutStream,stderrStream);
        stream.pipe(validated);
      });
      return await Promise.race([result,deadline]);
    } catch(error) {
      if(dispatched)throw new UncertainToolOutcomeError('容器命令启动或回执状态未知，禁止自动重试');
      serverLogger.error('container',`命令尚未启动: ${userId}`);
      throw new Error(`命令尚未启动: ${error instanceof Error?error.message:String(error)}`);
    } finally {finished=true;clearTimeout(timer!);for(const close of cleanup)close();}
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
  stopMonitoring(): void {
    this.mcpManager?.stopMonitoring();
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  async cleanup(): Promise<void> {
    this.stopMonitoring();
    await this.mcpManager?.cleanup();

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
