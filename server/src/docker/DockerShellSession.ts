/**
 * Docker 交互式 Shell 会话
 * 让 AI 可以像真人一样进入容器，持续执行命令并看到结果
 */

import Docker from 'dockerode';
import { serverLogger } from '../observability/ServerLogger.js';
import { Writable } from 'stream';

export interface ShellSessionConfig {
  container: string;              // 容器 ID 或名称
  workdir?: string;               // 初始工作目录
  env?: Record<string, string>;   // 环境变量
  shell?: string;                 // Shell 类型（默认 /bin/sh）
}

export interface CommandResult {
  command: string;
  output: string;
  exitCode?: number;
  duration: number;
}

/**
 * Docker 交互式 Shell 会话
 * 
 * 特点：
 * - 保持工作目录和环境变量
 * - 命令之间有状态连续性
 * - 实时查看输出
 * 
 * 实现方式：
 * - 使用状态文件（.shell_session_state）保存工作目录和环境变量
 * - 每次命令执行前加载状态，执行后保存状态
 * - 这样可以在多次 exec 之间保持状态连续性
 */
export class DockerShellSession {
  private docker: Docker;
  private containerId: string;
  private currentWorkdir: string;
  private currentEnv: Record<string, string>;
  private isReady: boolean = false;
  private commandHistory: CommandResult[] = [];
  private shell: string;
  private stateFile: string = '/tmp/.shell_session_state';

