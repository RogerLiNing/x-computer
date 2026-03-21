import type { UserSandboxManager } from '../tooling/UserSandboxManager.js';
import type { SandboxFS } from '../tooling/SandboxFS.js';
import { MemoryService } from '../memory/MemoryService.js';
import { VectorStore } from '../memory/vectorStore.js';
import { callLLM } from '../chat/chatService.js';
import { MEMORY_CONSIDER_SYSTEM_PROMPT, LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT } from '../prompts/systemCore.js';

export class MemoryServiceWrapper {
  private vectorStore;
  private defaultMemoryService: MemoryService;

  constructor(
    sandboxFS: SandboxFS,
    private userSandboxManager?: UserSandboxManager,
  ) {
    this.vectorStore = new VectorStore(sandboxFS);
    this.defaultMemoryService = new MemoryService(sandboxFS, this.vectorStore);
  }

  async getForUser(userId: string | undefined): Promise<MemoryService | null> {
    if (!userId || userId === 'anonymous' || !this.userSandboxManager) return null;
    const { sandboxFS } = await this.userSandboxManager.getForUser(userId);
    return new MemoryService(sandboxFS, this.vectorStore);
  }

  async runConsiderCapture(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
    vectorProviderId?: string;
    vectorModelId?: string;
    vectorBaseUrl?: string;
    vectorApiKey?: string;
    workspaceId?: string;
  }): Promise<void> {
    const ms = (await this.getForUser(params.workspaceId)) ?? this.defaultMemoryService;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: MEMORY_CONSIDER_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${params.userMessage}\n\n助手：${params.assistantReply}` },
      ],
      providerId: params.providerId,
      modelId: params.modelId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
    const typeLine = (lines[0] ?? '').toUpperCase();
    const typeMap = { PREFERENCE: 'preference' as const, DECISION: 'decision' as const, FACT: 'fact' as const };
    const type = typeMap[typeLine as keyof typeof typeMap] ?? 'fact';
    const content = (lines.slice(1).join(' ').trim() || lines[0] || trimmed).trim();
    if (!content) return;
    await ms.capture(content, type);
  }

  async runLearnPromptExtract(params: {
    userMessage: string;
    assistantReply: string;
    providerId: string;
    modelId: string;
    baseUrl?: string;
    apiKey?: string;
  }): Promise<void> {
    const ms = this.defaultMemoryService;
    const raw = await callLLM({
      messages: [
        { role: 'system', content: LEARNED_PROMPT_EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `用户：${params.userMessage}\n\n助手：${params.assistantReply}` },
      ],
      providerId: params.providerId,
      modelId: params.modelId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
    });
    const trimmed = (raw ?? '').trim();
    if (!trimmed || trimmed.toUpperCase() === 'NONE') return;
    const lines = trimmed.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    for (const line of lines) {
      if (line.length > 200) continue;
      await ms.appendLearnedPrompt(line);
    }
  }
}
