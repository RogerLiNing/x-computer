import { spawn } from 'child_process';
import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { ScriptAnalyzer } from '../../../security/ScriptAnalyzer.js';
import { DangerousCommandDetector } from '../../../security/DangerousCommandDetector.js';

export const shellRunDefinition: ToolDefinition = {
  name: 'shell.run',
  displayName: '运行命令',
  description:
    '在沙箱工作区内执行 shell 命令。命令的 cwd 固定为宿主机上的工作区路径，你可先 file.write 写入脚本，再执行 node 脚本.js、python3 脚本.py 等；脚本在子目录时传 workdir 指定相对沙箱根的工作目录。',
  domain: ['coding', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'command', type: 'string', description: '要执行的命令（可包含你刚写入的脚本路径）', required: true },
    { name: 'workdir', type: 'string', description: '沙箱内工作目录，相对沙箱根', required: false },
    { name: 'timeout', type: 'number', description: '超时毫秒数，默认 60000', required: false },
  ],
  requiredPermissions: ['shell'],
};

type CtxWithUser = { userId?: string; agentId?: string };

export function createShellRunHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const fs = await deps.resolveFS(ctx);
    if (!fs) throw new Error('shell.run: 沙箱不可用');
    const command = String(input.command ?? '').trim();
    if (!command) throw new Error('shell.run: command is required');
    
    // 安全检查 1：检测危险命令
    const cmdAnalysis = DangerousCommandDetector.analyze(command);
    if (cmdAnalysis.severity === 'critical') {
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: `🔴 安全拦截：检测到极度危险的命令，已被拒绝\n\n` +
          `命令: ${command}\n` +
          `风险: ${cmdAnalysis.description}\n` +
          `说明: ${cmdAnalysis.suggestion}`,
        duration: 0,
      };
    }
    
    if (cmdAnalysis.severity === 'high') {
      console.warn('[SECURITY] 高风险命令:', command, '-', cmdAnalysis.description);
    }
    
    // 安全检查 2：分析脚本执行命令
    const scriptMatch = command.match(/^(python3?|node|bash|sh)\s+(.+?)(\s|$)/);
    if (scriptMatch) {
      const [, interpreter, scriptPath] = scriptMatch;
      try {
        // 读取脚本内容
        const scriptContent = await fs.read(scriptPath.trim());
        const analysis = ScriptAnalyzer.analyze(scriptPath, scriptContent);
        
        // 高风险脚本：拒绝执行
        if (analysis.riskLevel === 'high') {
          return {
            ok: false,
            exitCode: 1,
            stdout: '',
            stderr: `🔴 安全拦截：脚本包含高风险操作，已被拒绝\n\n` +
              `脚本: ${scriptPath}\n` +
              `解释器: ${interpreter}\n\n` +
              `风险分析：\n${analysis.reasons.join('\n')}\n\n` +
              `${analysis.suggestions?.join('\n') || ''}`,
            duration: 0,
          };
        }
        
        // 中风险脚本：警告但允许执行
        if (analysis.riskLevel === 'medium') {
          const warning = `⚠️ 安全警告：即将执行中等风险脚本 ${scriptPath}\n${analysis.reasons.join('\n')}`;
          console.warn('[SECURITY]', warning);
        }
      } catch (err) {
        // 脚本文件不存在或无法读取，继续执行（可能是命令行参数）
      }
    }
    
    const workdir = String(input.workdir ?? '').trim() || '.';
    const timeoutMs = Math.min(300000, Math.max(5000, Number(input.timeout) || 60000));
    const root = fs.getRoot();
    const pathMod = await import('path');
    const cwd = pathMod.resolve(root, workdir.replace(/^\//, ''));
    if (!cwd.startsWith(root)) throw new Error('shell.run: workdir 必须在沙箱内');

    const uid = (ctx as CtxWithUser)?.userId;
    if (uid && uid !== 'anonymous' && deps.userSandboxManager) {
      const agentId = (ctx as CtxWithUser)?.agentId;
      const sandbox = agentId
        ? await deps.userSandboxManager.getForAgent(uid, agentId)
        : await deps.userSandboxManager.getForUser(uid);
      try {
        const result = await sandbox.sandboxShell.execute(command, cwd, timeoutMs);
        return {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 50000),
          stderr: result.stderr.slice(0, 10000),
          duration: result.duration,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`shell.run: ${msg}`);
      }
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(command, {
        shell: true,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
      proc.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          exitCode: -1,
          timedOut: true,
          stdout: stdout.slice(0, 50000),
          stderr: (stderr + '\n[Command timed out]').slice(0, 10000),
        });
      }, timeoutMs);
      proc.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? undefined,
          signal: signal ?? undefined,
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 10000),
        });
      });
      proc.once('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`shell.run: ${err.message}`));
      });
    });
  };
}
