import { v4 as uuid } from 'uuid';
import type {
  Task,
  TaskStep,
  TaskDomain,
  CreateTaskRequest,
  ExecutionMode,
  RiskLevel,
  ComputerContext,
  TaskLLMConfig,
} from '../../../shared/src/index.js';
import { callLLM } from '../chat/chatService.js';

/**
 * TaskPlanner — 由 AI 动态规划步骤，不固化任务流程（对齐 OpenClaw/OpenCode）。
 *
 * 有 llmConfig 时由 planWithLLM 用 LLM 根据用户描述生成步骤；无 LLM 时 plan() 仅做单步兜底。
 */

/** 当前已实现的工具（对齐 OpenClaw/OpenCode：llm、file、grep、shell、http） */
const IMPLEMENTED_TOOL_NAMES = new Set([
  'llm.generate',
  'file.write',
  'file.read',
  'file.replace',
  'file.list',
  'grep',
  'shell.run',
  'sleep',
  'http.request',
]);

export class TaskPlanner {
  /**
   * 无 LLM 时的兜底：单步「理解并执行」，由 llm.generate 处理描述。
   * 不按域固化流程，有 llmConfig 时应走 planWithLLM。
   */
  plan(request: CreateTaskRequest, mode: ExecutionMode, computerContext?: ComputerContext | null): Task {
    const taskId = uuid();
    const steps: TaskStep[] = [
      {
        id: `${taskId}-step-0`,
        taskId,
        action: '理解并执行',
        toolName: 'llm.generate',
        toolInput: { description: request.description },
        status: 'pending',
        riskLevel: 'low',
      },
    ];

    return {
      id: taskId,
      domain: request.domain,
      title: request.title,
      description: request.description,
      status: 'planning',
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: computerContext ? { computerContext } : undefined,
    };
  }

  /**
   * 用 LLM 根据用户描述与上下文生成步骤（可选，需 llmConfig）。
   * 若 LLM 调用或解析失败则回退到模板规划。
   */
  async planWithLLM(
    request: CreateTaskRequest,
    mode: ExecutionMode,
    computerContext: ComputerContext | null | undefined,
    llmConfig: TaskLLMConfig,
  ): Promise<Task> {
    const taskId = uuid();
    const toolsList = 'llm.generate, file.write, file.read, file.replace, file.list, grep, shell.run, sleep, http.request';
    const contextStr =
      computerContext != null
        ? `\n当前上下文（仅供参考）：${JSON.stringify(computerContext, null, 0).slice(0, 800)}`
        : '';
    const prompt = `你是一个任务规划助手。根据用户描述生成执行步骤。

用户任务（域: ${request.domain}）：${request.description}${contextStr}

可用工具名：${toolsList}

请只输出一个 JSON 数组，每项为 { "action": "简短动作描述", "toolName": "工具名" }，工具名只能从上述列表中选。例如：
[{"action":"理解并生成回复","toolName":"llm.generate"},{"action":"保存到文件","toolName":"file.write"}]`;

    try {
      const raw = await callLLM({
        messages: [{ role: 'user', content: prompt }],
        providerId: llmConfig.providerId,
        modelId: llmConfig.modelId,
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
      });
      const trimmed = (raw ?? '').trim().replace(/^```\w*\n?|\n?```$/g, '').trim();
      const match = trimmed.match(/\[[\s\S]*\]/);
      const jsonStr = match ? match[0] : trimmed;
      const parsed = JSON.parse(jsonStr) as Array<{ action?: string; toolName?: string }>;
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty or invalid steps');
      const steps: TaskStep[] = parsed.slice(0, 15).map((item, idx) => {
        const rawTool = String(item?.toolName ?? 'llm.generate').slice(0, 80);
        const toolName = IMPLEMENTED_TOOL_NAMES.has(rawTool) ? rawTool : 'llm.generate';
        return {
          id: `${taskId}-step-${idx}`,
          taskId,
          action: String(item?.action ?? `步骤 ${idx + 1}`).slice(0, 100),
          toolName,
          toolInput: { description: request.description },
          status: 'pending',
          riskLevel: 'medium' as RiskLevel,
        };
      });
      return {
        id: taskId,
        domain: request.domain,
        title: request.title,
        description: request.description,
        status: 'planning',
        steps,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: computerContext ? { computerContext } : undefined,
      };
    } catch {
      return this.plan(request, mode, computerContext);
    }
  }

  /**
   * Re-plan remaining steps (e.g., after failure / partial completion).
   */
  replan(task: Task): TaskStep[] {
    const remaining = task.steps.filter(
      (s) => s.status === 'pending' || s.status === 'failed',
    );
    // In production: call LLM to adjust plan based on what succeeded / failed.
    return remaining.map((s) => ({ ...s, status: 'pending' as const }));
  }
}
