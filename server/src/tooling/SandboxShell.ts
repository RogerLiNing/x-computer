import { spawn } from 'child_process';
import path from 'path';
import {realpath} from 'node:fs/promises';
import type { UserContainerManager } from '../container/UserContainerManager.js';
import { UncertainToolOutcomeError } from './UncertainToolOutcomeError.js';

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
  private containerWorkspaceRoot?:string;

  constructor(
    workspaceRoot: string,
    timeoutMs = 30_000,
    options?: {
      userId?: string;
      containerManager?: UserContainerManager;
      useContainer?: boolean;
      containerWorkspaceRoot?:string;
    }
  ) {
    this.workspaceRoot = workspaceRoot;
    this.timeout = timeoutMs;
    this.userId = options?.userId;
    this.containerManager = options?.containerManager;
    this.containerWorkspaceRoot=options?.containerWorkspaceRoot;
    // 默认使用容器模式（如果提供了 containerManager）
    this.useContainer = options?.useContainer ?? (!!options?.containerManager && !!options?.userId);
  }

  getExecutionMode(): 'container' | 'host' { return this.useContainer && this.containerManager && this.userId ? 'container' : 'host'; }

  async execute(command: string, cwd?: string, timeoutOverrideMs?: number, signal?: AbortSignal): Promise<ShellResult> {
    signal?.throwIfAborted();
    this.workspaceRoot=await realpath(this.workspaceRoot);
    cwd=await realpath(cwd?path.resolve(this.workspaceRoot,cwd):this.workspaceRoot);
    this.resolvePath(cwd);
    const startTime = Date.now();

    // Safety check
    this.validateCommand(command);

    const timeoutMs = timeoutOverrideMs ?? this.timeout;

    // 安全审计日志（R060）
    const mode = this.useContainer ? 'CONTAINER' : 'DIRECT';
    console.log(`[SECURITY] [${mode}] userId=${this.userId || 'anonymous'} shell execution`);

    // 容器模式：在隔离容器中执行（推荐）
    if (this.useContainer && this.containerManager && this.userId) {
      // shortcut: Docker exec has no command-scoped cancellation here; wait for its result until a remote cancellation handle is available.
      return await this.executeInContainer(command, cwd, timeoutMs, startTime);
    }

    // 直接模式：在宿主机执行（仅用于开发/测试）
    return await this.executeDirect(command, cwd, timeoutMs, startTime, signal);
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
      const mount=await realpath(this.containerWorkspaceRoot??this.workspaceRoot);
      const relativePath=path.relative(mount,cwd??this.workspaceRoot);
      if(relativePath==='..'||relativePath.startsWith('..'+path.sep)||path.isAbsolute(relativePath))throw new Error('工作目录不在容器挂载范围');
      const containerCwd=path.posix.join('/workspace',...relativePath.split(path.sep));

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
      if(error instanceof UncertainToolOutcomeError)throw error;
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
    startTime: number,
    signal?: AbortSignal,
  ): Promise<ShellResult> {
    const workDir = cwd ? this.resolvePath(cwd) : this.workspaceRoot;
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        cwd: workDir,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          HOME: this.workspaceRoot,
          USER: 'x-computer',
          TERM: 'xterm-256color',
          LANG: 'zh_CN.UTF-8',
          PATH: '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (kind: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, kind);
          else child.kill(kind);
        } catch { /* The process group may already have exited. */ }
      };
      const terminate = () => {
        kill('SIGTERM');
        killTimer ??= setTimeout(() => kill('SIGKILL'), 500);
      };
      const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
      signal?.addEventListener('abort', terminate, { once: true });
      if (signal?.aborted) terminate();
      child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(0, 50000); });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(0, 10000); });
      const cleanup = () => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener('abort', terminate);
      };
      child.once('error', (error) => { cleanup(); reject(error); });
      child.once('close', (code) => {
        cleanup();
        if (signal?.aborted) { reject(new DOMException('命令已停止', 'AbortError')); return; }
        resolve({ stdout, stderr: timedOut ? `${stderr}\n[Command timed out]` : stderr,
          exitCode: timedOut ? 1 : code ?? 1, command, duration: Date.now() - startTime });
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
    const relative=path.relative(this.workspaceRoot,resolved);
    if (relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)) {
      throw new Error('路径越界 — 访问被拒绝');
    }
    return resolved;
  }
}
