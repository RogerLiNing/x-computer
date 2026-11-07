import { SandboxShell } from '../../../tooling/SandboxShell.js';
import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { ScriptAnalyzer } from '../../../security/ScriptAnalyzer.js';
import { DangerousCommandDetector } from '../../../security/DangerousCommandDetector.js';
import { shellApprovalRequest, ShellApprovalRequiredError } from '../../../tooling/shellApproval.js';
import { UncertainToolOutcomeError } from '../../../tooling/UncertainToolOutcomeError.js';

export const shellRunDefinition: ToolDefinition = {
  name: 'shell.run',
  displayName: '运行命令',
  description:
    '申请在工作区运行一条 Shell 命令。每条命令都须由用户在交办记录中逐次确认；申请后服务端暂停，尚未执行，不得自己确认或声称成功。批准只适用于保存的命令、工作目录和超时，不能换参数。workdir 是沙箱内相对目录。脚本及组合命令同样需要确认。',
  domain: ['coding', 'agent'],
  riskLevel: 'high',
  parameters: [
    { name: 'command', type: 'string', description: '要执行的命令（可包含你刚写入的脚本路径）', required: true },
    { name: 'workdir', type: 'string', description: '沙箱内工作目录，相对沙箱根', required: false },
    { name: 'timeout', type: 'number', description: '超时毫秒数，默认 60000', required: false },
  ],
  requiredPermissions: ['shell'],
};

type CtxWithUser = { userId?: string; agentId?: string; agentRunId?:string; runId?:string;toolCallId?:string;approvedShellHash?:string;signal?: AbortSignal };

export function createShellRunHandler(deps: ToolExecutorDeps): ToolHandler {
  return async (input, ctx) => {
    const signal = (ctx as CtxWithUser | undefined)?.signal;
    signal?.throwIfAborted();
    const fs = await deps.resolveFS(ctx);
    if (!fs) throw new Error('shell.run: 沙箱不可用');
    const command = String(input.command ?? '').trim();
    if (!command) throw new Error('shell.run: command is required');
    
    // 安全检查 1：检测危险命令
    const cmdAnalysis = DangerousCommandDetector.analyze(command);
    if (cmdAnalysis.severity === 'critical') {
      return {
        ok: false,
        error: '极度危险的命令已拒绝，尚未执行',
        exitCode: 1,
        stdout: '',
        stderr: `🔴 安全拦截：检测到极度危险的命令，已被拒绝\n\n` +
          `命令: ${command}\n` +
          `风险: ${cmdAnalysis.description}\n` +
          `说明: ${cmdAnalysis.suggestion}`,
        duration: 0,
      };
    }
    const scope=(ctx as CtxWithUser|undefined) ?? {};
    const target=scope.userId&&scope.userId!=='anonymous'&&deps.userSandboxManager
      ? scope.agentId?await deps.userSandboxManager.getForAgent(scope.userId,scope.agentId,scope.agentRunId):await deps.userSandboxManager.getForUser(scope.userId):undefined;
    const runner=target?.sandboxShell??new SandboxShell(fs.getRoot());
    const request = await shellApprovalRequest(input, fs.getRoot(), scope, runner.getExecutionMode());
    if ((ctx as CtxWithUser|undefined)?.approvedShellHash !== request.hash) throw new ShellApprovalRequiredError(request);
    
    if (cmdAnalysis.severity === 'high') {
      console.warn('[SECURITY] 已确认的高风险命令', cmdAnalysis.description);
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
            error: '脚本安全检查未通过，尚未执行',
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
    
    const workdir = request.workdir;
    const timeoutMs = request.timeout;
    const root = request.workspace;
    const pathMod = await import('path');
    const cwd = pathMod.resolve(root, workdir.replace(/^\//, ''));
    const relative=pathMod.relative(root,cwd);
    if (relative==='..'||relative.startsWith('..'+pathMod.sep)||pathMod.isAbsolute(relative)) throw new Error('shell.run: workdir 必须在沙箱内');

      try {
        const result = await runner.execute(command, cwd, timeoutMs, signal);
        return {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 50000),
          stderr: result.stderr.slice(0, 10000),
          duration: result.duration,
        };
      } catch (err: unknown) {
        if (err instanceof UncertainToolOutcomeError || err instanceof Error && err.name === 'AbortError') throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`shell.run: ${msg}`);
      }
  };
}
