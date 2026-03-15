import path from 'path';
import os from 'os';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ToolExecutor } from './ToolExecutor.js';
import { SandboxFS } from '../tooling/SandboxFS.js';

// 模拟：模型返回的主回复是「AI 生成内容」，但 tool_call 里误带了「用户问题」
vi.mock('../chat/chatService.js', () => ({
  callLLM: vi.fn(),
  callLLMWithTools: vi.fn().mockResolvedValue({
    content: '这是模型生成的正确结果。',
    toolCalls: [
      {
        name: 'file_write',
        arguments: {
          path: '文档/saved.txt',
          content: '用户的问题内容', // 错误：不应写入文件
        },
      },
    ],
  }),
}));

describe('ToolExecutor llm.generate 保存结果', () => {
  const workspaceRoot = path.join(os.tmpdir(), `x-computer-llm-gen-test-${Date.now()}`);
  let sandboxFS: SandboxFS;
  let executor: ToolExecutor;

  beforeAll(async () => {
    sandboxFS = new SandboxFS(workspaceRoot);
    await sandboxFS.init();
    executor = new ToolExecutor(sandboxFS);
  });

  it('写入文件时使用模型主回复 text，而非 tool 的 content（避免误存用户问题）', async () => {
    const step = {
      id: 'step-1',
      taskId: 'task-1',
      action: '生成回复',
      toolName: 'llm.generate',
      toolInput: { description: '用户的问题：请介绍机器学习并保存到 文档/saved.txt' },
      status: 'pending' as const,
      riskLevel: 'low' as const,
    };
    const context = {
      llmConfig: {
        providerId: 'openai',
        modelId: 'gpt-4',
        baseUrl: 'https://api.openai.com',
        apiKey: 'test-key',
      },
    };

    const call = await executor.execute(step, 'container', context);

    expect(call.error).toBeUndefined();
    expect(call.output).toBeDefined();
    const output = call.output as { text?: string; writtenFiles?: string[] };
    expect(output?.writtenFiles).toContain('文档/saved.txt');

    const fileContent = await sandboxFS.read('文档/saved.txt');
    expect(fileContent).toBe('这是模型生成的正确结果。');
    expect(fileContent).not.toBe('用户的问题内容');
  });
});
