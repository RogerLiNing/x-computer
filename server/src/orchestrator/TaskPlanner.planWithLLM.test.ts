import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskPlanner } from './TaskPlanner.js';

vi.mock('../chat/chatService.js', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '../chat/chatService.js';

describe('TaskPlanner planWithLLM', () => {
  let planner: TaskPlanner;

  beforeEach(() => {
    planner = new TaskPlanner();
    vi.mocked(callLLM).mockReset();
  });

  it('LLM 返回合法 JSON 数组时生成对应步骤', async () => {
    vi.mocked(callLLM).mockResolvedValueOnce(
      '[{"action":"理解需求","toolName":"llm.generate"},{"action":"保存到文件","toolName":"file.write"}]',
    );

    const request = {
      domain: 'office' as const,
      title: '写周报',
      description: '生成本周工作周报',
    };
    const llmConfig = {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com',
      apiKey: 'test-key',
    };

    const task = await planner.planWithLLM(request, 'auto', null, llmConfig);

    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(task.steps).toHaveLength(2);
    expect(task.steps[0].action).toBe('理解需求');
    expect(task.steps[0].toolName).toBe('llm.generate');
    expect(task.steps[1].action).toBe('保存到文件');
    expect(task.steps[1].toolName).toBe('file.write');
    expect(task.domain).toBe('office');
  });

  it('LLM 调用或解析失败时回退到模板规划', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('API error'));

    const request = {
      domain: 'office' as const,
      title: '写周报',
      description: '生成本周工作周报',
    };
    const llmConfig = {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'test-key',
    };

    const task = await planner.planWithLLM(request, 'auto', null, llmConfig);

    expect(task.steps.length).toBe(1);
    expect(task.steps[0].toolName).toBe('llm.generate');
    expect(task.steps[0].action).toBe('理解并执行');
  });
});
