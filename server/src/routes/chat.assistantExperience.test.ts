import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callLLM, callLLMWithTools } from '../chat/chatService.js';
import { MemoryService } from '../memory/MemoryService.js';
import type { AgentOrchestrator } from '../orchestrator/AgentOrchestrator.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { createChatRouter } from './chat.js';

vi.mock('../chat/chatService.js', () => ({
  callLLM: vi.fn().mockResolvedValue('完成'),
  callLLMStream: vi.fn(),
  callLLMWithTools: vi.fn().mockResolvedValue({ content: '完成', toolCalls: [] }),
  callLLMGenerateImage: vi.fn(),
}));
vi.mock('../llm/credentialResolver.js', () => ({
  resolveLLMCredentials: vi.fn().mockResolvedValue({ providerId: 'openai', modelId: 'test-model' }),
}));

const livingContext = '已确认的长期目标：准备周报；当前正在收集资料。';
const getLivingAIContext = vi.fn().mockResolvedValue(livingContext);
const runChatAgentLoop = vi.fn(async (_params: { systemPrompt: string }) => ({ content: '完成' }));

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId: string }).userId = req.header('X-User-Id') ?? 'assistant-user';
    next();
  });
  const orchestrator = {
    getTools: () => [],
    getLLMToolDefsFiltered: async () => [],
    runChatAgentLoop,
  } as unknown as AgentOrchestrator;
  app.use(createChatRouter(orchestrator, {} as SandboxFS, (_req, _res, next) => next(),
    undefined, undefined, undefined, getLivingAIContext));
  return app;
}

const body = {
  messages: [{ role: 'user', content: '继续吧' }],
  providerId: 'openai',
  modelId: 'test-model',
  tools: [{ name: 'write_to_editor', description: 'Write', parameters: { type: 'object' } }],
};

beforeEach(() => {
  vi.spyOn(MemoryService.prototype, 'readLearnedPrompt').mockResolvedValue('');
  vi.spyOn(MemoryService.prototype, 'ensureEvolvedCorePromptExists').mockResolvedValue();
  vi.spyOn(MemoryService.prototype, 'readEvolvedCorePrompt').mockResolvedValue('');
  getLivingAIContext.mockResolvedValue(livingContext);
});

describe('assistant continuity', () => {
  it.each(['/chat', '/chat/with-tools', '/chat/agent', '/chat/agent/stream'])(
    '%s shares the current user’s confirmed goals with the everyday assistant',
    async (endpoint) => {
      const res = await request(createTestApp()).post(endpoint).send({ ...body, scene: 'normal_chat' });
      expect(res.status).toBe(200);
      expect(getLivingAIContext).toHaveBeenCalledWith('assistant-user');
      const prompt = endpoint === '/chat'
        ? vi.mocked(callLLM).mock.calls[0]?.[0].messages[0]?.content
        : endpoint === '/chat/with-tools'
          ? vi.mocked(callLLMWithTools).mock.calls[0]?.[0].messages[0]?.content
          : runChatAgentLoop.mock.calls[0]?.[0]?.systemPrompt;
      expect(prompt).toContain(livingContext);
    },
  );

  it.each(['write_to_editor', 'editor_agent', 'edit_current_document', 'intent_classify', 'extract_clean_content', 'none'])(
    'does not add continuous goals to the %s utility scene',
    async (scene) => {
      const res = await request(createTestApp()).post('/chat').send({ ...body, scene });
      expect(res.status).toBe(200);
      expect(getLivingAIContext).not.toHaveBeenCalled();
      expect(vi.mocked(callLLM).mock.calls[0]?.[0].messages[0]?.content).not.toContain(livingContext);
    },
  );

  it('does not read user state for anonymous conversations', async () => {
    const res = await request(createTestApp()).post('/chat/agent/stream')
      .set('X-User-Id', 'anonymous').send({ ...body, scene: 'normal_chat' });
    expect(res.status).toBe(200);
    expect(getLivingAIContext).not.toHaveBeenCalled();
  });

  it('continues the conversation when persistent context is temporarily unavailable', async () => {
    getLivingAIContext.mockRejectedValueOnce(new Error('state unavailable'));
    const res = await request(createTestApp()).post('/chat/agent/stream').send({ ...body, scene: 'normal_chat' });
    expect(res.status).toBe(200);
    expect(getLivingAIContext).toHaveBeenCalledWith('assistant-user');
    expect(runChatAgentLoop).toHaveBeenCalled();
    expect(res.text).toContain('event: done');
  });
});