  constructor(private config: ShellSessionConfig) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.containerId = config.container;
    this.currentWorkdir = config.workdir || '/workspace';
    this.currentEnv = config.env || {};
    this.shell = config.shell || '/bin/sh';
  }

  /**
   * 启动交互式 Shell 会话
   */
  async start(): Promise<void> {
    if (this.isReady) {
      throw new Error('Session already started');
    }

    try {
      // 初始化状态文件
      await this.saveState();
      
      this.isReady = true;
      serverLogger.info('docker-shell', `Shell 会话已启动: ${this.containerId.substring(0, 12)}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      serverLogger.error('docker-shell', 'Failed to start shell session', msg);
      throw new Error(`Failed to start shell session: ${msg}`);
    }
  }

  /**
   * 保存会话状态
   */
  private async saveState(): Promise<void> {
    const container = this.docker.getContainer(this.containerId);
    
    // 创建状态文件内容
    const stateContent = JSON.stringify({
      workdir: this.currentWorkdir,
      env: this.currentEnv,
    });

    // 写入状态文件
    const exec = await container.exec({
      Cmd: [this.shell, '-c', `echo '${stateContent}' > ${this.stateFile}`],
      AttachStdout: true,
      AttachStderr: true,
    });

    await exec.start({ Detach: false });
  }

  /**
   * 加载会话状态
   */
  private async loadState(): Promise<void> {
    const container = this.docker.getContainer(this.containerId);
    
    // 读取状态文件
    const exec = await container.exec({
      Cmd: [this.shell, '-c', `cat ${this.stateFile} 2>/dev/null || echo '{}'`],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false });
    
    let output = '';
    const stdoutStream = new Writable({
      write: (chunk, encoding, callback) => {
        output += chunk.toString();
        callback();
      },
    });

    const stderrStream = new Writable({
      write: (chunk, encoding, callback) => {
        callback();
      },
    });

    this.docker.modem.demuxStream(stream as any, stdoutStream as any, stderrStream as any);

    await new Promise((resolve) => {
      stream.on('end', resolve);
    });

    try {
      const state = JSON.parse(output.trim());
      this.currentWorkdir = state.workdir || this.currentWorkdir;
      this.currentEnv = state.env || this.currentEnv;
    } catch (error) {
      // 状态文件不存在或解析失败，使用默认值
    }
  }

  /**
   * 执行命令
   */
  async execute(command: string, timeoutMs: number = 30000): Promise<CommandResult> {
    if (!this.isReady) {
      throw new Error('Session not started');
    }

    const startTime = Date.now();

    try {
      // 加载状态
      await this.loadState();

      // 处理特殊命令
      if (command.trim().startsWith('cd ')) {
        // cd 命令：更新工作目录
        const newDir = command.trim().substring(3).trim();
        this.currentWorkdir = newDir.startsWith('/') ? newDir : `${this.currentWorkdir}/${newDir}`;
        await this.saveState();
        
        const duration = Date.now() - startTime;
        const result: CommandResult = {
          command,
          output: '',
          duration,
        };
        this.commandHistory.push(result);
        return result;
      } else if (command.trim().startsWith('export ')) {
        // export 命令：更新环境变量
        const envPart = command.trim().substring(7).trim();
        const match = envPart.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          this.currentEnv[key] = value.replace(/^["']|["']$/g, '');
          await this.saveState();
        }
        
        const duration = Date.now() - startTime;
        const result: CommandResult = {
          command,
          output: '',
          duration,
        };
        this.commandHistory.push(result);
        return result;
      }

      // 检查是否是后台命令（以 & 结尾或使用 nohup）
      const isBackground = command.trim().endsWith('&') || command.trim().startsWith('nohup ');
      
      // 如果是后台命令，使用较短的超时（只等待命令启动）
      const effectiveTimeout = isBackground ? 5000 : timeoutMs;

      // 执行普通命令
      const container = this.docker.getContainer(this.containerId);
      
      // 构建环境变量数组
      const envArray = Object.entries(this.currentEnv).map(([k, v]) => `${k}=${v}`);

      const exec = await container.exec({
        Cmd: [this.shell, '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: this.currentWorkdir,
        Env: envArray.length > 0 ? envArray : undefined,
      });

      const stream = await exec.start({ Detach: false });
      
      let stdout = '';
      let stderr = '';

      const stdoutStream = new Writable({
        write: (chunk, encoding, callback) => {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new Writable({
        write: (chunk, encoding, callback) => {
          stderr += chunk.toString();
          callback();
        },
      });

      this.docker.modem.demuxStream(stream as any, stdoutStream as any, stderrStream as any);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (isBackground) {
            // 后台命令超时不算错误，直接返回
            resolve(undefined);
          } else {
            reject(new Error(`Command timeout after ${effectiveTimeout}ms`));
          }
        }, effectiveTimeout);

        stream.on('end', () => {
          clearTimeout(timeout);
          resolve(undefined);
        });

        stream.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const duration = Date.now() - startTime;
      const output = stdout + stderr;

      const result: CommandResult = {
        command,
        output: isBackground && !output ? '(后台运行)' : output,
        duration,
      };

      this.commandHistory.push(result);

      serverLogger.debug('docker-shell', `命令执行完成: ${command}`, JSON.stringify({
        duration,
        outputLength: output.length,
        isBackground,
      }));

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      
      const result: CommandResult = {
        command,
        output: '',
        duration,
      };

      this.commandHistory.push(result);

      serverLogger.error('docker-shell', `命令执行失败: ${command}`, msg);
      throw new Error(`Command failed: ${msg}`);
    }
  }

  /**
   * 执行交互式命令（如 mysql、psql、redis-cli）
   * 
   * @param program 交互式程序（如 'mysql -uroot -p'）
   * @param commands 要执行的命令数组
   * @param timeoutMs 超时毫秒数
   */
  async executeInteractive(
    program: string,
    commands: string[],
    timeoutMs: number = 30000
  ): Promise<CommandResult> {
    if (!this.isReady) {
      throw new Error('Session not started');
    }

    const startTime = Date.now();

    try {
      // 加载状态
      await this.loadState();

      // 将命令通过管道传给交互式程序
      // 例如：echo -e "SHOW DATABASES;\nUSE mydb;\nSELECT * FROM users;" | mysql -uroot -p
      const commandsStr = commands.join('\\n');
      const fullCommand = `echo -e "${commandsStr}" | ${program}`;

      const container = this.docker.getContainer(this.containerId);
      
      // 构建环境变量数组
      const envArray = Object.entries(this.currentEnv).map(([k, v]) => `${k}=${v}`);

      const exec = await container.exec({
        Cmd: [this.shell, '-c', fullCommand],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: this.currentWorkdir,
        Env: envArray.length > 0 ? envArray : undefined,
      });

      const stream = await exec.start({ Detach: false });
      
      let stdout = '';
      let stderr = '';

      const stdoutStream = new Writable({
        write: (chunk, encoding, callback) => {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new Writable({
        write: (chunk, encoding, callback) => {
          stderr += chunk.toString();
          callback();
        },
      });

      this.docker.modem.demuxStream(stream as any, stdoutStream as any, stderrStream as any);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Interactive command timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        stream.on('end', () => {
          clearTimeout(timeout);
          resolve(undefined);
        });

        stream.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      const duration = Date.now() - startTime;
      const output = stdout + stderr;

      const result: CommandResult = {
        command: `${program} (${commands.length} commands)`,
        output,
        duration,
      };

      this.commandHistory.push(result);

      serverLogger.debug('docker-shell', `交互式命令执行完成: ${program}`, JSON.stringify({
        duration,
        commandCount: commands.length,
        outputLength: output.length,
      }));

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      
      const result: CommandResult = {
        command: `${program} (failed)`,
        output: '',
        duration,
      };

      this.commandHistory.push(result);

      serverLogger.error('docker-shell', `交互式命令执行失败: ${program}`, msg);
      throw new Error(`Interactive command failed: ${msg}`);
    }
  }

  /**
   * 获取当前工作目录
   */
  async pwd(): Promise<string> {
    await this.loadState();
    return this.currentWorkdir;
  }

  /**
   * 改变工作目录
   */
  async cd(path: string): Promise<void> {
    await this.execute(`cd ${path}`);
  }

  /**
   * 获取命令历史
   */
  getHistory(): CommandResult[] {
    return [...this.commandHistory];
  }

  /**
   * 关闭会话
   */
  async close(): Promise<void> {
    // 删除状态文件
    try {
      const container = this.docker.getContainer(this.containerId);
      const exec = await container.exec({
        Cmd: [this.shell, '-c', `rm -f ${this.stateFile}`],
        AttachStdout: true,
        AttachStderr: true,
      });
      await exec.start({ Detach: false });
    } catch (error) {
      // 忽略删除失败
    }

    this.isReady = false;
    serverLogger.info('docker-shell', `Shell 会话已关闭: ${this.containerId.substring(0, 12)}`);
  }

  /**
   * 检查会话是否活跃
   */
  isActive(): boolean {
    return this.isReady;
  }
}

/**
 * Docker Shell 会话管理器
 * 管理多个用户的 Shell 会话
 */
export class DockerShellSessionManager {
  private sessions: Map<string, DockerShellSession> = new Map();

  /**
   * 创建或获取会话
   */
  async getOrCreateSession(
    sessionId: string,
    config: ShellSessionConfig
  ): Promise<DockerShellSession> {
    let session = this.sessions.get(sessionId);

    if (session && session.isActive()) {
      return session;
    }

    // 创建新会话
    session = new DockerShellSession(config);
    await session.start();
    this.sessions.set(sessionId, session);

    serverLogger.info('docker-shell', `新会话已创建: ${sessionId}`);
    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): DockerShellSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 关闭会话
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
      serverLogger.info('docker-shell', `会话已关闭: ${sessionId}`);
    }
  }

  /**
   * 关闭所有会话
   */
  async closeAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      await this.closeSession(id);
    }
    serverLogger.info('docker-shell', `所有会话已关闭 (${sessionIds.length} 个)`);
  }

  /**
   * 列出所有会话
   */
  listSessions(): Array<{ sessionId: string; containerId: string; active: boolean }> {
    return Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      containerId: session['containerId'],
      active: session.isActive(),
    }));
  }
}

// 全局会话管理器
export const shellSessionManager = new DockerShellSessionManager();
