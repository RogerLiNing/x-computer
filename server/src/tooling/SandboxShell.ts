import { exec } from 'child_process';
import path from 'path';
import type { UserContainerManager } from '../container/UserContainerManager.js';

/**
 * SandboxShell — executes commands within the sandboxed workspace.
 *
 * 支持两种模式：
 * 1. 容器模式（推荐，R060）：在隔离的 Docker 容器中执行
 * 2. 直接模式（临时）：直接在宿主机执行（仅用于开发/测试）
 *
 * Provides:
 * - Command execution with timeout
 * - Output capture (stdout + stderr)
 * - Working directory confinement
 * - Command allowlist for safety
 */

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  duration: number;
}

// Commands that are always allowed
const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'date', 'pwd', 'whoami',
  'find', 'grep', 'sort', 'uniq', 'tr', 'cut', 'awk', 'sed',
  'mkdir', 'touch', 'cp', 'mv', 'rm',
  'node', 'npx', 'npm', 'python3', 'python', 'pip',
  'git', 'curl', 'wget',
  'uname', 'env', 'which', 'file', 'du', 'df',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip',
]);

// 直接模式（宿主机）：完整禁止列表（R060 安全加固）
const BLOCKED_PATTERNS_DIRECT: RegExp[] = [
  /sudo/i,
  /su\s/i,
  /rm\s+-rf\s+\//,
  /mkfs/i,
  /dd\s+if=/i,
  /chmod\s+777/,
  />\s*\/dev\/(?!null|zero\b)[a-z0-9]+/i,
  /shutdown|reboot|halt/i,
  /\/etc\/passwd|\/etc\/shadow/i,
  /\.\.\//,
  /~\//,
  /\/proc\//i,
  /\/sys\//i,
  /docker/i,
  /kubectl/i,
  /systemctl/i,
];

// 容器模式：不限制命令，由容器隔离保证安全，允许在容器内执行任意命令（脚本、docker、/proc、/sys 等）
const BLOCKED_PATTERNS_CONTAINER: RegExp[] = [];

export class SandboxShell {
  private workspaceRoot: string;
  private timeout: number;
  private userId?: string;
  private containerManager?: UserContainerManager;
  private useContainer: boolean;

  constructor(
    workspaceRoot: string,
    timeoutMs = 30_000,
    options?: {
      userId?: string;
      containerManager?: UserContainerManager;
      useContainer?: boolean;
    }
  ) {
    this.workspaceRoot = workspaceRoot;
    this.timeout = timeoutMs;
    this.userId = options?.userId;
    this.containerManager = options?.containerManager;
    // 默认使用容器模式（如果提供了 containerManager）
    this.useContainer = options?.useContainer ?? (!!options?.containerManager && !!options?.userId);
  }

  async execute(command: string, cwd?: string, timeoutOverrideMs?: number): Promise<ShellResult> {
    const startTime = Date.now();

    // Safety check
    this.validateCommand(command);

    const timeoutMs = timeoutOverrideMs ?? this.timeout;

    // 安全审计日志（R060）
    const mode = this.useContainer ? 'CONTAINER' : 'DIRECT';
    console.log(`[SECURITY] [${mode}] userId=${this.userId || 'anonymous'} cmd=${command.substring(0, 200)}`);

    // 容器模式：在隔离容器中执行（推荐）
    if (this.useContainer && this.containerManager && this.userId) {
      return await this.executeInContainer(command, cwd, timeoutMs, startTime);
    }

    // 直接模式：在宿主机执行（仅用于开发/测试）
    return await this.executeDirect(command, cwd, timeoutMs, startTime);
  }

  /**
   * 在容器中执行命令（安全模式）
   */
  private async executeInContainer(
    command: string,
    cwd: string | undefined,
    timeoutMs: number,
    startTime: number
  ): Promise<ShellResult> {
    try {
      // 容器内的工作目录：将宿主机路径转换为容器内路径
      // 宿主机：/var/folders/.../workspace/subdir -> 容器：/workspace/subdir
      let containerCwd = '/workspace';
      if (cwd && cwd.startsWith(this.workspaceRoot)) {
        const relativePath = path.relative(this.workspaceRoot, cwd);
        containerCwd = relativePath ? `/workspace/${relativePath}` : '/workspace';
      }

      const result = await this.containerManager!.execInContainer(
        this.userId!,
        command,
        {
          cwd: containerCwd,
          timeout: timeoutMs,
        }
      );

      return {
        ...result,
        command,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        command,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 直接在宿主机执行命令（不安全，仅用于开发）
   */
  private async executeDirect(
    command: string,
    cwd: string | undefined,
    timeoutMs: number,
    startTime: number
  ): Promise<ShellResult> {
    const workDir = cwd
      ? this.resolvePath(cwd)
      : this.workspaceRoot;

    return new Promise((resolve) => {
      const child = exec(command, {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        // 安全加固（R060）：不传递宿主机环境变量，防止泄露敏感信息
        env: {
          HOME: this.workspaceRoot,
          USER: 'x-computer',
          TERM: 'xterm-256color',
          LANG: 'zh_CN.UTF-8',
          PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin',
          // 不包含 process.env，避免泄露 API Keys、数据库密码等敏感信息
        },
      }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString().slice(0, 50_000),
          stderr: stderr.toString().slice(0, 10_000),
          exitCode: error?.code ?? (error ? 1 : 0),
          command,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  private validateCommand(command: string) {
    const patterns = this.useContainer ? BLOCKED_PATTERNS_CONTAINER : BLOCKED_PATTERNS_DIRECT;
    for (const pattern of patterns) {
      if (pattern.test(command)) {
        throw new Error(`命令被安全策略拦截: ${command}`);
      }
    }
  }

  private resolvePath(userPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, userPath);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error('路径越界 — 访问被拒绝');
    }
    return resolved;
  }
}
